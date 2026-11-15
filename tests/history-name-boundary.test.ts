import assert from "node:assert/strict";
import test from "node:test";
import { ACTION, JOIN } from "fuse-netcode";
import { parseMatchResult } from "fuse-platform";
import { historyPlayerName } from "fuse-platform/history-api";
import { ACCOUNT_RULES } from "../games/fuse-riders/src/platform.js";
import { craftRegistration } from "../games/fuse-craft/src/platform.js";
import { birdsRegistration } from "../games/fuse-birds/src/platform.js";
import {
  neuralGame,
  type NeuralEntry,
} from "../games/fuse-craft/src/online/game.js";
import { craftResults } from "../games/fuse-craft/src/online/result.js";
import { createMatch, getView } from "../games/fuse-birds/src/engine/index.js";
import { birdsResults } from "../games/fuse-birds/src/online/result.js";

test("receipt display names preserve words and complete code points within shared account rules", () => {
  assert.equal(
    historyPlayerName("  Ada Long Guest Name Here  "),
    "Ada Long Guest Nam",
  );
  assert.equal(
    historyPlayerName("a".repeat(17) + "🚀extra"),
    "a".repeat(17) + "🚀",
  );
  assert.equal(historyPlayerName("\u0000\ud800\u007f"), "Player");
  assert.equal(
    ACCOUNT_RULES.validName(historyPlayerName(" 🚀".repeat(30))),
    true,
  );
});

for (const name of ["NineteenLettersNameX", "a".repeat(17) + "🚀tail"]) {
  test(`long ${name.includes("🚀") ? "emoji" : "guest"} names produce accepted Craft and Birds round/match receipts`, () => {
    const a = "a".repeat(24),
      b = "b".repeat(24);
    const room = neuralGame.createRoom("lobby", {
      mapId: "close-quarters",
      slot: 0,
      mode: "versus",
      engine: {},
    });
    const ticker = neuralGame.createTicker();
    const fold = (entries: NeuralEntry[] = []) =>
      ticker(room, a, new Map([[a, { generation: 1, entries }]]));
    fold([
      [1, 1, JOIN, a, name, 0, "brain", 1],
      [2, 1, JOIN, b, "Bo", 1, "brain", 1],
    ]);
    fold([[3, 2, ACTION, "start", "match"]]);
    room.world.structures.find(
      (structure) => structure.kind === "brain" && structure.ownerId === b,
    )!.hp = 0;
    fold();
    assert.equal(room.decided!.names[a], name, "runtime name stays intact");
    for (const { result } of craftResults(room.world, room.decided)) {
      assert.ok(parseMatchResult(craftRegistration, ACCOUNT_RULES, result));
      assert.equal(
        result.players.find((player) => player.playerId === a)!.name,
        historyPlayerName(name),
      );
    }
    const world = getView(
      createMatch("birds", 42, [
        { id: a, name },
        { id: b, name: "Bo" },
      ]),
    );
    const receipts = birdsResults({
      tick: 3,
      stage: "over",
      world: { ...world, phase: "over", winner: a },
      seats: [],
      decided: { tick: 1, finishers: [a, b] },
      history: [],
    });
    assert.equal(receipts.length, 2);
    assert.equal(world.players[0]!.name, name);
    for (const { result } of receipts) {
      assert.ok(parseMatchResult(birdsRegistration, ACCOUNT_RULES, result));
      assert.equal(result.players[0]!.name, historyPlayerName(name));
    }
  });
}
