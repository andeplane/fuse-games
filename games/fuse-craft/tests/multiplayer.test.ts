import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { mountFuseCraft, type AppDependencies } from "../src/app/app.js";
import { createAttractScene } from "../src/app/attract-scene.js";
import type {
  OnlineDependencies,
  OnlineSession,
  RoomRules,
  RoomSnapshot,
} from "../src/app/contracts.js";

function fixture(
  options: {
    manager?: boolean;
    initialRoom?: string;
    friends?: AppDependencies["friends"];
  } = {},
) {
  const { document: dom } = parseHTML(
    '<html><body><div id="app"></div></body></html>',
  );
  const document = dom as unknown as Document;
  const Event = dom.defaultView!.Event;
  const root = document.getElementById("app")!;
  const world = createAttractScene();
  const calls: string[] = [];
  const listeners = new Set<() => void>();
  const room: RoomSnapshot = {
    code: "AB12",
    stage: "lobby",
    seats: [],
    self: world.players[0]!.id,
    manager: options.manager ?? true,
    status: "",
    closed: "",
    mapId: "close-quarters",
    aiStrategy: "balanced",
    powerups: true,
  };
  const session: OnlineSession = {
    confirmedView: () => ({ ...world, seats: room.seats }),
    code: "AB12",
    localPlayerId: world.players[0]!.id,
    canControl: true,
    view: () => world,
    dispatch() {},
    dispatchBatch() {
      return true;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset: () => calls.push("reset"),
    dispose: () => calls.push("dispose"),
    room: () => ({ ...room, seats: [...room.seats] }),
    join: (name) => calls.push(`join:${name}`),
    addBot: () => calls.push("addBot"),
    removeBot: (id) => calls.push(`removeBot:${id}`),
    configure: (change: Partial<RoomRules>) =>
      calls.push(`configure:${JSON.stringify(change)}`),
    start: () => calls.push("start"),
    rematch: () => calls.push("rematch"),
    lobby: () => calls.push("lobby"),
  };
  let saved = "";
  const online: OnlineDependencies = {
    async createRoom() {
      calls.push("createRoom");
      return { code: "AB12" };
    },
    openRoom(code) {
      calls.push(`openRoom:${code}`);
      return session;
    },
    validCode: (code) => /^[A-Z0-9]{4}$/.test(code),
    roomLink: (code) => `https://fuse.test/fuse-craft/?room=${code}`,
    enterRoom: (code) => calls.push(`enterRoom:${code}`),
    leaveRoom: () => calls.push("leaveRoom"),
    savedName: () => saved,
    saveName: (name) => {
      saved = name;
    },
  };
  const dependencies: AppDependencies = {
    maps: {
      async list() {
        return [];
      },
      async load() {
        return world.map;
      },
    },
    preferences: {
      read: () => ({
        mute: true,
        volume: 0.5,
        reducedMotion: true,
        edgeScroll: true,
      }),
      write() {},
    },
    createSession() {
      throw new Error("single player is not used here");
    },
    debug: false,
    animationClock: () => 0,
    requestFrame: () => 1,
    cancelFrame() {},
    online,
    ...(options.initialRoom ? { initialRoom: options.initialRoom } : {}),
    ...(options.friends ? { friends: options.friends } : {}),
  };
  const app = mountFuseCraft(root, dependencies);
  const click = (selector: string) => {
    for (const dialog of root.querySelectorAll<HTMLDialogElement>("dialog")) {
      dialog.showModal = () => {
        dialog.open = true;
      };
      dialog.close = () => {
        dialog.open = false;
      };
    }
    const element = root.querySelector<HTMLElement>(selector);
    assert.ok(element, `missing ${selector}`);
    element.click();
  };
  const change = (selector: string, value: string | boolean) => {
    const element = root.querySelector<HTMLInputElement>(selector)!;
    if (typeof value === "boolean") element.checked = value;
    else if (element.tagName === "SELECT")
      // linkedom's select value is read-only: select the option instead.
      for (const option of element.querySelectorAll("option"))
        option.toggleAttribute("selected", option.value === value);
    else element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const update = (edit: (room: RoomSnapshot) => void) => {
    edit(room);
    for (const listener of listeners) listener();
  };
  return { root, calls, click, change, update, app, world };
}

test("the menu offers single player and multiplayer", () => {
  const f = fixture();
  assert.ok(f.root.querySelector('[data-action="new-game"]'));
  f.click('[data-action="multiplayer"]');
  assert.ok(f.root.querySelector('[data-action="create-room"]'));
  assert.ok(f.root.querySelector('[data-field="room-code"]'));
  f.app.dispose();
});

test("creating a room enters its lobby and a name takes a seat", async () => {
  const f = fixture();
  f.click('[data-action="multiplayer"]');
  f.click('[data-action="create-room"]');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(f.calls.slice(0, 3), [
    "createRoom",
    "enterRoom:AB12",
    "openRoom:AB12",
  ]);
  assert.equal(f.root.querySelector(".fui-room-code")?.textContent, "AB12");
  f.change('[data-field="player-name"]', "Anders");
  f.click('[data-action="join-seat"]');
  assert.ok(f.calls.includes("join:Anders"));
  f.app.dispose();
});

test("joining needs a valid code", () => {
  const f = fixture();
  f.click('[data-action="multiplayer"]');
  f.change('[data-field="room-code"]', "nope!");
  f.click('[data-action="join-room"]');
  assert.ok(f.root.querySelector(".error-card"));
  assert.ok(!f.calls.some((call) => call.startsWith("openRoom")));
  f.change('[data-field="room-code"]', "ab12");
  f.click('[data-action="join-room"]');
  assert.ok(f.calls.includes("enterRoom:AB12"));
  assert.ok(f.calls.includes("openRoom:AB12"));
  f.app.dispose();
});

test("the room is the shared room: Back, Settings and Start in its head, HOST on a row, the code once", () => {
  const opened: string[] = [];
  const accounts = new Map([["guest", "acct-bo"]]);
  const f = fixture({
    initialRoom: "AB12",
    friends: {
      publicIdOfMember: (id) => accounts.get(id),
      friendButton(publicId) {
        const button = f.root.ownerDocument.createElement("button");
        button.textContent = `ADD FRIEND ${publicId}`;
        return button;
      },
      open: () => opened.push("friends"),
    },
  });
  f.update((room) => {
    room.managerId = room.self;
    room.mapId = "cortex-crossing";
    room.status = "Connected · direct game link";
    room.seats = [
      {
        id: room.self,
        name: "Anders",
        slot: 0,
        bot: false,
        connected: true,
        watcher: false,
      },
      {
        id: "guest",
        name: "Bo",
        slot: 1,
        bot: false,
        connected: false,
        watcher: false,
      },
      {
        id: "bot-1",
        name: "Bot 3",
        slot: 2,
        bot: true,
        connected: true,
        watcher: false,
      },
    ];
  });
  const head = f.root.querySelector(".fui-room-head")!;
  assert.deepEqual(
    [...head.querySelectorAll("button")].map((button) => button.textContent),
    ["Back", "Room settings", "START MATCH"],
  );
  assert.equal(head.querySelector(".fui-page-title")?.textContent, "Room");
  assert.equal(
    f.root.querySelector(".fui-room-invitation [data-action='start-room']"),
    null,
    "Start is not under the QR code",
  );
  assert.equal(
    f.root.textContent!.split("AB12").length - 1,
    1,
    "the room's code is shown once",
  );
  const rows = [...f.root.querySelectorAll(".fui-roster-row")].map((row) => [
    row.querySelector(".fui-roster-name")?.textContent,
    row.querySelector(".fui-roster-host")?.textContent ?? "",
    row.querySelector(".fui-roster-status")?.textContent,
  ]);
  assert.deepEqual(rows, [
    ["Anders (you)", "HOST", ""],
    ["Bo", "", "Away"],
    ["Bot 3", "", "AI"],
  ]);
  assert.equal(
    f.root.querySelector(".fui-room-layout > .fui-room-status")?.textContent,
    "Connected · direct game link",
  );
  // ADD FRIEND sits on the row of a seat the room has matched to an account, and survives the room's re-renders.
  const friend = () => f.root.querySelector(".fui-roster-friend");
  assert.equal(friend()?.textContent, "ADD FRIEND acct-bo");
  assert.equal(
    friend()?.closest(".fui-roster-row")?.querySelector(".fui-roster-name")
      ?.textContent,
    "Bo",
  );
  const before = friend();
  f.update((room) => {
    room.status = "Connected · Bo lagging";
  });
  assert.equal(friend(), before, "the same button, not a new one each frame");
  // The matched player leaves: the button goes with the row, not onto the neighbour's.
  f.update((room) => {
    room.seats = room.seats.filter((seat) => seat.id !== "guest");
  });
  assert.equal(friend(), null, "no ADD FRIEND left on another player's row");
  assert.deepEqual(
    [...f.root.querySelectorAll(".fui-roster-name")].map(
      (name) => name.textContent,
    ),
    ["Anders (you)", "Bot 3"],
  );
  f.click('[data-action="invite-friends"]');
  assert.deepEqual(opened, ["friends"]);
  f.app.dispose();
});

test("the manager changes rules, adds bots and starts once two players are ready", () => {
  const f = fixture({ initialRoom: "AB12" });
  assert.ok(f.calls.includes("openRoom:AB12"), "opens the room in the address");
  f.update((room) => {
    room.seats = [
      {
        id: room.self,
        name: "Anders",
        slot: 0,
        bot: false,
        connected: true,
        watcher: false,
      },
    ];
  });
  assert.equal(f.root.querySelector("#player-name"), null, "already seated");
  const start = () =>
    f.root.querySelector<HTMLButtonElement>('[data-action="start-room"]')!;
  assert.equal(start().disabled, true);
  f.click('[data-action="add-bot"]');
  assert.ok(f.calls.includes("addBot"));
  f.update((room) => {
    room.seats.push({
      id: "bot-1",
      name: "Bot 2",
      slot: 1,
      bot: true,
      connected: true,
      watcher: false,
    });
  });
  assert.equal(start().disabled, false);
  f.change('[data-field="room-map"]', "sandbox-12");
  f.change('[data-field="room-strategy"]', "siege");
  f.change('[data-field="room-powerups"]', false);
  assert.ok(f.calls.includes('configure:{"mapId":"sandbox-12"}'));
  assert.ok(f.calls.includes('configure:{"aiStrategy":"siege"}'));
  assert.ok(f.calls.includes('configure:{"powerups":false}'));
  f.click('[data-action="remove-bot"]');
  assert.ok(f.calls.includes("removeBot:bot-1"));
  f.click('[data-action="start-room"]');
  assert.ok(f.calls.includes("start"));
  f.app.dispose();
});

test("players who do not manage the room cannot start it or change rules", () => {
  const f = fixture({ manager: false, initialRoom: "AB12" });
  assert.equal(f.root.querySelector('[data-action="start-room"]'), null);
  assert.equal(f.root.querySelector('[data-action="add-bot"]'), null);
  assert.equal(
    f.root.querySelector<HTMLSelectElement>('[data-field="room-map"]')!
      .disabled,
    true,
  );
  f.app.dispose();
});

test("the room moves between its lobby and the battlefield, and leaving clears the address", () => {
  const f = fixture({ initialRoom: "AB12" });
  f.update((room) => {
    room.stage = "running";
  });
  assert.ok(f.root.querySelector("#nd-board"), "the match is shown");
  assert.ok(
    Array.from(
      f.root.querySelectorAll<HTMLButtonElement>(".fui-game-menu-action"),
    ).find(
      (button) => button.textContent === "BACK TO LOBBY" && !button.hidden,
    ),
  );
  f.update((room) => {
    room.stage = "lobby";
  });
  assert.ok(f.root.querySelector(".room-seats"), "back in the lobby");
  f.click('[data-action="leave-room"]');
  assert.ok(f.calls.includes("leaveRoom"));
  assert.ok(f.calls.includes("dispose"));
  assert.ok(f.root.querySelector('[data-action="multiplayer"]'));
  f.app.dispose();
});

test("a closed room says why and returns to the menu", () => {
  const f = fixture({ initialRoom: "AB12" });
  f.update((room) => {
    room.closed = "kicked";
  });
  assert.match(f.root.textContent ?? "", /removed you/);
  f.click('[data-action="leave-room"]');
  assert.ok(f.root.querySelector('[data-action="new-game"]'));
  f.app.dispose();
});
