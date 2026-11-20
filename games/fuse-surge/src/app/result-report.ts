import {
  playerResultRows,
  roomResultsBar,
  type ResultsBar,
  type ResultsHighlight,
  type ResultsReport,
} from "fuse-ui";
import type { Model } from "./presenter.js";

type Result = NonNullable<Model["result"]>;

/** What the page lends the report: a lane's colour and the friend buttons. */
export interface ReportParts {
  color(slot: number): string;
  /** FRIENDS or + ADD FRIEND for another player whose account is known. */
  friend?(id: string): HTMLElement | undefined;
}

/** A finished match as the shared results screen shows it. */
export function resultReport(
  result: Result,
  parts: ReportParts,
): ResultsReport {
  const rows = playerResultRows(result.rows, parts, {
    colorKey: (row) => row.slot,
    values: (row) => [String(row.wins), String(row.dodges), String(row.hits)],
  });
  const named = (pick: (row: Result["rows"][number]) => boolean) =>
    result.rows
      .filter(pick)
      .map((row) => ({ name: row.name, color: parts.color(row.slot) }));
  const cards: ResultsHighlight[] = [];
  // A highlight sets someone apart: what every rider shares is not one.
  const mostDodges = Math.max(0, ...result.rows.map((row) => row.dodges));
  if (mostDodges > 0 && result.rows.some((row) => row.dodges < mostDodges))
    cards.push({
      icon: "✦",
      title: "Quickest feet",
      winners: named((row) => row.dodges === mostDodges),
      detail: `${mostDodges} surges dodged.`,
    });
  // Untouched all match is worth saying only when somebody else was not.
  const clean = result.rows.filter((row) => row.hits === 0);
  if (clean.length && clean.length < result.rows.length)
    cards.push({
      icon: "◆",
      title: "Untouched",
      winners: named((row) => row.hits === 0),
      detail: "Not struck once.",
    });
  const fewest = Math.min(...result.rows.map((row) => row.hits));
  if (!clean.length && result.rows.some((row) => row.hits > fewest))
    cards.push({
      icon: "◇",
      title: "Hardest to hit",
      winners: named((row) => row.hits === fewest),
      detail: `Struck ${fewest === 1 ? "once" : `${fewest} times`}.`,
    });
  const winner = result.rows.find((row) => row.place === 1);
  const shared = result.rows.filter((row) => row.place === 1).length > 1;
  return {
    game: "FUSE SURGE",
    context: `${result.rows.length} riders · first to ${result.target}`,
    headline: result.title,
    ...(winner
      ? {
          summary: `${winner.wins} round ${winner.wins === 1 ? "win" : "wins"}`,
        }
      : {}),
    // A shared victory keeps the screen's own colour: no one rider's.
    ...(winner && !shared ? { accent: parts.color(winner.slot) } : {}),
    standings: {
      nameLabel: "RIDER",
      columns: ["ROUNDS", "DODGED", "HITS"],
      rows,
    },
    highlights: { cards },
  };
}

/** The bar under the report: the host's next steps, and what everybody else waits for. */
export function resultBar(result: Result): ResultsBar {
  return roomResultsBar(result);
}
