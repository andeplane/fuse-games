import {
  createTopResultHighlight,
  type ResultsHighlight,
  type ResultsReport,
  type ResultsRow,
} from "fuse-ui";
import type { Model } from "./presenter.js";

type Result = NonNullable<Model["result"]>;

/** What the page lends the report: a seat's colour and the friend buttons. */
export interface ReportParts {
  color(slot: number): string;
  /** FRIENDS or + ADD FRIEND for another pilot whose account is known. */
  friend?(id: string): HTMLElement | undefined;
}

const count = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;
/** Seconds as the standings show them: 0:42. */
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

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
      String(row.crowns),
      String(row.escapes),
      String(row.crashes),
      clock(row.airTime),
    ],
  }));
  const cards: ResultsHighlight[] = [];
  const most = createTopResultHighlight(
    result.rows,
    (row) => parts.color(row.slot),
    cards,
  );
  most(
    (row) => row.escapes,
    (best) => ({
      icon: "➤",
      title: "Escape artist",
      detail: `Flew out of the cave ${count(best, "time")}.`,
    }),
  );
  most(
    (row) => row.airTime,
    (best) => ({
      icon: "∞",
      title: "Longest in the air",
      detail: `${clock(best)} of flying over the match.`,
    }),
  );
  most(
    (row) => row.crashes,
    (best) => ({
      icon: "✕",
      title: "Crash magnet",
      detail: `${count(best, "crash", "crashes")}.`,
    }),
  );
  const winner = result.rows[0];
  return {
    game: "FUSE CHOPPERS",
    context: `${count(result.rounds, "round")} · ${count(result.rows.length, "pilot")}`,
    headline: result.title,
    ...(winner && result.winnerSlot >= 0
      ? {
          summary: `${count(winner.crowns, "crown")} in ${count(result.rounds, "round")}`,
          accent: parts.color(result.winnerSlot),
        }
      : {}),
    standings: {
      nameLabel: "PILOT",
      columns: ["CROWNS", "ESCAPES", "CRASHES", "AIR TIME"],
      rows,
    },
    highlights: { cards },
  };
}

/** The bar under the report: the host's next steps, and what everybody else waits for. */
export { roomResultsBar as resultBar } from "fuse-ui";
