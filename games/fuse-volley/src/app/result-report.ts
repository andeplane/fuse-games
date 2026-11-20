import {
  roomResultsBar,
  type ResultsBar,
  type ResultsHighlight,
  type ResultsReport,
  type ResultsRow,
} from "fuse-ui";
import type { Model } from "./presenter.js";

type Result = NonNullable<Model["result"]>;

/** What the page lends the report: a team's colour and the friend buttons. */
export interface ReportParts {
  color(team: number): string;
  /** FRIENDS or + ADD FRIEND for another player whose account is known. */
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
    color: parts.color(row.team),
    you: row.you,
    ...(row.bot || row.teamName
      ? { tag: [row.teamName, row.bot ? "AI" : ""].filter(Boolean).join(" · ") }
      : {}),
    friend: row.you || row.bot ? undefined : parts.friend?.(row.id),
    values: [String(row.points), String(row.touches)],
  }));
  const cards: ResultsHighlight[] = [];
  const most = Math.max(0, ...result.rows.map((row) => row.touches));
  if (most > 0)
    cards.push({
      icon: "✦",
      title: "Busiest hands",
      winners: result.rows
        .filter((row) => row.touches === most)
        .map((row) => ({ name: row.name, color: parts.color(row.team) })),
      detail: `${most} touches on the ball.`,
    });
  // How close it was, between two teams: a third team's points say nothing about the margin.
  const points = [
    ...new Map(result.rows.map((row) => [row.team, row.points])).values(),
  ];
  const [first, second] = points;
  if (points.length === 2 && first !== undefined && second !== undefined) {
    const margin = first - second,
      winners = result.rows
        .filter((row) => row.place === 1)
        .map((row) => ({ name: row.name, color: parts.color(row.team) }));
    // Two points or fewer apart is close; half the winner's points or fewer is not. In between, no card.
    if (margin <= 2 && second * 2 > first)
      cards.push({
        icon: "≈",
        title: "Down to the wire",
        winners,
        detail: `${first} – ${second}: decided by ${margin === 1 ? "one point" : `${margin} points`}.`,
      });
    else if (second * 2 <= first)
      cards.push({
        icon: "▲",
        title: "Clear win",
        winners,
        detail: `${margin} points ahead at the end.`,
      });
  }
  const winner = result.rows[0];
  return {
    game: "FUSE VOLLEY",
    context: `${result.rows.length} players`,
    headline: result.title,
    summary: result.score,
    ...(winner ? { accent: parts.color(winner.team) } : {}),
    standings: {
      nameLabel: "PLAYER",
      columns: ["POINTS", "TOUCHES"],
      rows,
    },
    highlights: { cards },
  };
}

/** The bar under the report: the host's next steps, and what everybody else waits for. */
export function resultBar(result: Result): ResultsBar {
  return roomResultsBar(result);
}
