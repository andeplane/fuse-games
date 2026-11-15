import { historyOnlyRegistration, type MatchResult } from "fuse-platform";
import {
  isHistoryBot,
  parseAxeHistoryPlayer,
  type AxeHistoryPlayer,
} from "./online/activity.js";

/** Cooperative stage/run history; no Elo or progression is awarded. */
export const axeRegistration = {
  ...historyOnlyRegistration({
    id: "fuse-axe",
    isBot: isHistoryBot,
  }),
  parseStats: parseAxeHistoryPlayer,
  validField: (players: readonly AxeHistoryPlayer[]) =>
    players.length <= 20 &&
    players.every((player) => player.outcome === players[0]?.outcome),
  activity: (result: MatchResult<AxeHistoryPlayer>) => ({
    title:
      result.round !== undefined
        ? `Stage ${result.round} · ${result.players[0]?.outcome === "clear" ? "Party cleared" : "Party defeated"}`
        : result.players[0]?.outcome === "victory"
          ? "Party victory"
          : "Party defeated",
    context: {
      playStyle: "Cooperative",
      outcome: result.players[0]?.outcome ?? "defeat",
    },
  }),
  activityPlayer: (player: AxeHistoryPlayer) => ({
    label: "Party member",
    stats: {
      damage: player.damage,
      knockdowns: player.knockdowns,
      stagesPlayed: player.roundsPlayed,
    },
  }),
};
