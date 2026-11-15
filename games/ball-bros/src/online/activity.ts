import type { MatchResult, PlayerResult } from "fuse-platform";
import { parseHistoryPlayer } from "fuse-platform/history-api";
import { isMapId, type MapId } from "../engine/maps.js";
import type { RoomView } from "./game.js";

/** Arena participants and deciding-tick finishers are immutable after completion. */
export interface BallHistoryPlayer extends PlayerResult {
  saves: number;
  broken: number;
  armor: number;
  mapId: MapId;
}
export function parseBallHistoryPlayer(
  raw: unknown,
  rounds: number,
): BallHistoryPlayer | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const value = raw as Record<string, unknown>;
  const { saves, broken, armor, mapId, ...base } = value;
  const player = parseHistoryPlayer(base, rounds);
  const counter = (n: unknown): n is number =>
    typeof n === "number" &&
    Number.isSafeInteger(n) &&
    n >= 0 &&
    n <= 1_000_000;
  if (
    !player ||
    rounds !== 1 ||
    !counter(saves) ||
    !counter(broken) ||
    !counter(armor) ||
    !isMapId(mapId)
  )
    return;
  return { ...player, saves, broken, armor, mapId };
}
export function activityResult(
  frame: RoomView,
): MatchResult<BallHistoryPlayer> | undefined {
  const arena = frame.arena;
  if (frame.stage !== "over" || arena?.phase !== "over" || !frame.finishers)
    return;
  const standing = arena.bases.filter((base) => base.alive).length;
  return {
    matchId: frame.matchId,
    length: 1,
    ...(arena.winner ? { winnerId: arena.winner } : {}),
    finishers: [...frame.finishers],
    players: arena.bases.map((base) => ({
      playerId: base.id,
      name: base.name,
      slot: base.slot,
      roundsPlayed: 1,
      roundWins: base.id === arena.winner ? 1 : 0,
      matchScoreUnits: base.alive ? 1 : 0,
      matchPlacement: base.alive || !standing ? 1 : standing + 1,
      earlyExits: base.bot || frame.finishers!.includes(base.id) ? 0 : 1,
      saves: base.saves,
      broken: base.broken,
      armor: base.blocks.filter((block) => block.alive).length,
      mapId: arena.mapId,
    })),
  };
}
