import test from "node:test";
import assert from "node:assert/strict";
import { MemoryRoomDatabase, RoomStore, peerId } from "fuse-network-be";
import {
  FriendsStore,
  MemoryFriendsDatabase,
  MemoryHistoryDatabase,
  Platform,
  LEGACY_GAME_ID,
  publicIdOf,
  type AccountRules,
  type GameRegistration,
  type PlayerResult,
} from "../src/index.js";

const rules: AccountRules = {
  validName: (value): value is string => typeof value === "string",
  validAvatar: (value): value is string => typeof value === "string",
  nameRule: "Name",
  fallbackName: "Player",
};
const game: GameRegistration = {
  id: LEGACY_GAME_ID,
  isBot: (id) => id.startsWith("bot:"),
  parseStats: (raw) => raw as PlayerResult,
  emptyTotals: () => ({}),
  credit: () => ({}),
  addTotals: () => {},
  parseTotals: () => ({}),
};
const token = (n: number) => n.toString(16).padStart(64, "0");

test("F-07: possession, live membership and unambiguous room players", async () => {
  const now = 1800000000000;
  const platform = new Platform(rules, [game]);
  const rooms = new RoomStore(new MemoryRoomDatabase(), {
    now: () => now,
    id: () => "incarnation",
    gameIds: platform.gameIds,
  });
  const database = new MemoryFriendsDatabase();
  const friends = new FriendsStore(
    platform,
    new MemoryHistoryDatabase(platform, () => now),
    database,
    rooms,
    () => now,
  );
  const code = await rooms.createAvailable(token(1));
  await rooms.admit(code, token(1), "gateway");
  await rooms.admit(code, token(2), "gateway");
  const claim = (n: number) => ({
    code,
    memberId: peerId(token(n)),
    token: token(n),
  });
  await friends.sync("alice", { room: claim(1) });
  await assert.rejects(
    friends.sync("mallory", { room: { ...claim(1), token: token(3) } }),
    /Join the room first/,
  );
  await assert.rejects(
    friends.sync("mallory", { room: { code, memberId: peerId(token(1)) } }),
    /Invalid presence/,
  );
  assert.equal(await database.presence("mallory"), undefined);
  await friends.sync("bob", { room: claim(2) });
  // Even if a token is shared, an ambiguous seat never identifies either account in the roster.
  const duplicate = await friends.sync("mallory", { room: claim(1) });
  assert.deepEqual(
    duplicate.roomPlayers.map((p) => p.publicId),
    [publicIdOf("bob")],
  );
  const view = await friends.sync("bob", { room: claim(2) });
  assert.equal(
    new Set(view.roomPlayers.map((p) => p.memberId)).size,
    view.roomPlayers.length,
  );
  assert.equal(
    new Set(view.roomPlayers.map((p) => p.publicId)).size,
    view.roomPlayers.length,
  );
  // A pre-fix record cannot be carried by a passive poll or appear as a room member.
  await database.setPresence({
    uid: "legacy",
    publicId: publicIdOf("legacy"),
    at: now,
    room: {
      code,
      memberId: peerId(token(2)),
      gameId: LEGACY_GAME_ID,
      incarnation: "incarnation",
    },
  });
  const passive = await friends.sync("legacy", { passive: true });
  assert.deepEqual(passive.roomPlayers, []);
  assert.equal((await database.presence("legacy"))?.room, undefined);
  assert.deepEqual(
    (await friends.sync("bob", { room: claim(2) })).roomPlayers.map(
      (p) => p.publicId,
    ),
    [publicIdOf("bob")],
  );
  const stored = await database.presence("bob");
  assert.ok(!JSON.stringify(stored).includes(token(2)));
});
