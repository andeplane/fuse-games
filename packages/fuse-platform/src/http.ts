import type { IncomingMessage, ServerResponse } from "node:http";
import {
  AddressBudget,
  RoomError,
  ROOM_LOOKUP_BURST,
  ROOM_LOOKUP_PER_SECOND,
  type HttpExtension,
} from "fuse-network-be";
import { LEGACY_GAME_ID } from "./game.js";
import { publicIdOf, type FriendsStore } from "./friends.js";
import { parseFeedCursor, type HistoryStore } from "./history.js";
import type { IdentityVerifier } from "./identity.js";
import type { ActivityDatabase } from "./activity.js";
import { createActivityHttp } from "./activity-http.js";

const MAX_BODY_BYTES = 256_000,
  BODY_TIMEOUT_MS = 10_000;
/** Shared across games and result kinds: enough for 12 devices reporting a round and match together. */
export const RESULT_LOOKUP_BURST = 60,
  RESULT_LOOKUP_PER_SECOND = 2;
export interface PlatformHttpDependencies {
  now: () => number;
}
const bearer = (req: IncomingMessage): string =>
  req.headers.authorization?.replace(/^Bearer /, "") ?? "";
/** A bounded JSON body: the limit is enforced while reading, so a lying Content-Length cannot buy memory. */
async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  // A body this small arrives at once; a sender trickling it is cut off rather than holding a connection open.
  const slow = setTimeout(
    () => req.destroy(new RoomError(408, "Request too slow")),
    BODY_TIMEOUT_MS,
  );
  try {
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) throw new RoomError(413, "Request too large");
      chunks.push(chunk);
    }
  } finally {
    clearTimeout(slow);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RoomError(400, "Invalid JSON");
  }
}

/** `?before=` pages backwards from a listed `endedAt`; null is a malformed cursor. */
function pageCursor(url: URL): number | undefined | null {
  const before = url.searchParams.get("before");
  if (before === null) return undefined;
  const cursor = Number(before);
  return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : null;
}

/**
 * `/api/games/{gameId}/…` addresses one game; the same routes without the prefix are the legacy game's, as they were
 * before there were games. Returns the game and the route as it reads without the prefix.
 */
const GAME_ROUTE = /^\/api\/games\/([^/]*)(\/.*)$/;
export function gameRoute(pathname: string): { gameId: string; path: string } {
  const scoped = pathname.match(GAME_ROUTE);
  return scoped
    ? { gameId: scoped[1]!, path: `/api${scoped[2]!}` }
    : { gameId: LEGACY_GAME_ID, path: pathname };
}
const ROOM_RESULT_ROUTE =
  /^\/api\/rooms\/([A-Z0-9]{6})\/(results|round-results)$/;

function jsonResponse(res: ServerResponse, noStore = false) {
  return (value: unknown, status = 200): void => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      ...(noStore ? { "Cache-Control": "no-store" } : {}),
    });
    res.end(JSON.stringify(value));
  };
}

interface HistoryRequest {
  req: IncomingMessage;
  url: URL;
  address: string;
  history: ReturnType<HistoryStore["game"]>;
  identity: IdentityVerifier;
  json(value: unknown, status?: number): void;
}

type HistoryHandler = (context: HistoryRequest) => Promise<void>;
type HistoryMethod = "GET" | "POST" | "PUT";

/** A room token authenticates the seat before a report is read or an identity is verified. */
async function reportRoomResult(
  { req, address, history, identity, json }: HistoryRequest,
  room: string,
  roundReport: boolean,
  lookups: AddressBudget,
): Promise<void> {
  if (!lookups.take(address))
    throw new RoomError(429, "Too many results; try later");
  const reporter = await history.admit(room, bearer(req), address, roundReport);
  const body = await readJson(req);
  const header = req.headers["x-fuse-identity"];
  const uid = typeof header === "string" ? await identity(header) : undefined;
  const result =
    body && typeof body === "object" && "result" in body
      ? history.parseResult(body.result)
      : undefined;
  if (!result || roundReport !== (result.round !== undefined))
    throw new RoomError(400, "Wrong result kind");
  // A temporarily unverifiable signed-in round reporter must not be settled as a guest.
  if (header && !uid && result.round !== undefined)
    throw new RoomError(503, "Identity unavailable; retry round report");
  json(await history.submit(reporter, body, uid));
}

function soloResult(roundReport: boolean): HistoryHandler {
  return async ({ req, address, history, identity, json }) => {
    const header = req.headers["x-fuse-identity"];
    if (typeof header !== "string" || !header)
      throw new RoomError(401, "Sign in first");
    const uid = await identity(header);
    if (!uid)
      throw new RoomError(503, "Identity unavailable; retry solo report");
    const reporter = await history.admitSolo(uid, address, roundReport);
    json(
      await history.submitSolo(reporter, await readJson(req), uid, roundReport),
    );
  };
}

async function publicHistoryIdentity({
  req,
  identity,
}: HistoryRequest): Promise<string | undefined> {
  const token = bearer(req);
  return token ? identity(token) : undefined;
}

function signedInHistory(
  handler: (context: HistoryRequest, uid: string) => Promise<void>,
): HistoryHandler {
  return async (request) => {
    const { req, identity, json } = request;
    const uid = await identity(bearer(req));
    if (!uid) {
      json({ error: "Sign in first" }, 401);
      return;
    }
    await handler(request, uid);
  };
}

const HISTORY_PATHS = new Map<
  string,
  Partial<Record<HistoryMethod, HistoryHandler>>
>([
  ["/api/me/results", { POST: soloResult(false) }],
  ["/api/me/round-results", { POST: soloResult(true) }],
  [
    "/api/matches",
    {
      GET: async (request) => {
        const { url, address, history, json } = request;
        const rawCursor = url.searchParams.get("before");
        const cursor =
          rawCursor === null ? undefined : parseFeedCursor(rawCursor);
        if (rawCursor !== null && cursor === undefined) {
          json({ error: "Invalid cursor" }, 400);
          return;
        }
        json(
          await history.feed(
            address,
            await publicHistoryIdentity(request),
            cursor,
          ),
        );
      },
    },
  ],
  [
    "/api/leaderboard",
    {
      GET: async (request) => {
        const { address, history, json } = request;
        json({
          players: await history.leaderboard(
            address,
            await publicHistoryIdentity(request),
          ),
        });
      },
    },
  ],
  [
    "/api/me",
    {
      GET: signedInHistory(async ({ history, json }, uid) => {
        json({ profile: (await history.profile(uid)) ?? null });
      }),
      PUT: signedInHistory(async ({ req, history, json }, uid) => {
        json(await history.rename(uid, await readJson(req)));
      }),
    },
  ],
  [
    "/api/me/matches",
    {
      GET: signedInHistory(async ({ url, history, json }, uid) => {
        const cursor = pageCursor(url);
        if (cursor === null) {
          json({ error: "Invalid cursor" }, 400);
          return;
        }
        json(await history.history(uid, cursor));
      }),
    },
  ],
]);

/** Account routes share a username. The legacy and scoped history paths use the selected game's store. */
export function createHistoryHttp(
  store: HistoryStore,
  identity: IdentityVerifier,
  dependencies: PlatformHttpDependencies = { now: Date.now },
): HttpExtension {
  const resultLookups = new AddressBudget(
    dependencies.now,
    RESULT_LOOKUP_BURST,
    RESULT_LOOKUP_PER_SECOND,
  );
  return {
    methods: ["PUT"],
    headers: ["X-Fuse-Identity"],
    async handle(req, res, address) {
      const url = new URL(req.url ?? "/", "http://gateway");
      const { gameId, path } = gameRoute(url.pathname);
      const route = HISTORY_PATHS.get(path);
      const roomReport = path.match(ROOM_RESULT_ROUTE);
      if (!route && !roomReport) return false;
      // A recognized route with an unknown game is refused before method dispatch.
      const history = store.game(gameId);
      const method = req.method;
      if (method !== "GET" && method !== "POST" && method !== "PUT")
        return false;
      const context: HistoryRequest = {
        req,
        url,
        address,
        history,
        identity,
        json: jsonResponse(res),
      };
      if (roomReport && method === "POST") {
        await reportRoomResult(
          context,
          roomReport[1]!,
          roomReport[2] === "round-results",
          resultLookups,
        );
        return true;
      }
      const handler = route?.[method];
      if (!handler) return false;
      await handler(context);
      return true;
    },
  };
}

interface FriendRequest {
  req: IncomingMessage;
  url: URL;
  store: FriendsStore;
  uid: string;
  id: string;
  json: ReturnType<typeof jsonResponse>;
}

type FriendHandler = (context: FriendRequest) => Promise<void>;
type FriendRoute = Partial<Record<"GET" | "POST" | "DELETE", FriendHandler>>;

function conversation(write: boolean): FriendHandler {
  return async ({ req, store, uid, id, json }) => {
    if (req.headers["x-fuse-account"] !== publicIdOf(uid))
      throw new RoomError(
        403,
        "The signed-in account changed. Reopen this conversation.",
      );
    json(
      await store.conversation(
        uid,
        id,
        write ? await readJson(req) : undefined,
      ),
    );
  };
}

const FRIEND_PATHS = new Map<string, FriendRoute>([
  [
    "/api/friends/sync",
    {
      POST: async ({ req, store, uid, json }) => {
        json(await store.sync(uid, await readJson(req)));
      },
    },
  ],
  [
    "/api/friends/search",
    {
      GET: async ({ url, store, uid, json }) => {
        json({ players: await store.search(uid, url.searchParams.get("q")) });
      },
    },
  ],
  [
    "/api/friends",
    {
      POST: async ({ req, store, uid, json }) => {
        json(await store.add(uid, await readJson(req)));
      },
    },
  ],
]);
const FRIEND_ID_PATHS: ReadonlyArray<readonly [RegExp, FriendRoute]> = [
  [
    /^\/api\/friends\/([a-f0-9]{20})\/messages$/,
    { GET: conversation(false), POST: conversation(true) },
  ],
  [
    /^\/api\/friends\/([a-f0-9]{20})$/,
    {
      DELETE: async ({ store, uid, id, json }) => {
        json(await store.remove(uid, id));
      },
    },
  ],
  [
    /^\/api\/friends\/invites\/([a-f0-9]{32})$/,
    {
      DELETE: async ({ store, uid, id, json }) => {
        await store.dismissInvite(uid, id);
        json({ dismissed: true });
      },
    },
  ],
];
const ROOM_INVITE_PATH = /^\/api\/rooms\/([A-Z0-9]{6})\/invites$/;

function friendPath(
  path: string,
): { route: FriendRoute; id: string } | undefined {
  const fixed = FRIEND_PATHS.get(path);
  if (fixed) return { route: fixed, id: "" };
  for (const [pattern, route] of FRIEND_ID_PATHS) {
    const match = path.match(pattern);
    if (match) return { route, id: match[1]! };
  }
}

async function inviteRoomFriend(
  req: IncomingMessage,
  room: string,
  store: FriendsStore,
  identity: IdentityVerifier,
  json: ReturnType<typeof jsonResponse>,
): Promise<void> {
  const header = req.headers["x-fuse-identity"];
  const uid =
    typeof header === "string" && header ? await identity(header) : undefined;
  if (!uid) throw new RoomError(401, "Sign in first");
  const expectedAccount = req.headers["x-fuse-account"];
  if (expectedAccount !== undefined && expectedAccount !== publicIdOf(uid))
    throw new RoomError(
      403,
      "The signed-in account changed. Reopen Messenger and try again.",
    );
  json(await store.invite(room, bearer(req), uid, await readJson(req)));
}

/** Friends and presence are account routes. Room invites use a seat token and a separate identity header. */
export function createFriendsHttp(
  store: FriendsStore,
  identity: IdentityVerifier,
  dependencies: PlatformHttpDependencies = { now: Date.now },
): HttpExtension {
  const inviteLookups = new AddressBudget(
    dependencies.now,
    ROOM_LOOKUP_BURST,
    ROOM_LOOKUP_PER_SECOND,
  );
  const nameLookups = new AddressBudget(
    dependencies.now,
    ROOM_LOOKUP_BURST,
    ROOM_LOOKUP_PER_SECOND,
  );
  return {
    methods: ["DELETE"],
    headers: ["X-Fuse-Identity", "X-Fuse-Account"],
    async handle(req, res, address) {
      const url = new URL(req.url ?? "/", "http://gateway");
      const invite = url.pathname.match(ROOM_INVITE_PATH);
      const found = friendPath(url.pathname);
      if (!invite && !found) return false;
      const json = jsonResponse(res, true);
      const method = req.method;
      if (invite) {
        if (method !== "POST") return false;
        // Limit room lookups before verification and body reads.
        if (!inviteLookups.take(address))
          throw new RoomError(429, "Too many invites; try later");
        await inviteRoomFriend(req, invite[1]!, store, identity, json);
        return true;
      }
      if (url.pathname === "/api/friends/search") {
        if (method !== "GET") return false;
        // Protect identity verification and the database independently of room invites.
        if (!nameLookups.take(address))
          throw new RoomError(429, "Too many searches; try later");
      }
      const uid = await identity(bearer(req));
      if (!uid) {
        json({ error: "Sign in first" }, 401);
        return true;
      }
      if (
        !found ||
        (method !== "GET" && method !== "POST" && method !== "DELETE")
      )
        return false;
      const handler = found.route[method];
      if (!handler) return false;
      await handler({ req, url, store, uid, id: found.id, json });
      return true;
    },
  };
}

/** One extension out of several: the first that handles a request answers it; methods and headers are the union. */
export function composeHttp(
  ...extensions: readonly HttpExtension[]
): HttpExtension {
  return {
    methods: [...new Set(extensions.flatMap((e) => e.methods ?? []))],
    headers: [...new Set(extensions.flatMap((e) => e.headers ?? []))],
    async handle(req, res, clientAddress) {
      for (const extension of extensions)
        if (await extension.handle(req, res, clientAddress)) return true;
      return false;
    },
  };
}

/** Every platform route: history and accounts, then friends. */
export function createPlatformHttp(options: {
  history: HistoryStore;
  friends: FriendsStore;
  identity: IdentityVerifier;
  activity?: ActivityDatabase;
  now?: () => number;
}): HttpExtension {
  const dependencies = { now: options.now ?? Date.now };
  return composeHttp(
    ...(options.activity
      ? [
          createActivityHttp({
            database: options.activity,
            platform: options.history.platform,
            identity: options.identity,
            allowRead: (address) => options.history.allowActivity(address),
            now: dependencies.now,
          }),
        ]
      : []),
    createHistoryHttp(options.history, options.identity, dependencies),
    createFriendsHttp(options.friends, options.identity, dependencies),
  );
}
