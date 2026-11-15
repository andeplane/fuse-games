import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTION,
  BOT,
  JOIN,
  PRESENCE,
  SETTINGS,
  SPECTATOR,
  World,
  encodeSnapshot,
  decodeSnapshot,
  SnapshotAssembler,
  type StreamEntries,
  type RoomTransport,
} from "fuse-netcode";
import {
  DEFAULT_SETTINGS,
  FIRE,
  LEFT,
  RIGHT,
  SLOT5,
  NEXT,
  stepWorld,
  PHYSICS_MS,
  OUTER_MS,
  allowedWeaponIds,
  validLoadout,
  createWorld as createClassicWorld,
  type Settings,
} from "../src/engine/index.js";
import {
  PLAY,
  LOADOUT,
  BEGIN_LOADOUT,
  createRoom,
  decode,
  encode,
  foldTick,
  hash,
  isEntry,
  stepsPerTick,
  LOG_TICK_MS,
  fuseroGame,
  type Entry,
  type Room,
  type Loadout,
} from "../src/online/game.js";
import { FuseroRuntime } from "../src/online/runtime.js";
import { recordInjury } from "../src/engine/classic/match.js";

type Bodies = Record<string, readonly unknown[][]>;
function fold(room: Room, bodies: Bodies = {}, generation = 1): void {
  const tick = room.tick + 1;
  const streams = new Map<string, StreamEntries<Entry>>();
  for (const [id, list] of Object.entries(bodies))
    streams.set(id, {
      generation,
      entries: list.map((body, i) => [i + 1, tick, ...body] as Entry),
    });
  foldTick(room, "a", streams);
}
function lobby(settings: Settings = DEFAULT_SETTINGS): Room {
  const room = createRoom("lobby", settings);
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "robot", 1],
      [JOIN, "b", "Bo", 1, "cat", 1],
      [BOT, "add", "bot:1", "Neon Nix", 2],
    ],
  });
  return room;
}
function started(settings: Settings = DEFAULT_SETTINGS): Room {
  const room = lobby(settings);
  fold(room, { a: [[ACTION, "start", "match-1"]] });
  return room;
}
function humans(settings: Settings = DEFAULT_SETTINGS): Room {
  const room = createRoom("lobby", settings);
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "robot", 1],
      [JOIN, "b", "Bo", 1, "cat", 1],
    ],
  });
  fold(room, { a: [[ACTION, "start", "match-1"]] });
  return room;
}
const chosen = (settings: Settings = DEFAULT_SETTINGS): Loadout => {
  const ids = allowedWeaponIds(settings);
  return [ids[0]!, ids[1]!, ids[2]!, ids[3]!, ids[4]!];
};

test("Classic controls and native five-slot inventories validate at the entry boundary", () => {
  assert.ok(isEntry([1, 20, PLAY, "match-1", 1, LEFT | FIRE | SLOT5]));
  assert.ok(isEntry([1, 20, LOADOUT, "lobby", 0, chosen()]));
  for (const value of [-1, 1.5, 131072, NaN, Infinity, "1"])
    assert.equal(isEntry([1, 20, PLAY, "match-1", 1, value]), false);
  for (const inventory of [
    [],
    [0, 1, 2, 3],
    [0, 1, 2, 3, 38],
    [0, 1, 2, 3, -1],
    [0, 1, 2, 3, 1.5],
  ])
    assert.equal(isEntry([1, 20, LOADOUT, "lobby", 0, inventory]), false);
  assert.ok(isEntry([1, 20, LOADOUT, "match-1", 1, chosen()]));
  assert.ok(isEntry([1, 20, BEGIN_LOADOUT, "match-1", 1]));
  assert.equal(isEntry([1, 20, BEGIN_LOADOUT, "match-1", 0]), false);
  assert.equal(
    isEntry([1, 1, JOIN, "constructor", "Ada", 0, "robot", 1]),
    false,
  );
});

test("brief fire and weapon taps survive every native physics phase, including match startup", () => {
  for (let phase = 0; phase < 11; phase++) {
    const room = humans();
    for (let i = 0; i < phase; i++) fold(room);
    const before = room.world!.nextId;
    fold(room, {
      b: [
        [PLAY, room.matchId, 1, NEXT | FIRE],
        [PLAY, room.matchId, 1, 0],
      ],
    });
    // Some 10ms outer frames have no due 11ms native physics pulse.
    for (let i = 0; i < 2 && room.pendingPressed.b; i++) fold(room);
    const worm = room.world!.worms.find((candidate) => candidate.id === "b")!;
    assert.equal(
      worm.weapon,
      1,
      `phase ${phase}: weapon tap consumed exactly once`,
    );
    assert.ok(
      room.world!.nextId > before || room.world!.pendingShots.length > 0,
      `phase ${phase}: fire tap reaches native simulation`,
    );
    assert.equal(room.held.b, undefined);
    for (let i = 0; i < 2; i++) fold(room);
    assert.equal(worm.input, 0);
  }
  const room = createRoom("lobby", DEFAULT_SETTINGS);
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "robot", 1],
      [JOIN, "b", "Bo", 1, "cat", 1],
    ],
  });
  fold(room, {
    a: [[ACTION, "start", "match-1"]],
    b: [
      [PLAY, "match-1", 1, NEXT | FIRE],
      [PLAY, "match-1", 1, 0],
    ],
  });
  const recovered = decode(encode(room), room.tick);
  assert.ok(recovered, "pending startup controls are checkpointed");
  assert.equal(hash(recovered), hash(room));
  for (let i = 0; i < 3; i++) {
    fold(room);
    fold(recovered);
    assert.equal(hash(recovered), hash(room));
  }
  assert.equal(room.world!.worms.find((worm) => worm.id === "b")!.weapon, 1);
  assert.ok(
    room.world!.nextId > 1 || room.world!.pendingShots.length > 0,
    "first match tick consumes brief controls after skipped initial outer frames",
  );
});

test("release and repress remain distinct across skipped physics pulses and within one input tick", () => {
  for (const sameTick of [false, true]) {
    const room = humans(),
      world = room.world!,
      worm = world.worms.find((worm) => worm.id === "b")!;
    fold(room, { b: [[PLAY, room.matchId, 1, NEXT]] });
    while (room.pendingPressed.b) fold(room);
    assert.equal(worm.weapon, 1);
    while (world.lastClientPhysicsMs + PHYSICS_MS <= world.elapsedMs)
      fold(room);
    const physics = world.lastClientPhysicsMs;
    fold(room, {
      b: [
        [PLAY, room.matchId, 1, 0],
        ...(sameTick
          ? [
              [PLAY, room.matchId, 1, NEXT],
              [PLAY, room.matchId, 1, 0],
            ]
          : []),
      ],
    });
    assert.equal(
      world.lastClientPhysicsMs,
      physics,
      "release arrived in an outer frame without physics",
    );
    const recovered = decode(encode(room), room.tick);
    assert.ok(recovered);
    const controls: Bodies = sameTick
      ? {}
      : { b: [[PLAY, room.matchId, 1, NEXT]] };
    fold(room, controls);
    fold(recovered, controls);
    assert.equal(
      worm.weapon,
      2,
      "a fresh press survives the previous sampled held bit",
    );
    assert.equal(hash(room), hash(recovered));
  }
});

test("adding another held control cannot manufacture a second weapon press across an unsampled release", () => {
  const room = humans(),
    world = room.world!,
    worm = world.worms.find((worm) => worm.id === "b")!;
  fold(room, { b: [[PLAY, room.matchId, 1, NEXT]] });
  while (room.pendingPressed.b) fold(room);
  while (world.lastClientPhysicsMs + PHYSICS_MS <= world.elapsedMs) fold(room);
  const physics = world.lastClientPhysicsMs;
  fold(room, { b: [[PLAY, room.matchId, 1, NEXT | FIRE]] });
  assert.equal(world.lastClientPhysicsMs, physics);
  assert.equal(
    room.pendingPressed.b,
    FIRE,
    "only the newly pressed fire bit is pending",
  );
  fold(room, { b: [[PLAY, room.matchId, 1, FIRE]] });
  assert.equal(worm.weapon, 1, "releasing NEXT does not cycle weapons again");
});

test("a returning connection cannot inherit a previous generation's held or unsampled brief controls", () => {
  for (const release of [true, false]) {
    const room = createRoom("lobby", DEFAULT_SETTINGS);
    fold(room, {
      a: [
        [JOIN, "a", "Ada", 0, "robot", 1],
        [JOIN, "b", "Bo", 1, "cat", 1],
      ],
    });
    fold(room, {
      a: [[ACTION, "start", "match-1"]],
      b: [
        [PLAY, "match-1", 1, NEXT | FIRE],
        ...(release ? [[PLAY, "match-1", 1, 0]] : []),
      ],
    });
    assert.equal(room.pendingPressed.b, NEXT | FIRE);
    fold(room, { a: [[PRESENCE, "b", true, 2]] });
    assert.equal(room.seats.get("b")?.generation, 2);
    assert.equal(room.held.b, undefined);
    assert.equal(room.pendingPressed.b, undefined);
    for (let i = 0; i < 3; i++) fold(room);
    assert.equal(room.world!.worms.find((worm) => worm.id === "b")!.weapon, 0);
    assert.equal(room.world!.nextId, 1);
  }
});

test("brief absence cancels sampled edge history even before a physics pulse or generation change", () => {
  const room = humans(),
    world = room.world!,
    worm = world.worms.find((worm) => worm.id === "b")!;
  fold(room, { b: [[PLAY, room.matchId, 1, NEXT]] });
  while (room.pendingPressed.b) fold(room);
  while (world.lastClientPhysicsMs + PHYSICS_MS <= world.elapsedMs) fold(room);
  const physics = world.lastClientPhysicsMs;
  fold(room, { a: [[PRESENCE, "b", false, 1]] });
  assert.equal(world.lastClientPhysicsMs, physics);
  assert.equal(worm.input, 0);
  fold(room, {
    a: [[PRESENCE, "b", true, 1]],
    b: [[PLAY, room.matchId, 1, NEXT]],
  });
  assert.equal(worm.weapon, 2);
});

test("a new connection's first press is not suppressed by the previous generation's sampled key history", () => {
  const room = humans(),
    worm = room.world!.worms.find((worm) => worm.id === "b")!;
  fold(room, { b: [[PLAY, room.matchId, 1, NEXT]] });
  while (room.pendingPressed.b) fold(room);
  assert.equal(worm.weapon, 1);
  const tick = room.tick + 1;
  foldTick(
    room,
    "a",
    new Map<string, StreamEntries<Entry>>([
      ["a", { generation: 1, entries: [[1, tick, PRESENCE, "b", true, 2]] }],
      [
        "b",
        { generation: 2, entries: [[1, tick, PLAY, room.matchId, 1, NEXT]] },
      ],
    ]),
  );
  while (room.pendingPressed.b) fold(room);
  assert.equal(worm.weapon, 2);
});

test("native live weapon selection blocks controls while passive physics continues and confirmation is owner-scoped", () => {
  const room = humans(),
    world = room.world!,
    worm = world.worms.find((candidate) => candidate.id === "b")!;
  fold(room, { b: [[BEGIN_LOADOUT, "stale", 1]] });
  fold(room, { b: [[BEGIN_LOADOUT, room.matchId, 1]] }, 2);
  fold(room, { viewer: [[BEGIN_LOADOUT, room.matchId, 1]] });
  assert.equal(worm.weaponsReady, true);
  worm.vx = Math.fround(8);
  worm.vy = Math.fround(-3);
  worm.health = 70;
  worm.weapon = 3;
  for (const slot of worm.slots) {
    slot.charge = Math.fround(0.25);
    slot.reloading = true;
    slot.lastFire = Math.fround(0.1);
  }
  const expected = structuredClone(world),
    expectedWorm = expected.worms.find((candidate) => candidate.id === "b")!;
  for (let frame = 0; frame < stepsPerTick(); frame++)
    stepWorld(expected, new Map());
  const before = world.nextId;
  fold(room, {
    b: [
      [PLAY, room.matchId, 1, FIRE],
      [BEGIN_LOADOUT, room.matchId, 1],
      [PLAY, room.matchId, 1, FIRE],
    ],
  });
  assert.equal(worm.weaponsReady, false);
  assert.equal(worm.input, 0);
  assert.equal(worm.weapon, 0);
  assert.equal(worm.health, 70);
  assert.equal(world.nextId, before, "selecting suppresses held fire");
  assert.deepEqual(
    [worm.x, worm.y, worm.vx, worm.vy],
    [expectedWorm.x, expectedWorm.y, expectedWorm.vx, expectedWorm.vy],
  );
  assert.ok(
    worm.slots.every(
      (slot) => slot.charge === 1 && !slot.reloading && slot.lastFire === 0,
    ),
  );
  assert.ok(
    decode(encode(room), room.tick),
    "selecting world remains recoverable",
  );
  const inventory = chosen();
  fold(room, { a: [[LOADOUT, room.matchId, 1, inventory]] });
  assert.equal(
    worm.weaponsReady,
    false,
    "another owner cannot confirm this worm",
  );
  fold(room, { b: [[LOADOUT, "stale", 1, inventory]] });
  assert.equal(worm.weaponsReady, false);
  fold(room, {
    b: [
      [PLAY, room.matchId, 1, FIRE],
      [LOADOUT, room.matchId, 1, inventory],
    ],
  });
  assert.equal(worm.weaponsReady, true);
  assert.equal(worm.input, 0);
  assert.equal(worm.weapon, 0);
  assert.deepEqual(
    worm.slots.map((slot) => slot.weaponId),
    inventory,
  );
  assert.equal(worm.health, 70);
  assert.equal(room.held.b, undefined);
});

test("a dead worm may change weapons without spawning or restoring health", () => {
  const room = humans(),
    world = room.world!,
    worm = world.worms.find((candidate) => candidate.id === "b")!;
  assert.equal(recordInjury(world, "b", 101, "a", world.settings).killed, true);
  fold(room, { b: [[BEGIN_LOADOUT, room.matchId, 1]] });
  assert.equal(worm.alive, false);
  assert.equal(worm.health, 0);
  assert.equal(worm.weaponsReady, false);
  assert.ok(decode(encode(room), room.tick));
  fold(room, { b: [[LOADOUT, room.matchId, 1, chosen()]] });
  assert.equal(worm.alive, false);
  assert.equal(worm.health, 0);
  assert.equal(worm.weaponsReady, true);
});

test("10ms Fuse input ticks run one native outer frame while checkpoints retain native physics clocks", () => {
  const room = started();
  for (let i = 0; i < 55; i++) {
    const before = room.simulationTick,
      budget = stepsPerTick();
    assert.equal(budget, 1);
    assert.equal(fuseroGame.tickMs, OUTER_MS);
    fold(room);
    assert.equal(room.simulationTick - before, budget);
    assert.equal(room.simulationTick, (room.tick * LOG_TICK_MS) / OUTER_MS);
    assert.equal(room.world!.lastClientPhysicsMs % PHYSICS_MS, 0);
    assert.ok(room.world!.lastClientPhysicsMs <= room.world!.elapsedMs);
  }
  const recovered = decode(structuredClone(encode(room)), room.tick);
  assert.ok(recovered);
  for (let i = 0; i < 50; i++) {
    fold(room);
    fold(recovered);
    assert.equal(hash(room), hash(recovered));
  }
  assert.equal(room.world!.elapsedMs, room.world!.step * OUTER_MS);
  assert.equal(
    recovered.world!.lastClientPhysicsMs,
    room.world!.lastClientPhysicsMs,
  );
});

test("loadout selections are owner-only, generation-fenced, lobby-scoped and restriction-checked", () => {
  const room = lobby(),
    inventory = chosen();
  const first = inventory[0]!;
  const duplicate: Loadout = [first, first, first, first, first];
  fold(room, {
    a: [[LOADOUT, room.matchId, 0, duplicate]],
    b: [[LOADOUT, room.matchId, 0, inventory]],
  });
  assert.deepEqual(
    room.loadouts.a,
    duplicate,
    "manual duplicates are native-valid",
  );
  assert.deepEqual(room.loadouts.b, inventory);
  fold(room, { a: [[LOADOUT, "stale", 0, inventory]] });
  fold(room, { a: [[LOADOUT, room.matchId, 0, inventory]] }, 2);
  fold(room, { viewer: [[LOADOUT, room.matchId, 0, inventory]] });
  assert.deepEqual(room.loadouts.a, duplicate);
  assert.equal(room.loadouts.viewer, undefined);
  const banned = Array.from({ length: 38 }, (_, id) => id).find(
    (id) => !allowedWeaponIds(room.settings).includes(id),
  )!;
  fold(room, {
    b: [[LOADOUT, room.matchId, 0, [banned, banned, banned, banned, banned]]],
  });
  assert.deepEqual(room.loadouts.b, inventory);
  fold(room, { a: [[SPECTATOR, "join", "watcher", "Watcher", 1]] });
  assert.equal(room.seats.get("watcher")?.watcher, true);
  fold(room, { watcher: [[LOADOUT, room.matchId, 0, inventory]] });
  assert.equal(room.loadouts.watcher, undefined);
  fold(room, { a: [[ACTION, "start", "match-1"]] });
  assert.equal(room.round, 1);
  assert.equal(room.world!.phase, "play");
  assert.deepEqual(
    room
      .world!.worms.find((w) => w.id === "a")!
      .slots.map((slot) => slot.weaponId),
    duplicate,
  );
  fold(room, { a: [[LOADOUT, room.matchId, 0, inventory]] });
  assert.deepEqual(
    room.loadouts.a,
    duplicate,
    "running inventories cannot be changed by lobby messages",
  );
});

test("source random selection is seeded, restriction-safe and retained through recovery", () => {
  for (const restrictionPreset of ["all", "standard-100lt"] as const) {
    const settings = {
      ...DEFAULT_SETTINGS,
      restrictionPreset,
      loadingTime: 50,
    };
    for (let seed = 0; seed < 30; seed++) {
      const create = () =>
        createClassicWorld(
          seed,
          [{ id: "bot:1", slot: 0, bot: true }],
          settings,
        );
      const result = create().worms[0]!.slots.map((slot) => slot.weaponId);
      assert.ok(validLoadout(result, settings));
      assert.equal(new Set(result).size, 5);
      assert.deepEqual(
        create().worms[0]!.slots.map((slot) => slot.weaponId),
        result,
      );
    }
  }
  const room = started(),
    recovered = decode(encode(room), room.tick);
  const first = allowedWeaponIds(DEFAULT_SETTINGS)[0]!;
  assert.deepEqual(
    room.loadouts.a,
    [first, first, first, first, first],
    "absent human profiles use the native fallback slots",
  );
  assert.ok(recovered);
  assert.deepEqual(recovered.loadouts, room.loadouts);
});

test("running checkpoints bind native AI to a live bot seat while finished results retain departed actors", () => {
  const room = started(),
    before = hash(room);
  const missing = structuredClone(room);
  missing.seats.delete("bot:1");
  delete missing.loadouts["bot:1"];
  assert.equal(decode(encode(missing), missing.tick), undefined);
  const wrongRole = structuredClone(room);
  wrongRole.world!.worms.find((worm) => worm.id === "bot:1")!.ai = null;
  assert.equal(decode(encode(wrongRole), wrongRole.tick), undefined);
  assert.equal(
    hash(room),
    before,
    "rejected recovery leaves the healthy controller untouched",
  );
  missing.stage = "over";
  missing.world!.phase = "done";
  missing.world!.winner = "a";
  missing.world!.worms.find((worm) => worm.id === "a")!.kills = 15;
  assert.ok(
    decode(encode(missing), missing.tick),
    "finished results may retain removed actor seats",
  );
});

test("switching restrictions prunes invalid lobby inventories without changing a running match", () => {
  const settings = { ...DEFAULT_SETTINGS, restrictionPreset: "all" as const },
    room = lobby(settings);
  const banned = Array.from({ length: 38 }, (_, id) => id).find(
    (id) => !allowedWeaponIds(DEFAULT_SETTINGS).includes(id),
  )!;
  fold(room, {
    b: [[LOADOUT, room.matchId, 0, [banned, banned, banned, banned, banned]]],
  });
  assert.ok(room.loadouts.b);
  fold(room, { a: [[SETTINGS, { ...DEFAULT_SETTINGS }]] });
  assert.equal(room.loadouts.b, undefined);
  fold(room, { a: [[ACTION, "start", "match-1"]] });
  const before = structuredClone(room.world!.settings);
  fold(room, { a: [[SETTINGS, settings]] });
  assert.deepEqual(room.world!.settings, before);
  assert.ok(decode(encode(room), room.tick));
});

test("held controls ignore stale scope and generation, and disconnect releases movement and fire", () => {
  const room = started();
  fold(room, { b: [[PLAY, room.matchId, room.round, RIGHT | FIRE]] });
  assert.equal(room.held.b, RIGHT | FIRE);
  fold(room, { b: [[PLAY, "old", room.round, LEFT]] });
  fold(room, { b: [[PLAY, room.matchId, 2, LEFT]] });
  fold(room, { b: [[PLAY, room.matchId, 1, LEFT]] }, 2);
  assert.equal(room.held.b, RIGHT | FIRE);
  fold(room, { a: [[PRESENCE, "b", false, 1]] });
  assert.equal(room.held.b, undefined);
  fold(room, { a: [[PRESENCE, "b", true, 1]] });
  assert.equal(room.held.b, undefined);
});

test("one native deathmatch ends without invented rounds; rematch resets its world", () => {
  const room = started({ ...DEFAULT_SETTINGS, timeLimitMs: 500 });
  assert.equal(room.stage, "running");
  assert.equal(room.round, 1);
  assert.equal(room.world!.phase, "play");
  for (let i = 0; i < 60 && fuseroGame.stage(room) !== "over"; i++) fold(room);
  assert.equal(room.stage, "over");
  assert.equal(room.round, 1);
  assert.equal(room.world!.phase, "done");
  assert.ok(decode(encode(room), room.tick));
  const previousSeed = room.world!.seed;
  fold(room, { a: [[ACTION, "rematch", "match-2"]] });
  assert.equal(room.stage, "running");
  assert.equal(room.round, 1);
  assert.equal(room.winner, "");
  assert.notEqual(room.world!.seed, previousSeed);
  assert.ok(room.world!.elapsedMs <= 55);
  assert.ok(decode(encode(room), room.tick));
});

test("room checkpoints reject invalid phase, inventories and clocks without modifying healthy state", () => {
  const room = started();
  for (let i = 0; i < 30; i++) fold(room);
  const before = hash(room);
  const bad = (change: (fields: unknown[]) => void) => {
    const fields = structuredClone(encode(room));
    change(fields);
    assert.equal(decode(fields, room.tick), undefined);
    assert.equal(hash(room), before);
  };
  bad((fields) => {
    fields[9] = room.simulationTick + 1;
  });
  bad((fields) => {
    fields[10] = 11;
  });
  bad((fields) => {
    fields[9] = Math.floor((room.tick * LOG_TICK_MS) / PHYSICS_MS);
  });
  bad((fields) => {
    fields[6] = [["nobody", FIRE]];
  });
  for (const pending of [
    [["nobody", FIRE]],
    [["bot:1", FIRE]],
    [["a", 0]],
    [["a", 131072]],
    [
      ["a", FIRE],
      ["a", FIRE],
    ],
  ])
    bad((fields) => {
      fields[10] = pending;
    });
  bad((fields) => {
    fields[7] = [["constructor", chosen()]];
  });
  bad((fields) => {
    fields[8] = { phase: "play" };
  });
  bad((fields) => {
    fields[1] = 2;
  });
  bad((fields) => {
    fields[2] = "between";
  });
  bad((fields) => {
    fields[7] = [["a", [38, 38, 38, 38, 38]]];
  });
});

function replica(self = "a") {
  const world = new World(
      fuseroGame,
      createRoom("lobby", DEFAULT_SETTINGS),
      "a",
      self,
    ),
    host = world.stream("a", 1);
  world.stream("b", 1);
  host.append(1, [JOIN, "a", "Ada", 0, "robot", 1]);
  host.append(1, [JOIN, "b", "Bo", 1, "cat", 1]);
  host.append(2, [ACTION, "start", "match-1"]);
  host.through = 180;
  return world;
}
test("late, duplicated and reordered controls converge across outer frames and native physics clocks", () => {
  const entries: Entry[] = Array.from({ length: 16 }, (_, i) => [
    i + 1,
    10 + i * 7,
    PLAY,
    "match-1",
    1,
    i % 3 === 0 ? FIRE | RIGHT : i % 3 === 1 ? LEFT : 0,
  ]);
  const whole = replica(),
    late = replica("b");
  for (let i = 0; i < entries.length; i += 6) {
    const batch = entries.slice(i, i + 6);
    whole.receive("b", batch, i + batch.length, batch.at(-1)![1], 0);
  }
  whole.receive("b", [], entries.length, 180, 0);
  whole.advance(180);
  for (let i = 1; i < entries.length; i += 2) {
    const entry = entries[i]!;
    late.advance(entry[1] + 10);
    late.receive("b", [entry], i + 1, entry[1], late.tick);
    late.receive("b", [entry], i + 1, entry[1], late.tick);
    late.receive("b", [entries[i - 1]!], i + 1, entry[1], late.tick);
  }
  late.receive("b", [], entries.length, 180, late.tick);
  late.advance(180);
  assert.ok(late.rollbacks > 0);
  assert.equal(hash(late.state), hash(whole.state));
  assert.equal(late.state.simulationTick, whole.state.simulationTick);
  assert.equal(
    late.state.world!.lastClientPhysicsMs,
    whole.state.world!.lastClientPhysicsMs,
  );
  const recovered = decode(encode(late.state), late.tick);
  assert.ok(recovered);
  assert.equal(hash(recovered), hash(whole.state));
});

test("a full native world travels through Fuse's bounded snapshot chunks and restores the native clock", () => {
  const world = replica();
  world.receive("b", [], 0, 180, 0);
  world.advance(180);
  const chunks = encodeSnapshot(world, 17),
    assembler = new SnapshotAssembler(fuseroGame, 17);
  let complete: ReturnType<SnapshotAssembler["accept"]>;
  for (const chunk of chunks) complete = assembler.accept(chunk);
  assert.ok(complete);
  assert.ok(complete.bytes.byteLength <= 2_600_000);
  const recovered = decodeSnapshot(fuseroGame, complete.bytes, 17);
  assert.ok(recovered);
  assert.equal(hash(recovered.state), hash(world.servable().state));
  assert.equal(recovered.state.simulationTick, recovered.state.tick);
  assert.equal(
    recovered.state.world?.lastClientPhysicsMs,
    world.servable().state.world?.lastClientPhysicsMs,
  );
  assert.ok(recovered.state.world);
});

class ControlsRuntime extends FuseroRuntime {
  release(): void {
    this.releaseControls();
  }
  resync(): void {
    this.resetControls();
  }
}
test("runtime submits lobby inventories, rejects live changes and releases controls through typed dependencies", () => {
  let now = 0,
    loop = () => {};
  const runtime = new ControlsRuntime(
    "ABCD",
    DEFAULT_SETTINGS,
    { state: () => {}, event: () => {}, status: () => {}, ready: () => {} },
    {
      dependencies: {
        now: () => now,
        hidden: () => false,
        token: () => `match-${now}`,
        generation: () => 1,
        schedule: (callback) => {
          loop = callback;
          return () => {};
        },
        onVisibilityChange: () => () => {},
      },
      transport: (events) => {
        const transport: RoomTransport = {
          id: "a",
          hostId: "a",
          sentBytes: 0,
          connect: () => events.welcome("a", "a"),
          close: () => {},
          send: () => true,
          sendFast: () => true,
          linked: () => false,
          explain: () => "test",
          stats: async () => ({ direct: 0, relayed: 0, buffered: 0 }),
        };
        return transport;
      },
    },
  );
  const run = (ms: number) => {
    for (let i = 0; i < ms; i += 10) {
      now += 10;
      loop();
      runtime.flush();
    }
  };
  runtime.start();
  run(100);
  assert.equal(
    runtime.loadout(chosen()),
    false,
    "unseated viewers cannot select weapons",
  );
  assert.ok(runtime.command({ type: "join", name: "Ada" }));
  run(200);
  assert.equal(runtime.loadout(chosen()), true);
  run(200);
  assert.deepEqual(runtime.roomState()!.loadouts.a, chosen());
  assert.ok(runtime.command({ type: "action", action: "start" }));
  run(200);
  assert.equal(runtime.loadout(chosen()), false);
  assert.equal(runtime.beginLoadout(), true);
  run(100);
  assert.equal(
    runtime.roomState()!.world!.worms.find((worm) => worm.id === "a")!
      .weaponsReady,
    false,
  );
  assert.equal(runtime.loadout(chosen()), true);
  run(100);
  assert.equal(
    runtime.roomState()!.world!.worms.find((worm) => worm.id === "a")!
      .weaponsReady,
    true,
  );
  runtime.input(FIRE | RIGHT);
  assert.equal(runtime.heldNow, FIRE | RIGHT);
  run(100);
  assert.equal(runtime.roomState()!.held.a, FIRE | RIGHT);
  runtime.resync();
  runtime.flush();
  runtime.release();
  assert.equal(runtime.heldNow, 0);
  run(100);
  assert.equal(Object.hasOwn(runtime.roomState()!.held, "a"), false);
  runtime.input(-1);
  assert.equal(runtime.heldNow, 0);
  runtime.stop();
});
