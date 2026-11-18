import { parseHistoryPlayer } from "fuse-platform/history-api";
import type { PlayerResult } from "fuse-platform";
import {
  CAPACITY,
  FINISH,
  MAX_RACE_TICKS,
  integer,
  isRoute,
  metres,
  object,
  validName,
  type Route,
} from "./basics.js";

export interface FuserodStats extends PlayerResult {
  route: Route;
  distance: number;
  raceTicks: number;
}
export function parseFuserodStats(
  raw: unknown,
  length: number,
): FuserodStats | undefined {
  if (!object(raw) || length !== 1) return;
  const { route, distance, raceTicks, ...base } = raw;
  const player = parseHistoryPlayer(base, length);
  if (
    !player ||
    !validName(player.name) ||
    player.slot >= CAPACITY ||
    player.roundsPlayed !== 1 ||
    !isRoute(route) ||
    !integer(distance, 0, Math.ceil(metres(FINISH[route]))) ||
    distance !== player.matchScoreUnits ||
    !integer(raceTicks, 1, MAX_RACE_TICKS)
  )
    return;
  return { ...player, route, distance, raceTicks };
}
