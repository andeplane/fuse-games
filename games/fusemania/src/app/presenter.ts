import {
  BATTLE_MODE,
  CAPACITY,
  type Library,
  type PlayerView,
} from "../engine/index.js";
import { unreadyGuests, type View } from "../online/game.js";
import type { LobbyAction } from "./lobby-bar.js";
import {
  chartLabel,
  grade,
  ordinal,
  percent,
  presentResult,
  scoreText,
  standingRows,
  type SessionModel,
  type SongResult,
} from "./present-result.js";

export {
  bestText,
  comboBadge,
  grade,
  ordinal,
  percent,
  scoreText,
  type Own,
  type ResultAction,
  type Row,
  type SessionModel,
  type Standing,
} from "./present-result.js";

/**
 * What the page shows, decided from one frame: the screen (the lobby with its song select, the note field, or a
 * phone controller for a shared screen), the lobby's roster, the names the field is labelled with and the result.
 * Pure, so the decisions are unit-tested; `main.ts` only puts them on the page.
 */
export interface Viewer {
  me: string;
  host: boolean;
  solo: boolean;
  /** This page is the shared TV: it shows the fields and never plays. */
  display: boolean;
}

/**
 * What a song that waits for its audio says over the field: this device's own download first, then who else the
 * room waits for.
 */
export function holdText(waiting: readonly string[], settled: boolean): string {
  if (!settled) return "DOWNLOADING SONG…";
  return waiting.length
    ? `WAITING FOR ${waiting.join(", ").toUpperCase()} · DOWNLOADING SONG…`
    : "GET READY…";
}

export interface Model {
  screen: "lobby" | "play" | "controller";
  askName: boolean;
  seated: boolean;
  /** This device has a field in the match being played: its keys are live. */
  playing: boolean;
  /** This device's player slot in the match, or −1. */
  localSlot: number;
  /**
   * Who else the started song waits for while their devices download it, by name ("THE TV" for the shared
   * screen), this device left out. Empty when the song is not held, or held for this device alone.
   */
  waiting: string[];
  lobby: {
    members: {
      id: string;
      name: string;
      slot: number;
      connected: boolean;
      you: boolean;
      bot: boolean;
      ready: boolean;
      /** The chart the seat will play: "HARD 9". */
      chart: string;
    }[];
    /** The host may seat another AI rival, and take these seats' AI away. */
    canAddBot: boolean;
    removable: string[];
    action: LobbyAction;
    editable: boolean;
    note: string;
    /** The session the room is in the middle of, between two of its songs. */
    session: SessionModel | null;
  };
  /** Each player's name and chart by slot, for the fields. */
  names: string[];
  chartNames: string[];
  /** Each player's session total before this song, by slot; empty when the song is not one of a session. */
  totals: number[];
  totalSongs: number;
  /** The song being played, after its number in a session: "SONG 2 OF 5 · NEON KICKOFF". */
  title: string;
  /** One line for a phone controller. */
  status: string;
  /** A line under the field for a device that is not playing. */
  note: string;
  /** The chart this device will play next, as the song select shows it. */
  chart: number;
  result: SongResult | null;
}

type World = NonNullable<View["world"]>;

function controllerStatus(
  view: View,
  world: World,
  player: PlayerView | undefined,
  songTitle: string,
  viewer: Viewer,
): string {
  const alone = world.players.length === 1;
  if (view.stage === "over") {
    if (!player) return "SONG OVER";
    if (alone) return `${grade(player.rating)} · ${percent(player.rating)}`;
    return view.winner === viewer.me
      ? "YOU WIN!"
      : `${ordinal(player.place)} PLACE`;
  }
  if (world.ms < 0) return "GET READY";
  if (!player) return songTitle;
  const score = scoreText(player.rating);
  return alone ? score : `${score} · ${ordinal(player.place)}`;
}

function lobbyMessage(
  view: View,
  viewer: Viewer,
  seats: number,
  inMatch: boolean,
  waiting: readonly string[],
  guestReady: boolean | undefined,
): string {
  if (!seats) return "Pick a name to take a seat";
  if (!viewer.host)
    return guestReady === false
      ? "Choose your chart, then press READY."
      : "Waiting for the host to start";
  const session = view.session;
  // Changing the song count ends the current session unless the host changes it back.
  if (
    !inMatch &&
    session &&
    session.done > 0 &&
    session.length !== view.settings.songs
  )
    return `Another number of songs starts a new session: pick ${session.length} again to go on with this one.`;
  if (waiting.length) return `Waiting for ${waiting.join(", ")} to get ready.`;
  if (view.settings.display)
    return "Shared screen: open the TV screen, then every player uses a phone";
  if (seats !== 1) return "";
  if (!viewer.solo)
    return "Start alone, add an AI rival, or invite up to four friends.";
  return view.settings.mode === BATTLE_MODE
    ? "A battle needs a rival: add an AI player or invite a friend."
    : "";
}

function presentLobby(
  library: Library,
  view: View,
  viewer: Viewer,
  inMatch: boolean,
): Model["lobby"] {
  const seats = view.seats.filter((seat) => !seat.watcher);
  const session = view.session;
  // The session waits in Song Select if the host has kept the number of songs.
  const between =
    !inMatch && session?.length === view.settings.songs ? session : null;
  const waiting = viewer.host
    ? unreadyGuests(seats, view.lobbyReady, viewer.me)
    : [];
  const ownSeat = seats.find((seat) => seat.id === viewer.me && seat.connected);
  const guestReady =
    !viewer.host && ownSeat && !viewer.display
      ? view.lobbyReady.includes(ownSeat.id)
      : undefined;
  const startText = between
    ? `START SONG ${between.done + 1} OF ${between.length}`
    : view.settings.songs > 1
      ? `START SONG 1 OF ${view.settings.songs}`
      : "START";
  return {
    members: seats.map((seat) => ({
      id: seat.id,
      name: seat.name,
      slot: seat.slot,
      connected: seat.connected,
      you: seat.id === viewer.me,
      bot: seat.bot,
      ready: view.lobbyReady.includes(seat.id),
      chart: chartLabel(library, view.settings.song, seat.chart),
    })),
    canAddBot: viewer.host && seats.length < CAPACITY,
    removable: viewer.host
      ? seats.filter((seat) => seat.bot).map((seat) => seat.id)
      : [],
    action: viewer.host
      ? {
          kind: "start",
          label: startText,
          enabled: seats.some((seat) => seat.connected) && !waiting.length,
        }
      : guestReady !== undefined
        ? { kind: "ready", pressed: guestReady }
        : { kind: "none" },
    editable: viewer.host,
    note: lobbyMessage(
      view,
      viewer,
      seats.length,
      inMatch,
      waiting.map((seat) => seat.name),
      guestReady,
    ),
    session:
      between && between.done > 0
        ? {
            title: `SESSION · ${between.done} OF ${between.length} PLAYED`,
            rows: standingRows(between, view, viewer),
          }
        : null,
  };
}

export function present(
  library: Library,
  view: View,
  viewer: Viewer,
  /** This device's best rating on the chart before this match, if there was one. */
  bestBefore?: number,
): Model {
  const mine = view.seats.find((seat) => seat.id === viewer.me);
  const seated = !!mine && !mine.watcher;
  const world = view.stage === "lobby" ? null : view.world;
  const inMatch = !!world;
  const localSlot =
    world?.players.findIndex((each) => each.id === viewer.me) ?? -1;
  const player = world?.players[localSlot];
  const playing = view.stage === "running" && localSlot !== -1;
  const shared = view.settings.display || view.play.display;
  const screen: Model["screen"] = !inMatch
    ? "lobby"
    : shared && !viewer.display && localSlot !== -1
      ? "controller"
      : "play";
  const song = library.song(inMatch ? view.play.song : view.settings.song);
  const session = view.session;
  const songTitle = (song?.title ?? "").toUpperCase();
  const title =
    inMatch && session
      ? `SONG ${session.songs.length} OF ${session.length} · ${songTitle}`
      : songTitle;

  const status = world
    ? controllerStatus(view, world, player, songTitle, viewer)
    : "";

  let note = "";
  if (inMatch && !viewer.display && localSlot === -1 && view.stage !== "over")
    note = seated
      ? "You play in the next song"
      : mine
        ? "Watching"
        : "Pick a name to play in the next song";

  let lobby: Model["lobby"] | undefined;
  const lobbyViewer = { ...viewer };
  return {
    screen,
    askName: !mine && !viewer.display && !viewer.solo,
    seated,
    playing,
    localSlot,
    waiting: view.waiting
      ? [
          ...view.waiting.ids
            .filter((id) => id !== viewer.me)
            .map((id) => view.seats.find((seat) => seat.id === id)?.name ?? "")
            .filter((name) => name !== ""),
          ...(view.waiting.screen && !viewer.display ? ["THE TV"] : []),
        ]
      : [],
    get lobby() {
      return (lobby ??= presentLobby(library, view, lobbyViewer, inMatch));
    },
    names: inMatch ? view.roster.map((entrant) => entrant.name) : [],
    chartNames: world
      ? world.players.map((each) => chartLabel(library, world.song, each.chart))
      : [],
    totals:
      world && session
        ? world.players.map((each) => {
            const points =
              session.standings.find((score) => score.id === each.id)?.points ??
              0;
            // Once the song is decided its rating is in the total already.
            return Math.max(
              0,
              points - (view.stage === "over" ? each.rating : 0),
            );
          })
        : [],
    totalSongs: session?.length ?? 1,
    title,
    status,
    note,
    chart: mine?.chart ?? view.settings.chart,
    result: presentResult(library, view, viewer, songTitle, bestBefore),
  };
}
