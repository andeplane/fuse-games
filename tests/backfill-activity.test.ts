import test from "node:test";
import assert from "node:assert/strict";
import {
  Platform,
  activityId,
  plain,
  type GameRegistration,
  type MatchRecord,
  type PlayerResult,
} from "fuse-platform";
import {
  activityBackfillCandidate,
  activityBackfillOptions,
} from "../scripts/backfill-activity.js";

const game: GameRegistration = {
  id: "history-test",
  isBot: (id) => id.startsWith("bot:"),
  parseStats(raw): PlayerResult | undefined {
    if (
      !plain(raw) ||
      typeof raw.playerId !== "string" ||
      typeof raw.name !== "string"
    )
      return;
    const keys = [
      "slot",
      "roundsPlayed",
      "roundWins",
      "matchScoreUnits",
      "matchPlacement",
      "earlyExits",
    ] as const;
    if (
      !keys.every(
        (key) =>
          typeof raw[key] === "number" &&
          Number.isSafeInteger(raw[key]) &&
          raw[key] >= 0,
      )
    )
      return;
    return {
      playerId: raw.playerId,
      name: raw.name,
      slot: Number(raw.slot),
      roundsPlayed: Number(raw.roundsPlayed),
      roundWins: Number(raw.roundWins),
      matchScoreUnits: Number(raw.matchScoreUnits),
      matchPlacement: Number(raw.matchPlacement),
      earlyExits: Number(raw.earlyExits),
    };
  },
  emptyTotals: () => ({}),
  credit: () => ({}),
  addTotals() {},
  parseTotals: () => ({}),
};
const platform = new Platform(
  {
    validName: (name): name is string =>
      typeof name === "string" && name.length > 0 && name.length < 50,
    validAvatar: (value): value is string => value === "fox",
    nameRule: "Choose a name",
    fallbackName: "Player",
  },
  [game],
);
const player = "a".repeat(24);
const record = (index: number, round?: number): MatchRecord => ({
  gameId: game.id,
  version: 1,
  id: index.toString(16).padStart(40, "0"),
  roomCode: "AB12",
  status: "confirmed",
  createdAt: 1000,
  endedAt: 2000,
  attesters: [player],
  uidByPlayer: { [player]: "private-account" },
  avatars: {},
  participantUids: round === undefined ? ["private-account"] : [],
  result: {
    matchId: "same-legacy-match",
    ...(round === undefined ? {} : { round }),
    length: 1,
    finishers: [player],
    winnerId: player,
    players: [
      {
        playerId: player,
        name: "Ada",
        slot: 0,
        roundsPlayed: 1,
        roundWins: 1,
        matchScoreUnits: 200,
        matchPlacement: 1,
        earlyExits: 0,
      },
    ],
  },
});
const plan = (data: MatchRecord) =>
  activityBackfillCandidate(platform, { id: data.id, data }, 3000);

test("activity migration is dry-run by default and requires explicit --write with bounded paging", () => {
  assert.deepEqual(activityBackfillOptions([]), {
    write: false,
    pageSize: 200,
  });
  const after = "a".repeat(40);
  assert.deepEqual(
    activityBackfillOptions([
      "--write",
      "--page-size=400",
      "--max-pages=3",
      `--after=${after}`,
    ]),
    { write: true, pageSize: 400, maxPages: 3, after },
  );
  for (const argument of [
    "--apply",
    "--write=yes",
    "--page-size=401",
    "--page-size=0",
    "--max-pages=-1",
    "--page-size=2=ignored",
    "--after=../source",
  ])
    assert.throws(() => activityBackfillOptions([argument]));
});

test("legacy round projections preserve unknown mode and singleton groups without mutating records", () => {
  const first = record(1, 1),
    second = record(2, 2),
    original = structuredClone(first);
  const a = plan(first),
    b = plan(second);
  assert.equal(a.status, "candidate");
  assert.equal(b.status, "candidate");
  if (a.status !== "candidate" || b.status !== "candidate") return;
  assert.equal(a.event.mode, "unknown");
  assert.equal(a.event.kind, "round");
  assert.equal(a.event.groupId, activityId(`legacy:${game.id}:${first.id}`));
  assert.notEqual(
    a.event.groupId,
    b.event.groupId,
    "a shared client match ID does not prove historical linkage",
  );
  assert.deepEqual(first, original);
  const publicJson = JSON.stringify(a.event);
  for (const secret of [
    "private-account",
    "AB12",
    "same-legacy-match",
    "uidByPlayer",
  ])
    assert.equal(publicJson.includes(secret), false, secret);
});

test("trusted mode and linkage survive migration and existing source TTL is retained", () => {
  const source = {
    ...record(1),
    groupScope: activityId("trusted-group"),
    playMode: "solo" as const,
    expiresAt: 10_000,
  };
  const planned = plan(source);
  assert.equal(planned.status, "candidate");
  if (planned.status !== "candidate") return;
  assert.equal(planned.event.groupId, source.groupScope);
  assert.equal(planned.event.mode, "solo");
  assert.equal(planned.event.expiresAt, source.expiresAt);
  assert.deepEqual(plan({ ...source, expiresAt: 2999 }), { status: "expired" });
});

test("migration excludes pending, expired, lone guest and invalid or mismatched documents", () => {
  assert.deepEqual(
    plan({ ...record(1), status: "pending", endedAt: undefined }),
    { status: "ineligible" },
  );
  assert.deepEqual(
    plan({ ...record(1), uidByPlayer: {}, participantUids: [] }),
    { status: "ineligible" },
  );
  assert.deepEqual(plan({ ...record(1), gameId: "unknown" }), {
    status: "invalid",
  });
  assert.deepEqual(
    activityBackfillCandidate(
      platform,
      { id: "f".repeat(40), data: record(1) },
      3000,
    ),
    { status: "invalid" },
  );
  const malformed = record(1);
  malformed.result.players[0]!.matchScoreUnits = -1;
  assert.deepEqual(plan(malformed), { status: "invalid" });
});
