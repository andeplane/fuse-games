import {
  playerResultRows,
  createTopResultHighlight,
  roomResultsBar,
  type ResultsBar,
  type ResultsHighlight,
  type ResultsReport,
} from "fuse-ui";
import { HEROES, type Result } from "./presenter.js";

/** What the page lends the report: a seat's colour and the friend buttons. */
export interface ReportParts {
  color(slot: number): string;
  /** FRIENDS or + ADD FRIEND for another player whose account is known. */
  friend?(id: string): HTMLElement | undefined;
}

const count = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** A finished run as the shared results screen shows it. The party wins or falls together: no winner's colour. */
export function resultReport(
  result: Result,
  parts: ReportParts,
): ResultsReport {
  const rows = playerResultRows(result.rows, parts, {
    colorKey: (row) => row.slot,
    values: (row) => [
      HEROES[row.hero].name,
      String(row.damage),
      String(row.knockdowns),
    ],
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
      title: "Heaviest hitter",
      detail: `${best} damage dealt over the run.`,
    }),
  );
  most(
    (row) => row.knockdowns,
    (best) => ({
      icon: "✕",
      title: "Knockout artist",
      detail: `${count(best, "foe")} knocked out.`,
    }),
  );
  return {
    game: "FUSE AXE",
    kicker: "RUN COMPLETE",
    context: `${count(result.stages, "stage")} · ${count(result.rows.length, "hero", "heroes")}`,
    headline: result.title,
    summary: result.line,
    standings: {
      title: "THE PARTY",
      nameLabel: "PLAYER",
      columns: ["HERO", "DAMAGE", "KO"],
      rows,
    },
    highlights: { title: "RUN HIGHLIGHTS", cards },
  };
}

/** The bar under the report: the host's next steps, and what everybody else waits for. */
export function resultBar(result: Result): ResultsBar {
  return roomResultsBar(result);
}
