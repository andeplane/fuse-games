import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION,
  BOT,
  JOIN,
  LEAVE,
  SETTINGS as SETTINGS_ENTRY,
} from "fuse-netcode";
import {
  activityId,
  activityOf,
  parseMatchResult,
  type AccountRules,
  type MatchRecord,
  type MatchResult,
} from "fuse-platform";
import { FULL_RATING } from "../src/engine/index.js";
import { validName } from "../src/basics.js";
import { PLAY, READY, type Room } from "../src/online/game.js";
import {
  captureHistoryReceipts,
  historyReceipts,
  matchResult,
  roundResult,
  RESULT_PARENTS,
  type FusemaniaReceipt,
} from "../src/online/result.js";
import { dueReports } from "../src/app/reports.js";
import {
  fusemaniaRegistration,
  parseFusemaniaStats,
  validFusemaniaField,
  type FusemaniaStats,
} from "../src/platform.js";
import {
  SETTINGS,
  fold,
  game,
  library,
  run,
  runTo,
  seated,
  started,
} from "./fixtures/room.js";

const finish = (room: Room) => {
  while (room.stage === "running") fold(room);
};
function ace(room: Room) {
  for (const note of library.steps(room.play.song, 0)!.notes) {
    runTo(room, note.ms);
    fold(room, {
      a: [
        [PLAY, room.epoch, note.column, note.ms],
        [PLAY, room.epoch, note.column + 4, note.ms + 40],
      ],
    });
  }
  finish(room);
}
const account: AccountRules = {
  validName,
  validAvatar: (raw): raw is string => typeof raw === "string",
  nameRule: "Name",
  fallbackName: "Player",
};
const registration = {
  ...fusemaniaRegistration,
  parseStats: (raw: unknown, rounds: number) =>
    parseFusemaniaStats(raw, rounds, library),
};
const wireId = (id: string) => (id.startsWith("bot:") ? id : id.repeat(24));
function wire(
  result: MatchResult<FusemaniaStats>,
): MatchResult<FusemaniaStats> {
  return {
    ...result,
    winnerId: result.winnerId && wireId(result.winnerId),
    finishers: result.finishers.map(wireId),
    players: result.players.map((player) => ({
      ...player,
      playerId: wireId(player.playerId),
    })),
  };
}

test("a three-song playlist reports three numbered song events and one final aggregate under one parent", () => {
  let room = started({ ...SETTINGS, songs: 3 });
  const sent = new Set<string>();
  const receipts: MatchResult<FusemaniaStats>[] = [];
  for (let song = 1; song <= 3; song++) {
    if (song === 1) ace(room);
    else finish(room);
    assert.equal(room.session!.id, "m1");
    assert.deepEqual(dueReports(library, room, "a", room.tick - 1, sent), []);
    const reports = dueReports(library, room, "a", room.tick, sent);
    assert.deepEqual(
      reports.map((report) => report.path),
      song === 3 ? ["round-results", "results"] : ["round-results"],
    );
    const round = roundResult(library, room)!;
    assert.equal(round.matchId, "m1");
    assert.equal(round.round, song);
    assert.equal(round.length, 1);
    assert.equal(round.players[0]!.sessionLength, 3);
    assert.equal(round.players[0]!.songId, "grid");
    for (const report of reports) {
      sent.add(report.key);
      const parsed = parseMatchResult(
        registration,
        account,
        wire(report.result),
      );
      assert.ok(parsed);
      receipts.push(parsed);
    }
    assert.deepEqual(dueReports(library, room, "a", room.tick, sent), []);
    if (song < 3) {
      assert.equal(matchResult(library, room), undefined);
      const checkpoint = game.checkpoint.encode(room);
      room = game.checkpoint.decode(checkpoint, room.tick)!;
      assert.ok(room);
      fold(room, { a: [[ACTION, "rematch", `song-${song + 1}`]] });
    }
  }
  assert.deepEqual([...sent], ["m1:1", "m1:2", "m1:3", "m1:match"]);
  const aggregate = matchResult(library, room)!;
  assert.equal(aggregate.matchId, "m1");
  assert.equal(aggregate.length, 3);
  const ada = aggregate.players[0]!;
  assert.equal(ada.roundsPlayed, 3);
  assert.equal(ada.roundWins, 3);
  assert.equal(ada.matchScoreUnits, FULL_RATING);
  assert.equal(ada.rating, Math.floor(FULL_RATING / 3));
  assert.equal(ada.marvelous, 64);
  assert.equal(ada.misses, 128);
  assert.equal(ada.songId, undefined);
  assert.equal(ada.chart, undefined);
  const events = receipts.map((result, index) => {
    const record: MatchRecord<FusemaniaStats> = {
      gameId: "fusemania",
      version: 1,
      id: String(index).padStart(40, "0"),
      roomCode: "AB12",
      groupScope: activityId(`room-incarnation:${result.matchId}`),
      playMode: "multiplayer",
      status: "confirmed",
      result,
      attesters: result.finishers,
      uidByPlayer: {},
      avatars: {},
      participantUids: [],
      createdAt: index,
      endedAt: index + 1,
    };
    return activityOf(registration, record)!;
  });
  assert.ok(events.every(Boolean));
  assert.equal(events.length, 4);
  assert.equal(new Set(events.map((event) => event.groupId)).size, 1);
  assert.deepEqual(
    events.map((event) => event.kind),
    ["round", "round", "round", "match"],
  );
  assert.equal(events[3]!.context.scoreDivisor, 3);
  assert.deepEqual(fusemaniaRegistration.credit(ada, aggregate.players), {
    matches: 1,
    wins: 1,
    steps: 64,
    marvelous: 64,
    misses: 128,
  });
});

test("playlist aggregate retains departed and later entrants with their actual counters", () => {
  const room = started({ ...SETTINGS, songs: 3 });
  ace(room);
  fold(room, {
    a: [
      [ACTION, "lobby", "lobby-2"],
      [LEAVE, "b"],
      [JOIN, "c", "Cy", 1, "robot", 1],
    ],
  });
  fold(room, { a: [[ACTION, "start", "song-2"]] });
  finish(room);
  fold(room, {
    a: [
      [ACTION, "lobby", "lobby-3"],
      [BOT, "add", "bot:1", "Robo", 2],
      [SETTINGS_ENTRY, { ...SETTINGS, songs: 3, song: "other" }],
    ],
  });
  fold(room, { a: [[ACTION, "start", "song-3"]] });
  finish(room);
  const result = matchResult(library, room)!;
  const byId = new Map(
    result.players.map((player) => [player.playerId, player]),
  );
  assert.equal(byId.get("b")!.roundsPlayed, 1);
  assert.equal(byId.get("c")!.roundsPlayed, 2);
  assert.equal(byId.get("bot:1")!.roundsPlayed, 1);
  assert.ok(!result.finishers.includes("b"));
  assert.equal(result.players.length, 4);
  assert.ok(parseMatchResult(registration, account, wire(result)));
  const frozen = JSON.stringify(result);
  room.seats.get("a")!.name = "New name";
  room.settings = { ...SETTINGS };
  assert.equal(JSON.stringify(matchResult(library, room)), frozen);
});

test("early exits are retained per song and old single-song result semantics remain unchanged", () => {
  const room = started({ ...SETTINGS, songs: 3 });
  fold(room, { a: [[LEAVE, "b"]] });
  finish(room);
  assert.equal(
    room.session!.records.find((record) => record.id === "b")!.earlyExits,
    1,
  );
  const single = started();
  finish(single);
  const match = matchResult(library, single)!,
    round = roundResult(library, single)!;
  assert.deepEqual(round, {
    ...match,
    round: 1,
    roundDuration: {
      version: 1,
      ticks: single.decided!.clock - single.matchStartTick,
    },
  });
  assert.equal(match.players[0]!.sessionLength, undefined);
  assert.equal(
    dueReports(library, single, "a", single.tick, new Set()).length,
    2,
  );
});

test("playlist history accepts a larger retained field than one song's five seats", () => {
  const room = started({ ...SETTINGS, songs: 3 });
  finish(room);
  fold(room, {
    a: [
      [ACTION, "lobby", "lobby-2"],
      [LEAVE, "b"],
      ...["c", "d", "e", "f"].map((id, index) => [
        JOIN,
        id,
        `Player ${id}`,
        index + 1,
        "robot",
        1,
      ]),
    ],
  });
  fold(room, { a: [[ACTION, "start", "song-2"]] });
  finish(room);
  fold(room, {
    a: [
      [ACTION, "lobby", "lobby-3"],
      ...["c", "d", "e", "f"].map((id) => [LEAVE, id]),
      ...["0", "1", "2", "3"].map((id, index) => [
        JOIN,
        id,
        `Player ${id}`,
        index + 1,
        "robot",
        1,
      ]),
    ],
  });
  fold(room, { a: [[ACTION, "start", "song-3"]] });
  finish(room);
  const result = matchResult(library, room)!;
  assert.equal(result.players.length, 10);
  assert.equal(result.finishers.length, 5);
  assert.equal(new Set(result.players.map((player) => player.slot)).size, 10);
  assert.ok(parseMatchResult(registration, account, wire(result)));
  const restored = game.checkpoint.decode(
    game.checkpoint.encode(room),
    room.tick,
  )!;
  assert.ok(restored);
  assert.deepEqual(matchResult(library, restored), result);
});

test("aggregate parser enforces playlist bounds, context, averages and field size", () => {
  const room = started({ ...SETTINGS, songs: 3 });
  for (let i = 0; i < 3; i++) {
    finish(room);
    if (i < 2) fold(room, { a: [[ACTION, "rematch", `next-${i}`]] });
  }
  const result = wire(matchResult(library, room)!);
  const player = result.players[0]!;
  for (const patch of [
    { roundsPlayed: 4 },
    { roundWins: 4 },
    { sessionLength: 5 },
    { sessionLength: undefined },
    { songId: "grid", chart: 0, mode: 0 },
    { rating: 1 },
    { steps: 60_001 },
    { combo: 20_001 },
    { earlyExits: 4 },
    { unexpected: 1 },
  ])
    assert.equal(
      parseFusemaniaStats({ ...player, ...patch }, 3, library),
      undefined,
      JSON.stringify(patch),
    );
  assert.equal(
    validFusemaniaField([
      { ...player, sessionLength: 3 },
      { ...result.players[1]!, sessionLength: 5 },
    ]),
    false,
  );
  assert.equal(parseFusemaniaStats(player, 4, library), undefined);
});

test("song and aggregate receipts survive rematch before a non-checkpoint completion tick becomes closed", () => {
  let room = started({ ...SETTINGS, songs: 3 });
  finish(room);
  if (room.tick % 4 === 0) {
    room = seated({ ...SETTINGS, songs: 3 });
    fold(room);
    fold(room, {
      a: [
        [ACTION, "start", "m1"],
        [READY, 1],
      ],
      b: [[READY, 1]],
    });
    finish(room);
  }
  const firstTick = room.decided!.clock;
  assert.notEqual(firstTick % 4, 0);
  const sent = new Set<string>();
  assert.deepEqual(
    dueReports(library, room, "a", Math.floor((firstTick - 40) / 4) * 4, sent),
    [],
  );
  fold(room, { a: [[ACTION, "rematch", "song-2"]] });
  assert.equal(room.decided, null);
  run(room, 44);
  const closed = Math.floor((room.tick - 40) / 4) * 4;
  assert.ok(closed >= firstTick);
  const prior = dueReports(library, room, "a", closed, sent);
  assert.deepEqual(
    prior.map((report) => report.key),
    ["m1:1"],
  );
  prior.forEach((report) => sent.add(report.key));
  finish(room);
  const second = dueReports(library, room, "a", room.tick, sent);
  assert.deepEqual(
    second.map((report) => report.key),
    ["m1:2"],
  );
  second.forEach((report) => sent.add(report.key));
  fold(room, { a: [[ACTION, "rematch", "song-3"]] });
  finish(room);
  const finalTick = room.decided!.clock;
  fold(room, { a: [[ACTION, "rematch", "new-parent"]] });
  run(room, 44);
  const finalClosed = Math.floor((room.tick - 40) / 4) * 4;
  assert.ok(finalClosed >= finalTick);
  assert.deepEqual(
    dueReports(library, room, "a", finalClosed, sent).map(
      (report) => report.key,
    ),
    ["m1:3", "m1:match"],
  );
  const checkpoint = game.checkpoint.encode(room),
    restored = game.checkpoint.decode(checkpoint, room.tick)!;
  assert.ok(restored);
  assert.equal(game.hash(restored), game.hash(room));
  assert.deepEqual(
    historyReceipts(library, restored),
    historyReceipts(library, room),
  );
});

test("legacy song results retain percentage units when their song context is unavailable", () => {
  const room = started();
  finish(room);
  const original = wire(matchResult(library, room)!);
  const players = original.players.map((player) => {
    const raw: Record<string, unknown> = { ...player };
    delete raw.songId;
    delete raw.chart;
    delete raw.mode;
    return raw;
  });
  const legacy = parseMatchResult(registration, account, {
    ...original,
    players,
  });
  assert.ok(legacy);
  const presentation = fusemaniaRegistration.activity?.(legacy);
  assert.equal(presentation?.context?.scoreUnit, "percent");
  assert.equal(
    presentation?.context?.songId,
    undefined,
    "missing historical song identity is not invented",
  );
});

test("reused host parent ids replace closed groups without growing or corrupting checkpoint history", () => {
  const room = started();
  finish(room);
  captureHistoryReceipts(library, room);
  assert.equal(
    historyReceipts(library, room).length,
    2,
    "capturing a deciding tick is idempotent",
  );
  for (const id of ["m1", "other-parent", "m1", "m1"]) {
    fold(room, { a: [[ACTION, "rematch", id]] });
    finish(room);
    assert.equal(
      new Set(room.recentResults.map((group) => group[0]!.result.matchId)).size,
      room.recentResults.length,
    );
    assert.ok(room.recentResults.every((group) => group.length === 2));
    assert.ok(game.checkpoint.decode(game.checkpoint.encode(room), room.tick));
  }
});

test("retained receipts are bounded by parent, detached and strictly validated at the checkpoint boundary", () => {
  const room = started();
  finish(room);
  for (let i = 1; i < RESULT_PARENTS + 2; i++) {
    fold(room, { a: [[ACTION, "rematch", `parent-${i}`]] });
    finish(room);
  }
  assert.equal(room.recentResults.length, RESULT_PARENTS);
  assert.ok(room.recentResults.every((group) => group.length === 2));
  const detached = historyReceipts(library, room);
  detached[0]!.result.players[0]!.name = "Changed copy";
  assert.notEqual(
    historyReceipts(library, room)[0]!.result.players[0]!.name,
    "Changed copy",
  );
  const original = game.checkpoint.encode(room);
  assert.ok(game.checkpoint.decode(original, room.tick));
  for (const corrupt of [
    (groups: FusemaniaReceipt[][]) => {
      groups.push(structuredClone(groups[0]!));
    },
    (groups: FusemaniaReceipt[][]) => {
      groups[0]![0]!.tick = room.tick + 1;
    },
    (groups: FusemaniaReceipt[][]) => {
      groups[0]!.push(structuredClone(groups[0]![0]!));
    },
    (groups: FusemaniaReceipt[][]) => {
      groups[0]![0]!.result.players[0]!.rating++;
    },
    (groups: FusemaniaReceipt[][]) => {
      groups[0]![0]!.result.round = 2;
    },
    (groups: FusemaniaReceipt[][]) => {
      groups.at(-1)!.pop();
    },
    (groups: FusemaniaReceipt[][]) => {
      groups[0]!.pop();
    },
    (groups: FusemaniaReceipt[][]) => {
      groups[0]![0]!.result.players = [];
    },
  ]) {
    const fields = structuredClone(original);
    corrupt(fields[13] as FusemaniaReceipt[][]);
    assert.equal(game.checkpoint.decode(fields, room.tick), undefined);
  }
  assert.deepEqual(
    dueReports(library, room, "watcher", room.tick, new Set()),
    [],
  );
  assert.deepEqual(
    dueReports(library, room, "bot:1", room.tick, new Set()),
    [],
  );
});
