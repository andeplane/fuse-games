import test from "node:test";
import assert from "node:assert/strict";
import {
  createResultsHistory,
  type HistoryReceipt,
  type HistorySnapshot,
} from "../src/results-history.js";
const me = "a".repeat(24);
const receipt = (matchId = "match", round?: number): HistoryReceipt => ({
  tick: 10,
  result: {
    matchId,
    ...(round === undefined ? {} : { round }),
    length: 1,
    finishers: [me],
    winnerId: me,
    players: [
      {
        playerId: me,
        name: "Ada",
        slot: 0,
        roundsPlayed: 1,
        roundWins: 1,
        matchScoreUnits: 1,
        matchPlacement: 1,
        earlyExits: 0,
      },
    ],
  },
});
const settled = () => new Promise<void>((resolve) => setImmediate(resolve));

test("shared history waits for confirmed participation and sign-in without consuming solo outcomes", async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  let signedIn = false;
  const history = createResultsHistory({
    fetch: async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response("{}");
    },
    apiUrl: (path) => `https://game.invalid${path}`,
    gameId: "example",
    signedIn: () => signedIn,
    playerId: () => me,
    now: () => 0,
  });
  const result = receipt();
  history.observe([result], 10);
  assert.equal(calls.length, 0);
  signedIn = true;
  history.observe([result], 9);
  assert.equal(calls.length, 0);
  history.observe(
    [{ ...result, result: { ...result.result, finishers: [] } }],
    10,
  );
  assert.equal(calls.length, 0);
  history.observe([result], 10);
  await settled();
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0]!.url,
    "https://game.invalid/api/games/example/me/results",
  );
  assert.equal(
    new Headers(calls[0]!.init?.headers).has("Authorization"),
    false,
  );
  result.result.players[0]!.name = "Changed after queue";
  assert.equal(
    JSON.parse(String(calls[0]!.init?.body)).result.players[0].name,
    "Ada",
  );
  history.observe([result], 10);
  await settled();
  assert.equal(calls.length, 1);
});

test("room rounds retry transient failures using a bounded schedule and preserve pending receipts across rematches", async () => {
  let now = 0;
  const calls: string[] = [];
  const history = createResultsHistory({
    fetch: async (input, init) => {
      calls.push(String(input));
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "Bearer room-token",
      );
      return new Response("{}", { status: calls.length === 1 ? 503 : 200 });
    },
    apiUrl: (path) => path,
    gameId: "example",
    room: { code: "AB12", token: "room-token" },
    signedIn: () => false,
    playerId: () => me,
    now: () => now,
  });
  history.observe([receipt("first", 1)], 10);
  await settled();
  assert.equal(calls.length, 1);
  history.observe([receipt("second")], 10);
  await settled();
  assert.equal(calls.length, 2);
  now = 999;
  history.observe([], 10);
  await settled();
  assert.equal(calls.length, 2);
  now = 1000;
  history.observe([], 10);
  await settled();
  assert.equal(calls.length, 3);
  assert.equal(calls[0], "/api/games/example/rooms/AB12/round-results");
  assert.equal(calls[2], calls[0]);
  history.dispose();
  history.observe([receipt("third")], 10);
  await settled();
  assert.equal(calls.length, 3);
});

test("permanent rejection and exhausted transient errors stop retries", async () => {
  let now = 0,
    calls = 0;
  const history = createResultsHistory({
    fetch: async () => {
      calls++;
      return new Response("{}", { status: 503 });
    },
    apiUrl: (path) => path,
    gameId: "example",
    signedIn: () => true,
    playerId: () => me,
    now: () => now,
  });
  for (const at of [0, 1000, 3000, 10000]) {
    now = at;
    history.observe([receipt()], 10);
    await settled();
  }
  assert.equal(calls, 3);
  const permanent = createResultsHistory({
    fetch: async () => {
      calls++;
      return new Response("{}", { status: 400 });
    },
    apiUrl: (path) => path,
    gameId: "example",
    signedIn: () => true,
    playerId: () => me,
    now: () => now,
  });
  permanent.observe([receipt()], 10);
  await settled();
  permanent.observe([receipt()], 10);
  await settled();
  assert.equal(calls, 4);
});

test("rate limits honor bounded Retry-After and a guest's later sign-in links the same room outcome", async () => {
  let now = 0,
    signedIn = false,
    calls = 0;
  const history = createResultsHistory({
    fetch: async () => {
      calls++;
      return new Response("{}", {
        status: calls === 1 ? 429 : calls === 2 ? 408 : 200,
        headers: { "Retry-After": "2" },
      });
    },
    apiUrl: (path) => path,
    gameId: "example",
    room: { code: "AB12", token: "token" },
    signedIn: () => signedIn,
    playerId: () => me,
    now: () => now,
  });
  history.observe([receipt()], 10);
  await settled();
  assert.equal(calls, 1);
  now = 1000;
  history.observe([], 10);
  await settled();
  assert.equal(calls, 1);
  now = 2000;
  history.observe([], 10);
  await settled();
  assert.equal(calls, 2);
  now = 4000;
  history.observe([], 10);
  await settled();
  assert.equal(calls, 3);
  history.observe([receipt()], 10);
  await settled();
  assert.equal(calls, 3);
  signedIn = true;
  history.observe([receipt()], 10);
  await settled();
  assert.equal(calls, 4);
  history.observe([receipt()], 10);
  await settled();
  assert.equal(calls, 4);
});

class DrainClock {
  now = 0;
  jobs = new Map<number, { at: number; callback(): void }>();
  nextId = 0;
  schedule = (callback: () => void, ms: number) => {
    const id = ++this.nextId;
    this.jobs.set(id, { at: this.now + ms, callback });
    return () => {
      this.jobs.delete(id);
    };
  };
  advance(ms: number) {
    const until = this.now + ms;
    while (true) {
      const next = [...this.jobs].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > until) break;
      this.now = next[1].at;
      this.jobs.delete(next[0]);
      next[1].callback();
    }
    this.now = until;
  }
}
function drainHarness() {
  const clock = new DrainClock();
  const sent: MatchResultBody[] = [];
  const history = createResultsHistory({
    fetch: async (_input, init) => {
      sent.push(JSON.parse(String(init?.body)) as MatchResultBody);
      return new Response("{}", { status: 503 });
    },
    apiUrl: (path) => path,
    gameId: "example",
    signedIn: () => true,
    playerId: () => me,
    now: () => clock.now,
    schedule: clock.schedule,
  });
  return { clock, history, sent };
}
interface MatchResultBody {
  result: HistoryReceipt["result"];
}

test("Back waits for fresh confirmed outcomes and sends corrected data before stopping exactly once", async () => {
  const { clock, history, sent } = drainHarness();
  let frame: HistorySnapshot = { receipts: [receipt()], confirmedTick: 9 };
  let stops = 0,
    reads = 0;
  history.close(
    () => {
      reads++;
      return frame;
    },
    () => {
      stops++;
    },
  );
  assert.equal(stops, 0);
  assert.equal(clock.jobs.size, 1);
  frame = {
    receipts: [
      {
        ...receipt(),
        result: {
          ...receipt().result,
          winnerId: undefined,
          players: [
            {
              ...receipt().result.players[0]!,
              name: "Corrected",
              roundWins: 0,
            },
          ],
        },
      },
    ],
    confirmedTick: 10,
  };
  clock.advance(50);
  assert.equal(
    stops,
    0,
    "the page survives until the transport attempt settles",
  );
  await settled();
  assert.equal(stops, 1);
  assert.equal(reads, 3);
  assert.equal(clock.jobs.size, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.result.players[0]!.name, "Corrected");
  assert.equal(sent[0]!.result.winnerId, undefined);
  history.close(
    () => frame,
    () => {
      stops++;
    },
  );
  history.dispose();
  clock.advance(10_000);
  history.observe(frame.receipts, 10);
  await settled();
  assert.equal(stops, 1);
  assert.equal(
    sent.length,
    1,
    "a failed keepalive request does not retry after close",
  );
});

test("Back withdraws a rolled-back result instead of sending the cached prediction", async () => {
  const { clock, history, sent } = drainHarness();
  let frame: HistorySnapshot = { receipts: [receipt()], confirmedTick: 9 };
  let stops = 0;
  history.close(
    () => frame,
    () => {
      stops++;
    },
  );
  frame = { receipts: [], confirmedTick: 10 };
  clock.advance(50);
  await settled();
  assert.equal(stops, 1);
  assert.equal(sent.length, 0);
  assert.equal(clock.jobs.size, 0);
});

test("Back sends already confirmed receipts without waiting for a timer and ignores ineligible predictions", async () => {
  const { clock, history, sent } = drainHarness();
  let stops = 0;
  history.close(
    () => ({
      receipts: [
        receipt(),
        {
          ...receipt("spectated"),
          tick: 20,
          result: { ...receipt("spectated").result, finishers: [] },
        },
      ],
      confirmedTick: 10,
    }),
    () => {
      stops++;
    },
  );
  assert.equal(stops, 0);
  await settled();
  assert.equal(stops, 1);
  assert.equal(clock.jobs.size, 0);
  await settled();
  assert.equal(sent.length, 1);

  const empty = drainHarness();
  let emptyStops = 0;
  empty.history.close(
    () => ({ receipts: [], confirmedTick: 10 }),
    () => {
      emptyStops++;
    },
  );
  assert.equal(emptyStops, 1);
  assert.equal(empty.clock.jobs.size, 0);
});

test("Back has a bounded deadline and disposal cancels outstanding runtime reads", async () => {
  const { clock, history, sent } = drainHarness();
  let stops = 0,
    reads = 0;
  history.close(
    () => {
      reads++;
      return { receipts: [receipt()], confirmedTick: 9 };
    },
    () => {
      stops++;
    },
  );
  clock.advance(2999);
  assert.equal(stops, 0);
  clock.advance(1);
  assert.equal(stops, 1);
  assert.equal(reads, 61);
  assert.equal(clock.jobs.size, 0);
  await settled();
  assert.equal(sent.length, 0);

  const other = drainHarness();
  let otherReads = 0,
    otherStops = 0;
  other.history.close(
    () => {
      otherReads++;
      return { receipts: [receipt()], confirmedTick: 9 };
    },
    () => {
      otherStops++;
    },
  );
  const stale = [...other.clock.jobs.values()][0]!.callback;
  other.history.dispose();
  assert.equal(otherStops, 1);
  assert.equal(other.clock.jobs.size, 0);
  stale();
  other.clock.advance(10_000);
  assert.equal(otherReads, 1);
  assert.equal(otherStops, 1);
});

test("Back bounds an unresolved authenticated transport and ignores its late failure", async () => {
  const clock = new DrainClock();
  let resolveFetch: ((response: Response) => void) | undefined;
  let calls = 0,
    stops = 0;
  const transport = new Promise<Response>((resolve) => {
    resolveFetch = resolve;
  });
  const history = createResultsHistory({
    fetch: async () => {
      calls++;
      return transport;
    },
    apiUrl: (path) => path,
    gameId: "example",
    signedIn: () => true,
    playerId: () => me,
    now: () => clock.now,
    schedule: clock.schedule,
  });
  const frame = { receipts: [receipt()], confirmedTick: 10 };
  history.close(
    () => frame,
    () => {
      stops++;
    },
  );
  await settled();
  assert.equal(calls, 1);
  assert.equal(stops, 0);
  clock.advance(3000);
  assert.equal(stops, 1);
  assert.equal(clock.jobs.size, 0);
  assert.ok(resolveFetch);
  resolveFetch(new Response("{}", { status: 503 }));
  await settled();
  clock.advance(10_000);
  history.observe(frame.receipts, 10);
  await settled();
  assert.equal(calls, 1);
  assert.equal(stops, 1);
});

test("nine complete matches remain deduplicated through guest and signed-in reporting", async () => {
  const receipts = Array.from({ length: 9 }, (_, match) => [
    ...Array.from({ length: 99 }, (_, round) =>
      receipt(`match-${match}`, round + 1),
    ),
    receipt(`match-${match}`),
  ]).flat();
  let signedIn = false;
  const posted: string[] = [];
  const history = createResultsHistory({
    fetch: async (_input, init) => {
      const { result } = JSON.parse(String(init?.body)) as MatchResultBody;
      posted.push(JSON.stringify([result.matchId, result.round, signedIn]));
      return new Response("{}");
    },
    apiUrl: (path) => path,
    gameId: "example",
    room: { code: "AB12", token: "token" },
    signedIn: () => signedIn,
    playerId: () => me,
    now: () => 0,
  });
  const drain = async () => {
    // At most eight new receipts enter the transport on each observation.
    for (let batch = 0; batch < Math.ceil(receipts.length / 8); batch++) {
      history.observe(receipts, 10);
      await settled();
    }
  };
  await drain();
  assert.equal(posted.length, 900);
  assert.equal(new Set(posted).size, 900);
  history.observe(receipts, 10);
  await settled();
  assert.equal(
    posted.length,
    900,
    "retained guest receipts cannot evict one another",
  );
  signedIn = true;
  await drain();
  assert.equal(posted.length, 1800);
  assert.equal(new Set(posted).size, 1800);
  history.observe(receipts, 10);
  await settled();
  signedIn = false;
  history.observe(receipts, 10);
  await settled();
  assert.equal(
    posted.length,
    1800,
    "both account-linking states stay deduplicated",
  );
  history.dispose();
});
