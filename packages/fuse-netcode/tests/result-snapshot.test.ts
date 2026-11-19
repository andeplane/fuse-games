import assert from "node:assert/strict";
import test from "node:test";
import {
  createRosterDecoder,
  decodeHumanFinishers,
  decodeSingleWinner,
  memberId,
} from "../src/index.js";

const decodeRoster = createRosterDecoder({
  validLength: (length) => length === 0 || length === 2,
  playerKey: memberId,
  validName: (value): value is string =>
    typeof value === "string" && value.length > 0,
  slotAt: (index) => (index % 2 === 0 ? 1 : 0),
});

test("roster decoding keeps the game's allowed lengths and slot assignments", () => {
  assert.deepEqual(decodeRoster([]), []);
  assert.deepEqual(
    decodeRoster([
      ["b", "B", true],
      ["a", "A", false],
    ]),
    [
      { id: "b", name: "B", slot: 1, bot: true },
      { id: "a", name: "A", slot: 0, bot: false },
    ],
  );
  for (const roster of [
    [["a", "A", false]],
    [
      ["a", "A", false],
      ["a", "Other", true],
    ],
    [
      ["a", "A", false],
      ["b", "B", 0],
    ],
    [
      ["a", "A", false],
      ["b", "", true],
    ],
    [
      ["a", "A", false],
      ["bad key", "B", true],
    ],
    [
      ["a", "A", false],
      ["b", "B", true, 0],
    ],
  ])
    assert.equal(decodeRoster(roster), undefined);
});

const roster = [
  { id: "b", bot: false },
  { id: "robot", bot: true },
  { id: "a", bot: false },
];

test("only distinct human finishers in ID order are accepted", () => {
  assert.deepEqual(decodeHumanFinishers([], roster), []);
  assert.deepEqual(decodeHumanFinishers(["a", "b"], roster), ["a", "b"]);
  for (const value of [
    "a",
    ["a", "a"],
    ["b", "a"],
    ["robot"],
    ["missing"],
    ["a", "b", "a", "b"],
  ])
    assert.equal(decodeHumanFinishers(value, roster), undefined);
});

test("a single-winner decision can name a bot, with a positive clock and human finishers", () => {
  assert.equal(decodeSingleWinner(null, roster), null);
  assert.deepEqual(decodeSingleWinner([1, "robot", ["a", "b"]], roster), {
    clock: 1,
    winner: "robot",
    finishers: ["a", "b"],
  });
  for (const value of [
    [0, "a", []],
    [1, "missing", []],
    [1, "a", ["robot"]],
    [1, "a", [], 0],
  ])
    assert.equal(decodeSingleWinner(value, roster), undefined);
});
