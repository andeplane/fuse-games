import { createHash } from "node:crypto";
import type { AnyGame } from "./game.js";
import { publicIdOf } from "./friends.js";
import { validPublicId } from "./friends-api.js";
import { plain, type MatchRecord } from "./result.js";
import {
  type ActivityQuery,
  type ActivityPage,
  type GameActivity,
  type ActivityPlayer,
} from "./activity-api.js";

export interface StoredActivity extends GameActivity {
  scopes: string[];
  expiresAt?: number;
}
export interface ActivityDatabase {
  listActivity(query: ActivityQuery, limit: number): Promise<ActivityPage>;
  readActivity(id: string): Promise<GameActivity | undefined>;
  groupActivity(id: string, limit: number): Promise<GameActivity[]>;
}
export const activityId = (value: string) =>
  createHash("sha256").update(value).digest("hex").slice(0, 40);
export const activityScope = (query: ActivityQuery) =>
  activityId(
    JSON.stringify([
      query.gameId ?? "*",
      query.player ?? "*",
      query.mode ?? "*",
      query.kind ?? "*",
    ]),
  );
export function storeActivity(
  event: GameActivity,
  expiresAt?: number,
): StoredActivity {
  const players = [
    undefined,
    ...new Set(
      event.players.flatMap((player) =>
        player.publicId ? [player.publicId] : [],
      ),
    ),
  ];
  const scopes: string[] = [];
  for (const gameId of [undefined, event.gameId])
    for (const player of players)
      for (const mode of [undefined, event.mode])
        for (const kind of [undefined, event.kind])
          scopes.push(activityScope({ gameId, player, mode, kind }));
  return {
    ...event,
    scopes,
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
}
const integer = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const opaque = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= max &&
  !/[\u0000-\u001f\u007f]/.test(value);
/** Strict read boundary also strips storage-only scope/index fields. */
export function parseActivity(
  raw: unknown,
  now = Date.now(),
): GameActivity | undefined {
  if (
    !plain(raw) ||
    raw.version !== 1 ||
    !opaque(raw.id) ||
    !opaque(raw.groupId) ||
    !text(raw.gameId, 80) ||
    !["match", "round"].includes(String(raw.kind)) ||
    !["solo", "multiplayer", "unknown"].includes(String(raw.mode)) ||
    !["peer-agreed", "account-reported", "server-replayed"].includes(
      String(raw.proof),
    ) ||
    !integer(raw.endedAt) ||
    !integer(raw.rounds) ||
    raw.rounds < 1 ||
    raw.rounds > 1_000_000 ||
    (raw.round !== undefined && (!integer(raw.round) || raw.round < 1)) ||
    (raw.kind === "round") !== (raw.round !== undefined) ||
    !text(raw.title, 512) ||
    !Array.isArray(raw.players) ||
    !raw.players.length ||
    raw.players.length > 128 ||
    !plain(raw.context) ||
    Object.keys(raw.context).length > 24 ||
    (raw.expiresAt !== undefined &&
      (!integer(raw.expiresAt) || raw.expiresAt <= now))
  )
    return;
  const players: ActivityPlayer[] = [];
  for (const player of raw.players) {
    if (
      !plain(player) ||
      !opaque(player.id) ||
      (player.publicId !== undefined && !validPublicId(player.publicId)) ||
      !text(player.name, 100) ||
      typeof player.bot !== "boolean" ||
      !integer(player.place) ||
      player.place < 1 ||
      player.place > 128 ||
      typeof player.score !== "number" ||
      !Number.isFinite(player.score) ||
      !integer(player.wins) ||
      !plain(player.stats) ||
      Object.keys(player.stats).length > 64 ||
      !Object.entries(player.stats).every(
        ([key, value]) =>
          /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(key) &&
          typeof value === "number" &&
          Number.isFinite(value),
      )
    )
      return;
    if (player.label !== undefined && !text(player.label, 160)) return;
    players.push({
      id: player.id,
      ...(player.publicId === undefined ? {} : { publicId: player.publicId }),
      name: player.name,
      ...(player.label === undefined ? {} : { label: player.label }),
      bot: player.bot,
      place: player.place,
      score: player.score,
      wins: player.wins,
      stats: { ...player.stats } as Record<string, number>,
    });
  }
  if (
    new Set(players.map((player) => player.id)).size !== players.length ||
    (raw.winner !== undefined &&
      !players.some((player) => player.id === raw.winner))
  )
    return;
  if (
    !Object.entries(raw.context).every(
      ([key, value]) =>
        /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(key) &&
        (typeof value === "boolean" ||
          (typeof value === "number" && Number.isFinite(value)) ||
          (typeof value === "string" &&
            value.length <= 512 &&
            !/[\u0000-\u001f\u007f]/.test(value))),
    )
  )
    return;
  return {
    version: 1,
    id: raw.id,
    gameId: raw.gameId,
    groupId: raw.groupId,
    kind: raw.kind as GameActivity["kind"],
    mode: raw.mode as GameActivity["mode"],
    proof: raw.proof as GameActivity["proof"],
    endedAt: raw.endedAt,
    ...(raw.round === undefined ? {} : { round: raw.round as number }),
    rounds: raw.rounds,
    title: raw.title,
    ...(raw.winner === undefined ? {} : { winner: raw.winner as string }),
    players,
    context: { ...raw.context } as GameActivity["context"],
  };
}
export function activityOf(
  game: AnyGame,
  match: MatchRecord,
): StoredActivity | undefined {
  if (
    match.status !== "confirmed" ||
    match.endedAt === undefined ||
    (!Object.keys(match.uidByPlayer).length && match.attesters.length < 2)
  )
    return;
  const result = match.result,
    id = activityId(`history:${game.id}:${match.id}`);
  const groupId =
    match.groupScope ?? activityId(`legacy:${game.id}:${match.id}`);
  const seats = new Map(
    result.players.map((player) => [
      player.playerId,
      activityId(`${groupId}:${player.playerId}`),
    ]),
  );
  const presentation = game.activity?.(result);
  const players: ActivityPlayer[] = result.players.map((player) => {
    const extra = game.activityPlayer?.(player);
    return {
      id: seats.get(player.playerId)!,
      ...(match.uidByPlayer[player.playerId]
        ? { publicId: publicIdOf(match.uidByPlayer[player.playerId]!) }
        : {}),
      name: player.name,
      bot: game.isBot(player.playerId),
      place: player.matchPlacement,
      score: extra?.score ?? player.matchScoreUnits,
      wins: player.roundWins,
      ...(extra?.label ? { label: extra.label } : {}),
      stats:
        extra?.stats ??
        Object.fromEntries(
          Object.entries(player)
            .filter(
              ([key, value]) =>
                ![
                  "slot",
                  "matchPlacement",
                  "matchScoreUnits",
                  "roundWins",
                ].includes(key) &&
                /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(key) &&
                typeof value === "number" &&
                Number.isFinite(value),
            )
            .slice(0, 64),
        ),
    };
  });
  const event: GameActivity = {
    version: 1,
    id,
    gameId: game.id,
    groupId,
    kind: result.round === undefined ? "match" : "round",
    mode: match.playMode ?? "unknown",
    proof:
      match.playMode === "solo" || match.attesters.length < 2
        ? "account-reported"
        : "peer-agreed",
    endedAt: match.endedAt,
    ...(result.round === undefined ? {} : { round: result.round }),
    rounds: result.length,
    title:
      presentation?.title ??
      (result.round === undefined ? "Match complete" : `Round ${result.round}`),
    ...(result.winnerId === undefined
      ? {}
      : { winner: seats.get(result.winnerId)! }),
    players,
    context: presentation?.context ?? {},
  };
  if (!parseActivity(event, 0)) throw new Error("Invalid activity projection");
  return storeActivity(event, match.expiresAt);
}
export const activityOrder = (a: GameActivity, b: GameActivity) =>
  b.endedAt - a.endedAt || b.id.localeCompare(a.id);
export const activityBefore = (event: GameActivity, query: ActivityQuery) =>
  !query.before ||
  event.endedAt < query.before.at ||
  (event.endedAt === query.before.at && event.id < query.before.id);
/** Query adapter for a single-process event document source, with the same cursor/filter semantics as Firestore. */
export class MemoryActivityDatabase implements ActivityDatabase {
  constructor(
    private read: () => Promise<readonly unknown[]>,
    private now: () => number = Date.now,
  ) {}
  private async events() {
    return (await this.read()).flatMap((raw) => {
      const event = parseActivity(raw, this.now());
      return event ? [event] : [];
    });
  }
  async listActivity(query: ActivityQuery, limit: number) {
    const all = (await this.events())
      .filter(
        (event) =>
          (!query.gameId || event.gameId === query.gameId) &&
          (!query.player ||
            event.players.some((player) => player.publicId === query.player)) &&
          (!query.mode || event.mode === query.mode) &&
          (!query.kind || event.kind === query.kind) &&
          activityBefore(event, query),
      )
      .sort(activityOrder);
    const events = all.slice(0, limit),
      last = events.at(-1);
    return {
      events,
      ...(all.length > limit && last
        ? { next: { at: last.endedAt, id: last.id } }
        : {}),
    };
  }
  async readActivity(id: string) {
    return (await this.events()).find((event) => event.id === id);
  }
  async groupActivity(id: string, limit: number) {
    return (await this.events())
      .filter((event) => event.groupId === id)
      .sort(activityOrder)
      .slice(0, limit);
  }
}
