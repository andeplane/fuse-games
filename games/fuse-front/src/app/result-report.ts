import {
  playerResultRows,
  createTopResultHighlight,
  roomResultsBar,
  type ResultsBar,
  type ResultsHighlight,
  type ResultsReport,
} from "fuse-ui";
import { DRAW, type HeroKind } from "../engine/index.js";
import { TEAMS, banner, type SlotView } from "./model.js";
import type { Score } from "./scoreboard.js";

/** One hero's line of a finished match. */
export interface ResultRow {
  /** The rider's member id, or `bot:<slot>` for a slot the bot fill played. */
  id: string;
  slot: number;
  team: number;
  name: string;
  hero: HeroKind;
  you: boolean;
  bot: boolean;
  /** 1 for the winning army, 2 for the other; everybody is 1 in a draw. */
  place: number;
  kills: number;
  deaths: number;
  assists: number;
}

/** A finished match, as the page hands it to the results screen. */
export interface MatchResult {
  /** VICTORY, DEFEAT, DRAW, or RED WINS for a watcher. */
  title: string;
  /** The winning team, or `DRAW`. */
  winner: number;
  /** The match time as `m:ss`. */
  time: string;
  /** Sectors held at the end. */
  sectors: { red: number; neutral: number; blue: number };
  /** By team: enemy towers and gates razed, and jungle sectors held. */
  towers: [number, number];
  jungle: [number, number];
  rows: ResultRow[];
  /** This device may start a rematch or take the room back to the lobby. */
  host: boolean;
  /** What everybody else waits for. */
  waiting: string;
}

/** What the page knows of the match beyond its scoreboard. */
export interface ResultFacts {
  winner: number;
  /** This device's seat, −1 for a watcher. */
  seat: number;
  time: string;
  sectors: { red: number; neutral: number; blue: number };
  /** The room's riders, for their member ids. */
  seats: readonly { id: string; slot: number; bot: boolean }[];
  host: boolean;
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The result of a decided match: the winning army first, each army by kills, then fewest deaths. */
export function matchResult(
  score: Score,
  slots: readonly SlotView[],
  facts: ResultFacts,
): MatchResult {
  const rows = score.rows
    .map((row): ResultRow => {
      const slot = slots.find((s) => s.slot === row.seat);
      const bot = slot?.bot ?? true;
      const rider = facts.seats.find((s) => !s.bot && s.slot === row.seat);
      return {
        id: !bot && rider ? rider.id : `bot:${row.seat}`,
        slot: row.seat,
        team: row.team,
        // A bot is named by its difficulty; the AI tag says the rest.
        name: bot
          ? capital(slot?.difficulty ?? "normal")
          : (slot?.name ?? `Seat ${row.seat + 1}`),
        hero: row.kind,
        you: row.self,
        bot,
        place: facts.winner === DRAW || row.team === facts.winner ? 1 : 2,
        kills: row.kills,
        deaths: row.deaths,
        assists: row.assists,
      };
    })
    .sort(
      (a, b) =>
        a.place - b.place ||
        a.team - b.team ||
        b.kills - a.kills ||
        a.deaths - b.deaths ||
        a.slot - b.slot,
    );
  return {
    title: banner(facts.winner, facts.seat),
    winner: facts.winner,
    time: facts.time,
    sectors: { ...facts.sectors },
    towers: [...score.towers],
    jungle: [...score.jungle],
    rows,
    host: facts.host,
    waiting: facts.host ? "" : "Waiting for the host…",
  };
}

/** What the page lends the report: a team's colour and the friend buttons. */
export interface ReportParts {
  color(team: number): string;
  /** FRIENDS or + ADD FRIEND for another rider whose account is known. */
  friend?(id: string): HTMLElement | undefined;
}

const count = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** A finished match as the shared results screen shows it. */
export function resultReport(
  result: MatchResult,
  parts: ReportParts,
): ResultsReport {
  const rows = playerResultRows(result.rows, parts, {
    colorKey: (row) => row.team,
    values: (row) => [
      row.hero.toUpperCase(),
      String(row.kills),
      String(row.deaths),
      String(row.assists),
    ],
  });
  const cards: ResultsHighlight[] = [];
  const most = createTopResultHighlight(
    result.rows,
    (row) => parts.color(row.team),
    cards,
  );
  most(
    (row) => row.kills,
    (best) => ({
      icon: "◎",
      title: "Hero slayer",
      detail: `${count(best, "hero kill")}.`,
    }),
  );
  most(
    (row) => row.assists,
    (best) => ({
      icon: "✦",
      title: "Wingman",
      detail: `${count(best, "assist")}.`,
    }),
  );
  most(
    (row) => row.deaths,
    (best) => ({
      icon: "✕",
      title: "Fell the most",
      detail: `${count(best, "death")}.`,
    }),
  );
  const { red, neutral, blue } = result.sectors;
  const perTeam = (values: readonly [number, number]) =>
    `${TEAMS[0]} ${values[0]} · ${TEAMS[1]} ${values[1]}`;
  const size = Math.ceil(result.rows.length / 2);
  return {
    game: "FUSE FRONT",
    context: `${result.time} · ${size}v${size}`,
    headline: result.title,
    summary: `Sectors: ${red} red · ${neutral} neutral · ${blue} blue`,
    ...(result.winner === DRAW ? {} : { accent: parts.color(result.winner) }),
    standings: {
      nameLabel: "COMMANDER",
      columns: ["HERO", "KILLS", "DEATHS", "ASSISTS"],
      rows,
      note: `Towers razed: ${perTeam(result.towers)}. Jungle held: ${perTeam(result.jungle)}.`,
    },
    highlights: { cards },
  };
}

/** The bar under the report: the host's next steps, and what everybody else waits for. */
export function resultBar(result: MatchResult): ResultsBar {
  return roomResultsBar(result);
}
