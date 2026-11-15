import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { MemoryRoomDatabase, RoomStore, peerId } from "fuse-network-be";
import { HistoryStore, MemoryHistoryDatabase } from "fuse-platform";
import {
  fuseRiders,
  type StoredPlayer,
} from "../games/fuse-riders/src/platform.js";
import { platform } from "../service/history.js";

test("F-05: a lone host cannot publish or credit results until a second seat corroborates", async () => {
  const now = () => 1_000_000;
  const rooms = new RoomStore(new MemoryRoomDatabase(), {
    now,
    id: () => "room-id",
  });
  const history = new HistoryStore(
    platform,
    new MemoryHistoryDatabase(platform),
    rooms,
    now,
  ).game(fuseRiders);
  const tokens = [
    randomBytes(32).toString("hex"),
    randomBytes(32).toString("hex"),
  ];
  const code = await rooms.createAvailable(tokens[0]!);
  for (const token of tokens) await rooms.admit(code, token, "gateway");
  const ids = tokens.map(peerId);
  const player = (slot: number): StoredPlayer => ({
    playerId: ids[slot]!,
    name: `Rider ${slot + 1}`,
    slot,
    color: "#22d3ee",
    roundsPlayed: 1,
    roundWins: slot === 0 ? 1 : 0,
    matchScoreUnits: 1,
    roundsDrawn: 0,
    matchPlacement: slot + 1,
    survivalTicks: 1,
    longestSurvivalTicks: 1,
    distanceUnits: 1,
    bombsPlaced: 0,
    bombsExploded: 0,
    eliminations: 0,
    deathsByCause: { wall: 0, trail: 0, explosion: 0, rider: 0 },
    pickupsCollected: 0,
    powerPickups: 0,
    starPickups: 0,
    beerPickups: 0,
    inkPickups: 0,
    triplePickups: 0,
    fivePickups: 0,
    targetPickups: 0,
    shieldPickups: 0,
    portalPickups: 0,
    portalTransits: 0,
    invulnerableTicks: 0,
    wallBounces: 0,
    earlyExits: 0,
  });
  const result = {
    matchId: "f05",
    length: 1,
    winnerId: ids[0]!,
    finishers: [ids[0]!],
    players: [player(0), player(1)],
  };
  const report = async (index: number, value: typeof result) =>
    history.submit(
      await history.admit(code, tokens[index]!, `address-${index}`),
      { result: value },
      index === 0 ? "alice" : undefined,
    );
  for (let i = 0; i < 10; i++) {
    const outcome = await report(0, { ...result, matchId: `f05-${i}` });
    assert.equal(outcome.status, "pending");
    assert.equal(outcome.needed, 2);
  }
  assert.deepEqual(
    (await history.feed("viewer", undefined, undefined)).matches,
    [],
  );
  assert.equal((await history.profile("alice"))?.totals.matches ?? 0, 0);
  assert.equal(
    (await report(1, { ...result, matchId: "f05-0" })).status,
    "confirmed",
  );
  assert.equal(
    (await history.feed("viewer", undefined, undefined)).matches.length,
    1,
  );
  assert.equal((await history.profile("alice"))!.totals.matches, 1);
});
