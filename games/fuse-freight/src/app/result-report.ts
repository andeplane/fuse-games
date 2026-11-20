import {
  createTopResultHighlight,
  roomResultsBar,
  type ResultsBar,
  type ResultsHighlight,
  type ResultsReport,
  type ResultsRow,
} from "fuse-ui";
import type { Model } from "./presenter.js";

type Result = NonNullable<Model["result"]>;

/** What the page lends the report: a seat's colour and the friend buttons. */
export interface ReportParts {
  color(slot: number): string;
  /** FRIENDS or + ADD FRIEND for another driver whose account is known. */
  friend?(id: string): HTMLElement | undefined;
}

const count = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** A finished match as the shared results screen shows it. */
export function resultReport(
  result: Result,
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
      String(row.wins),
      String(row.delivered),
      String(row.stolen),
      String(row.stranded),
    ],
  }));
  const cards: ResultsHighlight[] = [];
  const most = createTopResultHighlight(
    result.rows,
    (row) => parts.color(row.slot),
    cards,
  );
  most(
    (row) => row.delivered,
    (best) => ({
      icon: "▣",
      title: "Freight baron",
      detail: `${count(best, "wagon")} delivered over the match.`,
    }),
  );
  most(
    (row) => row.stolen,
    (best) => ({
      icon: "✂",
      title: "Wagon thief",
      detail: `Cut ${count(best, "rival wagon")} loose.`,
    }),
  );
  most(
    (row) => row.stranded,
    (best) => ({
      icon: "◌",
      title: "Left on the track",
      detail: `${count(best, "wagon")} still in tow at the whistle.`,
    }),
  );
  const winner = result.rows[0];
  return {
    game: "FUSE FREIGHT",
    context: `${count(result.rounds, "round")} · ${count(result.rows.length, "driver")}`,
    headline: result.title,
    ...(winner && result.winnerSlot >= 0
      ? {
          summary: `${count(winner.wins, "win")} · ${count(winner.delivered, "wagon")} delivered`,
          accent: parts.color(result.winnerSlot),
        }
      : {}),
    standings: {
      nameLabel: "DRIVER",
      columns: ["WINS", "DELIVERED", "STOLEN", "STRANDED"],
      rows,
    },
    highlights: { cards },
  };
}

/** The bar under the report: the host's next steps, and what everybody else waits for. */
export function resultBar(result: Result): ResultsBar {
  return roomResultsBar(result);
}
