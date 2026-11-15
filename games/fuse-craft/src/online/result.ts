import type { MatchResult, PlayerResult } from "fuse-platform";
import { historyPlayerName } from "fuse-platform/history-api";
import type { SeatRecord } from "fuse-netcode";
import type { World } from "../engine/index.js";

export const isCraftBot = (id: string) =>
  /^(?:bot-[1-9][0-9]*|ai-opponent|lab-opponent)$/.test(id);
export interface CraftDecision {
  tick: number;
  finishers: string[];
  names: Record<string, string>;
}
export function craftDecision(
  world: World,
  seats: ReadonlyMap<string, SeatRecord>,
  tick: number,
): CraftDecision {
  return {
    tick,
    finishers: world.players
      .filter(
        (player) =>
          !isCraftBot(player.id) &&
          seats.get(player.id)?.connected &&
          !seats.get(player.id)?.watcher,
      )
      .map((player) => player.id)
      .sort(),
    names: Object.fromEntries(
      world.players.map((player) => [
        player.id,
        seats.get(player.id)?.name ??
          (isCraftBot(player.id)
            ? `Bot ${player.slot + 1}`
            : `Network ${player.slot + 1}`),
      ]),
    ),
  };
}
export function parseCraftDecision(
  raw: unknown,
  world: World,
  tick: number,
): CraftDecision | null | undefined {
  if (raw === null) return world.finished ? undefined : null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !world.finished)
    return;
  const data = raw as Record<string, unknown>,
    names = data.names,
    finishers = data.finishers;
  if (
    Object.keys(data).sort().join() !== "finishers,names,tick" ||
    !Number.isSafeInteger(data.tick) ||
    Number(data.tick) < 1 ||
    Number(data.tick) > tick ||
    !names ||
    typeof names !== "object" ||
    Array.isArray(names) ||
    !Array.isArray(finishers) ||
    finishers.length > world.players.length
  )
    return;
  const entries = Object.entries(names);
  if (
    entries.length !== world.players.length ||
    !entries.every(
      ([id, name]) =>
        world.players.some((player) => player.id === id) &&
        typeof name === "string" &&
        name.length > 0 &&
        name.length <= 64 &&
        !/[\u0000-\u001f\u007f]/.test(name),
    )
  )
    return;
  if (
    !finishers.every(
      (id: unknown, index: number) =>
        typeof id === "string" &&
        !isCraftBot(id) &&
        world.players.some((player) => player.id === id) &&
        (index === 0 || finishers[index - 1] < id),
    )
  )
    return;
  return {
    tick: Number(data.tick),
    names: Object.fromEntries(entries) as Record<string, string>,
    finishers: [...finishers],
  };
}
/** One completed simulation is one round and one match; no report is made for an unfinished sandbox. */
export function craftResults(
  world: Readonly<World>,
  decided: CraftDecision | null,
): { tick: number; result: MatchResult<PlayerResult> }[] {
  if (!world.finished || !decided) return [];
  const lasted = (id: string, alive: boolean) =>
    id === world.winnerId
      ? Number.MAX_SAFE_INTEGER
      : alive
        ? world.tick + 1
        : (world.events.find(
            (event) => event.type === "eliminated" && event.playerId === id,
          )?.tick ?? world.tick);
  const ranks = world.players.map((player) => ({
    player,
    survival: lasted(player.id, player.alive),
  }));
  const result: MatchResult = {
    matchId: world.matchId,
    length: 1,
    ...(world.winnerId === null ? {} : { winnerId: world.winnerId }),
    finishers: [...decided.finishers],
    players: ranks.map(({ player, survival }) => ({
      playerId: player.id,
      name: historyPlayerName(decided.names[player.id]!),
      slot: player.slot,
      roundsPlayed: 1,
      roundWins: player.id === world.winnerId ? 1 : 0,
      matchScoreUnits: player.statistics.built,
      matchPlacement:
        1 + ranks.filter((other) => other.survival > survival).length,
      earlyExits:
        isCraftBot(player.id) || decided.finishers.includes(player.id) ? 0 : 1,
    })),
  };
  result.players.sort(
    (a, b) => a.slot - b.slot || a.playerId.localeCompare(b.playerId),
  );
  return [
    { tick: decided.tick, result: { ...result, round: 1 } },
    { tick: decided.tick, result },
  ];
}
