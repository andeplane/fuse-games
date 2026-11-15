import test from "node:test";
import assert from "node:assert/strict";
import { toView } from "../src/engine/index.js";
import { HIGH_BOTTOM, STAND_H } from "../src/engine/view-kit.js";
import type { RiderView, WorldView } from "../src/engine/view.js";
import {
  DEFAULT_LOOK,
  LOOKS,
  LOOK_IDS,
  lookFrom,
  lookOf,
  nextLook,
  parseLook,
  type LookId,
  type Theme,
} from "../src/render/looks.js";
import {
  createShow,
  type Layer,
  type Stage,
  type StageFactory,
} from "../src/render/show.js";
import {
  DECK_DEPTH,
  RIDER_SCALE,
  UNIT,
  crownOf,
  easeJoints,
  frame,
  hipOf,
  jointsOf,
  laneZ,
  stanceOf,
  type Stance,
  type Vec3,
} from "../src/render/stage-kit.js";
import { playing } from "./fixtures/world.js";

test("a look is this device's choice: a link's over the browser's, and a name that means nothing is ignored", () => {
  assert.deepEqual(
    LOOKS.map((look) => look.id),
    [...LOOK_IDS],
  );
  assert.equal(new Set(LOOKS.map((look) => look.title)).size, LOOKS.length);
  assert.equal(lookFrom("", null), DEFAULT_LOOK);
  assert.equal(lookFrom("?mute", "forge"), "forge");
  assert.equal(lookFrom("?look=glacier&mute", "forge"), "glacier");
  assert.equal(lookFrom("?look=GLACIER", null), "glacier");
  assert.equal(lookFrom("?look=nope", "toybox"), "toybox");
  assert.equal(lookFrom("?look=nope", "also-nope"), DEFAULT_LOOK);
  for (const junk of [undefined, null, 3, "", "reactor2", {}])
    assert.equal(parseLook(junk), undefined);
  // The button goes round every look and comes back.
  let id: LookId = DEFAULT_LOOK;
  const seen: LookId[] = [];
  for (let i = 0; i < LOOK_IDS.length; i++) {
    seen.push(id);
    id = nextLook(id);
  }
  assert.equal(id, DEFAULT_LOOK);
  assert.deepEqual([...seen].sort(), [...LOOK_IDS].sort());
  // Every look is drawn in 3D but the flat one, and a theme's colours are all colours.
  for (const look of LOOKS) {
    assert.equal(lookOf(look.id), look);
    assert.equal(look.theme === undefined, look.id === "classic", look.id);
    if (!look.theme) continue;
    const colours = JSON.stringify(look.theme).match(/"#[^"]*"/g) ?? [];
    assert.ok(colours.length > 20, look.id);
    for (const colour of colours)
      assert.match(colour, /^"#[0-9a-f]{6}"$/, `${look.id}: ${colour}`);
    assert.ok(look.theme.bloom >= 0 && look.theme.exposure > 0, look.id);
  }
});

const rider = (view: WorldView, patch: Partial<RiderView>): RiderView => ({
  ...view.riders[0]!,
  ...patch,
});

test("a rider's stance is read off the view, and its pose stays inside what the rules strike", () => {
  const view = toView(playing());
  const standing = rider(view, {});
  assert.equal(stanceOf(standing, view), "idle");
  assert.equal(stanceOf(rider(view, { duck: true }), view), "duck");
  const up = { air: true, y: 60 };
  assert.equal(stanceOf(rider(view, { ...up, vy: 9 }), view), "rise");
  assert.equal(stanceOf(rider(view, { ...up, vy: -2 }), view), "fall");
  assert.equal(stanceOf(rider(view, { ...up, vy: -20 }), view), "dive");
  assert.equal(
    stanceOf(rider(view, { reeling: true, duck: true }), view),
    "reel",
  );
  assert.equal(
    stanceOf(rider(view, { out: true, reeling: true }), view),
    "out",
  );
  assert.equal(
    stanceOf(rider(view, { x: standing.foothold + 40 }), view),
    "walk",
  );
  assert.equal(stanceOf(standing, view, true), "win");
  const won: WorldView = { ...view, phase: "break", lastWinners: [0] };
  assert.equal(stanceOf(standing, won), "win");
  assert.equal(stanceOf(rider(view, { slot: 1 }), won), "idle");
  // A finished match stands its survivors on the deck, whatever they were doing when it ended.
  const over: WorldView = { ...view, phase: "over", winners: [1] };
  assert.equal(stanceOf(rider(view, { ...up, vy: 9 }), over), "idle");
  assert.equal(stanceOf(rider(view, { slot: 1, duck: true }), over), "win");

  const stances: Stance[] = [
    "out",
    "reel",
    "rise",
    "fall",
    "dive",
    "duck",
    "win",
    "walk",
    "idle",
  ];
  for (const stance of stances)
    for (const t of [0, 0.37, 1.9, 12.4]) {
      const joints = jointsOf(stance, t, 3);
      for (const value of Object.values(joints))
        assert.ok(Number.isFinite(value), `${stance} at ${t}`);
      assert.ok(hipOf(joints) > 0, stance);
    }
  // Upright it is as tall as the rules say; ducked, it fits under a high surge even drawn larger than life.
  const tall = crownOf(jointsOf("idle", 0));
  assert.ok(Math.abs(tall - STAND_H * UNIT) < 0.03, String(tall));
  assert.ok(tall * RIDER_SCALE > HIGH_BOTTOM * UNIT);
  for (const t of [0, 0.5, 3.3])
    assert.ok(
      crownOf(jointsOf("duck", t)) * RIDER_SCALE < HIGH_BOTTOM * UNIT,
      "a duck shows under the surge it clears",
    );
  // Easing all the way lands on the target; part of the way lands between.
  const from = jointsOf("idle", 0),
    to = jointsOf("duck", 0);
  const half = easeJoints({ ...from }, to, 0.5);
  assert.ok(half.torso > from.torso && half.torso < to.torso);
  const whole = easeJoints({ ...from }, to, 1);
  assert.ok(Math.abs(whole.torso - to.torso) < 1e-9);
  assert.ok(Math.abs(hipOf(whole) - hipOf(to)) < 1e-9);
});

test("lanes run back to front across the deck", () => {
  for (const lanes of [1, 2, 3, 5]) {
    const lines = Array.from({ length: lanes }, (_, slot) =>
      laneZ(slot, lanes),
    );
    for (const [slot, z] of lines.entries()) {
      assert.ok(Math.abs(z) < DECK_DEPTH / 2, `${lanes} lanes`);
      if (slot > 0) assert.ok(z > lines[slot - 1]!, "lane 0 is at the back");
      assert.ok(Math.abs(z + lines[lanes - 1 - slot]!) < 1e-9, "centred");
    }
  }
});

test("the camera stands as near as it can and still holds the whole deck in the window", () => {
  const points: Vec3[] = [
    [-6, 0, 3],
    [-6, 0, -3],
    [6, 0, 3],
    [6, 0, -3],
    [0, 2.5, -3],
    [-5, -0.5, 3],
  ];
  const yaw = 0.3,
    pitch = 0.52;
  const back: Vec3 = [
    -Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(yaw) * Math.cos(pitch),
  ];
  const flat = Math.hypot(back[0], back[2]);
  const right: Vec3 = [back[2] / flat, 0, -back[0] / flat];
  const up: Vec3 = [
    back[1] * right[2] - back[2] * right[1],
    back[2] * right[0] - back[0] * right[2],
    back[0] * right[1] - back[1] * right[0],
  ];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const tanY = Math.tan((40 * Math.PI) / 360);
  for (const aspect of [16 / 9, 4 / 3, 9 / 16]) {
    const window = { left: -0.9, right: 0.95, bottom: -0.7, top: 0.8 };
    const fit = frame(points, { right, up, back }, tanY, aspect, window);
    /** Where a point lands in the picture, −1 to 1, from `distance` with the fit's slide. */
    const spread = (distance: number) => {
      const at = points.map((point) => {
        const depth = distance - dot(point, back);
        return {
          x: (dot(point, right) - fit.right) / (tanY * aspect * depth),
          y: (dot(point, up) - fit.up) / (tanY * depth),
        };
      });
      return {
        left: Math.min(...at.map((p) => p.x)),
        right: Math.max(...at.map((p) => p.x)),
        bottom: Math.min(...at.map((p) => p.y)),
        top: Math.max(...at.map((p) => p.y)),
      };
    };
    const held = spread(fit.distance);
    const slack = 1e-6;
    assert.ok(held.left >= window.left - slack, `${aspect}: left`);
    assert.ok(held.right <= window.right + slack, `${aspect}: right`);
    assert.ok(held.bottom >= window.bottom - slack, `${aspect}: bottom`);
    assert.ok(held.top <= window.top + slack, `${aspect}: top`);
    // It is a tight fit: one pair of edges is touched, and a step closer spills out.
    const wide = held.right - held.left > window.right - window.left - 1e-3,
      high = held.top - held.bottom > window.top - window.bottom - 1e-3;
    assert.ok(wide || high, `${aspect}: touches an edge pair`);
    const closer = spread(fit.distance * 0.97);
    assert.ok(
      closer.right - closer.left > window.right - window.left ||
        closer.top - closer.bottom > window.top - window.bottom,
      `${aspect}: no nearer`,
    );
  }
});

// ---- the picture: which look is on the page ----
interface FakeLayer extends Layer {
  name: string;
  removed: boolean;
}
function page() {
  const layers: FakeLayer[] = [];
  const stages: {
    themes: Theme[];
    draws: number;
    destroyed: boolean;
    /** What the picture gave the renderer to call when the GPU takes its canvas away. */
    loseContext: () => void;
  }[] = [];
  let resolve!: (factory: StageFactory<FakeLayer>) => void,
    reject!: (error: unknown) => void;
  const fetched = new Promise<StageFactory<FakeLayer>>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  let loads = 0,
    broken: unknown;
  const factory: StageFactory<FakeLayer> = (
    _world,
    _overlay,
    theme,
    options,
  ) => {
    if (broken) throw broken;
    const record = {
      themes: [theme],
      draws: 0,
      destroyed: false,
      loseContext: () => options.onContextLost?.(),
    };
    stages.push(record);
    const stage: Stage = {
      resize() {},
      draw() {
        record.draws++;
        return [{ kind: "go", round: 9 }];
      },
      setTheme: (next) => void record.themes.push(next),
      destroy: () => void (record.destroyed = true),
    };
    return stage;
  };
  const fallbacks: LookId[] = [];
  return {
    layers,
    stages,
    fallbacks,
    live: () => layers.filter((layer) => !layer.removed).map((l) => l.name),
    arrive: () => resolve(factory),
    fail: (error: unknown) => reject(error),
    breakFactory: (error: unknown) => (broken = error),
    loads: () => loads,
    options: (look: LookId) => ({
      look,
      layer(name: string): FakeLayer {
        const layer: FakeLayer = {
          name,
          removed: false,
          width: 0,
          height: 0,
          clientWidth: 960,
          clientHeight: 540,
          getContext: () => null,
          remove() {
            layer.removed = true;
          },
        };
        layers.push(layer);
        return layer;
      },
      load() {
        loads++;
        return fetched;
      },
      onFallback: (id: LookId) => void fallbacks.push(id),
    }),
  };
}
const settle = () => new Promise<void>((done) => setImmediate(done));

test("a 3D look is fetched once, shown when it arrives, and rebuilt in place for another look", async () => {
  const fake = page();
  const show = createShow(fake.options("reactor"));
  const view = toView(playing());
  assert.equal(show.look(), "reactor");
  assert.deepEqual(fake.live(), [], "nothing on the page yet");
  // Until the renderer arrives nothing is drawn, but what happens is still heard.
  assert.deepEqual(show.draw(view, 0, 0), []);
  assert.deepEqual(show.draw({ ...view, step: view.step + 1 }, 16, 0), []);
  fake.arrive();
  await settle();
  assert.deepEqual(fake.live(), ["world", "overlay"]);
  assert.equal(fake.stages[0]!.themes[0], lookOf("reactor").theme);
  assert.deepEqual(show.draw(view, 32, 0), [{ kind: "go", round: 9 }]);
  // Another 3D look keeps the canvases and the renderer.
  show.setLook("forge");
  show.setLook("forge");
  assert.deepEqual(fake.stages[0]!.themes, [
    lookOf("reactor").theme,
    lookOf("forge").theme,
  ]);
  assert.equal(fake.stages.length, 1);
  // The flat look takes the 3D one off the page; a 3D look after it starts a new renderer without fetching again.
  show.setLook("classic");
  assert.deepEqual(fake.live(), ["flat"]);
  assert.equal(fake.stages[0]!.destroyed, true);
  assert.deepEqual(show.draw(view, 48, 0), []);
  show.setLook("glacier");
  assert.deepEqual(fake.live(), ["flat"], "the flat picture stays until then");
  await settle();
  assert.deepEqual(fake.live(), ["world", "overlay"]);
  assert.equal(fake.stages.length, 2);
  assert.equal(fake.stages[1]!.themes[0], lookOf("glacier").theme);
  assert.equal(fake.loads(), 1);
  show.destroy();
  show.destroy();
  assert.deepEqual(fake.live(), []);
  assert.equal(fake.stages[1]!.destroyed, true);
  assert.deepEqual(show.draw(view, 64, 0), []);
});

test("a look chosen while the renderer is on its way is the one that is shown", async () => {
  const changed = page();
  const show = createShow(changed.options("reactor"));
  show.setLook("toybox");
  changed.arrive();
  await settle();
  assert.equal(changed.stages.length, 1);
  assert.equal(changed.stages[0]!.themes[0], lookOf("toybox").theme);

  // Back to the flat look before it arrives: the renderer is not started at all.
  const flat = page();
  const other = createShow(flat.options("skyisle"));
  other.setLook("classic");
  flat.arrive();
  await settle();
  assert.deepEqual(flat.live(), ["flat"]);
  assert.equal(flat.stages.length, 0);

  // A page that is gone by then mounts nothing.
  const gone = page();
  createShow(gone.options("skyisle")).destroy();
  gone.arrive();
  await settle();
  assert.deepEqual(gone.live(), []);
  assert.equal(gone.stages.length, 0);
});

test("a device that cannot draw 3D shows the flat look and says so", async () => {
  // The renderer arrives but cannot start (no WebGL).
  const noGl = page();
  noGl.breakFactory(new Error("no webgl"));
  const show = createShow(noGl.options("forge"));
  noGl.arrive();
  await settle();
  assert.equal(show.look(), "classic");
  assert.deepEqual(noGl.fallbacks, ["classic"]);
  assert.deepEqual(noGl.live(), ["flat"], "the 3D canvases are taken back out");
  // The renderer never arrives (the chunk failed to load).
  const offline = page();
  const other = createShow(offline.options("glacier"));
  offline.fail(new Error("offline"));
  await settle();
  assert.equal(other.look(), "classic");
  assert.deepEqual(offline.fallbacks, ["classic"]);
  assert.deepEqual(offline.live(), ["flat"]);
  // The flat look needs no renderer at all.
  const plain = page();
  createShow(plain.options("classic"));
  assert.deepEqual(plain.live(), ["flat"]);
  assert.equal(plain.loads(), 0);
  // Looks changed twice while the fetch was out, and it failed: the page hears of it once.
  const twice = page();
  const waiting = createShow(twice.options("reactor"));
  waiting.setLook("forge");
  waiting.setLook("glacier");
  twice.fail(new Error("offline"));
  await settle();
  assert.deepEqual(twice.fallbacks, ["classic"]);
  assert.deepEqual(twice.live(), ["flat"]);
});

test("a 3D picture whose GPU context is taken away gives way to the flat look", async () => {
  const fake = page();
  const show = createShow(fake.options("toybox"));
  fake.arrive();
  await settle();
  assert.deepEqual(fake.live(), ["world", "overlay"]);
  fake.stages[0]!.loseContext();
  assert.equal(show.look(), "classic");
  assert.deepEqual(fake.fallbacks, ["classic"]);
  assert.equal(fake.stages[0]!.destroyed, true);
  assert.deepEqual(fake.live(), ["flat"]);
  // The context of a picture already taken off the page says nothing more.
  fake.stages[0]!.loseContext();
  assert.deepEqual(fake.fallbacks, ["classic"]);
  // Choosing a 3D look again starts a new renderer.
  show.setLook("toybox");
  await settle();
  assert.deepEqual(fake.live(), ["world", "overlay"]);
  assert.equal(fake.stages.length, 2);
});
