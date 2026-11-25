import {
  playerResultRows,
  createTopResultHighlight,
  roomResultsBar,
  type ResultsBar,
  type ResultsHighlight,
  type ResultsReport,
} from "fuse-ui";
import type { ResultModel } from "./presenter.js";

/** What the page lends the report: a seat's colour and the friend buttons. */
export interface ReportParts {
  color(slot: number): string;
  /** FRIENDS or + ADD FRIEND for another player whose account is known. */
  friend?(id: string): HTMLElement | undefined;
}

const count = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** A finished match as the shared results screen shows it. */
export function resultReport(
  result: ResultModel,
  parts: ReportParts,
): ResultsReport {
  const rows = playerResultRows(result.rows, parts, {
    colorKey: (row) => row.slot,
    values: (row) => [
      String(row.roundWins),
      String(row.rolls),
      String(row.bestTurn),
      String(row.busts),
    ],
  });
  const cards: ResultsHighlight[] = [];
  const most = createTopResultHighlight(
    result.rows,
    (row) => parts.color(row.slot),
    cards,
  );
  most(
    (row) => row.bestTurn,
    (best) => ({
      icon: "◆",
      title: "Biggest turn",
      detail: `Banked ${best} in one turn.`,
    }),
  );
  most(
    (row) => row.rolls,
    (best) => ({
      icon: "↺",
      title: "Kept rolling",
      detail: `${count(best, "roll")} over the match.`,
    }),
  );
  most(
    (row) => row.busts,
    (best) => ({
      icon: "✕",
      title: "Pushed their luck",
      detail: `${count(best, "bust")}.`,
    }),
  );
  const winner = result.rows.find((row) => row.slot === result.winnerSlot);
  return {
    game: "PIG",
    context: `${count(result.rounds, "round")} · ${count(result.rows.length, "player")}`,
    headline: result.title,
    ...(winner
      ? {
          summary: `${count(winner.roundWins, "round win")} in ${count(result.rounds, "round")}`,
          accent: parts.color(winner.slot),
        }
      : {}),
    standings: {
      columns: ["ROUNDS", "ROLLS", "BEST TURN", "BUSTS"],
      rows,
    },
    highlights: { cards },
  };
}

/** The bar under the report: the host's next steps, and what everybody else waits for. */
export function resultBar(result: ResultModel): ResultsBar {
  return roomResultsBar(result);
}
