import assert from "node:assert/strict";
import test from "node:test";
import {
  displayQuery,
  hostTokenKey,
  onlineRoute,
  plainClick,
  rejoinCode,
  roomQuery,
  SOLO_QUERY,
} from "../src/online/landing-route.js";

const noTokens = () => null;
const tokens =
  (stored: Record<string, string>) =>
  (code: string): string | null =>
    stored[hostTokenKey(code)] ?? null;

test("no room and no solo run is the landing page", () => {
  for (const search of ["", "?", "?room=", "?solo=0", "?display=1", "?mute"])
    assert.deepEqual(
      onlineRoute(search, noTokens),
      { kind: "landing" },
      search,
    );
});

test("an invited device is a joiner; the browser that created the room is its host", () => {
  assert.deepEqual(onlineRoute("?room=ab42", noTokens), {
    kind: "room",
    code: "AB42AA",
    solo: false,
    displayOnly: false,
    role: "joiner",
    hostToken: null,
  });
  assert.deepEqual(
    onlineRoute("?room=AB42AA&mute", tokens({ "fuse-room-AB42AA": "t0k" })),
    {
      kind: "room",
      code: "AB42AA",
      solo: false,
      displayOnly: false,
      role: "host",
      hostToken: "t0k",
    },
  );
  assert.equal(
    onlineRoute("?room=AB42AA", tokens({ "fuse-room-AB42AA": "" })).kind ===
      "room" &&
      (
        onlineRoute("?room=AB42AA", tokens({ "fuse-room-AB42AA": "" })) as {
          role: string;
        }
      ).role,
    "joiner",
    "an empty stored token is no token",
  );
});

test("TV VIEW is a display, even in the creator's browser", () => {
  const route = onlineRoute(
    displayQuery("AB42AA"),
    tokens({ "fuse-room-AB42AA": "t0k" }),
  );
  assert.deepEqual(route, {
    kind: "room",
    code: "AB42AA",
    solo: false,
    displayOnly: true,
    role: "display",
    hostToken: null,
  });
});

test("a solo run ignores any room or display in the query", () => {
  for (const search of [SOLO_QUERY, "?solo=1&room=AB42AA", "?solo=1&display=1"])
    assert.deepEqual(
      onlineRoute(
        search,
        tokens({ "fuse-room-SOLO": "x", "fuse-room-AB42AA": "y" }),
      ),
      {
        kind: "room",
        code: "SOLO",
        solo: true,
        displayOnly: false,
        role: "solo",
        hostToken: null,
      },
      search,
    );
});

test("a code that is not a room code gets the invalid card, not a room", () => {
  for (const search of ["?room=A", "?room=AB-42", "?room=ABCDEFGHIJKLMNOP"])
    assert.equal(onlineRoute(search, noTokens).kind, "invalid", search);
  assert.deepEqual(onlineRoute("?room=ab!", noTokens), {
    kind: "invalid",
    code: "AB!",
  });
});

test("the room and display links", () => {
  assert.equal(roomQuery("AB42AA"), "?room=AB42AA");
  assert.equal(displayQuery("AB42AA"), "?room=AB42AA&display=1");
});

test("REJOIN offers only a stored room code", () => {
  assert.equal(rejoinCode("AB42AA"), "AB42AA");
  assert.equal(rejoinCode(null), undefined);
  assert.equal(rejoinCode(""), undefined);
  assert.equal(rejoinCode("not a code"), undefined);
});

test("PLAY SOLO stays in the page only for a plain primary click", () => {
  const plain = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
  };
  assert.equal(plainClick(plain), true);
  assert.equal(
    plainClick({ ...plain, button: 1 }),
    false,
    "middle click: new tab",
  );
  for (const key of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const)
    assert.equal(plainClick({ ...plain, [key]: true }), false, key);
});
