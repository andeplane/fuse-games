import assert from "node:assert/strict";
import test from "node:test";
import {
  parseHistoryPlayer,
  parseHistoryReceipts,
} from "../src/history-api.js";

const id = "a".repeat(24);
const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{24}$/.test(value);
const result = {
  matchId: "match",
  length: 1,
  finishers: [id],
  players: [
    {
      playerId: id,
      name: "Ada",
      slot: 0,
      roundsPlayed: 1,
      roundWins: 1,
      matchScoreUnits: 12,
      matchPlacement: 1,
      earlyExits: 0,
    },
  ],
};
const parse = (raw: unknown, at = 4, max = 64) =>
  parseHistoryReceipts(raw, at, parseHistoryPlayer, validId, () => false, max);

test("retained results reject future or unordered decisions, malformed results and unbounded state", () => {
  const round = { tick: 3, result: { ...result, round: 1 } },
    match = { tick: 3, result };
  assert.equal(
    parse([round, match])!.length,
    2,
    "round and parent can complete on the same tick",
  );
  assert.equal(parse([round, match], 4, 1), undefined);
  assert.equal(parse([{ ...round, tick: 5 }]), undefined);
  assert.equal(parse([match, { ...round, tick: 2 }]), undefined);
  assert.equal(parse([{ ...round, injected: true }]), undefined);
  assert.equal(
    parse([{ tick: 3, result: { ...result, finishers: [id, id] } }]),
    undefined,
  );
  assert.equal(
    parse([
      {
        tick: 3,
        result: {
          ...result,
          players: [{ ...result.players[0], earlyExits: -1 }],
        },
      },
    ]),
    undefined,
  );
});
