import {
  createTopResultHighlight,
  roomResultsBar,
  type ResultsBar,
  type ResultsHighlight,
  type ResultsReport,
  type ResultsRow,
} from "fuse-ui";
import type { CastleStats } from "../engine/index.js";

/** One pilot's line in the result. */
export interface ResultRow {
  id: string;
  /** The seat, for the colour. */
  slot: number;
  name: string;
  /** What a local seat flies with (`WASD`, `PAD 1`); "" online. */
  tag: string;
  you: boolean;
  bot: boolean;
  /** The match winner is first; pilots level on round wins share a place. */
  place: number;
  wins: number;
  /** The final round's: the engine keeps a round's statistics, not the match's. */
  damage: number;
  kills: number;
  bombs: number;
}

/** A finished match, as the online presenter and the local flow both say it. */
export interface Result {
  title: string;
  /** The winner's seat, or -1 when nobody won. */
  winnerSlot: number;
  rounds: number;
  /** Round wins that take the match. */
  target: number;
  rows: ResultRow[];
  host: boolean;
  waiting: string;
}

/** Who flew, before the placing. */
export interface Entrant {
  id: string;
  slot: number;
  name: string;
  tag: string;
  you: boolean;
  bot: boolean;
  wins: number;
  stats: CastleStats | undefined;
}

/** The match's result: `winner` (an entrant's id, or null) first, then by round wins and seat. */
export function matchResult(
  entrants: readonly Entrant[],
  winner: string | null,
  match: { rounds: number; target: number; host: boolean },
): Result {
  const rank = (entrant: { id: string; wins: number }) =>
    entrant.id === winner ? Infinity : entrant.wins;
  const sorted = [...entrants].sort(
    (a, b) => rank(b) - rank(a) || a.slot - b.slot,
  );
  const rows = sorted.map(({ stats, ...entrant }): ResultRow => ({
    ...entrant,
    place: 1 + sorted.filter((other) => rank(other) > rank(entrant)).length,
    damage: Math.round(stats?.damageDealt ?? 0),
    kills: stats?.kills ?? 0,
    bombs: stats?.ghostBombs ?? 0,
  }));
  const first = sorted.find((entrant) => entrant.id === winner);
  return {
    title: first ? `${first.name.toUpperCase()} WINS` : "NO WINNER",
    winnerSlot: first ? first.slot : -1,
    rounds: match.rounds,
    target: match.target,
    rows,
    host: match.host,
    waiting: match.host ? "" : "WAITING FOR THE HOST",
  };
}

/** What the page lends the report: a seat's colour and the friend buttons. */
export interface ReportParts {
  color(slot: number): string;
  /** FRIENDS or + ADD FRIEND for another pilot whose account is known. */
  friend?(id: string): HTMLElement | undefined;
}

const count = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** A finished match as the shared results screen shows it. */
export function resultReport(
  result: Result,
  parts: ReportParts,
): ResultsReport {
  const rows: ResultsRow[] = result.rows.map((row) => {
    const tag = row.bot ? "AI" : row.tag;
    return {
      id: row.id,
      placement: row.place,
      name: row.name,
      color: parts.color(row.slot),
      you: row.you,
      ...(tag ? { tag } : {}),
      friend: row.you || row.bot ? undefined : parts.friend?.(row.id),
      values: [String(row.wins), String(row.damage), String(row.kills)],
    };
  });
  const cards: ResultsHighlight[] = [];
  const most = createTopResultHighlight(
    result.rows,
    (row) => parts.color(row.slot),
    cards,
  );
  most(
    (row) => row.damage,
    (best) => ({
      icon: "◆",
      title: "Heavy hitter",
      detail: `${best} damage dealt in the final round.`,
    }),
  );
  most(
    (row) => row.kills,
    (best) => ({
      icon: "✕",
      title: "Knockout artist",
      detail: `${count(best, "gunship")} shot down in the final round.`,
    }),
  );
  most(
    (row) => row.bombs,
    (best) => ({
      icon: "○",
      title: "Restless ghost",
      detail: `${count(best, "bomb")} dropped as a ghost in the final round.`,
    }),
  );
  const winner = result.rows.find((row) => row.slot === result.winnerSlot);
  return {
    game: "FUSE BOMBERS",
    context: `${count(result.rounds, "round")} · ${count(result.rows.length, "gunship")}`,
    headline: result.title,
    ...(winner
      ? {
          summary: `${count(winner.wins, "round win")} · first to ${result.target}`,
          accent: parts.color(winner.slot),
        }
      : {}),
    standings: {
      nameLabel: "PILOT",
      columns: ["WINS", "DAMAGE", "KOS"],
      rows,
      note: "Damage and KOs are the final round's.",
    },
    highlights: { cards },
  };
}

/** The bar under the report: the host's next steps, and what everybody else waits for. */
export function resultBar(result: Result): ResultsBar {
  return roomResultsBar(result);
}
