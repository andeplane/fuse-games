import { parseHistoryPlayer } from "fuse-platform/history-api";
import type { PlayerResult } from "fuse-platform";
import {
  CAPACITY,
  finishUnits,
  validVariant,
  type RaceVariant,
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
  variant: RaceVariant;
  distance: number;
  raceTicks: number;
}
export function parseFuserodStats(
  raw: unknown,
  length: number,
): FuserodStats | undefined {
  if (!object(raw) || length !== 1) return;
  const { route, variant, distance, raceTicks, ...base } = raw;
  const player = parseHistoryPlayer(base, length);
  if (
    !player ||
    !validName(player.name) ||
    player.slot >= CAPACITY ||
    player.roundsPlayed !== 1 ||
    !isRoute(route) ||
    !validVariant(route, variant) ||
    !integer(distance, 0, Math.ceil(metres(finishUnits(route, variant)))) ||
    distance !== player.matchScoreUnits ||
    !integer(raceTicks, 0, MAX_RACE_TICKS)
  )
    return;
  return { ...player, route, variant, distance, raceTicks };
}
