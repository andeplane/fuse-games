import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { RoomError, MemoryRoomDatabase, RoomStore, peerId } from "fuse-network-be";
import { HistoryStore, MemoryHistoryDatabase, Platform, publicIdOf, type AccountRules, type GameRegistration, type MatchRecord, type PlayerResult } from "../src/index.js";
import { plain } from "../src/result.js";
import { activityId, activityOf, activityScope, parseActivity, storeActivity, MemoryActivityDatabase } from "../src/activity.js";
import { createActivityHttp } from "../src/activity-http.js";
import type { GameActivity, ActivityPage } from "../src/activity-api.js";

const account: AccountRules = { validName: (raw): raw is string => typeof raw === "string" && raw.length > 0 && raw.length <= 100, validAvatar: (raw): raw is string => raw === "robot", nameRule: "Choose a name", fallbackName: "Player" };
function parsePlayer(raw: unknown): PlayerResult | undefined {
  if (!plain(raw) || typeof raw.playerId !== "string" || typeof raw.name !== "string" || typeof raw.slot !== "number" || typeof raw.roundsPlayed !== "number" || typeof raw.roundWins !== "number" || typeof raw.matchScoreUnits !== "number" || typeof raw.matchPlacement !== "number" || typeof raw.earlyExits !== "number") return;
  return { playerId: raw.playerId, name: raw.name, slot: raw.slot, roundsPlayed: raw.roundsPlayed, roundWins: raw.roundWins, matchScoreUnits: raw.matchScoreUnits, matchPlacement: raw.matchPlacement, earlyExits: raw.earlyExits };
}
const game: GameRegistration = { id: "example", isBot: id => id.startsWith("bot:"), parseStats: parsePlayer, emptyTotals: () => ({}), credit: () => ({}), addTotals() {}, parseTotals: () => ({}) };
const platform = new Platform(account, [game, { ...game, id: "other" }]);
const player = "a".repeat(24), opponent = "b".repeat(24), uid = "account-ander";
function record(index: number, round?: number, extra: Partial<MatchRecord> = {}): MatchRecord {
  const length = round === undefined ? 3 : 1;
  return { gameId: game.id, version: 1, id: index.toString(16).padStart(40, "0"), roomCode: "AB12", groupScope: activityId("room-incarnation:match-1"), playMode: "multiplayer", status: "confirmed", result: { matchId: "private-match-id", ...(round === undefined ? {} : { round }), length, winnerId: player, finishers: [player, opponent], players: [
    { playerId: player, name: "Ander", slot: 0, roundsPlayed: length, roundWins: length, matchScoreUnits: 30, matchPlacement: 1, earlyExits: 0 },
    { playerId: opponent, name: "Richy", slot: 1, roundsPlayed: length, roundWins: 0, matchScoreUnits: 12, matchPlacement: 2, earlyExits: 0 },
  ] }, attesters: [player, opponent], uidByPlayer: { [player]: uid }, avatars: {}, participantUids: round === undefined ? [uid] : [], createdAt: 500, endedAt: 1000, ...(round === undefined ? { feedAt: 1000 } : {}), ...extra };
}

test("one match and three rounds are four linked events without changing legacy career feeds", async () => {
  const db = new MemoryHistoryDatabase(platform, () => 1000);
  for (const value of [record(1,1), record(2,2), record(3,3), record(4)]) await db.transactMatch(game.id, value.id, () => ({ match: value, result: undefined }));
  const all = await db.activity.listActivity({}, 20);
  assert.equal(all.events.length, 4);
  assert.equal(new Set(all.events.map(event => event.groupId)).size, 1);
  // Guest seats stay recognizable across rounds even without account links.
  assert.equal(new Set(all.events.map(event => event.players[1]!.id)).size, 1);
  assert.notEqual(all.events[0]!.players[0]!.id, all.events[0]!.players[1]!.id);
  assert.notEqual(all.events[0]!.players[1]!.id, activityOf(game, record(5, 1, { groupScope: activityId("another-match") }))!.players[1]!.id);
  assert.equal((await db.activity.listActivity({ kind: "round" }, 20)).events.length, 3);
  assert.equal((await db.activity.listActivity({ kind: "match" }, 20)).events.length, 1);
  assert.equal((await db.activity.listActivity({ player: publicIdOf(uid) }, 20)).events.length, 4);
  assert.equal((await db.activity.groupActivity(all.events[0]!.groupId, 100)).length, 4);
  assert.equal((await db.recentMatches(game.id, undefined, 20)).length, 1);
  assert.equal((await db.matchesFor(game.id, uid, undefined, 20)).length, 1);
  const json = JSON.stringify(all);
  for (const secret of [uid, "AB12", "private-match-id", player, "uidByPlayer", "participantUids", "scopes"]) assert.ok(!json.includes(secret), `public activity leaked ${secret}`);
});

test("idempotence, late identity links and admission-defined solo mode are preserved", async () => {
  const db = new MemoryHistoryDatabase(platform, () => 1000), first = record(1, 1, { uidByPlayer: {} });
  await db.transactMatch(game.id, first.id, () => ({ match: first, result: 0 }));
  assert.equal((await db.activity.listActivity({ player: publicIdOf(uid) }, 20)).events.length, 0);
  const linked = record(1, 1);
  await db.transactMatch(game.id, first.id, () => ({ match: linked, result: 0 }));
  await db.transactMatch(game.id, first.id, () => ({ match: linked, result: 0 }));
  assert.equal((await db.activity.listActivity({}, 20)).events.length, 1);
  assert.equal((await db.activity.listActivity({ player: publicIdOf(uid) }, 20)).events.length, 1);
  const solo = record(2, 1, { playMode: "solo", groupScope: activityId("solo-1") });
  await db.transactMatch(game.id, solo.id, () => ({ match: solo, result: 0 }));
  assert.equal((await db.activity.listActivity({ mode: "solo" }, 20)).events.length, 1);
  assert.equal((await db.activity.listActivity({ mode: "multiplayer" }, 20)).events.length, 1);
  assert.equal((await db.activity.listActivity({ mode: "solo" }, 20)).events[0]!.proof, "account-reported");
});

test("pending and lone guest claims stay private; legacy metadata is not invented", () => {
  assert.equal(activityOf(game, record(1, 1, { status: "pending", endedAt: undefined })), undefined);
  assert.equal(activityOf(game, record(1, 1, { uidByPlayer: {}, attesters: [player] })), undefined);
  const legacy = activityOf(game, record(1, 1, { playMode: undefined, groupScope: undefined }))!;
  assert.equal(legacy.mode, "unknown");
  assert.notEqual(legacy.groupId, activityOf(game, record(2, 2, { playMode: undefined, groupScope: undefined }))!.groupId);
});

test("compound cursors retain every tied event, game/player/mode/kind filters compose", async () => {
  const rows = Array.from({ length: 47 }, (_, index) => activityOf(game, record(index + 1, 1))!);
  const db = new MemoryActivityDatabase(async () => rows, () => 1000);
  const ids: string[] = []; let before: ActivityPage["next"];
  do { const page = await db.listActivity({ before }, 20); ids.push(...page.events.map(event => event.id)); before = page.next; } while (before);
  assert.equal(ids.length, rows.length); assert.equal(new Set(ids).size, rows.length);
  assert.deepEqual((await db.listActivity({ gameId: "other" }, 20)).events, []);
  assert.equal((await db.listActivity({ gameId: game.id, player: publicIdOf(uid), mode: "multiplayer", kind: "round" }, 20)).events.length, 20);
  assert.notEqual(activityScope({ player: publicIdOf(uid) }), activityScope({}));
  assert.notEqual(activityScope({ kind: "round" }), activityScope({ kind: "match" }));
});

test("stored boundary rejects malformed events and strips all private/index fields", () => {
  const event = activityOf(game, record(1, 1))!;
  for (const patch of [{ players: [] }, { id: "bad" }, { groupId: "bad" }, { mode: "claimed-solo" }, { round: undefined }, { endedAt: NaN }, { winner: "missing" }, { context: { nested: {} } }, { players: [{ ...event.players[0], publicId: uid }] }]) assert.equal(parseActivity({ ...event, ...patch }, 0), undefined);
  assert.equal(parseActivity({ ...event, expiresAt: 100 }, 101), undefined);
  assert.ok(!("scopes" in parseActivity({ ...event, secret: "hidden" }, 0)!));
  assert.ok(!("secret" in parseActivity({ ...event, secret: "hidden" }, 0)!));
  assert.equal(storeActivity(event).scopes.length, 16);
});

test("game-owned activity scores preserve negative points without changing placement scores", () => {
  const source = record(1, 1);
  const event = activityOf({ ...game, activityPlayer: () => ({ score: -2, stats: { points: -2 } }) }, source)!;
  assert.equal(event.players[0]!.score, -2);
  assert.equal(source.result.players[0]!.matchScoreUnits, 30);
  assert.equal(parseActivity(event, 0)?.players[0]!.score, -2);
  assert.equal(parseActivity({ ...event, players: [{ ...event.players[0], score: Infinity }] }, 0), undefined);
});

test("real room admission groups rounds with summaries and fences reissued room incarnations", async () => {
  let ids = 0;
  const now = () => 1000, rooms = new RoomStore(new MemoryRoomDatabase(), { now, id: () => `incarnation-${ids++}`, gameIds: platform.gameIds });
  const db = new MemoryHistoryDatabase(platform, now), history = new HistoryStore(platform, db, rooms, now).game(game.id);
  const tokens = ["1".repeat(64), "2".repeat(64)], seats = tokens.map(peerId), code = "AB12";
  const open = async () => {
    await rooms.create(code, tokens[0]!, game.id);
    for (const token of tokens) await rooms.admit(code, token, "gateway", game.id);
  };
  const play = async (round?: number) => {
    const source = record(1, round).result;
    const result = { ...source, winnerId: seats[0], finishers: seats, players: source.players.map((value, index) => ({ ...value, playerId: seats[index]! })) };
    for (const [index, token] of tokens.entries()) await history.submit(await history.admit(code, token, "127.0.0.1", round !== undefined), { result }, index === 0 ? uid : undefined);
  };
  await open();
  for (const round of [1, 2, 3, undefined]) await play(round);
  const first = (await db.activity.listActivity({}, 20)).events;
  assert.equal(first.length, 4); assert.equal(new Set(first.map(value => value.groupId)).size, 1);
  assert.ok(first.every(value => value.mode === "multiplayer"));
  assert.equal(new Set(first.map(value => value.players[1]!.id)).size, 1);
  await rooms.end(code, tokens[0]!); await open(); await play(1);
  const all = (await db.activity.listActivity({}, 20)).events;
  assert.equal(all.length, 5); assert.equal(new Set(all.map(value => value.groupId)).size, 2);
});

test("real solo admission fences accounts and games while linking a round and its summary", async () => {
  const now = () => 1000, rooms = new RoomStore(new MemoryRoomDatabase(), { now, id: () => "incarnation", gameIds: platform.gameIds });
  const db = new MemoryHistoryDatabase(platform, now), store = new HistoryStore(platform, db, rooms, now), solo = "0".repeat(24);
  for (const [gameId, accountId] of [[game.id, uid], [game.id, "another-account"], ["other", uid]] as const) {
    const history = store.game(gameId);
    for (const isRound of [true, false]) {
      const value = { matchId: "same-match-id", ...(isRound ? { round: 1 } : {}), length: 1, winnerId: solo, finishers: [solo], players: [{ ...record(1, 1).result.players[0]!, playerId: solo }] };
      await history.submitSolo(await history.admitSolo(accountId, "127.0.0.1", isRound), { result: value }, accountId, isRound);
    }
  }
  const all = (await db.activity.listActivity({}, 20)).events;
  assert.equal(all.length, 6); assert.equal(new Set(all.map(value => value.groupId)).size, 3);
  assert.ok(all.every(value => value.mode === "solo" && value.proof === "account-reported"));
  for (const group of new Set(all.map(value => value.groupId))) assert.equal((await db.activity.groupActivity(group, 100)).length, 2);
});

test("public API supports own/player filters, detail and linked groups with no UID disclosure", async t => {
  const event = activityOf(game, record(1, 1))!, db = new MemoryActivityDatabase(async () => [event], () => 1000);
  const extension = createActivityHttp({ database: db, platform, now: () => 1000, identity: async token => token === "test-identity" ? uid : undefined, allowRead: async () => true });
  const server = createServer((req,res) => { void extension.handle(req,res,"127.0.0.1").catch(error => { res.writeHead(error instanceof RoomError ? error.status : 500, { "Content-Type": "application/json" }); res.end(JSON.stringify({error: error.message})); }); });
  server.listen(0,"127.0.0.1"); await once(server,"listening");
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/activity`;
  assert.equal((await fetch(url + "?scope=mine")).status, 401);
  const own = await (await fetch(url + "?scope=mine&kind=round", {headers:{Authorization:"Bearer test-identity"}})).json() as ActivityPage;
  assert.equal(own.events.length,1); assert.ok(!JSON.stringify(own).includes(uid));
  assert.equal((await fetch(url + `?player=${publicIdOf(uid)}&mode=multiplayer`)).status,200);
  assert.equal((await fetch(url + `/${event.id}`)).status,200);
  assert.equal((await fetch(url + `/groups/${event.groupId}`)).status,200);
  for (const path of ["?mode=invalid", "?player=raw-uid", "?before=1000:invalid", "?kind=round&kind=match", "?unexpected=value"]) assert.equal((await fetch(url + path)).status,400);
  assert.equal((await fetch(url + "?gameId=unknown")).status,404);
  assert.equal((await fetch(url,{method:"POST"})).status,405);
});
