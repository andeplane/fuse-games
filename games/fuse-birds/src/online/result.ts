import type { MatchResult, PlayerResult } from "fuse-platform";
import type { BirdsView } from "./game.js";

/** A battle is one round. Faulted preparation and local practice produce no ordinary game receipt. */
export function birdsResults(view: BirdsView): { tick: number; result: MatchResult<PlayerResult> }[] {
  const world = view.world, decided = view.decided;
  if (!world || world.phase !== "over" || !decided) return [];
  const result: MatchResult = {
    matchId: world.id,
    length: 1,
    ...(world.winner === null ? {} : { winnerId: world.winner }),
    finishers: [...decided.finishers],
    players: world.players.map(player => ({
      playerId: player.id, name: player.name, slot: player.slot,
      roundsPlayed: 1, roundWins: player.id === world.winner ? 1 : 0,
      matchScoreUnits: player.hp,
      matchPlacement: world.winner === null || player.id === world.winner ? 1 : 2,
      earlyExits: decided.finishers.includes(player.id) ? 0 : 1,
    })),
  };
  return [{ tick: decided.tick, result: { ...result, round: 1 } }, { tick: decided.tick, result }];
}
