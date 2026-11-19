import {
  hashCheckpointJson,
  applyManagementTick,
  createRosterDecoder,
  decodeHumanFinishers,
  createSeatListDecoder,
  createHeldInputDecoder,
  createCheckpointBaseDecoder,
  CHECKPOINT_HEADER_FIELDS,
  validCheckpointLifecycle,
  defaultText,
  hasLogPosition,
  isManagementEntry,
  uint32,
  type LifecycleHooks,
  type ManagedRoom,
  type ManagementEntry,
  type RollbackGame,
  type SeatRecord,
  type StreamEntries,
} from "fuse-netcode";
import {
  INPUT_MASK,
  createWorld,
  stepWorld,
  botInput,
  type World,
} from "./canal.js";
import { decodeWorld } from "./validate.js";
import { CAPACITY, BOT_PREFIX, validName } from "./basics.js";
import {
  AVATAR,
  isAvatar,
  playerKey,
  validMatchId,
  seatName,
} from "./names.js";
export { seatName };
export interface Settings {
  display: boolean;
}
export const DEFAULT_SETTINGS: Settings = { display: false };
export function parseSettings(raw: unknown): Settings | undefined {
  if (
    plain(raw) &&
    Object.keys(raw).length === 1 &&
    typeof raw.display === "boolean"
  )
    return { display: raw.display };
}
const isInput = (n: unknown): n is number => uint32(n) && n <= INPUT_MASK;
function seedOf(s: string) {
  let n = 0;
  for (const ch of s) n = (Math.imul(n, 31) + ch.charCodeAt(0)) >>> 0;
  return n;
}
export const PLAY = 0;
/** A seat's held control bits from this tick on, for the match it names. A new round keeps what is held. */
export type PlayEntry = [
  seq: number,
  tick: number,
  kind: typeof PLAY,
  matchId: string,
  bits: number,
];
export type Entry = ManagementEntry<Settings> | PlayEntry;

export const MAX_WATCHERS = 5;
/** A room is in its lobby, in play, or showing the delivery result. */
export type RoomStage = "lobby" | "running" | "over";

/**
 * A bot's controls for the tick about to run: ordinary held bits, read off the world like a player reads the screen.
 * It is asked once per log tick, so a bot presses and releases no faster than a device can.
 */
export type BotInput = (world: World, slot: number) => number;
/** A bot that holds nothing. */
export const idleBot: BotInput = () => 0;
/** A pilot of the current match as it started: the result names them even if the seat is gone by the end. */
export interface Entrant {
  id: string;
  name: string;
  /** West (0) or east (1). */
  slot: number;
  bot: boolean;
}
/** The finished match, frozen on the tick it was decided so every replica reports the same thing. */
export interface Decided {
  /** The game clock (`simulationTick`) as of the deciding tick: a report waits until it is confirmed. */
  clock: number;
  /** Pilots who delivered on the deciding tick, in seat order. */
  winners: string[];
  /** The humans still seated when it ended, sorted: who can attest the result. */
  finishers: string[];
}

export interface Room extends ManagedRoom<Settings> {
  tick: number;
  simulationTick: number;
  matchId: string;
  stage: RoomStage;
  /** The settings the current match plays with, fixed at its start. */
  play: Settings;
  /** Each pilot's held bits, from the latest entry its seat logged this match; absent when nothing is held. */
  held: Record<string, number>;
  /** The match's pilots in lane order (two); empty in the lobby. */
  roster: Entrant[];
  decided: Decided | null;
  world: World | null;
}

export interface SeatView {
  id: string;
  name: string;
  avatarId: string;
  slot: number;
  bot: boolean;
  connected: boolean;
  away: boolean;
  watcher: boolean;
}
/** What the screen renders. Outcomes are read from here, never from events, so a rollback's correction shows. */
export interface View {
  /** The game clock: steps simulated, one per log tick. */
  tick: number;
  logTick: number;
  stage: RoomStage;
  matchId: string;
  /** The lobby's settings: the next match's. */
  settings: Settings;
  /** The settings of the match being played. */
  play: Settings;
  seats: SeatView[];
  /** The match's pilots in lane order, named as they started. */
  roster: Entrant[];
  /** The winners' ids once `stage` is "over" (several when it is drawn), otherwise none. */
  winners: string[];
  decided: Decided | null;
  world: World | null;
}

const plain = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const payloads = {
  name: validName,
  avatar: isAvatar,
  settings: (value: unknown) => parseSettings(value) !== undefined,
  memberKey: playerKey,
  matchKey: validMatchId,
  capacity: CAPACITY,
};
export function isEntry(raw: unknown): raw is Entry {
  if (isManagementEntry(raw, payloads)) return true;
  return (
    hasLogPosition(raw) &&
    raw.length === 5 &&
    raw[2] === PLAY &&
    validMatchId(raw[3]) &&
    isInput(raw[4])
  );
}

export function createRoom(matchId: string, settings: Settings): Room {
  return {
    tick: 0,
    simulationTick: 0,
    matchId,
    stage: "lobby",
    seats: new Map(),
    settings: { ...settings },
    play: { ...settings },
    held: {},
    roster: [],
    decided: null,
    world: null,
  };
}

/** Seats in slot order, watchers excluded. */
export const pilots = (room: Room): SeatRecord[] =>
  [...room.seats.values()]
    .filter((seat) => !seat.watcher)
    .sort((a, b) => a.slot - b.slot);

function resetMatch(room: Room, matchId: string): void {
  room.matchId = matchId;
  room.play = { ...room.settings };
  room.stage = "lobby";
  room.held = {};
  room.roster = [];
  room.decided = null;
  room.world = null;
}
/** Starts a match for the seats, in seat order, or leaves the room in its lobby when fewer than two are seated. */
function beginMatch(room: Room): void {
  const seated = pilots(room);
  if (seated.length < CAPACITY) return;
  room.stage = "running";
  room.roster = seated.map((seat, index) => ({
    id: seat.id,
    name: seat.name,
    slot: index,
    bot: seat.bot,
  }));
  room.world = createWorld(
    seated.map((seat) => seat.id),
    seedOf(room.matchId),
  );
}

export const lifecycle: LifecycleHooks<Room, Settings> = {
  stage: (room) => room.stage,
  maxWatchers: MAX_WATCHERS,
  parseSettings,
  botAvatar: AVATAR,
  start(room, matchId) {
    if (pilots(room).length < CAPACITY) return;
    resetMatch(room, matchId);
    beginMatch(room);
  },
  // A rematch with too few pilots left falls back to the lobby, where the room can seat someone or add a bot.
  rematch(room, matchId) {
    resetMatch(room, matchId);
    beginMatch(room);
  },
  lobby(room, matchId) {
    resetMatch(room, matchId);
  },
};

/** Steps every log tick runs: one, always. */
export const MAX_STEPS_PER_TICK = 1;
export const steps = (_room: Room): number => 1;

function decide(room: Room, world: World, clock: number): void {
  const slots = world.winners;
  if (!slots.length) return;
  room.stage = "over";
  // The match is done with its controls: the next one starts with nothing held.
  room.held = {};
  room.decided = {
    clock,
    winners: slots.map((slot) => world.rigs[slot]!.id),
    finishers: room.roster
      .filter((entrant) => {
        const seat = room.seats.get(entrant.id);
        return !entrant.bot && seat && (seat.connected || seat.away === true);
      })
      .map((entrant) => entrant.id)
      .sort(),
  };
}

export function foldTick(
  room: Room,
  creatorId: string,
  streams: ReadonlyMap<string, StreamEntries<Entry>>,
  bot: BotInput = idleBot,
): never[] {
  const tick = room.tick + 1;
  applyManagementTick(room, tick, creatorId, streams, lifecycle);
  const world = room.world;
  if (room.stage === "running" && world) {
    const controls = world.rigs.map((pilot, slot) => {
      const seat = room.seats.get(pilot.id);
      if (seat?.bot) return bot(world, slot);
      if (!seat?.connected || seat.watcher) {
        delete room.held[pilot.id];
        return 0;
      }
      const stream = streams.get(pilot.id);
      const source =
        stream?.generation === seat.generation
          ? stream
          : stream?.retired?.find((s) => s.generation === seat.generation);
      const samples = (source?.entries ?? [])
        .filter(
          (e): e is PlayEntry =>
            e[1] === tick && e[2] === PLAY && e[3] === room.matchId,
        )
        .sort((a, b) => a[0] - b[0])
        .map((e) => e[4]);
      if (!samples.length) return room.held[pilot.id] ?? 0;
      const held = samples[samples.length - 1]!;
      if (held) room.held[pilot.id] = held;
      else delete room.held[pilot.id];
      return samples;
    });
    stepWorld(world, controls);
    if (world.winners.length) decide(room, world, tick);
  }
  room.tick = tick;
  room.simulationTick = tick;
  return [];
}

// ---- checkpoint ----
const STAGES: readonly RoomStage[] = ["lobby", "running", "over"];
const FIELDS = 10;
const seatOrder = (a: SeatRecord, b: SeatRecord) =>
  a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function encode(room: Room): unknown[] {
  return [
    room.matchId,
    room.stage,
    { ...room.settings },
    [...room.seats.values()].sort(seatOrder).map((seat) => ({ ...seat })),
    { ...room.play },
    Object.entries(room.held).sort(([a], [b]) => (a < b ? -1 : 1)),
    room.roster.map((entrant) => [entrant.id, entrant.name, entrant.bot]),
    room.decided
      ? [
          room.decided.clock,
          [...room.decided.winners],
          [...room.decided.finishers],
        ]
      : null,
    room.world ? structuredClone(room.world) : null,
    room.simulationTick,
  ];
}

const decodeSeats = createSeatListDecoder({
  capacity: CAPACITY,
  maxWatchers: MAX_WATCHERS,
  playerKey,
  validName,
  validAvatar: isAvatar,
});

const decodeHeld = createHeldInputDecoder({
  capacity: CAPACITY,
  playerKey,
  isInput,
});

const decodeRoster = createRosterDecoder({
  validLength: (length) =>
    length === 0 || (length >= CAPACITY && length <= CAPACITY),
  playerKey,
  validName,
  slotAt: (index) => index,
});

function decodeDecided(
  raw: unknown,
  roster: readonly Entrant[],
): Decided | null | undefined {
  if (raw === null) return null;
  if (!Array.isArray(raw) || raw.length !== 3) return;
  const [clock, winners, rawFinishers] = raw as unknown[];
  if (
    !uint32(clock) ||
    clock === 0 ||
    !Array.isArray(winners) ||
    winners.length < 1 ||
    winners.length > roster.length
  )
    return;
  // In lane order and without repeats, as the fold writes them.
  const won: string[] = [];
  let lane = -1;
  for (const id of winners as unknown[]) {
    const entrant = roster.find((known) => known.id === id);
    if (!entrant || entrant.slot <= lane) return;
    lane = entrant.slot;
    won.push(entrant.id);
  }
  const finishers = decodeHumanFinishers(rawFinishers, roster);
  if (!finishers) return;
  return { clock, winners: won, finishers };
}

const decodeBase = createCheckpointBaseDecoder({
  stages: STAGES,
  minStepsPerTick: 1,
  validMatchId,
  parseSettings,
  decodeSeats,
  decodeHeld,
  decodeRoster,
});

/**
 * The room a checkpoint describes, or nothing: every field is checked on its own and against the others, and the
 * room is built only once all of them hold, so a refused checkpoint leaves no half-read state behind.
 */
export function decode(
  fields: readonly unknown[],
  tick: number,
): Room | undefined {
  if (fields.length !== FIELDS || !uint32(tick)) return;
  const [rawDecided, rawWorld, rawSimulationTick] = fields.slice(
    CHECKPOINT_HEADER_FIELDS,
  );
  const base = decodeBase(fields, rawSimulationTick, tick);
  if (!base) return;
  const { roster, held, stage, simulationTick } = base;
  const decided = decodeDecided(rawDecided, roster);
  const world = rawWorld === null ? null : decodeWorld(rawWorld);
  if (decided === undefined || world === undefined) return;
  if (
    !validCheckpointLifecycle(
      { stage, roster, held, hasDecision: decided !== null },
      world && { players: world.rigs, over: world.winners.length > 0 },
    )
  )
    return;
  if (world) {
    if (
      world.tick < 1 ||
      world.tick > simulationTick ||
      world.seed !== seedOf(base.matchId)
    )
      return;
    if (decided) {
      const won = world.winners;
      if (
        decided.clock > simulationTick ||
        decided.winners.length !== won.length ||
        decided.winners.some((id, index) => id !== roster[won[index]!]!.id)
      )
        return;
    }
  }
  return {
    tick,
    ...base,
    decided,
    world,
  };
}

export function hash(room: Room): string {
  return hashCheckpointJson([room.tick, ...encode(room)]);
}

export function view(room: Room): View {
  return {
    tick: room.simulationTick,
    logTick: room.tick,
    stage: room.stage,
    matchId: room.matchId,
    settings: { ...room.settings },
    play: { ...room.play },
    seats: [...room.seats.values()].sort(seatOrder).map((seat) => ({
      id: seat.id,
      name: seat.name,
      avatarId: seat.avatarId,
      slot: seat.slot,
      bot: seat.bot,
      connected: seat.connected,
      away: seat.away === true,
      watcher: seat.watcher === true,
    })),
    roster: room.roster.map((entrant) => ({ ...entrant })),
    winners: room.decided ? [...room.decided.winners] : [],
    decided: room.decided ? structuredClone(room.decided) : null,
    world: room.world ? structuredClone(room.world) : null,
  };
}

export type DocksideGame = RollbackGame<Room, Entry, View, never, Settings>;

/**
 * The game with `bot` answering for bot seats. Every device in a room must fold with the same bot, which is why the
 * production uses the deterministic practice pilot.
 */
export function createDocksideGame(
  bot: BotInput = botInput,
  /** Bots a solo room seats beside its player. */
  soloBots = 1,
): DocksideGame {
  return {
    id: "dockside",
    rules: "dockside-1",
    isEntry,
    createRoom,
    createTicker: () => (room, creatorId, streams) =>
      foldTick(room, creatorId, streams, bot),
    // One delivery race is one match and one round.
    scope: (room) => ({ matchId: room.matchId, round: 1 }),
    clock: (room) => room.simulationTick,
    steps,
    maxSteps: MAX_STEPS_PER_TICK,
    view,
    hash,
    checkpoint: { leading: 5, encode, decode },
    // Slot then id: an order that depends only on the room, so a device that recovered it from a checkpoint names
    // members exactly as the devices that folded it.
    members: (room) => [...room.seats.values()].sort(seatOrder),
    seat: (room, id) => room.seats.get(id),
    stage: (room) => room.stage,
    settings: (room) => room.settings,
    matchSettings: (room) => room.play,
    seating: {
      capacity: CAPACITY,
      minPlayers: CAPACITY,
      maxWatchers: MAX_WATCHERS,
      seatName,
      isAvatar,
      defaultAvatar: AVATAR,
      parseSettings,
      soloSettings: (settings) => ({ ...settings, display: false }),
      sharedScreen: (settings) => settings.display,
      botId(room, pending) {
        // Never an id the match remembers, so a new bot is not mistaken for a departed one in its result.
        let number = 1;
        const taken = (id: string) =>
          room.seats.has(id) ||
          pending.has(id) ||
          room.roster.some((entrant) => entrant.id === id);
        while (taken(`${BOT_PREFIX}${number}`)) number++;
        return `${BOT_PREFIX}${number}`;
      },
      botName: (slot) => ["Quay", "Crane"][slot % 2]!,
      solo: { name: "You", bots: soloBots },
    },
    text: {
      ...defaultText,
      needTwo: "A match needs two pilots: invite a friend or add a bot.",
    },
  };
}

export const docksideGame: DocksideGame = createDocksideGame();
