import {
  createTopResultHighlight,
  type ResultsBar,
  type ResultsHighlight,
  type ResultsReport,
  type ResultsRow,
} from "fuse-ui";
import { money, type ResultModel } from "./presenter.js";

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
      `${row.goals}%`,
      money(row.netWorth),
      String(row.degrees),
      String(row.shifts),
    ],
  }));
  const cards: ResultsHighlight[] = [];
  const most = createTopResultHighlight(
    result.rows,
    (row) => parts.color(row.slot),
    cards,
  );
  most(
    (row) => row.netWorth,
    (best) => ({
      icon: "◆",
      title: "Deepest pockets",
      detail: `${money(best)} net worth.`,
    }),
  );
  most(
    (row) => row.degrees,
    (best) => ({
      icon: "▲",
      title: "Top of the class",
      detail: `${count(best, "degree")} earned.`,
    }),
  );
  most(
    (row) => row.shifts,
    (best) => ({
      icon: "▣",
      title: "Hardest worker",
      detail: `${count(best, "shift")} worked.`,
    }),
  );
  const winner =
    result.winnerSlot >= 0
      ? result.rows.find((row) => row.slot === result.winnerSlot)
      : undefined;
  return {
    game: "FUSETOWN",
    context: `${count(result.weeks, "week")} · ${count(result.rows.length, "player")}`,
    headline: result.title,
    ...(winner
      ? {
          summary: `${winner.finished ? `All goals met in week ${winner.finished}` : `${winner.goals}% of goals`} · net worth ${money(winner.netWorth)}`,
          accent: parts.color(winner.slot),
        }
      : {}),
    standings: {
      columns: ["GOALS", "NET WORTH", "DEGREES", "SHIFTS"],
      rows,
    },
    highlights: { cards },
  };
}

/**
 * The bar under the report: the host's next steps, and what everybody else waits for. A match on this device leads
 * out through its own bar (PLAY AGAIN, MENU), so it has no Leave.
 */
export function resultBar(result: ResultModel): ResultsBar {
  return {
    ...(result.waiting ? { status: result.waiting } : {}),
    actions: result.host
      ? [
          { id: "lobby", label: result.local ? "MENU" : "Back to lobby" },
          {
            id: "rematch",
            label: result.local ? "PLAY AGAIN" : "REMATCH",
            primary: true,
          },
        ]
      : [],
    ...(result.local ? { back: false } : {}),
  };
}
