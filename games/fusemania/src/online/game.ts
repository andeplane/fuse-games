import {
  hashCheckpointJson,
  applyManagementTick,
  decodeSingleWinner as decodeDecided,
  createSeatListDecoder,
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
  entriesForGeneration,
} from "fuse-netcode";
import {
  CAPACITY,
  LEAD_IN_MS,
  MAX_SONG_MS,
  MIN_SONG_MS,
  MODES,
  RELEASE,
  SCORE_MODE,
  SOLO_LEAD_IN_MS,
  TICK_MS,
  UP,
  createWorld,
  decodeWorld,
  encodeWorld,
  isCode,
  ranking,
  rating,
  songStats,
  stepWorld,
  toView,
  type Input,
  type Library,
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
import {
  captureHistoryReceipts,
  currentHistoryReceipts,
  parseRecentResults,
  type FusemaniaReceipt,
} from "./result.js";
import {
  decodeSession,
  encodeSession,
  SESSION_LENGTHS,
  settleSession,
  standings,
  type Session,
  type SessionView,
} from "./session.js";

export { SESSION_LENGTHS, SESSION_SCORES, standings } from "./session.js";
export type {
  Session,
  SessionScore,
  SessionTotal,
  SessionView,
} from "./session.js";

/**
 * Fusemania behind the netcode's `RollbackGame`. The room keeps the seats, the lobby's settings (the song, the mode
 * and the chart a seat plays unless it picked its own) and one match. One log tick folds the management entries and
 * every rider's key presses, each stamped with the song time its device heard, then moves the song by one tick.
 */
export interface Settings {
  /** One shared screen with phones as controllers. */
  display: boolean;
  /** The song's id in the library. */
  song: string;
  /** `SCORE_MODE` or `BATTLE_MODE`. */
  mode: number;
  /** The chart a seat plays unless it picked one: an index into the song's charts, easiest first. */
  chart: number;
  /** How many songs one session plays: one of `SESSION_LENGTHS`. One is a single song with no session around it. */
  songs: number;
  /** A session's songs are drawn at random instead of picked by the host. */
  random: boolean;
}
/** The most charts one song offers a room. */
export const MAX_CHARTS = 16;
const SETTING_KEYS = ["display", "song", "mode", "chart", "songs", "random"];

export const PLAY = 0,
  PICK = 1,
  READY = 2,
  LOBBY_READY = 3;
/**
 * The longest a started song waits for its devices to have the audio, in log ticks (30 s): a device that never
 * answers, a tab left in the background, does not keep the room from its song.
 */
export const HOLD_TICKS = Math.round(30000 / TICK_MS);
/**
 * A key of this seat moved (or its power-up button was pressed) in the match numbered `epoch`, at song time `ms`.
 * The epoch counts the room's matches, so a late entry from the last match never plays in this one.
 */
export type PlayEntry = [
  seq: number,
  tick: number,
  kind: typeof PLAY,
  epoch: number,
  code: number,
  ms: number,
];
/** This seat plays chart `chart` from the next match on. */
export type PickEntry = [
  seq: number,
  tick: number,
  kind: typeof PICK,
  chart: number,
];
/**
 * This device is done getting the song of the match numbered `epoch`: it has the audio, or it will not play any
 * (muted, a phone that is a pad, a file that would not load).
 */
export type ReadyEntry = [
  seq: number,
  tick: number,
  kind: typeof READY,
  epoch: number,
];
/** A human seat's readiness for one lobby configuration. Separate from downloading a started song. */
export type LobbyReadyEntry = [
  seq: number,
  tick: number,
  kind: typeof LOBBY_READY,
  revision: number,
  slot: number,
  ready: boolean,
];
type OwnEntry = PlayEntry | PickEntry | ReadyEntry | LobbyReadyEntry;
export type Entry = ManagementEntry<Settings> | OwnEntry;
/** A started song that stands at its first moment until every device has its audio. */
export interface Hold {
  /** Log ticks waited so far: at most `HOLD_TICKS`. */
  ticks: number;
  /** The members whose devices are done, sorted. */
  ready: string[];
  /**
   * The shared screen is waited for too: the room's creator when it holds no seat, which is the TV of a shared
   * screen room. It plays the song for everyone, and the seats cannot speak for it.
   */
  screen: boolean;
}

export const MAX_WATCHERS = 5;
/** The room's size, whatever library the game is made with: what the service sizes its rooms by. */
export const ROOM = {
  seating: { capacity: CAPACITY, maxWatchers: MAX_WATCHERS },
} as const;
/** Bump this peer protocol for incompatible room or gameplay changes. Ranked replay has its own version. */
const ROOM_RULES = "fusemania-11-activity-duration-2";
export type RoomStage = "lobby" | "running" | "over";

/** A rider of the current match as it started: the result names them even if the seat is gone by the end. */
export interface Entrant {
  id: string;
  name: string;
  slot: number;
  bot: boolean;
  chart: number;
}
/** The finished match, frozen on the tick it was decided so every replica reports the same thing. */
export interface Decided {
  /** The log tick it was decided on: a report waits until it is confirmed. */
  clock: number;
  winner: string;
  /** The humans still seated when it ended, sorted: who can attest the result. */
  finishers: string[];
}

export interface Room extends ManagedRoom<Settings> {
  tick: number;
  matchStartTick: number;
  matchId: string;
  /** Matches this room has started. */
  epoch: number;
  stage: RoomStage;
  /** The settings the current match plays with, fixed at its start. */
  play: Settings;
  /** The chart each seat picked for itself, by member id. */
  picks: Record<string, number>;
  /** A revision of the shared lobby settings and the human seats that accepted it. */
  lobbyReady: { revision: number; ids: string[] };
  /** The match's riders in slot order; empty in the lobby. */
  roster: Entrant[];
  decided: Decided | null;
  world: World | null;
  /** The session the room is in the middle of, or just finished; null when it plays single songs. */
  session: Session | null;
  /** The running song waits for its devices to have the audio; null once it moves, and outside a match. */
  hold: Hold | null;
  /** Up to eight recent parents, each with at most ten song receipts and its final aggregate. */
  recentResults: FusemaniaReceipt[][];
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
  /** The chart the seat will play in the next match. */
  chart: number;
}
/** What the screen renders. Outcomes are read from here, never from events, so a rollback's correction shows. */
export interface View {
  /** The log tick. */
  tick: number;
  stage: RoomStage;
  matchId: string;
  epoch: number;
  /** The lobby's settings: what the next match plays. */
  settings: Settings;
  /** The settings of the match being played. */
  play: Settings;
  seats: SeatView[];
  lobbyReady: string[];
  roster: Entrant[];
  /** The winner's id once `stage` is "over", otherwise "". */
  winner: string;
  world: WorldView | null;
  session: SessionView | null;
  /**
   * Who a started song still waits for (their devices are getting its audio): the seats by id and whether the
   * shared screen is one of them. Null when the song is not held.
   */
  waiting: { ids: string[]; screen: boolean } | null;
}

const plain = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const chartIndex = (value: unknown): value is number =>
  Number.isInteger(value) &&
  (value as number) >= 0 &&
  (value as number) < MAX_CHARTS;

/** A match's seed, from its id. */
export function seedOf(matchId: string): number {
  let seed = 0x811c9dc5;
  for (let i = 0; i < matchId.length; i++)
    seed = Math.imul(seed ^ matchId.charCodeAt(i), 0x01000193) >>> 0;
  return seed;
}

const STAGES: readonly RoomStage[] = ["lobby", "running", "over"];
const FIELDS = 15;
const sameSettings = (a: Settings, b: Settings): boolean =>
  a.song === b.song &&
  a.chart === b.chart &&
  a.mode === b.mode &&
  a.display === b.display &&
  a.songs === b.songs &&
  a.random === b.random;

export function unreadyGuests<
  T extends {
    id: string;
    bot: boolean;
    connected: boolean;
    watcher?: boolean;
  },
>(seats: readonly T[], ready: readonly string[], host: string): T[] {
  const humans = seats.filter(
    (seat) => !seat.bot && seat.connected && !seat.watcher,
  );
  return humans.length <= 1
    ? []
    : humans.filter((seat) => seat.id !== host && !ready.includes(seat.id));
}
const seatOrder = (a: SeatRecord, b: SeatRecord) =>
  a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const decodeSeats = createSeatListDecoder({
  capacity: CAPACITY,
  maxWatchers: MAX_WATCHERS,
  playerKey,
  validName,
  validAvatar: isAvatar,
});

function decodePicks(
  raw: unknown,
  seats: ReadonlyMap<string, SeatRecord>,
): Record<string, number> | undefined {
  if (!Array.isArray(raw) || raw.length > CAPACITY) return;
  const picks: Record<string, number> = {};
  for (const pair of raw) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      !playerKey(pair[0]) ||
      Object.hasOwn(picks, pair[0]) ||
      // Only a seated rider has a pick.
      seats.get(pair[0])?.watcher !== undefined ||
      !seats.has(pair[0]) ||
      !chartIndex(pair[1])
    )
      return;
    picks[pair[0]] = pair[1];
  }
  return picks;
}

function decodeRoster(raw: unknown): Entrant[] | undefined {
  if (!Array.isArray(raw) || raw.length > CAPACITY) return;
  const roster: Entrant[] = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length !== 4) return;
    const [id, name, bot, chart] = item as unknown[];
    if (
      !playerKey(id) ||
      !validName(name) ||
      typeof bot !== "boolean" ||
      !chartIndex(chart) ||
      roster.some((entrant) => entrant.id === id)
    )
      return;
    roster.push({ id, name, slot: roster.length, bot, chart });
  }
  return roster;
}

export type FusemaniaGame = RollbackGame<Room, Entry, View, never, Settings> & {
  /** The songs this game plays. */
  library: Library;
};

/**
 * The game over a library of songs: the bundled one for rooms, or one with a loaded simfile for a solo run.
 * `soloBots` is how many AI rivals a solo run starts with.
 */
export function createFusemaniaGame(
  library: Library,
  soloBots = 0,
): FusemaniaGame {
  /** The settings boundary, for a logged entry, a command and a checkpoint alike: exactly the fields, each checked. */
  function parseSettings(raw: unknown): Settings | undefined {
    if (!plain(raw)) return;
    const keys = Object.keys(raw);
    if (
      keys.length !== SETTING_KEYS.length ||
      !SETTING_KEYS.every((key) => Object.hasOwn(raw, key))
    )
      return;
    const { display, song, mode, chart, songs, random } = raw;
    if (
      typeof display !== "boolean" ||
      typeof song !== "string" ||
      !library.song(song) ||
      !Number.isInteger(mode) ||
      (mode as number) < 0 ||
      (mode as number) >= MODES ||
      !chartIndex(chart) ||
      !SESSION_LENGTHS.includes(songs as number) ||
      typeof random !== "boolean"
    )
      return;
    return {
      display,
      song,
      mode: mode as number,
      chart,
      songs: songs as number,
      random,
    };
  }

  const payloads = {
    name: validName,
    avatar: isAvatar,
    settings: (value: unknown) => parseSettings(value) !== undefined,
    memberKey: playerKey,
    matchKey: validMatchId,
    capacity: CAPACITY,
  };
  function isEntry(raw: unknown): raw is Entry {
    if (isManagementEntry(raw, payloads)) return true;
    if (!hasLogPosition(raw)) return false;
    if (raw[2] === PLAY)
      return (
        raw.length === 6 &&
        uint32(raw[3]) &&
        isCode(raw[4]) &&
        typeof raw[5] === "number" &&
        Number.isInteger(raw[5]) &&
        raw[5] >= MIN_SONG_MS &&
        raw[5] <= MAX_SONG_MS
      );
    if (raw[2] === READY) return raw.length === 4 && uint32(raw[3]);
    if (raw[2] === LOBBY_READY)
      return (
        raw.length === 6 &&
        uint32(raw[3]) &&
        uint32(raw[4]) &&
        raw[4] < CAPACITY &&
        typeof raw[5] === "boolean"
      );
    return raw[2] === PICK && raw.length === 4 && chartIndex(raw[3]);
  }

  function createRoom(matchId: string, settings: Settings): Room {
    return {
      tick: 0,
      matchStartTick: 0,
      matchId,
      epoch: 0,
      stage: "lobby",
      seats: new Map(),
      settings: { ...settings },
      play: { ...settings },
      picks: {},
      lobbyReady: { revision: 0, ids: [] },
      roster: [],
      decided: null,
      world: null,
      session: null,
      hold: null,
      recentResults: [],
    };
  }

  /** Seats in slot order, watchers excluded. */
  const riders = (room: Room): SeatRecord[] =>
    [...room.seats.values()]
      .filter((seat) => !seat.watcher)
      .sort((a, b) => a.slot - b.slot);

  function resetMatch(room: Room, matchId: string): void {
    room.matchId = matchId;
    room.play = { ...room.settings };
    room.stage = "lobby";
    room.roster = [];
    room.decided = null;
    room.world = null;
    room.hold = null;
    room.lobbyReady = { revision: room.tick + 1, ids: [] };
  }
  /** Starts a match for the seats, in seat order, or leaves the room in its lobby when nobody is seated. */
  function beginMatch(room: Room): void {
    const seated = riders(room);
    if (seated.length < 1) return;
    const charts = library.song(room.play.song)?.charts.length ?? 1;
    const roster = seated.map((seat, index) => ({
      id: seat.id,
      name: seat.name,
      slot: index,
      bot: seat.bot,
      chart: Math.min(
        (seat.bot ? undefined : room.picks[seat.id]) ?? room.play.chart,
        charts - 1,
      ),
    }));
    const world = createWorld(
      library,
      room.play.song,
      room.play.mode,
      seedOf(matchId(room)),
      roster,
      roster.length === 1 ? SOLO_LEAD_IN_MS : LEAD_IN_MS,
    );
    if (!world) return;
    room.matchStartTick = room.tick;
    room.roster = roster;
    room.world = world;
    room.stage = "running";
    room.epoch++;
    room.hold = { ticks: 0, ready: [], screen: false };
  }
  /** The members a held song waits for: every device that is in the room and not done getting the audio. */
  const awaited = (room: Room, hold: Hold): string[] =>
    [...room.seats.values()]
      .filter(
        (seat) =>
          !seat.bot &&
          seat.connected &&
          seat.away !== true &&
          !hold.ready.includes(seat.id),
      )
      .sort(seatOrder)
      .map((seat) => seat.id);
  const matchId = (room: Room) => room.matchId;

  /**
   * The song a random session plays next, from the match's id: one it has not played yet while there is one, and
   * otherwise any but the last.
   */
  function draw(session: Session, id: string): string | undefined {
    const all = library.songs.map((song) => song.id);
    const last = session.songs[session.songs.length - 1];
    let pool = all.filter((song) => !session.songs.includes(song));
    if (!pool.length) pool = all.filter((song) => song !== last);
    if (!pool.length) pool = all;
    return pool[seedOf(id) % pool.length];
  }
  /**
   * Starts the next song. With more than one song a session it is a song of the session: the one the room is in the
   * middle of, or a new session when there is none, the last one is finished or the host changed its length.
   */
  function startSong(room: Room, id: string): void {
    resetMatch(room, id);
    let session = room.play.songs > 1 ? room.session : null;
    if (
      room.play.songs > 1 &&
      (!session ||
        session.done >= session.length ||
        session.length !== room.play.songs)
    )
      session = {
        id,
        length: room.play.songs,
        done: 0,
        songs: [],
        totals: [],
      };
    if (session) {
      // A song that was given up is not one of the session's.
      session.songs.length = session.done;
      const song = room.play.random ? draw(session, id) : undefined;
      if (song !== undefined) {
        // The lobby shows the song that was drawn, as it shows one the host picked.
        room.play.song = song;
        room.settings = { ...room.settings, song };
      }
    }
    room.session = session;
    beginMatch(room);
    if (session && room.stage === "running") session.songs.push(room.play.song);
  }

  const lifecycle: Omit<LifecycleHooks<Room, Settings>, "start"> = {
    stage: (room) => room.stage,
    maxWatchers: MAX_WATCHERS,
    parseSettings,
    botAvatar: AVATAR,
    rematch: startSong,
    lobby(room, id) {
      resetMatch(room, id);
      const session = room.session;
      // A finished session is over; one in the middle waits in the lobby for its next song.
      if (session && session.done >= session.length) room.session = null;
      else if (session) session.songs.length = session.done;
    },
  };

  /** The seat's own entries for this tick, from the stream generation its controls follow, in the order written. */
  function ownEntries(
    seat: Pick<SeatRecord, "id" | "generation">,
    streams: ReadonlyMap<string, StreamEntries<Entry>>,
    tick: number,
  ): OwnEntry[] {
    const stream = streams.get(seat.id);
    const entries = entriesForGeneration(stream, seat.generation);
    return entries
      .filter(
        (entry): entry is OwnEntry =>
          entry[1] === tick &&
          (entry[2] === PLAY ||
            entry[2] === PICK ||
            entry[2] === READY ||
            entry[2] === LOBBY_READY),
      )
      .sort((a, b) => a[0] - b[0]);
  }

  function foldTick(
    room: Room,
    creatorId: string,
    streams: ReadonlyMap<string, StreamEntries<Entry>>,
  ): never[] {
    const tick = room.tick + 1;
    const previousSettings = room.settings;
    const previousVotes = room.lobbyReady.ids.flatMap((id) => {
      const seat = room.seats.get(id);
      return seat ? [{ id, generation: seat.generation, slot: seat.slot }] : [];
    });
    const retainedVotes = () =>
      previousVotes
        .filter((before) => {
          const seat = room.seats.get(before.id);
          return (
            seat?.connected &&
            !seat.watcher &&
            seat.generation === before.generation &&
            seat.slot === before.slot
          );
        })
        .map((seat) => seat.id);
    applyManagementTick(room, tick, creatorId, streams, {
      ...lifecycle,
      start(room, id, origin) {
        const ready =
          room.lobbyReady.revision !== tick &&
          sameSettings(previousSettings, room.settings)
            ? retainedVotes().filter((id) => {
                const seat = room.seats.get(id)!;
                // A same-tick withdrawal or chart change takes precedence over START.
                return !ownEntries(seat, streams, tick).some(
                  (entry) =>
                    (entry[2] === PICK &&
                      entry[3] !== (room.picks[id] ?? room.settings.chart)) ||
                    (entry[2] === LOBBY_READY &&
                      entry[3] === room.lobbyReady.revision &&
                      entry[4] === seat.slot &&
                      !entry[5]),
                );
              })
            : [];
        if (
          !unreadyGuests(riders(room), ready, origin?.author ?? creatorId)
            .length
        )
          startSong(room, id);
      },
    });
    if (room.stage === "lobby" && room.lobbyReady.revision !== tick) {
      if (!sameSettings(previousSettings, room.settings))
        room.lobbyReady = { revision: tick, ids: [] };
      else room.lobbyReady.ids = retainedVotes();
    }
    const ready = new Set(room.lobbyReady.ids);
    // A pick is a seat's own: it lasts while the seat does.
    for (const id of Object.keys(room.picks))
      if (!room.seats.has(id) || room.seats.get(id)!.watcher)
        delete room.picks[id];
    const inputs: Input[] = [];
    for (const seat of riders(room)) {
      if (seat.bot) continue;
      const slot = room.roster.findIndex((entrant) => entrant.id === seat.id);
      if (!seat.connected) {
        // A seat that went away let go of its keys: its key-up is never heard, so nothing of it stays held.
        const player =
          room.stage === "running" ? room.world?.players[slot] : undefined;
        if (player && room.world)
          for (const [column, down] of player.down.entries())
            if (down !== UP)
              inputs.push({ slot, code: RELEASE + column, ms: room.world.ms });
        continue;
      }
      for (const entry of ownEntries(seat, streams, tick)) {
        if (entry[2] === PICK) {
          const before = room.picks[seat.id] ?? room.settings.chart;
          room.picks[seat.id] = entry[3];
          if (before !== entry[3]) ready.delete(seat.id);
        } else if (entry[2] === LOBBY_READY) {
          if (
            room.stage !== "lobby" ||
            entry[3] !== room.lobbyReady.revision ||
            entry[4] !== seat.slot
          )
            continue;
          if (entry[5]) ready.add(seat.id);
          else ready.delete(seat.id);
        } else if (entry[2] === READY) continue;
        else if (
          slot >= 0 &&
          room.stage === "running" &&
          entry[3] === room.epoch
        )
          inputs.push({ slot, code: entry[4], ms: entry[5] });
      }
    }
    room.lobbyReady.ids = [...ready].sort();
    const hold = room.stage === "running" ? room.hold : null;
    if (hold) {
      // Anyone in the room says so, a watcher and the shared screen too: they hear the song as the riders do.
      const said = (seat: Pick<SeatRecord, "id" | "generation">) =>
        ownEntries(seat, streams, tick).some(
          (entry) => entry[2] === READY && entry[3] === room.epoch,
        );
      for (const seat of room.seats.values())
        if (
          !seat.bot &&
          seat.connected &&
          !hold.ready.includes(seat.id) &&
          said(seat)
        )
          hold.ready.push(seat.id);
      // A shared screen room's TV is its creator and holds no seat: its own stream speaks for it.
      const tv = room.play.display && !room.seats.has(creatorId);
      if (
        tv &&
        !hold.ready.includes(creatorId) &&
        said({
          id: creatorId,
          generation: streams.get(creatorId)?.generation ?? 0,
        })
      )
        hold.ready.push(creatorId);
      hold.ready = hold.ready
        .filter((id) => room.seats.has(id) || (tv && id === creatorId))
        .sort();
      hold.screen = tv && !hold.ready.includes(creatorId);
      if (
        (!hold.screen && !awaited(room, hold).length) ||
        hold.ticks >= HOLD_TICKS
      )
        room.hold = null;
      else hold.ticks++;
    }
    const world = room.world;
    // A held song stands at its first moment: nothing is judged and the song time does not move.
    if (room.stage === "running" && world && !room.hold) {
      // Riders in roster order, each one's inputs as it wrote them.
      inputs.sort((a, b) => a.slot - b.slot);
      stepWorld(library, world, inputs);
      if (world.phase === "over") {
        room.stage = "over";
        room.decided = {
          clock: tick,
          winner: room.roster[ranking(library, world)[0]!]!.id,
          finishers: room.roster
            .filter((entrant) => {
              const seat = room.seats.get(entrant.id);
              return (
                !entrant.bot && seat && (seat.connected || seat.away === true)
              );
            })
            .map((entrant) => entrant.id)
            .sort(),
        };
        settleSession(room, library);
        captureHistoryReceipts(library, room);
      }
    }
    room.tick = tick;
    return [];
  }

  function encode(room: Room): unknown[] {
    return [
      room.matchId,
      room.stage,
      { ...room.settings },
      [...room.seats.values()].sort(seatOrder).map((seat) => ({ ...seat })),
      { ...room.play },
      Object.entries(room.picks).sort(([a], [b]) => (a < b ? -1 : 1)),
      room.roster.map((entrant) => [
        entrant.id,
        entrant.name,
        entrant.bot,
        entrant.chart,
      ]),
      room.decided
        ? [room.decided.clock, room.decided.winner, [...room.decided.finishers]]
        : null,
      room.world ? encodeWorld(room.world) : null,
      room.epoch,
      encodeSession(room.session),
      room.hold
        ? [room.hold.ticks, [...room.hold.ready], room.hold.screen]
        : null,
      room.matchStartTick,
      structuredClone(room.recentResults),
      [room.lobbyReady.revision, [...room.lobbyReady.ids]],
    ];
  }

  /**
   * The room a checkpoint describes, or nothing: every field is checked on its own and against the others, and the
   * room is built only once all of them hold, so a refused checkpoint leaves no half-read state behind.
   */
  function decode(fields: readonly unknown[], tick: number): Room | undefined {
    if (fields.length !== FIELDS || !uint32(tick)) return;
    const [
      id,
      stage,
      rawSettings,
      rawSeats,
      rawPlay,
      rawPicks,
      rawRoster,
      rawDecided,
      rawWorld,
      epoch,
      rawSession,
      rawHold,
      matchStartTick,
      rawRecentResults,
      rawLobbyReady,
    ] = fields;
    const settings = parseSettings(rawSettings),
      play = parseSettings(rawPlay),
      seats = decodeSeats(rawSeats),
      roster = decodeRoster(rawRoster);
    const recentResults = parseRecentResults(rawRecentResults, tick, library);
    if (
      !validMatchId(id) ||
      !uint32(matchStartTick) ||
      matchStartTick > tick ||
      !STAGES.some((known) => known === stage) ||
      !settings ||
      !play ||
      !seats ||
      !roster ||
      !recentResults ||
      !uint32(epoch) ||
      epoch > tick
    )
      return;
    const picks = decodePicks(rawPicks, seats);
    const decided = decodeDecided(rawDecided, roster);
    const world = rawWorld === null ? null : decodeWorld(library, rawWorld);
    const session = decodeSession(
      rawSession,
      (song) => library.song(song) !== undefined,
    );
    if (
      !picks ||
      decided === undefined ||
      (decided !== null && decided.clock < matchStartTick) ||
      world === undefined ||
      session === undefined
    )
      return;
    if (world === null) {
      // The lobby has no match: no world, no riders and nothing decided, and a session there is between two songs.
      if (stage !== "lobby" || roster.length || decided) return;
      if (
        session &&
        (session.done >= session.length ||
          session.songs.length !== session.done)
      )
        return;
    } else {
      const charts = library.song(play.song)?.charts.length ?? 0;
      if (
        stage === "lobby" ||
        epoch === 0 ||
        world.song !== play.song ||
        world.mode !== play.mode ||
        world.seed !== seedOf(id) ||
        (stage === "running") === (world.phase === "over") ||
        (stage === "over") !== (decided !== null) ||
        world.players.length !== roster.length ||
        world.players.some(
          (player, slot) =>
            player.id !== roster[slot]!.id ||
            player.bot !== roster[slot]!.bot ||
            player.chart !== roster[slot]!.chart,
        ) ||
        roster.some((entrant) => entrant.chart >= charts) ||
        (decided !== null &&
          (decided.clock > tick ||
            decided.winner !== roster[ranking(library, world)[0]!]!.id))
      )
        return;
      // A match of several songs a session is one of its session's songs, and a single song has no session.
      if (play.songs > 1 !== (session !== null)) return;
      if (session) {
        const at = stage === "running" ? session.done : session.done - 1;
        if (
          session.length !== play.songs ||
          session.songs.length !== at + 1 ||
          session.songs[at] !== play.song ||
          (decided !== null &&
            // The song just decided is in the totals: every rider has one, no less than this song gave it.
            world.players.some((player, slot) => {
              const total = session.totals.find(
                (each) => each.id === roster[slot]!.id,
              );
              const stats = songStats(player);
              return (
                !total ||
                total.bot !== player.bot ||
                total.combo < stats.combo ||
                total.marvelous < stats.marvelous ||
                total.perfect < stats.perfect ||
                total.great < stats.great ||
                total.steps < stats.steps ||
                total.misses < stats.misses ||
                total.earlyExits <
                  (player.bot || decided.finishers.includes(player.id)
                    ? 0
                    : 1) ||
                total.points <
                  rating(library.steps(world.song, player.chart)!, player.score)
              );
            }))
        )
          return;
      }
    }
    let hold: Hold | null = null;
    if (rawHold !== null) {
      // Only a running song is held, by members of the room, each named once and in order.
      if (
        stage !== "running" ||
        !Array.isArray(rawHold) ||
        rawHold.length !== 3 ||
        !uint32(rawHold[0]) ||
        rawHold[0] > HOLD_TICKS ||
        !Array.isArray(rawHold[1]) ||
        typeof rawHold[2] !== "boolean" ||
        (rawHold[2] && !play.display)
      )
        return;
      const ready: unknown[] = rawHold[1];
      // At most one of them is no seat: the shared screen, which only a shared screen room has.
      if (
        ready.length > seats.size + 1 ||
        !ready.every(
          (member, index): member is string =>
            playerKey(member) &&
            seats.get(member)?.bot !== true &&
            (index === 0 || (ready[index - 1] as string) < member),
        ) ||
        ready.filter((member) => !seats.has(member)).length >
          (play.display && !rawHold[2] ? 1 : 0)
      )
        return;
      hold = { ticks: rawHold[0], ready: [...ready], screen: rawHold[2] };
    }
    if (
      !Array.isArray(rawLobbyReady) ||
      rawLobbyReady.length !== 2 ||
      !uint32(rawLobbyReady[0]) ||
      rawLobbyReady[0] > tick ||
      !Array.isArray(rawLobbyReady[1]) ||
      rawLobbyReady[1].length > CAPACITY ||
      (stage !== "lobby" && rawLobbyReady[1].length)
    )
      return;
    const lobbyIds: unknown[] = rawLobbyReady[1];
    if (
      !lobbyIds.every((id, index): id is string => {
        if (
          !playerKey(id) ||
          (index > 0 && (lobbyIds[index - 1] as string) >= id)
        )
          return false;
        const seat = seats.get(id);
        return Boolean(seat?.connected && !seat.bot && !seat.watcher);
      })
    )
      return;
    const room: Room = {
      tick,
      matchStartTick,
      matchId: id,
      epoch,
      stage: stage as RoomStage,
      seats,
      settings,
      play,
      picks,
      roster,
      decided,
      world,
      session,
      hold,
      recentResults,
      lobbyReady: { revision: rawLobbyReady[0], ids: [...lobbyIds] },
    };
    if (stage === "over") {
      const retained = recentResults.at(-1) ?? [];
      const signature = (receipt: FusemaniaReceipt) =>
        JSON.stringify(receipt, (_key, value) =>
          plain(value)
            ? Object.fromEntries(
                Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)),
              )
            : value,
        );
      if (
        currentHistoryReceipts(library, room).some(
          (expected) =>
            !retained.some(
              (receipt) => signature(receipt) === signature(expected),
            ),
        )
      )
        return;
    }
    return room;
  }

  function hash(room: Room): string {
    return hashCheckpointJson([room.tick, ...encode(room)]);
  }

  function view(room: Room): View {
    const charts = library.song(room.settings.song)?.charts.length ?? 1;
    return {
      tick: room.tick,
      stage: room.stage,
      matchId: room.matchId,
      epoch: room.epoch,
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
        chart: Math.min(
          (seat.bot ? undefined : room.picks[seat.id]) ?? room.settings.chart,
          charts - 1,
        ),
      })),
      lobbyReady: [...room.lobbyReady.ids],
      roster: room.roster.map((entrant) => ({ ...entrant })),
      winner: room.decided?.winner ?? "",
      world: room.world ? toView(library, room.world) : null,
      session: room.session
        ? {
            id: room.session.id,
            length: room.session.length,
            done: room.session.done,
            songs: [...room.session.songs],
            standings: standings(room.session.totals),
          }
        : null,
      waiting:
        room.stage === "running" && room.hold
          ? { ids: awaited(room, room.hold), screen: room.hold.screen }
          : null,
    };
  }

  return {
    library,
    id: GAME_ID,
    rules: ROOM_RULES,
    isEntry,
    createRoom,
    createTicker: () => foldTick,
    scope: (room) => ({ matchId: room.matchId, round: 0 }),
    clock: (room) => room.tick,
    steps: () => 1,
    maxSteps: 1,
    view,
    hash,
    checkpoint: { leading: 6, encode, decode },
    // Slot then id: an order that depends only on the room, so a device that recovered it from a checkpoint names
    // members exactly as the devices that folded it.
    members: (room) => [...room.seats.values()].sort(seatOrder),
    seat: (room, id) => room.seats.get(id),
    stage: (room) => room.stage,
    settings: (room) => room.settings,
    matchSettings: (room) => room.play,
    seating: {
      ...ROOM.seating,
      minPlayers: 1,
      seatName,
      isAvatar,
      defaultAvatar: AVATAR,
      parseSettings,
      soloSettings: (settings) => ({ ...settings, display: false }),
      sharedScreen: (settings) => settings.display,
      botId(room, pending) {
        // Never an id the match or the session remembers, so a new bot is not mistaken for a departed one in the
        // result, and does not start with a departed one's session total.
        let number = 1;
        const taken = (id: string) =>
          room.seats.has(id) ||
          pending.has(id) ||
          room.roster.some((entrant) => entrant.id === id) ||
          room.session?.totals.some((total) => total.id === id) === true;
        while (taken(`${BOT_PREFIX}${number}`)) number++;
        return `${BOT_PREFIX}${number}`;
      },
      botName: (slot) => BOT_NAMES[slot % BOT_NAMES.length]!,
      solo: { name: "You", bots: soloBots },
    },
    text: {
      ...defaultText,
      solo: "Solo",
      needTwo: "Take a seat to start.",
    },
  };
}

/** The settings a library's first song starts a room with. */
export const defaultSettings = (library: Library): Settings => ({
  display: false,
  song: library.songs[0]?.id ?? "",
  mode: SCORE_MODE,
  chart: 1,
  songs: 1,
  random: false,
});
