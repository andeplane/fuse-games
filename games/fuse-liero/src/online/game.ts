import {
  ACTION,
  BOT,
  PRESENCE,
  SPECTATOR,
  applyManagementTick,
  defaultText,
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
  RULES,
  STEPS_PER_TICK,
  botInput,
  createWorld,
  decodeWorld,
  encodeWorld,
  isInput,
  parseSettings,
  roundDone,
  seedOf,
  stepWorld,
  toView,
  type Settings,
  type World,
  type WorldView,
} from "../engine/index.js";
export type { Settings } from "../engine/index.js";
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

/**
 * Fuse Liero behind the netcode's `RollbackGame`. The room keeps the seats, the match (crowns and round results)
 * and the current round's world; one log tick folds the management entries, each seat's held controls and the
 * bots' answers, then runs the simulation budget selected from the folded state.
 */
export const PLAY = 0;
/** A seat's held control bits from this tick on, for the match and round it names. */
export type PlayEntry = [
  seq: number,
  tick: number,
  kind: typeof PLAY,
  matchId: string,
  round: number,
  bits: number,
];
export type Entry = ManagementEntry<Settings> | PlayEntry;

/** Log ticks the scoreboard shows between two rounds. */
export const BETWEEN_TICKS = 50;
export const MAX_WATCHERS = 5;

export interface Placing {
  id: string;
  name: string;
  slot: number;
  bot: boolean;
  frags: number;
  deaths: number;
}
export interface RoundResult {
  round: number;
  /** The round's winner, or "" when nobody won it. */
  winner: string;
  /** Best first. */
  placings: Placing[];
}

export interface Room extends ManagedRoom<Settings> {
  tick: number;
  simulationTick: number;
  matchId: string;
  round: number;
  stage: Stage;
  /** The settings the current match plays with, fixed at its start. */
  play: Settings;
  /** Crowns this match, by member id. */
  wins: Record<string, number>;
  results: RoundResult[];
  /** The match winner once `stage` is "over". */
  winner: string;
  /** The log tick the next round starts at, while `between`. */
  resumeAt: number;
  /** Each worm's held bits, from the latest entry its seat logged this round. */
  held: Record<string, number>;
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
  /** The game clock: simulation steps. */
  tick: number;
  logTick: number;
  stage: Stage;
  matchId: string;
  round: number;
  settings: Settings;
  play: Settings;
  seats: SeatView[];
  wins: Record<string, number>;
  winsNeeded: number;
  results: RoundResult[];
  winner: string;
  /** Log ticks until the next round, between rounds. */
  resumeIn: number;
  world: WorldView | null;
}

/** The most rounds a match plays: past it the leader wins. */
export const maxRounds = (settings: Settings): number =>
  settings.wins * CAPACITY + 3;

const payloads = {
  name: validName,
  avatar: isAvatar,
  settings: (value: unknown) => parseSettings(value) !== undefined,
  capacity: CAPACITY,
};
export function isEntry(raw: unknown): raw is Entry {
  if (isManagementEntry(raw, payloads)) {
    if (raw[2] === ACTION) return validMatchId(raw[4]);
    const at =
      raw[2] === BOT || raw[2] === SPECTATOR ? 4 : raw[2] <= PRESENCE ? 3 : -1;
    return at < 0 || playerKey((raw as unknown[])[at]);
  }
  return (
    Array.isArray(raw) &&
    raw.length === 6 &&
    uint32(raw[0]) &&
    raw[0] > 0 &&
    uint32(raw[1]) &&
    raw[1] > 0 &&
    raw[2] === PLAY &&
    validMatchId(raw[3]) &&
    uint32(raw[4]) &&
    isInput(raw[5])
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
    wins: {},
    results: [],
    winner: "",
    resumeAt: 0,
    held: {},
    world: null,
  };
}

/** Seats in slot order, watchers excluded. */
export const riders = (room: Room): SeatRecord[] =>
  [...room.seats.values()]
    .filter((seat) => !seat.watcher)
    .sort((a, b) => a.slot - b.slot);
/** Every seat present at the start participates in the new cave. */
const entrants = (room: Room) =>
  riders(room).filter((seat) => seat.connected || seat.away || seat.bot);

function startRound(room: Room): void {
  const seats = entrants(room);
  // An empty room returns to the lobby rather than creating an empty world.
  if (!seats.length) {
    resetMatch(room, room.matchId);
    room.stage = "lobby";
    return;
  }
  room.round++;
  room.stage = "running";
  room.held = {};
  room.world = createWorld(
    seedOf(`${room.matchId}:${room.round}`),
    seats.map((seat) => ({ id: seat.id, slot: seat.slot })),
    room.play,
  );
}
function resetMatch(room: Room, matchId: string): void {
  room.matchId = matchId;
  room.play = { ...room.settings };
  room.round = 0;
  room.wins = {};
  room.results = [];
  room.winner = "";
  room.resumeAt = 0;
  room.held = {};
  room.world = null;
}

export const lifecycle: LifecycleHooks<Room, Settings> = {
  stage: (room) => room.stage,
  maxWatchers: MAX_WATCHERS,
  parseSettings,
  botAvatar: AVATAR,
  start(room, matchId) {
    if (!entrants(room).length) return;
    resetMatch(room, matchId);
    startRound(room);
  },
  rematch(room, matchId) {
    resetMatch(room, matchId);
    startRound(room);
  },
  lobby(room, matchId) {
    resetMatch(room, matchId);
    room.stage = "lobby";
  },
};

/** The seat's play entries for this tick, match and round, from the stream generation its controls follow. */
function playEntries(
  room: Room,
  seat: SeatRecord,
  streams: ReadonlyMap<string, StreamEntries<Entry>>,
  tick: number,
): PlayEntry[] {
  const stream = streams.get(seat.id);
  const source =
    stream?.generation === seat.generation
      ? stream
      : stream?.retired?.find((old) => old.generation === seat.generation);
  return (source?.entries ?? [])
    .filter(
      (entry): entry is PlayEntry =>
        entry[1] === tick &&
        entry[2] === PLAY &&
        entry[3] === room.matchId &&
        entry[4] === room.round,
    )
    .sort((a, b) => a[0] - b[0]);
}

function leader(room: Pick<Room, "wins" | "results">): string {
  const last = (id: string) => {
    for (let i = room.results.length - 1; i >= 0; i--) {
      const at = room.results[i]!.placings.findIndex((p) => p.id === id);
      if (at >= 0) return at;
    }
    return CAPACITY;
  };
  return (
    Object.keys(room.wins).sort(
      (a, b) =>
        room.wins[b]! - room.wins[a]! || last(a) - last(b) || (a < b ? -1 : 1),
    )[0] ?? ""
  );
}

function placings(room: Room, world: World): Placing[] {
  return [...world.worms]
    .sort(
      (a, b) =>
        Number(b.id === world.winner) - Number(a.id === world.winner) ||
        b.frags - a.frags ||
        a.deaths - b.deaths ||
        a.slot - b.slot,
    )
    .map((c) => {
      const seat = room.seats.get(c.id);
      return {
        id: c.id,
        name: seat?.name ?? "Worm",
        slot: c.slot,
        bot: seat?.bot ?? false,
        frags: c.frags,
        deaths: c.deaths,
      };
    });
}

function endRound(room: Room, tick: number): void {
  const world = room.world!;
  const winner = world.winner ?? "";
  if (winner) room.wins[winner] = (room.wins[winner] ?? 0) + 1;
  room.results.push({
    round: room.round,
    winner,
    placings: placings(room, world),
  });
  if (
    (winner && room.wins[winner]! >= room.play.wins) ||
    room.round >= maxRounds(room.play)
  ) {
    room.stage = "over";
    room.winner =
      winner && room.wins[winner]! >= room.play.wins ? winner : leader(room);
  } else {
    room.stage = "between";
    room.resumeAt = tick + BETWEEN_TICKS;
  }
}

export const MAX_STEPS_PER_TICK = STEPS_PER_TICK;
export const stepsPerTick = (): number => STEPS_PER_TICK;

export function foldTick(
  room: Room,
  creatorId: string,
  streams: ReadonlyMap<string, StreamEntries<Entry>>,
): never[] {
  const tick = room.tick + 1;
  const count = stepsPerTick();
  applyManagementTick(room, tick, creatorId, streams, lifecycle);
  const world = room.world;
  if (room.stage === "running" && world) {
    const held = new Map<string, number>(),
      first = new Map<string, number>();
    for (const worm of world.worms) {
      const seat = room.seats.get(worm.id);
      let bits = 0,
        tapped = 0;
      if (seat?.bot) bits = botInput(world, worm);
      else if (seat?.connected) {
        bits = room.held[worm.id] ?? 0;
        for (const entry of playEntries(room, seat, streams, tick)) {
          tapped |= entry[5] & INPUT_MASK;
          bits = entry[5] & INPUT_MASK;
        }
      }
      // Only what a seat logged is held: a bot answers afresh every tick.
      if (bits && !seat?.bot) room.held[worm.id] = bits;
      else delete room.held[worm.id];
      held.set(worm.id, bits);
      first.set(worm.id, bits | tapped);
    }
    for (let step = 0; step < count; step++) {
      stepWorld(world, step === 0 ? first : held);
    }
    if (roundDone(world)) endRound(room, tick);
  } else if (room.stage === "between" && tick >= room.resumeAt)
    startRound(room);
  room.tick = tick;
  room.simulationTick += count;
  return [];
}

// ---- checkpoint ----
const SEAT_KEYS = [
  "id",
  "name",
  "slot",
  "avatarId",
  "connected",
  "bot",
  "watcher",
  "generation",
  "away",
];
const STAGES: readonly Stage[] = ["lobby", "running", "between", "over"];
const plain = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const sortedEntries = (record: Record<string, number>) =>
  Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1));

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
    sortedEntries(room.wins),
    room.results.map((result) => ({
      round: result.round,
      winner: result.winner,
      placings: result.placings.map((p) => ({ ...p })),
    })),
    room.winner,
    room.resumeAt,
    sortedEntries(room.held),
    room.world ? encodeWorld(room.world) : null,
    room.simulationTick,
  ];
}

function decodeSeat(raw: unknown): SeatRecord | undefined {
  if (!plain(raw) || Object.keys(raw).some((key) => !SEAT_KEYS.includes(key)))
    return;
  const {
    id,
    name,
    slot,
    avatarId,
    connected,
    bot,
    watcher,
    generation,
    away,
  } = raw;
  if (
    !playerKey(id) ||
    !validName(name) ||
    typeof connected !== "boolean" ||
    typeof bot !== "boolean" ||
    (watcher !== undefined && watcher !== true) ||
    (away !== undefined && away !== true) ||
    (away === true && connected) ||
    (watcher ? slot !== -1 : !uint32(slot) || slot >= CAPACITY) ||
    (watcher ? avatarId !== "" : !isAvatar(avatarId)) ||
    (bot ? generation !== undefined || watcher === true : !uint32(generation))
  )
    return;
  return {
    id,
    name,
    slot: slot as number,
    avatarId: avatarId as string,
    connected,
    bot,
    ...(watcher ? { watcher: true } : {}),
    ...(generation !== undefined ? { generation: generation as number } : {}),
    ...(away ? { away: true } : {}),
  };
}

function decodePlacing(raw: unknown): Placing | undefined {
  if (!plain(raw) || Object.keys(raw).length !== 6) return;
  const { id, name, slot, bot, frags, deaths } = raw;
  if (
    !playerKey(id) ||
    !validName(name) ||
    !uint32(slot) ||
    slot >= CAPACITY ||
    typeof bot !== "boolean" ||
    !uint32(frags) ||
    frags > 10000 ||
    !uint32(deaths) ||
    deaths > 10000
  )
    return;
  return { id, name, slot, bot, frags, deaths };
}

const counts = (
  raw: unknown,
  max: number,
): Record<string, number> | undefined => {
  if (!Array.isArray(raw) || raw.length > max) return;
  const out: Record<string, number> = {};
  for (const pair of raw) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      !playerKey(pair[0]) ||
      Object.hasOwn(out, pair[0]) ||
      !uint32(pair[1]) ||
      pair[1] === 0
    )
      return;
    out[pair[0]] = pair[1];
  }
  return out;
};

export function decode(
  fields: readonly unknown[],
  tick: number,
): Room | undefined {
  if (fields.length !== 13 || !uint32(tick)) return;
  const [
    matchId,
    round,
    stage,
    rawSettings,
    rawSeats,
    rawPlay,
    rawWins,
    rawResults,
    winner,
    resumeAt,
    rawHeld,
    rawWorld,
    simulationTick,
  ] = fields;
  const settings = parseSettings(rawSettings),
    play = parseSettings(rawPlay);
  if (
    !validMatchId(matchId) ||
    !uint32(simulationTick) ||
    simulationTick < tick * STEPS_PER_TICK ||
    simulationTick > tick * MAX_STEPS_PER_TICK ||
    !uint32(round) ||
    round > maxRounds(play ?? { display: false, wins: 1 }) ||
    !STAGES.includes(stage as Stage) ||
    !settings ||
    !play ||
    !Array.isArray(rawSeats) ||
    rawSeats.length > CAPACITY + MAX_WATCHERS ||
    (winner !== "" && !playerKey(winner)) ||
    !uint32(resumeAt) ||
    !Array.isArray(rawResults) ||
    rawResults.length > maxRounds(play)
  )
    return;
  const seats = new Map<string, SeatRecord>();
  for (const raw of rawSeats) {
    const seat = decodeSeat(raw);
    if (
      !seat ||
      seats.has(seat.id) ||
      (!seat.watcher &&
        [...seats.values()].some((s) => !s.watcher && s.slot === seat.slot))
    )
      return;
    seats.set(seat.id, seat);
  }
  if ([...seats.values()].filter((s) => s.watcher).length > MAX_WATCHERS)
    return;
  const wins = counts(rawWins, maxRounds(play)),
    held = counts(rawHeld, CAPACITY);
  if (!wins || !held || Object.values(held).some((bits) => !isInput(bits)))
    return;
  const results: RoundResult[] = [];
  for (const raw of rawResults) {
    if (
      !plain(raw) ||
      Object.keys(raw).length !== 3 ||
      !uint32(raw.round) ||
      raw.round !== results.length + 1 ||
      !playerKey(raw.winner) ||
      !Array.isArray(raw.placings) ||
      raw.placings.length === 0 ||
      raw.placings.length > CAPACITY
    )
      return;
    const placed = raw.placings.map(decodePlacing);
    if (placed.some((p) => !p)) return;
    const ids = placed.map((p) => p!.id);
    const slots = placed.map((p) => p!.slot);
    if (
      new Set(ids).size !== ids.length ||
      new Set(slots).size !== slots.length ||
      !ids.includes(raw.winner)
    )
      return;
    results.push({
      round: raw.round,
      winner: raw.winner,
      placings: placed as Placing[],
    });
  }
  const world = rawWorld === null ? null : decodeWorld(rawWorld);
  if (world === undefined) return;
  const expectedWins: Record<string, number> = {};
  for (const result of results)
    expectedWins[result.winner] = (expectedWins[result.winner] ?? 0) + 1;
  if (
    JSON.stringify(sortedEntries(wins)) !==
    JSON.stringify(sortedEntries(expectedWins))
  )
    return;
  const lastWinner = results.at(-1)?.winner ?? "";
  const earnedWinner =
    (wins[lastWinner] ?? 0) >= play.wins
      ? lastWinner
      : leader({ wins, results });
  // The lobby has no round and no world; a round in play or between rounds has both; only a finished match has a
  // winner (a match of nothing but draws ends with none).
  if (
    (stage === "lobby") !== (round === 0) ||
    (stage === "lobby" && world !== null) ||
    (stage !== "lobby" && world === null) ||
    results.length !== (stage === "running" ? round - 1 : round) ||
    (world &&
      (world.step > simulationTick ||
        (stage === "running") === (world.phase === "done"))) ||
    (winner !== "" && stage !== "over") ||
    (stage === "over" && (!winner || !Object.hasOwn(wins, winner))) ||
    (stage === "over" && winner !== earnedWinner) ||
    (stage === "between" &&
      Object.values(wins).some((count) => count >= play.wins)) ||
    (stage === "over" &&
      (wins[winner as string] ?? 0) < play.wins &&
      round < maxRounds(play)) ||
    Object.keys(held).some((id) => !world?.worms.some((c) => c.id === id)) ||
    // Between rounds, the next one is due within the break; every worm and placing names a safe member id.
    (stage === "between" &&
      (resumeAt <= tick || resumeAt > tick + BETWEEN_TICKS)) ||
    world?.worms.some((c) => !playerKey(c.id)) ||
    results.some((r) => r.placings.some((p) => !playerKey(p.id)))
  )
    return;
  return {
    tick,
    simulationTick,
    matchId,
    round,
    stage: stage as Stage,
    seats,
    settings,
    play,
    wins,
    results,
    winner: winner as string,
    resumeAt,
    held,
    world,
  };
}

export function hash(room: Room): string {
  const text = JSON.stringify([room.tick, ...encode(room)], (_key, value) =>
    plain(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : (value as unknown),
  );
  let a = 0x811c9dc5,
    b = 0x9747b28c;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b ^ text.charCodeAt(i), 0x01000193) >>> 0;
    b = (b ^ (b >>> 13)) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
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
    wins: { ...room.wins },
    winsNeeded: room.play.wins,
    results: room.results.map((result) => ({
      ...result,
      placings: result.placings.map((p) => ({ ...p })),
    })),
    winner: room.winner,
    resumeIn:
      room.stage === "between" ? Math.max(0, room.resumeAt - room.tick) : 0,
    world: room.world ? toView(room.world) : null,
  };
}

export const lieroGame: RollbackGame<Room, Entry, View, never, Settings> = {
  id: "fuse-liero",
  rules: `${RULES}-room-1`,
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
      (a, b) => a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
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
      const taken = (id: string) =>
        room.seats.has(id) ||
        pending.has(id) ||
        room.results.some((r) => r.placings.some((p) => p.id === id));
      while (taken(`${BOT_PREFIX}${number}`)) number++;
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
