import {
  createTopResultHighlight,
  type ResultsHighlight,
  type ResultsReport,
  type ResultsRow,
} from "fuse-ui";
import type { Model } from "./presenter.js";

type Result = NonNullable<Model["result"]>;

/** What the page lends the report: a side's colour and the friend buttons. */
export interface ReportParts {
  color(slot: number): string;
  /** FRIENDS or + ADD FRIEND for another rider whose account is known. */
  friend?(id: string): HTMLElement | undefined;
}

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
    ...(row.bot || row.teamName
      ? { tag: [row.teamName, row.bot ? "AI" : ""].filter(Boolean).join(" · ") }
      : {}),
    friend: row.you || row.bot ? undefined : parts.friend?.(row.id),
    values: [String(row.goals), String(row.ownGoals), String(row.bubbles)],
  }));
  const cards: ResultsHighlight[] = [];
  const most = createTopResultHighlight(
    result.rows,
    (row) => parts.color(row.slot),
    cards,
  );
  most(
    (row) => row.goals,
    (best) => ({
      icon: "◎",
      title: "Top scorer",
      detail: best === 1 ? "One goal." : `${best} goals.`,
    }),
  );
  most(
    (row) => row.bubbles,
    (best) => ({
      icon: "○",
      title: "Bubble machine",
      detail: best === 1 ? "One bubble blown." : `${best} bubbles blown.`,
    }),
  );
  most(
    (row) => row.ownGoals,
    (best) => ({
      icon: "↺",
      title: "Wrong way",
      detail:
        best === 1
          ? "One ball into the other side's goal."
          : `${best} balls into the other side's goal.`,
    }),
  );
  const winner = result.rows.find((row) => row.place === 1);
  const decided = result.rows.some((row) => row.place !== 1);
  return {
    game: "FUSEBALL",
    context: `${result.rows.length} riders`,
    headline: result.title,
    summary: result.score,
    ...(winner && decided ? { accent: parts.color(winner.slot) } : {}),
    standings: {
      nameLabel: "RIDER",
      columns: ["GOALS", "OWN GOALS", "BUBBLES"],
      rows,
    },
    highlights: { cards },
  };
}

/** The bar under the report: the host's next steps, and what everybody else waits for. */
export { roomResultsBar as resultBar } from "fuse-ui";
