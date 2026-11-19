import {
  hashCheckpointJson,
  applyManagementTick,
  createSeatListDecoder,
  createHeldInputDecoder,
  defaultText,
  hasLogPosition,
  isManagementEntry,
  uint32,
  type LifecycleHooks,
  type ManagedRoom,
  type ManagementEntry,
  type RollbackGame,
  type SeatRecord,
  type Stage,
  type StreamEntries,
} from "fuse-netcode";
import {
  CAPACITY,
  INPUT_MASK,
  OUTER_MS,
  RULES,
  validLoadout,
  createWorld,
  decodeWorld,
  encodeWorld,
  isInput,
  parseSettings,
  seedOf,
  stepWorld,
  toView,
  type Settings,
  type World,
  type WorldView,
} from "../engine/index.js";
import {
  AVATAR,
  BOT_NAMES,
  BOT_PREFIX,
  isAvatar,
  playerKey,
  seatName,
  validMatchId,
  validName,
} from "./names.js";
import { defaultLoadout as nativeDefaultLoadout } from "../engine/classic/match.js";
export type { Settings } from "../engine/index.js";

export const PLAY = 0;
export const LOADOUT = 1;
export const BEGIN_LOADOUT = 2;
export const MAX_WATCHERS = 5;
export const LOG_TICK_MS = OUTER_MS;
export type Loadout = [number, number, number, number, number];
export type PlayEntry = [
  seq: number,
  tick: number,
  kind: typeof PLAY,
  matchId: string,
  round: number,
  bits: number,
];
export type LoadoutEntry = [
  seq: number,
  tick: number,
  kind: typeof LOADOUT,
  matchId: string,
  round: 0 | 1,
  weapons: Loadout,
];
export type BeginLoadoutEntry = [
  seq: number,
  tick: number,
  kind: typeof BEGIN_LOADOUT,
  matchId: string,
  round: 1,
];
export type Entry =
  ManagementEntry<Settings> | PlayEntry | LoadoutEntry | BeginLoadoutEntry;

/** Each Fuse input tick runs one native 10ms outer frame; the world owns its internal physics clocks. */
export interface Room extends ManagedRoom<Settings> {
  tick: number;
  simulationTick: number;
  matchId: string;
  round: number;
  stage: Stage;
  play: Settings;
  held: Record<string, number>;
  /** Brief controls wait for the next native 11ms physics pulse, including after recovery. */
  pendingPressed: Record<string, number>;
  loadouts: Record<string, Loadout>;
  winner: string;
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
export interface View {
  tick: number;
  logTick: number;
  stage: Stage;
  matchId: string;
  round: number;
  settings: Settings;
  play: Settings;
  seats: SeatView[];
  loadouts: Record<string, Loadout>;
  winner: string;
  world: WorldView | null;
}
const payloads = {
  name: validName,
  avatar: isAvatar,
  settings: (raw: unknown) => parseSettings(raw) !== undefined,
  memberKey: playerKey,
  matchKey: validMatchId,
  capacity: CAPACITY,
};
const shapeLoadout = (raw: unknown): raw is Loadout =>
  Array.isArray(raw) &&
  raw.length === 5 &&
  raw.every((id) => uint32(id) && id < 38);
export function isEntry(raw: unknown): raw is Entry {
  if (isManagementEntry(raw, payloads)) return true;
  return (
    hasLogPosition(raw) &&
    (raw.length === 5 || raw.length === 6) &&
    validMatchId(raw[3]) &&
    (raw[2] === PLAY
      ? raw.length === 6 && uint32(raw[4]) && isInput(raw[5])
      : raw[2] === LOADOUT
        ? raw.length === 6 &&
          (raw[4] === 0 || raw[4] === 1) &&
          shapeLoadout(raw[5])
        : raw[2] === BEGIN_LOADOUT && raw.length === 5 && raw[4] === 1)
  );
}
export function createRoom(matchId: string, settings: Settings): Room {
  return {
    tick: 0,
    simulationTick: 0,
    matchId,
    round: 0,
    stage: "lobby",
    seats: new Map(),
    settings: { ...settings },
    play: { ...settings },
    held: {},
    pendingPressed: {},
    loadouts: {},
    winner: "",
    world: null,
  };
}
export const riders = (room: Room): SeatRecord[] =>
  [...room.seats.values()]
    .filter((seat) => !seat.watcher)
    .sort((a, b) => a.slot - b.slot);
const entrants = (room: Room) =>
  riders(room).filter((seat) => seat.connected || seat.away || seat.bot);

function resetMatch(room: Room, matchId: string): void {
  room.matchId = matchId;
  room.round = 0;
  room.stage = "lobby";
  room.play = { ...room.settings };
  room.held = {};
  room.pendingPressed = {};
  room.winner = "";
  room.world = null;
  reconcileLoadouts(room);
}
function start(room: Room, matchId: string): void {
  const seats = entrants(room);
  if (!seats.length) return;
  resetMatch(room, matchId);
  room.round = 1;
  room.stage = "running";
  room.world = createWorld(
    seedOf(matchId),
    seats.map((seat) => {
      const chosen = seat.bot ? undefined : room.loadouts[seat.id];
      const loadout =
        chosen && validLoadout(chosen, room.play)
          ? chosen
          : nativeDefaultLoadout(room.play);
      return { id: seat.id, slot: seat.slot, loadout, bot: seat.bot };
    }),
    room.play,
  );
  for (const worm of room.world.worms) {
    const loadout = worm.slots.map((slot) => slot.weaponId);
    if (!validLoadout(loadout, room.play))
      throw new Error("Native bot selected a forbidden arsenal");
    room.loadouts[worm.id] = loadout;
  }
}
export const lifecycle: LifecycleHooks<Room, Settings> = {
  stage: (room) => room.stage,
  maxWatchers: MAX_WATCHERS,
  parseSettings,
  botAvatar: AVATAR,
  start,
  rematch: start,
  lobby(room, matchId) {
    resetMatch(room, matchId);
  },
};

/** Seat generations fence controls and loadouts against a page's old connection. */
function ownEntries(
  room: Room,
  seat: SeatRecord,
  streams: ReadonlyMap<string, StreamEntries<Entry>>,
  tick: number,
): Entry[] {
  const stream = streams.get(seat.id);
  const source =
    stream?.generation === seat.generation
      ? stream
      : stream?.retired?.find((old) => old.generation === seat.generation);
  return (source?.entries ?? [])
    .filter((entry) => entry[1] === tick)
    .sort((a, b) => a[0] - b[0]);
}
function reconcileLoadouts(room: Room): void {
  const settings = room.stage === "lobby" ? room.settings : room.play;
  for (const [id, weapons] of Object.entries(room.loadouts)) {
    const seat = room.seats.get(id);
    if (!seat || seat.watcher || !validLoadout(weapons, settings))
      delete room.loadouts[id];
  }
}
/** Input admission follows the native outer frame rather than batching five frames. */
export const stepsPerTick = (): number => LOG_TICK_MS / OUTER_MS;
export const MAX_STEPS_PER_TICK = LOG_TICK_MS / OUTER_MS;
export function foldTick(
  room: Room,
  creatorId: string,
  streams: ReadonlyMap<string, StreamEntries<Entry>>,
): never[] {
  const tick = room.tick + 1;
  const count = stepsPerTick();
  const generations = new Map(
    [...room.seats.values()].map((seat) => [seat.id, seat.generation]),
  );
  // Loadout selection belongs to the lobby as seen before a same-tick START, so the selected weapons enter that match.
  if (room.stage === "lobby")
    for (const seat of riders(room)) {
      if (seat.bot || !seat.connected) continue;
      for (const entry of ownEntries(room, seat, streams, tick)) {
        if (
          entry[2] === LOADOUT &&
          entry[3] === room.matchId &&
          entry[4] === 0 &&
          validLoadout(entry[5], room.settings)
        )
          room.loadouts[seat.id] = [...entry[5]];
      }
    }
  applyManagementTick(room, tick, creatorId, streams, lifecycle);
  for (const seat of room.seats.values()) {
    if (generations.get(seat.id) === seat.generation) continue;
    delete room.held[seat.id];
    delete room.pendingPressed[seat.id];
    const worm = room.world?.worms.find(
      (candidate) => candidate.id === seat.id,
    );
    if (worm && !worm.ai) worm.input = 0;
  }
  reconcileLoadouts(room);
  const world = room.world;
  if (room.stage === "running" && world) {
    const selectionSequence = new Map<string, number>();
    for (const seat of riders(room)) {
      if (seat.bot || !seat.connected) continue;
      const worm = world.worms.find((candidate) => candidate.id === seat.id);
      if (!worm) continue;
      for (const entry of ownEntries(room, seat, streams, tick)) {
        if (
          (entry[2] !== BEGIN_LOADOUT && entry[2] !== LOADOUT) ||
          entry[3] !== room.matchId ||
          entry[4] !== room.round
        )
          continue;
        if (entry[2] === BEGIN_LOADOUT) worm.weaponsReady = false;
        else {
          if (worm.weaponsReady || !validLoadout(entry[5], room.play)) continue;
          for (let slot = 0; slot < 5; slot++)
            worm.slots[slot]!.weaponId = entry[5][slot]!;
          room.loadouts[seat.id] = [...entry[5]];
          worm.weaponsReady = true;
        }
        for (const slot of worm.slots) {
          slot.charge = 1;
          slot.reloading = false;
          slot.lastFire = 0;
        }
        worm.weapon = 0;
        worm.input = 0;
        delete room.held[seat.id];
        delete room.pendingPressed[seat.id];
        selectionSequence.set(seat.id, entry[0]);
      }
    }
    const held = new Map<string, number>(),
      first = new Map<string, number>();
    for (const worm of world.worms) {
      const seat = room.seats.get(worm.id);
      let bits = 0,
        tapped = 0;
      if (seat?.connected && !seat.bot && !seat.watcher && worm.weaponsReady) {
        bits = room.held[worm.id] ?? 0;
        tapped = room.pendingPressed[worm.id] ?? 0;
        for (const entry of ownEntries(room, seat, streams, tick))
          if (
            entry[2] === PLAY &&
            entry[0] > (selectionSequence.get(worm.id) ?? 0) &&
            entry[3] === room.matchId &&
            entry[4] === room.round
          ) {
            const next = entry[5] & INPUT_MASK;
            // Native key-up clears the sampled edge history even between physics pulses.
            // A subsequent press must still be down-once when the next pulse samples it.
            worm.input &= next;
            tapped |= next & ~bits;
            bits = next;
          }
      } else if (!worm.ai) worm.input = 0;
      if (bits && !seat?.bot) room.held[worm.id] = bits;
      else delete room.held[worm.id];
      if (tapped) room.pendingPressed[worm.id] = tapped;
      else delete room.pendingPressed[worm.id];
      held.set(worm.id, bits);
      first.set(worm.id, bits | tapped);
    }
    let firstPhysicsPulse = true;
    for (let step = 0; step < count; step++) {
      const previousPhysicsMs = world.lastClientPhysicsMs;
      stepWorld(world, firstPhysicsPulse ? first : held);
      if (world.lastClientPhysicsMs !== previousPhysicsMs) {
        firstPhysicsPulse = false;
        room.pendingPressed = {};
      }
    }
    if (world.phase === "done") {
      room.stage = "over";
      room.winner = world.winner ?? "";
      room.held = {};
      room.pendingPressed = {};
    }
  }
  room.tick = tick;
  room.simulationTick += count;
  return [];
}

const plain = (raw: unknown): raw is Record<string, unknown> =>
  !!raw && typeof raw === "object" && !Array.isArray(raw);
const sortedEntries = <T>(record: Record<string, T>): [string, T][] =>
  Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
export function encode(room: Room): unknown[] {
  return [
    room.matchId,
    room.round,
    room.stage,
    { ...room.settings },
    [...room.seats.values()]
      .sort((a, b) => a.slot - b.slot || (a.id < b.id ? -1 : 1))
      .map((seat) => ({ ...seat })),
    { ...room.play },
    sortedEntries(room.held),
    sortedEntries(room.loadouts).map(([id, weapons]) => [id, [...weapons]]),
    room.world ? encodeWorld(room.world) : null,
    room.simulationTick,
    sortedEntries(room.pendingPressed),
  ];
}
const decodeHeld = createHeldInputDecoder({
  capacity: CAPACITY,
  playerKey,
  isInput,
});

const decodeSeats = createSeatListDecoder({
  capacity: CAPACITY,
  maxWatchers: MAX_WATCHERS,
  playerKey,
  validName,
  validAvatar: isAvatar,
});
export function decode(
  fields: readonly unknown[],
  tick: number,
): Room | undefined {
  if (fields.length !== 11 || !uint32(tick)) return;
  const [
    matchId,
    round,
    stage,
    rawSettings,
    rawSeats,
    rawPlay,
    rawHeld,
    rawLoadouts,
    rawWorld,
    simulationTick,
    rawPendingPressed,
  ] = fields;
  const settings = parseSettings(rawSettings),
    play = parseSettings(rawPlay);
  if (
    !validMatchId(matchId) ||
    (round !== 0 && round !== 1) ||
    (stage !== "lobby" && stage !== "running" && stage !== "over") ||
    !settings ||
    !play ||
    !uint32(simulationTick) ||
    simulationTick !== (tick * LOG_TICK_MS) / OUTER_MS ||
    !Array.isArray(rawLoadouts) ||
    rawLoadouts.length > CAPACITY
  )
    return;
  const seats = decodeSeats(rawSeats);
  if (!seats) return;
  const held = decodeHeld(rawHeld),
    pendingPressed = decodeHeld(rawPendingPressed);
  if (!held || !pendingPressed) return;
  const loadouts: Record<string, Loadout> = {};
  for (const pair of rawLoadouts) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      !playerKey(pair[0]) ||
      Object.hasOwn(loadouts, pair[0]) ||
      !seats.has(pair[0]) ||
      seats.get(pair[0])!.watcher ||
      !validLoadout(pair[1], stage === "lobby" ? settings : play)
    )
      return;
    loadouts[pair[0]] = [...pair[1]];
  }
  const world = rawWorld === null ? null : decodeWorld(rawWorld);
  if (
    world === undefined ||
    (stage === "lobby") !== (round === 0) ||
    (stage === "lobby") !== (world === null) ||
    (world &&
      ((stage === "over") !== (world.phase === "done") ||
        world.seed !== seedOf(matchId) ||
        world.elapsedMs > simulationTick * OUTER_MS ||
        Object.entries(play).some(
          ([key, value]) =>
            Object.entries(world.settings).find(
              ([name]) => name === key,
            )?.[1] !== value,
        ) ||
        world.worms.some((worm) => {
          const seat = seats.get(worm.id);
          if (stage === "running" && (!seat || seat.watcher)) return true;
          return seat && !seat.watcher && Boolean(worm.ai) !== seat.bot;
        }))) ||
    [...Object.keys(held), ...Object.keys(pendingPressed)].some(
      (id) =>
        stage !== "running" ||
        !world?.worms.some((worm) => worm.id === id && worm.weaponsReady) ||
        !seats.get(id)?.connected ||
        seats.get(id)?.bot ||
        seats.get(id)?.watcher,
    )
  )
    return;
  return {
    tick,
    simulationTick,
    matchId,
    round,
    stage,
    seats,
    settings,
    play,
    held,
    pendingPressed,
    loadouts,
    winner: world?.winner ?? "",
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
    round: room.round,
    settings: { ...room.settings },
    play: { ...room.play },
    seats: [...room.seats.values()]
      .sort((a, b) => a.slot - b.slot || (a.id < b.id ? -1 : 1))
      .map((seat) => ({
        id: seat.id,
        name: seat.name,
        avatarId: seat.avatarId,
        slot: seat.slot,
        bot: seat.bot,
        connected: seat.connected,
        away: seat.away === true,
        watcher: seat.watcher === true,
      })),
    loadouts: Object.fromEntries(
      sortedEntries(room.loadouts).map(([id, loadout]) => [id, [...loadout]]),
    ),
    winner: room.winner,
    world: room.world ? toView(room.world) : null,
  };
}
export const fuseroGame: RollbackGame<Room, Entry, View, never, Settings> = {
  id: "fusero",
  rules: `${RULES}-room-3`,
  tickMs: LOG_TICK_MS,
  isEntry,
  createRoom,
  createTicker: () => foldTick,
  scope: (room) => ({ matchId: room.matchId, round: room.round }),
  clock: (room) => room.simulationTick,
  steps: stepsPerTick,
  maxSteps: MAX_STEPS_PER_TICK,
  view,
  hash,
  checkpoint: { leading: 5, encode, decode },
  members: (room) =>
    [...room.seats.values()].sort(
      (a, b) => a.slot - b.slot || (a.id < b.id ? -1 : 1),
    ),
  seat: (room, id) => room.seats.get(id),
  stage: (room) => room.stage,
  settings: (room) => room.settings,
  matchSettings: (room) => room.play,
  seating: {
    capacity: CAPACITY,
    minPlayers: 1,
    maxWatchers: MAX_WATCHERS,
    seatName,
    isAvatar,
    defaultAvatar: AVATAR,
    parseSettings,
    soloSettings: (settings) => ({ ...settings, display: false }),
    sharedScreen: (settings) => settings.display,
    botId(room, pending) {
      let number = 1;
      while (
        room.seats.has(`${BOT_PREFIX}${number}`) ||
        pending.has(`${BOT_PREFIX}${number}`)
      )
        number++;
      return `${BOT_PREFIX}${number}`;
    },
    botName: (slot) => BOT_NAMES[slot % BOT_NAMES.length]!,
    solo: { name: "You", bots: 3 },
  },
  text: {
    ...defaultText,
    needTwo: "At least one worm must be seated to start.",
  },
};
