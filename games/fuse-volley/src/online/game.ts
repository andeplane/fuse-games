import {
  hashCheckpointJson,
  applyManagementTick,
  foldHeldInput,
  createRosterDecoder,
  decodeSingleWinner as decodeDecided,
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
  CAPACITY,
  INPUT_MASK,
  LEFT,
  RIGHT,
  RULES,
  SCORINGS,
  STEPS_PER_TICK,
  blobsFor,
  botInput,
  createWorld,
  isFormat,
  decodeWorld,
  encodeWorld,
  isBotLevel,
  isInput,
  seedOf,
  stepWorld,
  toView,
  winnerOf,
  type BotLevel,
  type Format,
  type Scoring,
  type World,
  type WorldView,
} from "../engine/index.js";
import { BOT_PREFIX, GAME_ID, validName } from "../basics.js";
import {
  AVATAR,
  BOT_NAMES,
  isAvatar,
  playerKey,
  seatName,
  validMatchId,
} from "./names.js";

/**
 * Fuse Volley behind the netcode's `RollbackGame`. The room keeps the seats, the lobby's settings and one match: its
 * world, who plays in it and, once it is won, who was there to see it. One log tick folds the management entries,
 * each blob's held controls and the bots' answers, then runs the tick's six steps. A match is one world from 0–0 to
 * its winning point: serves and rallies are the engine's, so there are no rounds.
 */
export interface Settings {
  /** One shared screen with phones as controllers. */
  display: boolean;
  /** `rally`: every rally scores, first to 11. `classic`: only the serving side scores, first to 15. */
  scoring: Scoring;
  /** How well bots play: 0 easy, 1 normal, 2 hard. */
  bot: BotLevel;
  /**
   * One on one (two seats), two a side on the wide court (four), three a side on the big court (six), or three teams of
   * two playing king of the court (six).
   */
  format: Format;
}
export const DEFAULT_SETTINGS: Settings = {
  display: false,
  scoring: "rally",
  bot: 1,
  format: "1v1",
};
const SETTING_KEYS = ["display", "scoring", "bot", "format"];
/** Seats a match under `settings` takes: one a blob. */
export const seatsFor = (settings: Settings): number =>
  blobsFor(settings.format);
/** The settings boundary, for a logged entry, a command and a checkpoint alike: exactly the four fields, each checked. */
export function parseSettings(raw: unknown): Settings | undefined {
  if (!plain(raw)) return;
  const keys = Object.keys(raw);
  if (
    keys.length !== SETTING_KEYS.length ||
    !SETTING_KEYS.every((key) => Object.hasOwn(raw, key))
  )
    return;
  const { display, scoring, bot, format } = raw;
  if (
    typeof display !== "boolean" ||
    !isFormat(format) ||
    !SCORINGS.some((known) => known === scoring) ||
    !isBotLevel(bot)
  )
    return;
  return { display, scoring: scoring as Scoring, bot, format };
}

export const PLAY = 0;
/** A seat's held control bits from this tick on, for the match it names. A new serve keeps what is held. */
export type PlayEntry = [
  seq: number,
  tick: number,
  kind: typeof PLAY,
  matchId: string,
  bits: number,
];
export type Entry = ManagementEntry<Settings> | PlayEntry;

export const MAX_WATCHERS = 5;
/** A room is in its lobby, in a match, or looking at a finished one; a match has no break between rounds. */
export type RoomStage = "lobby" | "running" | "over";

/**
 * A bot's controls for the tick about to run: ordinary held bits, read off the world like a player reads the screen.
 * It is asked once per log tick, so a bot presses and releases no faster than a device can.
 */
export type BotInput = (world: World, slot: number, level: BotLevel) => number;
/** A bot that holds nothing. */
export const idleBot: BotInput = () => 0;
/** A rider of the current match as it started: the result names them even if the seat is gone by the end. */
export interface Entrant {
  id: string;
  name: string;
  /** The blob it rides: even slots play the left side, odd ones the right; three teams of two, slot % 3 is the team. */
  slot: number;
  bot: boolean;
}
/** The team a blob slot plays for under `format`: its side (0 left, 1 right), or three teams of two, 0–2. */
export const teamOfSlot = (slot: number, format: Format): number =>
  format === "2v2v2" ? slot % 3 : slot % 2;
/** Teams a format has. */
export const teamsIn = (format: Format): number => (format === "2v2v2" ? 3 : 2);
/** The finished match, frozen on the tick it was decided so every replica reports the same thing. */
export interface Decided {
  /** The game clock (`simulationTick`) as of the deciding tick: a report waits until it is confirmed. */
  clock: number;
  /** The winning team's first blob (its slot is the team); its teammates won too. */
  winner: string;
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
  /** Each rider's held bits, from the latest entry its seat logged this match; absent when nothing is held. */
  held: Record<string, number>;
  /** The match's players in blob slot order (two, four or six); empty in the lobby. */
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
  /** The game clock: steps simulated, six per log tick. */
  tick: number;
  logTick: number;
  stage: RoomStage;
  matchId: string;
  /** The lobby's settings: the next match's scoring and bot level. */
  settings: Settings;
  /** The settings of the match being played. */
  play: Settings;
  seats: SeatView[];
  /** The match's riders in slot order, named as they started. */
  roster: Entrant[];
  /** The winner's id once `stage` is "over", otherwise "". */
  winner: string;
  world: WorldView | null;
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
export const riders = (room: Room): SeatRecord[] =>
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
/**
 * Starts a match for the seats, in seat order (so seats alternate sides: 0, 2 and 4 play the left), or leaves the room in
 * its lobby when it does not have exactly the seats the match's settings take.
 */
function beginMatch(room: Room): void {
  const seated = riders(room);
  if (seated.length !== seatsFor(room.play)) return;
  room.stage = "running";
  room.roster = seated.map((seat, index) => ({
    id: seat.id,
    name: seat.name,
    slot: index,
    bot: seat.bot,
  }));
  room.world = createWorld(
    seated.map((seat) => seat.id),
    room.play.scoring,
    seedOf(room.matchId),
    room.play.format,
  );
}

export const lifecycle: LifecycleHooks<Room, Settings> = {
  stage: (room) => room.stage,
  maxWatchers: MAX_WATCHERS,
  parseSettings,
  botAvatar: AVATAR,
  start(room, matchId) {
    if (riders(room).length !== seatsFor(room.settings)) return;
    resetMatch(room, matchId);
    beginMatch(room);
  },
  // A rematch with a rider gone falls back to the lobby, where the room can seat someone or add a bot.
  rematch(room, matchId) {
    resetMatch(room, matchId);
    beginMatch(room);
  },
  lobby(room, matchId) {
    resetMatch(room, matchId);
  },
};

/**
 * What the tick's first step sees: everything held at its end plus everything pressed and let go inside it, so a jump
 * tapped shorter than a tick is still a jump. Where the two disagree on direction, what is held at the end wins.
 */
export function firstStepBits(held: number, tapped: number): number {
  let bits = held | tapped;
  if ((bits & (LEFT | RIGHT)) === (LEFT | RIGHT))
    bits = (bits & ~(LEFT | RIGHT)) | (held & (LEFT | RIGHT));
  return bits;
}

/** Steps every log tick runs: six, always. */
export const MAX_STEPS_PER_TICK = STEPS_PER_TICK;
export const steps = (_room: Room): number => STEPS_PER_TICK;

function decide(room: Room, world: World, clock: number): void {
  const slot = winnerOf(world);
  if (slot === -1) return;
  room.stage = "over";
  // The match is done with its controls: the next one starts with nothing held.
  room.held = {};
  room.decided = {
    clock,
    winner: world.blobs[slot]!.id,
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
  const count = steps(room);
  applyManagementTick(room, tick, creatorId, streams, lifecycle);
  const world = room.world;
  if (room.stage === "running" && world) {
    const input = foldHeldInput(room, streams, tick, (entry) =>
      entry[2] === PLAY && entry[3] === room.matchId
        ? entry[4] & INPUT_MASK
        : undefined,
    );
    const held = world.blobs.map(() => 0),
      first = world.blobs.map(() => 0);
    for (const [slot, blob] of world.blobs.entries()) {
      const [bits, tapped] = input(blob.id, () => {
        const answer = bot(world, slot, room.play.bot);
        return isInput(answer) ? answer : 0;
      });
      held[slot] = bits;
      first[slot] = firstStepBits(bits, tapped);
    }
    for (let step = 0; step < count; step++)
      stepWorld(world, step === 0 ? first : held);
    if (world.phase === "over")
      decide(room, world, room.simulationTick + count);
  }
  room.tick = tick;
  room.simulationTick += count;
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
      ? [room.decided.clock, room.decided.winner, [...room.decided.finishers]]
      : null,
    room.world ? encodeWorld(room.world) : null,
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
    length === 0 || length === 2 || length === 4 || length === 6,
  playerKey,
  validName,
  slotAt: (index) => index,
});

const decodeBase = createCheckpointBaseDecoder({
  stages: STAGES,
  minStepsPerTick: STEPS_PER_TICK,
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
  const { roster, held, stage, play, simulationTick } = base;
  const decided = decodeDecided(rawDecided, roster);
  const world = rawWorld === null ? null : decodeWorld(rawWorld);
  if (decided === undefined || world === undefined) return;
  if (
    !validCheckpointLifecycle(
      { stage, roster, held, hasDecision: decided !== null },
      world && { players: world.blobs, over: world.phase === "over" },
    )
  )
    return;
  if (
    world &&
    (roster.length !== seatsFor(play) ||
      world.scoring !== play.scoring ||
      world.format !== play.format ||
      (decided &&
        (decided.clock > simulationTick ||
          decided.winner !== roster[Math.max(winnerOf(world), 0)]!.id)))
  )
    return;
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
    winner: room.decided?.winner ?? "",
    world: room.world ? toView(room.world) : null,
  };
}

export type FuseVolleyGame = RollbackGame<Room, Entry, View, never, Settings>;

/**
 * The game with `bot` answering for bot seats. Every device in a room must fold with the same bot, which is why the
 * default is the engine's own (covered by `RULES`); a test passes a typed fake.
 */
export function createFuseVolleyGame(
  bot: BotInput = botInput,
  /** Bots a solo room seats beside its player: 1 for one a side, 3 two a side, 5 three a side. */
  soloBots = 1,
): FuseVolleyGame {
  return {
    id: GAME_ID,
    rules: RULES,
    isEntry,
    createRoom,
    createTicker: () => (room, creatorId, streams) =>
      foldTick(room, creatorId, streams, bot),
    // One match is one scope: a serve inside it is the engine's, not a new round.
    scope: (room) => ({ matchId: room.matchId, round: 0 }),
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
      capacityFor: (room) => seatsFor(room.settings),
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
      botName: (slot) => BOT_NAMES[slot % BOT_NAMES.length]!,
      solo: { name: "You", bots: soloBots },
    },
    text: {
      ...defaultText,
      needTwo: "A match needs two players: invite a friend or add a bot.",
    },
  };
}

export const fuseVolleyGame: FuseVolleyGame = createFuseVolleyGame();
