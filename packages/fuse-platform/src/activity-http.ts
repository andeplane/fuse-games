import {
  AddressBudget,
  RoomError,
  rateLimitAddress,
  type HttpExtension,
} from "fuse-network-be";
import type { Platform } from "./game.js";
import type { IdentityVerifier } from "./identity.js";
import { publicIdOf } from "./friends.js";
import { validPublicId } from "./friends-api.js";
import type { ActivityDatabase } from "./activity.js";
import {
  ACTIVITY_PAGE,
  ACTIVITY_GROUP_LIMIT,
  type ActivityQuery,
} from "./activity-api.js";

export function createActivityHttp(options: {
  database: ActivityDatabase;
  platform: Platform;
  identity: IdentityVerifier;
  allowRead(address: string): Promise<boolean>;
  now?: () => number;
}): HttpExtension {
  const budget = new AddressBudget(options.now ?? Date.now, 60, 2, 5000);
  let pending = 0;
  return {
    async handle(req, res, address) {
      const url = new URL(req.url ?? "/", "http://activity");
      if (
        url.pathname !== "/api/activity" &&
        !url.pathname.startsWith("/api/activity/")
      )
        return false;
      if (req.method !== "GET")
        throw new RoomError(405, "Use GET for gameplay activity");
      if (pending >= 64 || !budget.take(rateLimitAddress(address)))
        throw new RoomError(429, "Activity busy; retry later");
      pending++;
      try {
        if (!(await options.allowRead(address)))
          throw new RoomError(429, "Too many activity requests; try later");
        let value: unknown;
        if (url.pathname === "/api/activity") {
          const allowed = new Set([
            "gameId",
            "player",
            "scope",
            "mode",
            "kind",
            "before",
          ]);
          for (const key of url.searchParams.keys())
            if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1)
              throw new RoomError(400, "Invalid activity filter");
          const query: ActivityQuery = {};
          const game = url.searchParams.get("gameId"),
            player = url.searchParams.get("player"),
            mode = url.searchParams.get("mode"),
            kind = url.searchParams.get("kind"),
            scope = url.searchParams.get("scope"),
            before = url.searchParams.get("before");
          if (game !== null) {
            options.platform.game(game);
            query.gameId = game;
          }
          if (player !== null) {
            if (!validPublicId(player))
              throw new RoomError(400, "Invalid player id");
            query.player = player;
          }
          if (mode !== null) {
            if (mode !== "solo" && mode !== "multiplayer" && mode !== "unknown")
              throw new RoomError(400, "Invalid play mode");
            query.mode = mode;
          }
          if (kind !== null) {
            if (kind !== "match" && kind !== "round")
              throw new RoomError(400, "Invalid activity kind");
            query.kind = kind;
          }
          if (scope !== null && scope !== "everyone" && scope !== "mine")
            throw new RoomError(400, "Invalid activity scope");
          if (scope === "mine") {
            if (player !== null)
              throw new RoomError(400, "Choose yours or a player");
            const token =
              req.headers.authorization?.replace(/^Bearer /, "") ?? "";
            const uid = token ? await options.identity(token) : undefined;
            if (!uid) throw new RoomError(401, "Sign in to see your activity");
            query.player = publicIdOf(uid);
          }
          if (before !== null) {
            const cursor = /^(\d{1,16}):([a-f0-9]{40})$/.exec(before);
            if (!cursor || !Number.isSafeInteger(Number(cursor[1])))
              throw new RoomError(400, "Invalid activity cursor");
            query.before = { at: Number(cursor[1]), id: cursor[2]! };
          }
          value = {
            ...(await options.database.listActivity(query, ACTIVITY_PAGE)),
            games: options.platform.gameIds,
          };
        } else {
          const detail = /^\/api\/activity\/(?:groups\/)?([a-f0-9]{40})$/.exec(
            url.pathname,
          );
          if (!detail) throw new RoomError(404, "Activity not found");
          if (url.pathname.startsWith("/api/activity/groups/")) {
            const events = await options.database.groupActivity(
              detail[1]!,
              ACTIVITY_GROUP_LIMIT + 1,
            );
            value = {
              events: events.slice(0, ACTIVITY_GROUP_LIMIT),
              truncated: events.length > ACTIVITY_GROUP_LIMIT,
            };
          } else {
            const event = await options.database.readActivity(detail[1]!);
            if (!event) throw new RoomError(404, "Activity not found");
            value = { event };
          }
        }
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify(value));
      } finally {
        pending--;
      }
      return true;
    },
  };
}
