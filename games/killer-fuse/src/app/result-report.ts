import {
  createTopResultHighlight,
  roomResultsBar,
  el,
  type ResultsBar,
  type ResultsHighlight,
  type ResultsReport,
  type ResultsRow,
} from "fuse-ui";
import type { ResultModel } from "./presenter.js";

/** What the page lends the report: a team's colour and the friend buttons. */
export interface ReportParts {
  color(team: number): string;
  /** FRIENDS or + ADD FRIEND for another player whose account is known. */
  friend?(id: string): HTMLElement | undefined;
  document?: Document;
}

/** A finished set as the shared results screen shows it. */
export function resultReport(
  result: ResultModel,
  parts: ReportParts,
): ResultsReport {
  const doc = parts.document ?? document;
  const rows: ResultsRow[] = result.rows.map((row) => ({
    id: row.id,
    placement: row.place,
    name: row.name,
    color: parts.color(row.team),
    you: row.you,
    tag: row.seat,
    friend: row.you ? undefined : parts.friend?.(row.id),
    values: [String(row.kills), String(row.deaths), String(row.berries)],
  }));
  const cards: ResultsHighlight[] = [];
  const most = createTopResultHighlight(
    result.rows,
    (row) => parts.color(row.team),
    cards,
  );
  most(
    (row) => row.kills,
    (best) => ({
      icon: "✕",
      title: "Deadliest",
      detail: best === 1 ? "One kill." : `${best} kills.`,
    }),
  );
  most(
    (row) => row.berries,
    (best) => ({
      icon: "●",
      title: "Berry runner",
      detail:
        best === 1
          ? "One berry carried home."
          : `${best} berries carried home.`,
    }),
  );
  // Whoever played the whole set without dying once, when somebody else did die.
  const unhurt = result.rows.filter((row) => row.deaths === 0);
  if (unhurt.length && unhurt.length < result.rows.length)
    cards.push({
      icon: "◆",
      title: "Untouchable",
      winners: unhurt.map((row) => ({
        name: row.name,
        color: parts.color(row.team),
      })),
      detail: "Not one death in the whole set.",
    });
  const games = el("ol", "", "kf-result-games", doc);
  games.append(...result.games.map((line) => el("li", line, "", doc)));
  return {
    game: "KILLER FUSE",
    kicker: "SET COMPLETE",
    context: `${result.games.length === 1 ? "1 game" : `${result.games.length} games`} · ${result.rows.length === 1 ? "1 player" : `${result.rows.length} players`}`,
    headline: result.title,
    summary: result.score,
    accent: parts.color(result.team),
    standings: {
      nameLabel: "PLAYER",
      columns: ["KILLS", "DEATHS", "BERRIES"],
      rows,
    },
    highlights: { cards },
    sections: result.games.length
      ? [{ title: "GAME BY GAME", content: [games] }]
      : [],
  };
}

/** The bar under the report: the host's next steps, and what everybody else waits for. */
export function resultBar(result: ResultModel): ResultsBar {
  return roomResultsBar(result);
}
