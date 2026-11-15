import type {
  ResultsBar,
  ResultsHighlight,
  ResultsReport,
  ResultsRow,
} from "fuse-ui";
import { HEROES, type Result, type ResultRow } from "./presenter.js";

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
  const rows: ResultsRow[] = result.rows.map((row) => ({
    id: row.id,
    placement: row.place,
    name: row.name,
    color: parts.color(row.slot),
    you: row.you,
    ...(row.bot ? { tag: "AI" } : {}),
    friend: row.you || row.bot ? undefined : parts.friend?.(row.id),
    values: [HEROES[row.hero].name, String(row.damage), String(row.knockdowns)],
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
