import type {
  ResultsBar,
  ResultsHighlight,
  ResultsReport,
  ResultsRow,
} from "fuse-ui";
import type { ResultModel, ResultRow } from "./presenter.js";

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
  const rows: ResultsRow[] = result.rows.map((row) => ({
    id: row.id,
    placement: row.place,
    name: row.name,
    color: parts.color(row.slot),
    you: row.you,
    ...(row.bot ? { tag: "AI" } : {}),
    friend: row.you || row.bot ? undefined : parts.friend?.(row.id),
    values: [
      String(row.roundWins),
      String(row.rolls),
      String(row.bestTurn),
      String(row.busts),
    ],
  }));
  const cards: ResultsHighlight[] = [];
  /** A card for whoever has the most of something, when anybody has any. */
  const most = (
    pick: (row: ResultRow) => number,
    card: (best: number) => Omit<ResultsHighlight, "winners">,
  ) => {
    const best = Math.max(0, ...result.rows.map(pick));
    if (best > 0)
      cards.push({
        ...card(best),
        winners: result.rows
          .filter((row) => pick(row) === best)
          .map((row) => ({ name: row.name, color: parts.color(row.slot) })),
      });
  };
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
  return {
    ...(result.waiting ? { status: result.waiting } : {}),
    actions: result.host
      ? [
          { id: "lobby", label: "Back to lobby" },
          { id: "rematch", label: "REMATCH", primary: true },
        ]
      : [],
  };
}
