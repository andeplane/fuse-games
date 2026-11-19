import type { MatchResult } from "fuse-platform";
import type { DocksideStats } from "../platform.js";
import type { Room } from "./game.js";

/**
 * A finished match as every replica computes it, for the room service (`parseDocksideStats` in `../platform.ts` is
 * its boundary). Everything is read from what the fold froze on the deciding tick — the world, the roster the match
 * started with and who was still seated — so every device writes the same bytes however seats change afterwards.
 *
 * A delivery decides one match and one rated round. Simultaneous deliveries share first place.
 */
export type DocksidePlayerResult = DocksideStats;

function players(room: Room): DocksidePlayerResult[] | undefined {
  const { world, decided, roster } = room;
  if (room.stage !== "over" || !world || !decided) return;
  return roster.map((entrant) => {
    const pilot = world.rigs[entrant.slot]!;
    const won = decided.winners.includes(entrant.id);
    return {
      playerId: entrant.id,
      name: entrant.name,
      slot: entrant.slot,
      roundsPlayed: 1,
      roundWins: won ? 1 : 0,
      matchScoreUnits: Number(won),
      matchPlacement: won ? 1 : 2,
      earlyExits: entrant.bot || decided.finishers.includes(entrant.id) ? 0 : 1,
      points: Number(won),
      launched: pilot.launched,
      intercepted: pilot.intercepted,
    };
  });
}

/** The whole match, which credits account totals; undefined until the match is over. */
export function matchResult(
  room: Room,
): MatchResult<DocksidePlayerResult> | undefined {
  const list = players(room);
  if (!list || !room.decided) return;
  return {
    matchId: room.matchId,
    length: 1,
    // A drawn match has several winners: the placements say who.
    ...(room.decided.winners.length === 1
      ? { winnerId: room.decided.winners[0]! }
      : {}),
    finishers: [...room.decided.finishers],
    players: list,
  };
}

/** The same match as a rating receipt: a match is one round to the platform, which rates rounds. */
export function roundResult(
  room: Room,
): MatchResult<DocksidePlayerResult> | undefined {
  const result = matchResult(room);
  return result && room.world
    ? {
        ...result,
        round: 1,
        roundDuration: { version: 1, ticks: room.world.tick },
      }
    : undefined;
}
