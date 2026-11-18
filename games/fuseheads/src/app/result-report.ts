import type { ResultsReport } from "fuse-ui";
import type { FuseheadsView } from "../game/index.js";

export function resultReport(view: FuseheadsView, self: string): ResultsReport {
  return {
    game: "Fuseheads",
    headline: view.outcome === "cleared" ? "Underworld cleared!" : "Game over",
    context: "Level " + view.round,
    standings: {
      title: "Team score",
      columns: ["POINTS"],
      rows: view.players.map((player) => ({
        id: player.id,
        placement: 1,
        name: player.name,
        you: player.id === self,
        color: player.slot === 0 ? "#9ad551" : "#67c3ee",
        values: [String(player.score)],
      })),
    },
  };
}
