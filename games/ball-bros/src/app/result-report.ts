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
  /** FRIENDS or + ADD FRIEND for another player whose account is known. */
  friend?(id: string): HTMLElement | undefined;
}

const count = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** A finished round as the shared results screen shows it. */
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
    friend:
      row.you || row.bot || result.solo ? undefined : parts.friend?.(row.id),
    values: [
      String(row.saves),
      String(row.broken),
      row.alive ? String(row.armor) : "LOST",
    ],
  }));
  const cards: ResultsHighlight[] = [];
  const most = createTopResultHighlight(
    result.rows,
    (row) => parts.color(row.slot),
    cards,
  );
  most(
    (row) => row.saves,
    (best) => ({
      icon: "◎",
      title: "Goalkeeper",
      detail: `${count(best, "save")} off the paddle.`,
    }),
  );
  most(
    (row) => row.broken,
    (best) => ({
      icon: "✕",
      title: "Wrecking ball",
      detail: `Broke ${count(best, "enemy block")}.`,
    }),
  );
  most(
    (row) => (row.alive ? row.armor : 0),
    (best) => ({
      icon: "▣",
      title: "Iron wall",
      detail: `${count(best, "armor block")} still standing.`,
    }),
  );
  const winner = result.rows.find((row) => row.slot === result.winnerSlot);
  return {
    game: "BALL BROS",
    kicker: "ROUND COMPLETE",
    context: `${result.map} · ${count(result.rows.length, "player")}`,
    headline: result.title,
    ...(winner
      ? {
          summary: `${count(winner.saves, "save")} · ${count(winner.broken, "block")} broken`,
          accent: parts.color(winner.slot),
        }
      : { summary: "Nobody was the last core standing" }),
    standings: {
      columns: ["SAVES", "BREAKS", "ARMOR"],
      rows,
    },
    highlights: { cards },
  };
}

/** The bar under the report: a solo retry, the host's next steps, or what everybody else waits for. */
export function resultBar(result: Result): ResultsBar {
  if (result.solo)
    return {
      actions: [{ id: "rematch", label: "PLAY AGAIN", primary: true }],
    };
  return roomResultsBar(result);
}
