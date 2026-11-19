import assert from "node:assert/strict";
import test from "node:test";
import {
  createSeatDecoder,
  createSeatListDecoder,
  memberId,
} from "../src/index.js";

const decode = createSeatDecoder({
  capacity: 2,
  playerKey: memberId,
  validName: (value): value is string =>
    typeof value === "string" && value.length > 0,
  validAvatar: (value, bot): value is string =>
    value === (bot ? "bot" : "rider"),
});

const human = {
  id: "local",
  name: "Player",
  slot: 0,
  avatarId: "rider",
  connected: true,
  bot: false,
  generation: 7,
};
const bot = {
  id: "bot:1",
  name: "Bot",
  slot: 1,
  avatarId: "bot",
  connected: true,
  bot: true,
};
const watcher = {
  ...human,
  slot: -1,
  avatarId: "",
  watcher: true,
  connected: false,
  away: true,
};

test("checkpoint seats preserve valid players, bots and watchers", () => {
  assert.deepEqual(decode(human), human);
  assert.deepEqual(decode(bot), bot);
  assert.deepEqual(decode(watcher), watcher);
  assert.deepEqual(
    decode({
      ...bot,
      generation: undefined,
      watcher: undefined,
      away: undefined,
    }),
    bot,
  );
});

test("checkpoint seat decoding rejects invalid fields and relationships", () => {
  const rejected = {
    "null payload": null,
    "array payload": [],
    "unexpected key": { ...human, extra: undefined },
    "invalid id": { ...human, id: "" },
    "invalid name": { ...human, name: "" },
    "invalid connected flag": { ...human, connected: 1 },
    "invalid bot flag": { ...human, bot: "no" },
    "false watcher flag": { ...human, watcher: false },
    "false away flag": { ...human, away: false },
    "connected while away": { ...human, away: true },
    "negative zero slot": { ...human, slot: -0 },
    "slot outside capacity": { ...human, slot: 2 },
    "human without generation": { ...human, generation: undefined },
    "bot with generation": { ...bot, generation: 0 },
    "human with bot avatar": { ...human, avatarId: "bot" },
    "bot with human avatar": { ...bot, avatarId: "rider" },
    "watcher in player slot": { ...watcher, slot: 0 },
    "watcher with player avatar": { ...watcher, avatarId: "rider" },
    "bot as watcher": { ...watcher, bot: true, generation: undefined },
  };
  for (const [caseName, seat] of Object.entries(rejected))
    assert.equal(decode(seat), undefined, caseName);
});

test("checkpoint seat lists preserve order and reject duplicate ids, slots and excess watchers", () => {
  const decodeList = createSeatListDecoder({
    capacity: 2,
    maxWatchers: 1,
    playerKey: memberId,
    validName: (value): value is string => typeof value === "string",
    validAvatar: (value, bot): value is string =>
      value === (bot ? "bot" : "rider"),
  });
  const spectator = { ...watcher, id: "watcher" };
  assert.deepEqual(
    [...decodeList([spectator, bot, human])!.keys()],
    ["watcher", "bot:1", "local"],
  );
  assert.equal(decodeList([watcher, human]), undefined);
  assert.equal(decodeList([human, { ...bot, slot: 0 }]), undefined);
  assert.equal(decodeList([watcher, spectator]), undefined);
  assert.equal(decodeList([human, { ...bot, slot: 2 }]), undefined);
});
