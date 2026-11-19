import {
  BOO,
  DROPPED,
  FULL_RATING,
  GOOD,
  GREAT,
  HELD,
  MARVELOUS,
  MINED,
  MISS,
  PERFECT,
  type Library,
  type PlayerView,
} from "../engine/index.js";
import type { SessionView, View } from "../online/game.js";
import { scorePercent } from "../song-scores.js";
import type { Viewer } from "./presenter.js";

/** A rating as a letter grade and a percentage. */
export function grade(rating: number): string {
  const share = rating / FULL_RATING;
  return share >= 1
    ? "AAAA"
    : share >= 0.97
      ? "AAA"
      : share >= 0.93
        ? "AA"
        : share >= 0.85
          ? "A"
          : share >= 0.75
            ? "B"
            : share >= 0.6
              ? "C"
              : "D";
}
export const percent = scorePercent;
/** A rating displayed as its percentage of the chart's possible points. */
export const scoreText = scorePercent;
/** What a best result reads as on a chart chip. */
export const bestText = (rating: number): string =>
  `${grade(rating)} ${percent(rating)}`;
export const ordinal = (place: number): string =>
  `${place}${["TH", "ST", "ND", "RD"][place % 100 > 10 && place % 100 < 14 ? 0 : place % 10 < 4 ? place % 10 : 0]}`;

/** One line of the result table. */
export interface Row {
  /** The player's id in the room. */
  id: string;
  bot: boolean;
  place: number;
  slot: number;
  name: string;
  you: boolean;
  /** The chart played: "HARD 9". */
  chart: string;
  /** "94.2%". */
  accuracy: string;
  /** The longest combo, as a number. */
  maxCombo: string;
  /** How many of each judgment, Marvelous first and Miss last. */
  judgments: string[];
  grade: string;
  score: string;
  /** The chart played and the accuracy: "HARD 9 · 94.2%". */
  detail: string;
  /** "MAX COMBO 212". */
  combo: string;
}
/** This device's own run on the result. */
export interface Own {
  grade: string;
  /** The score with thousands separators. */
  score: string;
  /** "CHALLENGE 13 · 94.2% · MAX COMBO 212". */
  detail: string;
  /** What a run with no broken combo earned ("FULL GREAT COMBO", "FULL PERFECT COMBO", ...), or "". */
  badge: string;
}
/** One line of a session's standings. */
export interface Standing {
  place: number;
  name: string;
  you: boolean;
  /** The seat the rider sits in now, for its colour, or −1 for one who left. */
  slot: number;
  /** The session total, with thousands separators. */
  points: string;
  /** "2 WINS", or "" for none. */
  wins: string;
}
/** A session's standings under a heading: "SESSION · AFTER SONG 2 OF 5", "FINAL STANDINGS". */
export interface SessionModel {
  title: string;
  rows: Standing[];
}
/** What a button of the result does: the room action it sends. */
export interface ResultAction {
  text: string;
  action: "rematch" | "lobby";
}
export interface SongResult {
  title: string;
  /** The song that was played: "NEON KICKOFF". */
  song: string;
  rows: Row[];
  /** This device's own run, large: null for a watcher and for the TV. */
  own: Own | null;
  /** This device's own judgments, one line each: ["MARVELOUS", "212"]. */
  counts: [label: string, value: string][];
  /** Extra lines: a new best. */
  lines: string[];
  host: boolean;
  waiting: string;
  solo: boolean;
  /** The session's standings with this song in them. */
  session: SessionModel | null;
  /** The session is over: its standings lead the card. */
  final: boolean;
  /** The host's main button, and the other one where there is a second thing to do. */
  primary: ResultAction;
  secondary: ResultAction | null;
}

export const chartLabel = (
  library: Library,
  song: string,
  chart: number,
): string => {
  const info = library.song(song)?.charts;
  const picked = info?.[Math.min(chart, info.length - 1)];
  return picked ? `${picked.name.toUpperCase()} ${picked.meter}` : "";
};

const countLines = (player: PlayerView): [string, string][] => [
  ["MARVELOUS", String(player.counts[MARVELOUS])],
  ["PERFECT", String(player.counts[PERFECT])],
  ["GREAT", String(player.counts[GREAT])],
  ["GOOD", String(player.counts[GOOD])],
  ["BOO", String(player.counts[BOO])],
  ["MISS", String(player.counts[MISS])],
  [
    "HOLDS",
    `${player.counts[HELD]} / ${player.counts[HELD]! + player.counts[DROPPED]!}`,
  ],
  ...(player.counts[MINED]
    ? [["MINES HIT", String(player.counts[MINED])] as [string, string]]
    : []),
];

/** A run that never broke its combo, named after the worst judgment in it. */
export const comboBadge = (counts: readonly number[]): string => {
  const at = (judgment: number) => counts[judgment] ?? 0;
  if (
    at(MISS) ||
    at(BOO) ||
    at(GOOD) ||
    at(DROPPED) ||
    at(MARVELOUS) + at(PERFECT) + at(GREAT) === 0
  )
    return "";
  return at(GREAT)
    ? "FULL GREAT COMBO"
    : at(PERFECT)
      ? "FULL PERFECT COMBO"
      : "ALL MARVELOUS";
};

export const standingRows = (
  session: SessionView,
  view: View,
  viewer: Viewer,
): Standing[] =>
  session.standings.map((score, index) => ({
    place: index + 1,
    name: score.name,
    you: score.id === viewer.me,
    slot:
      view.seats.find((seat) => seat.id === score.id && !seat.watcher)?.slot ??
      -1,
    points: scoreText(score.points / session.length),
    wins: score.wins
      ? `${score.wins} ${score.wins === 1 ? "WIN" : "WINS"}`
      : "",
  }));

type World = NonNullable<View["world"]>;

function personalBestLine(
  player: PlayerView | undefined,
  before: number | undefined,
): string {
  if (!player || player.bot) return "";
  if (before === undefined) return "FIRST SCORE ON THIS CHART";
  if (player.rating > before)
    return `NEW BEST! +${scoreText(player.rating - before)} (WAS ${percent(before)})`;
  const best = `BEST ${bestText(before)}`;
  return player.rating === before
    ? best
    : `${best} · −${scoreText(before - player.rating)}`;
}

type SessionProgress = "single" | "between" | "complete";

function resultActions(
  progress: SessionProgress,
  random: boolean,
): [ResultAction, ResultAction | null] {
  const select: ResultAction = { text: "SONG SELECT", action: "lobby" };
  if (progress === "single")
    return [{ text: "PLAY AGAIN", action: "rematch" }, select];
  if (random)
    return [
      {
        text: progress === "complete" ? "NEW SESSION" : "NEXT SONG",
        action: "rematch",
      },
      select,
    ];
  return [
    {
      text: progress === "complete" ? "NEW SESSION" : "PICK NEXT SONG",
      action: "lobby",
    },
    null,
  ];
}

function resultWait(progress: SessionProgress, random: boolean): string {
  if (progress === "complete")
    return "Waiting for the host to start a new session";
  return progress === "between" && random
    ? "Waiting for the host to start the next song"
    : "Waiting for the host to pick the next song";
}

function resultTitle(
  view: View,
  viewer: Viewer,
  world: World,
  songTitle: string,
  leader?: SessionView["standings"][number],
): string {
  if (leader)
    return leader.id === viewer.me
      ? "YOU WIN THE SESSION!"
      : `${leader.name.toUpperCase()} WINS THE SESSION`;
  if (world.players.length === 1)
    return `${songTitle} · ${grade(world.players[0]!.rating)}`;
  const winner = view.roster.find((entrant) => entrant.id === view.winner);
  if (!winner) return "SONG OVER";
  return winner.id === viewer.me
    ? "YOU WIN!"
    : `${winner.name.toUpperCase()} WINS`;
}

export function presentResult(
  library: Library,
  view: View,
  viewer: Viewer,
  songTitle: string,
  bestBefore: number | undefined,
): SongResult | null {
  const world = view.world;
  if (view.stage !== "over" || !world) return null;
  const player = world.players.find((each) => each.id === viewer.me);
  const session = view.session;
  const rows: Row[] = [...world.players]
    .sort((a, b) => a.place - b.place)
    .map((each) => {
      const chart = chartLabel(library, world.song, each.chart);
      const accuracy = percent(each.rating);
      return {
        id: each.id,
        bot: each.bot,
        chart,
        accuracy,
        maxCombo: String(each.best),
        judgments: [MARVELOUS, PERFECT, GREAT, GOOD, BOO, MISS].map((kind) =>
          String(each.counts[kind]),
        ),
        place: each.place,
        slot: each.slot,
        name: view.roster[each.slot]?.name ?? "",
        you: each.id === viewer.me,
        grade: grade(each.rating),
        score: accuracy,
        detail: `${chart} · ${accuracy}`,
        combo: `MAX COMBO ${each.best}`,
      };
    });
  const line = personalBestLine(player, bestBefore);
  const progress: SessionProgress = !session
    ? "single"
    : session.done >= session.length
      ? "complete"
      : "between";
  const final = progress === "complete";
  const leader = session?.standings[0];
  const random = view.settings.random;
  const [primary, secondary] = resultActions(progress, random);
  return {
    title: resultTitle(
      view,
      viewer,
      world,
      songTitle,
      final ? leader : undefined,
    ),
    song: songTitle,
    rows,
    own: player
      ? {
          grade: grade(player.rating),
          score: scoreText(player.rating),
          detail: `${chartLabel(library, world.song, player.chart)} · ${percent(player.rating)} · MAX COMBO ${player.best}`,
          badge: comboBadge(player.counts),
        }
      : null,
    counts: player ? countLines(player) : [],
    lines: line ? [line] : [],
    host: viewer.host,
    waiting: viewer.host ? "" : resultWait(progress, random),
    solo: viewer.solo,
    session: session
      ? {
          title: final
            ? "FINAL STANDINGS"
            : `SESSION · AFTER SONG ${session.done} OF ${session.length}`,
          rows: standingRows(session, view, viewer),
        }
      : null,
    final,
    primary,
    secondary,
  };
}
