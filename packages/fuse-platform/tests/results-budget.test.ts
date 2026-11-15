import assert from "node:assert/strict";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import test from "node:test";
import {
  MemoryRoomDatabase,
  ROOM_LOOKUP_BURST,
  ROOM_LOOKUP_PER_SECOND,
  RoomError,
  RoomStore,
  generateRoomCode,
  peerId,
  type HttpExtension,
} from "fuse-network-be";
import {
  FriendsStore,
  HistoryStore,
  LEGACY_GAME_ID,
  MemoryFriendsDatabase,
  MemoryHistoryDatabase,
  MAX_RATED_PLAYERS,
  Platform,
  RESULT_LOOKUP_BURST,
  RESULT_LOOKUP_PER_SECOND,
  createPlatformHttp,
  type GameRegistration,
  type PlayerResult,
} from "../src/index.js";

class CountingRoomDatabase extends MemoryRoomDatabase {
  reads = 0;
  allowanceCalls = 0;
  override read(code: string) {
    this.reads++;
    return super.read(code);
  }
  override allowance(...args: Parameters<MemoryRoomDatabase["allowance"]>) {
    this.allowanceCalls++;
    return super.allowance(...args);
  }
}
const token = (n: number) => n.toString(16).padStart(64, "0");
const game: GameRegistration = {
  id: LEGACY_GAME_ID,
  isBot: () => false,
  parseStats: (raw) => raw as PlayerResult,
  emptyTotals: () => ({}),
  credit: () => ({}),
  addTotals: () => {},
  parseTotals: () => ({}),
};
function fixture() {
  let time = 1_800_000_000_000,
    ids = 0,
    identityCalls = 0;
  const now = () => time;
  const platform = new Platform(
    {
      validName: (name): name is string => typeof name === "string",
      validAvatar: (avatar): avatar is string => typeof avatar === "string",
      nameRule: "Any name",
      fallbackName: "Player",
    },
    [game, { ...game, id: "other" }],
  );
  const database = new CountingRoomDatabase();
  const rooms = new RoomStore(database, {
    now,
    id: () => `id-${ids++}`,
    maxGuests: 11,
    gameIds: platform.gameIds,
  });
  const history = new MemoryHistoryDatabase(platform, now);
  const http = createPlatformHttp({
    history: new HistoryStore(platform, history, rooms, now),
    friends: new FriendsStore(
      platform,
      history,
      new MemoryFriendsDatabase(),
      rooms,
      now,
    ),
    identity: async () => {
      identityCalls++;
      return "account";
    },
    now,
  });
  return {
    database,
    rooms,
    http,
    identityCalls: () => identityCalls,
    tick: (ms: number) => {
      time += ms;
    },
  };
}

/** Real Node HTTP surfaces without a listening server or a fabricated request/response type. */
async function report(
  http: HttpExtension,
  path: string,
  address = "address",
  bearer = token(1),
  body: unknown = { to: [] },
) {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.method = "POST";
  req.url = path;
  req.headers = {
    authorization: `Bearer ${bearer}`,
    "x-fuse-identity": "identity",
  };
  req.push(Buffer.from(JSON.stringify(body)));
  req.push(null);
  const res = new ServerResponse(req);
  try {
    assert.equal(await http.handle(req, res, address), true);
    return res.statusCode;
  } catch (error) {
    if (!(error instanceof RoomError)) throw error;
    return error.status;
  } finally {
    req.destroy();
    res.destroy();
    socket.destroy();
  }
}

test("F-03: exhausted result budgets prevent room reads across games and report kinds", async () => {
  const f = fixture(),
    code = generateRoomCode(),
    match = `/api/rooms/${code}/results`,
    round = `/api/games/other/rooms/${code}/round-results`;
  for (let i = 0; i < RESULT_LOOKUP_BURST; i++)
    assert.equal(await report(f.http, i % 2 ? match : round), 404);
  assert.equal(f.database.reads, RESULT_LOOKUP_BURST);
  assert.equal(f.database.allowanceCalls, 0);
  assert.equal(f.identityCalls(), 0);
  for (const path of [match, round])
    for (let i = 0; i < 12; i++) assert.equal(await report(f.http, path), 429);
  assert.equal(f.database.reads, RESULT_LOOKUP_BURST);
  assert.equal(await report(f.http, match, "other-address"), 404);
  f.tick(1000 / RESULT_LOOKUP_PER_SECOND);
  assert.equal(await report(f.http, match), 404);
  assert.equal(await report(f.http, round), 429);
});

test("F-03: exhausted invite budgets prevent room reads and identity verification", async () => {
  const f = fixture(),
    path = `/api/rooms/${generateRoomCode()}/invites`;
  for (let i = 0; i < ROOM_LOOKUP_BURST; i++)
    assert.equal(await report(f.http, path), 404);
  const reads = f.database.reads;
  for (let i = 0; i < 12; i++) assert.equal(await report(f.http, path), 429);
  assert.equal(f.database.reads, reads);
  assert.equal(f.identityCalls(), ROOM_LOOKUP_BURST);
  assert.equal(await report(f.http, path, "other-address"), 404);
  f.tick(1000 / ROOM_LOOKUP_PER_SECOND);
  assert.equal(await report(f.http, path), 404);
  assert.equal(await report(f.http, path), 429);
});

test("F-03: twelve devices can report a round and whole match together behind one address", async () => {
  const f = fixture(),
    tokens = Array.from({ length: 12 }, (_, i) => token(i + 1)),
    code = await f.rooms.createAvailable(tokens[0]!);
  for (const t of tokens) await f.rooms.admit(code, t, "gateway");
  const players: PlayerResult[] = tokens.map((t, slot) => ({
    playerId: peerId(t),
    name: "Player",
    slot,
    roundsPlayed: 1,
    roundWins: slot === 0 ? 1 : 0,
    matchScoreUnits: 12 - slot,
    matchPlacement: slot + 1,
    earlyExits: 0,
  }));
  for (const kind of ["results", "round-results"]) {
    for (const [index, t] of tokens.entries()) {
      // Round receipts have a six-player cap; the room may retain additional devices and past players.
      const start = Math.floor(index / MAX_RATED_PLAYERS) * MAX_RATED_PLAYERS;
      const field =
        kind === "results"
          ? players
          : players
              .slice(start, start + MAX_RATED_PLAYERS)
              .map((p, slot) => ({ ...p, slot, matchPlacement: slot + 1 }));
      const result = {
        matchId: "honest-match",
        length: 1,
        ...(kind === "round-results" ? { round: start + 1 } : {}),
        winnerId: field[0]!.playerId,
        finishers: field.slice(0, MAX_RATED_PLAYERS).map((p) => p.playerId),
        players: field,
      };
      assert.equal(
        await report(f.http, `/api/rooms/${code}/${kind}`, "address", t, {
          result,
        }),
        200,
      );
    }
  }
  assert.equal(f.identityCalls(), 24);
  assert.ok(f.database.allowanceCalls >= 48, "database budgets still apply");
});
