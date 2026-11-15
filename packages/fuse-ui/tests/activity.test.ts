import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import type {
  ActivityPage,
  ActivityQuery,
  ActivitySource,
  ActivityGroup,
  GameActivity,
} from "fuse-platform/activity-api";
import {
  createActivityBrowser,
  createActivitySource,
} from "../src/activity.js";

const settle = async () => {
  for (let i = 0; i < 5; i++)
    await new Promise<void>((resolve) => setImmediate(resolve));
};
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const event = (fields: Partial<GameActivity> = {}): GameActivity => ({
  version: 1,
  id: "match-1",
  gameId: "fusemania",
  groupId: "group-1",
  kind: "match",
  mode: "solo",
  proof: "server-replayed",
  endedAt: 1_700_000_000_000,
  rounds: 3,
  title: "Victory",
  winner: "seat-1",
  players: [
    {
      id: "seat-1",
      publicId: "public-ada",
      name: "Ada",
      bot: false,
      place: 1,
      score: 900_000,
      wins: 1,
      stats: { marvelous: 89, steps: 100 },
    },
  ],
  context: { scoreUnit: "percent" },
  ...fields,
});
class Source implements ActivitySource {
  queries: ActivityQuery[] = [];
  eventIds: string[] = [];
  groupIds: string[] = [];
  listReply: (query: ActivityQuery) => Promise<ActivityPage> = async () => ({
    events: [event()],
    games: ["fusemania", "fuse-riders"],
  });
  eventReply: (id: string) => Promise<GameActivity> = async (id) =>
    event({ id });
  groupReply: (id: string) => Promise<ActivityGroup> = async () => ({
    events: [event(), event({ id: "round-1", kind: "round", round: 1 })],
  });
  list(query: ActivityQuery) {
    this.queries.push(structuredClone(query));
    return this.listReply(query);
  }
  event(id: string) {
    this.eventIds.push(id);
    return this.eventReply(id);
  }
  group(id: string) {
    this.groupIds.push(id);
    return this.groupReply(id);
  }
}
function fixture(t: { after(hook: () => Promise<void>): void }) {
  const window = new Window();
  const document = window.document as unknown as Document;
  const source = new Source();
  let signedIn = false,
    signsIn = 0;
  const browser = createActivityBrowser({
    source,
    document,
    signedIn: () => signedIn,
    signIn: () => {
      signsIn++;
    },
    gameName: (id) => (id === "fusemania" ? "Fusemania" : "Fuse Riders"),
  });
  document.body.append(browser.element);
  t.after(async () => {
    browser.dispose();
    await window.happyDOM.close();
  });
  const named = (label: string, within: ParentNode = browser.element) => {
    const button = [
      ...within.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === label);
    assert.ok(button, `button ${label} exists`);
    return button;
  };
  const select = (label: string, value: string) => {
    const input = browser.element.querySelector<HTMLSelectElement>(
      `select[aria-label="${label}"]`,
    )!;
    input.value = value;
    input.dispatchEvent(new document.defaultView!.Event("change"));
  };
  return {
    browser,
    source,
    document,
    named,
    select,
    signedIn(value: boolean) {
      signedIn = value;
    },
    signsIn: () => signsIn,
  };
}

test("activity is lazy, an empty first page does not loop, and explicit filters reach the shared source", async (t) => {
  const f = fixture(t);
  assert.equal(f.source.queries.length, 0);
  f.source.listReply = async () => ({
    events: [],
    games: ["fusemania", "fuse-riders"],
  });
  f.browser.open();
  await settle();
  assert.deepEqual(f.source.queries, [{ kind: "match" }]);
  assert.match(f.browser.element.textContent!, /No recorded activity/);
  f.browser.open();
  await settle();
  assert.equal(f.source.queries.length, 1);
  f.select("Game", "fusemania");
  await settle();
  f.select("Show", "round");
  await settle();
  f.select("Players", "multiplayer");
  await settle();
  assert.deepEqual(f.source.queries.at(-1), {
    gameId: "fusemania",
    kind: "round",
    mode: "multiplayer",
  });
  f.select("Show", "");
  await settle();
  assert.deepEqual(f.source.queries.at(-1), {
    gameId: "fusemania",
    mode: "multiplayer",
  });
});

test("Yours requires sign-in and changing authentication invalidates an in-flight own feed", async (t) => {
  const f = fixture(t);
  f.browser.open();
  await settle();
  f.named("YOURS").click();
  await settle();
  assert.equal(
    f.source.queries.length,
    1,
    "a guest never asks the API for a private scope",
  );
  assert.match(f.browser.element.textContent!, /Sign in to see your activity/);
  f.named("SIGN IN").click();
  assert.equal(f.signsIn(), 1);
  const own = deferred<ActivityPage>();
  f.signedIn(true);
  f.source.listReply = () => own.promise;
  f.browser.refresh();
  await settle();
  assert.deepEqual(f.source.queries.at(-1), { mine: true, kind: "match" });
  f.signedIn(false);
  f.browser.refresh();
  await settle();
  own.resolve({ events: [event({ title: "Old account result" })] });
  await settle();
  assert.match(f.browser.element.textContent!, /Sign in to see your activity/);
  assert.ok(!f.browser.element.textContent!.includes("Old account result"));
});

test("player navigation clears unrelated filters, focuses the player heading, and can return to Everyone", async (t) => {
  const f = fixture(t);
  f.browser.open();
  await settle();
  f.select("Game", "fuse-riders");
  await settle();
  f.select("Players", "multiplayer");
  await settle();
  const player = f.browser.element.querySelector<HTMLButtonElement>(
    ".fui-activity-player",
  )!;
  player.focus();
  player.click();
  await settle();
  assert.deepEqual(f.source.queries.at(-1), {
    player: "public-ada",
  });
  assert.equal(f.document.activeElement?.textContent, "Ada · RECENT ACTIVITY");
  assert.equal(f.named("EVERYONE").getAttribute("aria-pressed"), "false");
  f.named("EVERYONE").click();
  await settle();
  assert.deepEqual(f.source.queries.at(-1), {});
  assert.equal(f.named("EVERYONE").getAttribute("aria-pressed"), "true");
});

test("opening a player's feed includes games that record matches without round receipts", async (t) => {
  const f = fixture(t);
  f.source.listReply = async (query) => ({
    events:
      query.kind === "round"
        ? []
        : [event({ gameId: "fuse-lane", title: "Local game complete" })],
  });
  f.browser.openPlayer("public-ada", "Ada");
  await settle();
  assert.match(f.browser.element.textContent!, /Local game complete/);
  assert.equal(f.source.queries.at(-1)?.kind, undefined);
});

test("round and match details preserve score units, escape names, sort linked rounds, and return focus", async (t) => {
  const f = fixture(t);
  f.source.eventReply = async (id) =>
    event({
      id,
      title: "Result <img src=x>",
      players: [
        {
          ...event().players[0]!,
          name: "<img src=x onerror=alert(1)>",
          label: "Challenge 12",
        },
      ],
    });
  f.source.groupReply = async () => ({
    events: [
      event({ id: "round-3", kind: "round", round: 3 }),
      event({ id: "round-1", kind: "round", round: 1 }),
      event(),
    ],
  });
  f.browser.open();
  await settle();
  const open =
    f.browser.element.querySelector<HTMLButtonElement>(".fui-activity-open")!;
  open.focus();
  open.click();
  await settle();
  const detail = f.browser.element.querySelector<HTMLElement>(
    ".fui-activity-detail",
  )!;
  assert.equal(f.document.activeElement?.tagName, "H3");
  assert.match(detail.textContent!, /Replay-verified result/);
  assert.match(detail.textContent!, /90.00%/);
  assert.match(detail.textContent!, /Challenge 12/);
  assert.equal(detail.querySelectorAll("img,script").length, 0);
  assert.ok(detail.textContent!.includes("<img src=x onerror=alert(1)>"));
  assert.deepEqual(f.source.eventIds, ["match-1"]);
  assert.deepEqual(f.source.groupIds, ["group-1"]);
  const linked = [
    ...detail.querySelectorAll<HTMLButtonElement>("section ol button"),
  ];
  assert.deepEqual(
    linked.map((button) => button.textContent?.split(" · ")[0]),
    ["MATCH", "ROUND 1", "ROUND 3"],
  );
  assert.equal(
    linked[0]!.disabled,
    true,
    "the currently open event is identified",
  );
  linked[1]!.click();
  await settle();
  assert.equal(f.source.eventIds.at(-1), "round-1");
  f.named("BACK TO ACTIVITY").click();
  assert.equal(
    f.document.activeElement,
    open,
    "linked detail retains its originating list control",
  );
  assert.equal(
    f.browser.element.querySelector<HTMLElement>(".fui-activity-detail")!
      .hidden,
    true,
  );
});

test("a deferred detail announces success through its existing live status", async (t) => {
  const f = fixture(t);
  let resolve: ((value: GameActivity) => void) | undefined;
  f.source.eventReply = () =>
    new Promise<GameActivity>((done) => {
      resolve = done;
    });
  f.browser.open();
  await settle();
  f.browser.element
    .querySelector<HTMLButtonElement>(".fui-activity-open")!
    .click();
  const live = f.browser.element.querySelector<HTMLElement>(
    ".fui-activity-detail [role=status]",
  )!;
  assert.equal(live.textContent, "Loading result…");
  resolve!(event());
  await settle();
  assert.equal(
    f.browser.element.querySelector(".fui-activity-detail [role=status]"),
    live,
  );
  assert.match(live.textContent!, /Result loaded/);
});

test("Back restores the original list button's keyboard focus", async (t) => {
  const f = fixture(t);
  f.browser.open();
  await settle();
  const open =
    f.browser.element.querySelector<HTMLButtonElement>(".fui-activity-open")!;
  open.focus();
  open.click();
  await settle();
  f.named("BACK TO ACTIVITY").click();
  assert.equal(f.document.activeElement, open);
});

test("recent activity rows show each player's score beside their name with game-appropriate units", async (t) => {
  const f = fixture(t);
  f.source.listReply = async () => ({
    events: [
      event({
        context: { scoreUnit: "percent", scoreDivisor: 3 },
        players: [{ ...event().players[0]!, score: 3_000_000 }],
      }),
      event({
        id: "points",
        context: {},
        players: [
          {
            ...event().players[0]!,
            publicId: undefined,
            name: "Metronome",
            bot: true,
            score: 12,
          },
        ],
      }),
    ],
  });
  f.browser.open();
  await settle();
  const rows = [
    ...f.browser.element.querySelectorAll(".fui-activity-player-result"),
  ];
  assert.deepEqual(
    rows.map((row) => row.textContent),
    ["Ada · 100.00%", "Metronome · AI · 12"],
  );
  assert.equal(rows[0]!.querySelector("button")!.textContent, "Ada");
  assert.equal(rows[1]!.querySelector("button"), null);
});

test("percent session summaries use their song divisor while ordinary round percentages stay unchanged", async (t) => {
  const f = fixture(t);
  f.source.eventReply = async (id) =>
    event({
      id,
      context: { scoreUnit: "percent", scoreDivisor: id === "round" ? 1 : 3 },
      players: [
        { ...event().players[0]!, score: id === "round" ? 999_999 : 3_000_000 },
      ],
    });
  f.source.groupReply = async () => ({
    events: [event({ id: "round", kind: "round", round: 1 })],
  });
  f.browser.open();
  await settle();
  f.browser.element
    .querySelector<HTMLButtonElement>(".fui-activity-open")!
    .click();
  await settle();
  assert.equal(
    f.browser.element.querySelector(".fui-activity-standings tbody td")!
      .textContent,
    "100.00%",
  );
  const linked = f.browser.element.querySelector<HTMLButtonElement>(
    ".fui-activity-detail section ol button",
  )!;
  linked.click();
  await settle();
  assert.equal(
    f.browser.element.querySelector(".fui-activity-standings tbody td")!
      .textContent,
    "99.99%",
  );
});

test("older-page failure retries the same composite cursor while retaining current results", async (t) => {
  const f = fixture(t),
    cursor = { at: 1_700_000_000_000, id: "same-time-tie" };
  let fail = true;
  f.source.listReply = async (query) => {
    if (!query.before) return { events: [event()], next: cursor };
    if (fail) throw new Error("Service unavailable");
    return { events: [event({ id: "older", title: "Earlier song" })] };
  };
  f.browser.open();
  await settle();
  f.named("OLDER ACTIVITY").click();
  await settle();
  assert.deepEqual(f.source.queries.at(-1)?.before, cursor);
  assert.match(f.browser.element.textContent!, /Service unavailable/);
  assert.equal(
    f.browser.element.querySelectorAll(".fui-activity-list > li").length,
    1,
  );
  fail = false;
  f.named("TRY AGAIN").click();
  await settle();
  assert.deepEqual(f.source.queries.at(-1)?.before, cursor);
  assert.equal(
    f.browser.element.querySelectorAll(".fui-activity-list > li").length,
    2,
  );
  assert.equal(f.named("OLDER ACTIVITY").hidden, true);
});

test("opening a result cancels an older request without stranding pagination disabled on Back", async (t) => {
  const f = fixture(t),
    older = deferred<ActivityPage>();
  f.source.listReply = async (query) =>
    query.before
      ? older.promise
      : { events: [event()], next: { at: 100, id: "cursor" } };
  f.browser.open();
  await settle();
  f.named("OLDER ACTIVITY").click();
  assert.equal(f.named("OLDER ACTIVITY").disabled, true);
  f.browser.element
    .querySelector<HTMLButtonElement>(".fui-activity-open")!
    .click();
  await settle();
  f.named("BACK TO ACTIVITY").click();
  assert.equal(f.named("OLDER ACTIVITY").disabled, false);
  assert.ok(
    !f.browser.element
      .querySelector(".fui-activity-status")!
      .textContent!.includes("Loading"),
  );
  older.resolve({ events: [event({ title: "Cancelled older page" })] });
  await settle();
  assert.ok(!f.browser.element.textContent!.includes("Cancelled older page"));
});

test("failed event and group reads are explicitly retryable without dropping the linked-round heading", async (t) => {
  const f = fixture(t);
  let failEvent = true,
    failGroup = true;
  f.source.eventReply = async (id) => {
    if (failEvent) throw new Error("Result connection failed");
    return event({ id });
  };
  f.source.groupReply = async () => {
    if (failGroup) throw new Error("Group unavailable");
    return { events: [event()] };
  };
  f.browser.open();
  await settle();
  f.browser.element
    .querySelector<HTMLButtonElement>(".fui-activity-open")!
    .click();
  await settle();
  assert.match(f.browser.element.textContent!, /RESULT UNAVAILABLE/);
  failEvent = false;
  f.named(
    "TRY AGAIN",
    f.browser.element.querySelector(".fui-activity-detail")!,
  ).click();
  await settle();
  assert.match(f.browser.element.textContent!, /Could not load linked rounds/);
  failGroup = false;
  f.named("RETRY ROUNDS").click();
  await settle();
  assert.equal(
    f.browser.element.querySelectorAll(".fui-activity-detail section h4")
      .length,
    1,
  );
  assert.equal(
    f.browser.element.querySelector(".fui-activity-detail section h4")!
      .textContent,
    "MATCH AND ROUNDS",
  );
  assert.equal(
    f.browser.element.querySelectorAll(".fui-activity-detail section ol li")
      .length,
    1,
  );
});

test("a truncated group explicitly says older linked results were omitted", async (t) => {
  const f = fixture(t);
  f.source.groupReply = async () => ({
    events: [
      event(),
      ...Array.from({ length: 99 }, (_, index) =>
        event({ id: `round-${index + 1}`, kind: "round", round: index + 1 }),
      ),
    ],
    truncated: true,
  });
  f.browser.open();
  await settle();
  f.browser.element
    .querySelector<HTMLButtonElement>(".fui-activity-open")!
    .click();
  await settle();
  assert.match(
    f.browser.element.querySelector(".fui-activity-detail")!.textContent!,
    /Showing the latest 100 linked results\. Older results are not included\./,
  );
  assert.equal(
    f.browser.element.querySelectorAll(".fui-activity-detail section ol > li")
      .length,
    100,
  );
});

test("stale list/detail replies and disposed browsers cannot overwrite the current view", async (t) => {
  const f = fixture(t),
    first = deferred<ActivityPage>(),
    detail = deferred<GameActivity>();
  f.source.listReply = (query) =>
    query.kind === "match"
      ? first.promise
      : Promise.resolve({
          events: [
            event({
              id: "round",
              kind: "round",
              round: 1,
              title: "Current round",
            }),
          ],
        });
  f.browser.open();
  f.select("Show", "round");
  await settle();
  first.resolve({ events: [event({ title: "Stale match" })] });
  await settle();
  assert.ok(!f.browser.element.textContent!.includes("Stale match"));
  f.source.eventReply = () => detail.promise;
  f.browser.element
    .querySelector<HTMLButtonElement>(".fui-activity-open")!
    .click();
  f.named("BACK TO ACTIVITY").click();
  detail.resolve(event({ title: "Stale detail" }));
  await settle();
  assert.ok(!f.browser.element.textContent!.includes("Stale detail"));
  const count = f.source.queries.length;
  f.browser.dispose();
  f.browser.open(true);
  f.browser.openPlayer("public-ada", "Ada");
  f.browser.refresh();
  await settle();
  assert.equal(f.source.queries.length, count);
});

test("HTTP source uses exact API scope, composite cursors and header-only identity", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  let token: string | undefined = "test-identity";
  const source = createActivitySource({
    apiUrl: (path) => `https://service.test${path}`,
    token: async () => token,
    fetch: async (input, init) => {
      const url = String(input);
      calls.push({ url, ...(init ? { init } : {}) });
      return new Response(
        JSON.stringify(
          url.includes("/groups/")
            ? { events: [event()], truncated: true }
            : url.includes("event%2Fid")
              ? { event: event() }
              : { events: [], next: { at: 123, id: "tie-id" } },
        ),
      );
    },
  });
  const query: ActivityQuery = {
    gameId: "fusemania",
    player: "public-ada",
    mode: "solo",
    kind: "round",
    before: { at: 123, id: "tie-id" },
  };
  assert.deepEqual(await source.list(query), {
    events: [],
    next: { at: 123, id: "tie-id" },
  });
  const url = new URL(calls[0]!.url);
  assert.equal(url.pathname, "/api/activity");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    gameId: "fusemania",
    player: "public-ada",
    mode: "solo",
    kind: "round",
    before: "123:tie-id",
  });
  assert.equal(
    new Headers(calls[0]!.init?.headers).get("Authorization"),
    "Bearer test-identity",
  );
  assert.ok(!calls[0]!.url.includes("test-identity"));
  assert.ok(calls[0]!.init?.signal);
  await source.event("event/id");
  assert.deepEqual(await source.group("group/id"), {
    events: [event()],
    truncated: true,
  });
  assert.equal(new URL(calls[1]!.url).pathname, "/api/activity/event%2Fid");
  assert.equal(
    new URL(calls[2]!.url).pathname,
    "/api/activity/groups/group%2Fid",
  );
  token = undefined;
  await source.list({ mine: true });
  assert.equal(new URL(calls[3]!.url).searchParams.get("scope"), "mine");
  assert.equal(
    new Headers(calls[3]!.init?.headers).has("Authorization"),
    false,
  );
});

test("HTTP errors and malformed list/detail/group envelopes fail visibly rather than pretending empty history", async () => {
  const bodies = [
    new Response(JSON.stringify({ error: "Retry later" }), { status: 503 }),
    new Response("{}"),
    new Response("{}"),
    new Response("{}"),
  ];
  const source = createActivitySource({
    apiUrl: (path) => path,
    token: async () => undefined,
    fetch: async () => {
      const body = bodies.shift();
      assert.ok(body);
      return body;
    },
  });
  await assert.rejects(source.list({}), /Retry later/);
  await assert.rejects(source.list({}), /Invalid activity response/);
  await assert.rejects(source.event("id"), /Activity unavailable/);
  await assert.rejects(source.group("id"), /Match rounds unavailable/);
});
