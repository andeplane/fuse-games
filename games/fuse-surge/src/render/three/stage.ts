import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { registerPlaytestCapture } from "fuse-ui/playtest-input";
import type { WorldView } from "../../engine/view.js";
import { STEPS_PER_SECOND } from "../../engine/view-kit.js";
import { createCueWatch, type Cue } from "../cues.js";
import { createHud, type Hint, type HudSkin, type Tag } from "../hud.js";
import type { Theme } from "../looks.js";
import { laneColor, laneLight } from "../palette.js";
import type { Scene, SceneCanvas, SceneOptions } from "../scene.js";
import { UNIT, frame, laneZ, type Vec3, type Window } from "../stage-kit.js";
import { buildRider, type RiderActor } from "./actors.js";
import {
  buildSurges,
  buildWarden,
  type SurgeCrew,
  type Warden,
} from "./surges.js";
import { box, release, tint } from "./kit.js";
import { ARCH_X, PIT_Y, buildSet, type StageSet } from "./set.js";

/**
 * A match drawn in 3D: the look's set, a figure for every rider, a model for every surge, sparks, and the flat
 * layer of names and scores over it. Like the 2D picture it runs no loop, timer or physics of its own: the app calls
 * `draw` with the view to show and the wall clock, and nothing here feeds back into the match.
 */
export interface Stage3d extends Scene {
  /** Rebuilds the world in another look, keeping the canvas and its GPU context. */
  setTheme(theme: Theme): void;
}
export interface StageOptions extends SceneOptions {
  /** Without the board the picture fills the canvas and shows no scores (the menu's demo). */
  board?: boolean;
  /** The GPU took the canvas's context away (a backgrounded phone, a driver reset): nothing more can be drawn on it. */
  onContextLost?: () => void;
}
/** The canvas the world is drawn on: a real one, since WebGL needs it. */
export type GlCanvas = HTMLCanvasElement;

const MAX_RATIO = 2,
  FOV = 40,
  /** The camera looks from the front, a little above and from the pit's side. */
  YAW = 0.3,
  PITCH = 0.52,
  TARGET: Vec3 = [4.6, 0.6, 0];
/** What the picture must always hold: the deck from the pit to the arch, and the height of a jump. */
const HOLD: readonly Vec3[] = [
  [-1.1, 0, 2.9],
  [-1.1, 0, -2.9],
  [-0.2, -0.5, 2.9],
  [ARCH_X + 0.3, 0, 2.9],
  [ARCH_X + 0.3, 0, -2.9],
  [ARCH_X, 2.5, -2.9],
  // A double jump lifts a rider's feet to about 2.6 and its head a body higher.
  [0.4, 3.3, -2.6],
  [6.2, 3.3, -2.6],
];
const WITH_BOARD: Window = { left: -0.97, right: 0.97, bottom: -0.7, top: 0.8 },
  BARE: Window = { left: -0.8, right: 0.8, bottom: -0.75, top: 0.75 };
const SPARKS = 320;

export const skinOf = (theme: Theme): HudSkin => ({
  low: theme.low.color,
  high: theme.high.color,
  tall: theme.tall,
  flip: theme.flip,
  accent: theme.deck.trim,
});

export function createStage3d(
  canvas: GlCanvas,
  overlay: SceneCanvas,
  initial: Theme,
  options: StageOptions = {},
): Stage3d {
  const doc = canvas.ownerDocument;
  const random = options.random ?? Math.random;
  const ratio =
    options.pixelRatio ??
    (() => (typeof devicePixelRatio === "number" ? devicePixelRatio : 1));
  const calm = options.reducedMotion === true;
  const window_ = options.board === false ? BARE : WITH_BOARD;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.5, 400);
  const hud = createHud(overlay, skinOf(initial), {
    pixelRatio: ratio,
    reducedMotion: calm,
    board: options.board !== false,
  });
  const back: Vec3 = [
    -Math.sin(YAW) * Math.cos(PITCH),
    Math.sin(PITCH),
    Math.cos(YAW) * Math.cos(PITCH),
  ];
  const side = Math.hypot(back[2], back[0]);
  const right: Vec3 = [back[2] / side, 0, -back[0] / side];
  const up: Vec3 = [
    back[1] * right[2] - back[2] * right[1],
    back[2] * right[0] - back[0] * right[2],
    back[0] * right[1] - back[1] * right[0],
  ];
  const held = HOLD.map((point): Vec3 => [
    point[0] - TARGET[0],
    point[1] - TARGET[1],
    point[2] - TARGET[2],
  ]);
  const eye = new THREE.Vector3(),
    aim = new THREE.Vector3();

  // ---- the world of one look ----
  let theme = initial;
  let scene = new THREE.Scene();
  let set: StageSet;
  let surges: SurgeCrew;
  let warden: Warden;
  let riders: RiderActor[] = [];
  let composer: EffectComposer | undefined;
  /** The post chain's passes: the composer frees its own targets, not theirs. */
  let passes: (RenderPass | UnrealBloomPass | OutputPass)[] = [];
  const dropComposer = () => {
    for (const pass of passes) pass.dispose();
    passes = [];
    composer?.dispose();
    composer = undefined;
  };
  let sparks: THREE.InstancedMesh;
  const flying: {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    gravity: number;
    life: number;
    ms: number;
    size: number;
    spin: number;
  }[] = [];
  /** Sparks still in the air, and whether the last frame had any (their last matrices still need sending). */
  let nextSpark = 0,
    alive = 0,
    settling = false;
  const placing = new THREE.Object3D();
  let box_ = { w: -1, h: -1, r: -1 };

  const build = () => {
    scene = new THREE.Scene();
    set = buildSet(theme, doc);
    scene.fog = set.fog;
    scene.add(set.group);
    surges = buildSurges(theme, doc);
    scene.add(surges.group);
    warden = buildWarden(theme);
    scene.add(warden.group);
    riders = [];
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    material.toneMapped = false;
    sparks = new THREE.InstancedMesh(box(1, 1, 1), material, SPARKS);
    sparks.frustumCulled = false;
    sparks.setColorAt(0, new THREE.Color(0xffffff));
    flying.length = 0;
    alive = 0;
    for (let i = 0; i < SPARKS; i++) {
      placing.scale.setScalar(0);
      placing.updateMatrix();
      sparks.setMatrixAt(i, placing.matrix);
    }
    scene.add(sparks);
    renderer.toneMapping =
      theme.tone === "aces"
        ? THREE.ACESFilmicToneMapping
        : THREE.NeutralToneMapping;
    renderer.toneMappingExposure = theme.exposure;
    dropComposer();
    if (theme.bloom > 0) {
      const target = new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType,
        samples: 4,
      });
      composer = new EffectComposer(renderer, target);
      passes = [
        new RenderPass(scene, camera),
        new UnrealBloomPass(new THREE.Vector2(1, 1), theme.bloom, 0.45, 1),
        new OutputPass(),
      ];
      for (const pass of passes) composer.addPass(pass);
    }
    hud.setSkin(skinOf(theme));
    box_ = { w: -1, h: -1, r: -1 };
  };
  const demolish = () => {
    release(scene);
    scene.clear();
  };

  const resize = () => {
    const r = Math.min(MAX_RATIO, Math.max(1, ratio())),
      w = canvas.clientWidth,
      h = canvas.clientHeight;
    hud.resize();
    if (box_.w === w && box_.h === h && box_.r === r) return;
    if (w < 1 || h < 1) return;
    box_ = { w, h, r };
    renderer.setPixelRatio(r);
    renderer.setSize(w, h, false);
    composer?.setPixelRatio(r);
    composer?.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const fit = frame(
      held,
      { right, up, back },
      Math.tan((FOV * Math.PI) / 360),
      camera.aspect,
      window_,
    );
    aim.set(
      TARGET[0] + right[0] * fit.right + up[0] * fit.up,
      TARGET[1] + right[1] * fit.right + up[1] * fit.up,
      TARGET[2] + right[2] * fit.right + up[2] * fit.up,
    );
    eye.set(
      aim.x + back[0] * fit.distance,
      aim.y + back[1] * fit.distance,
      aim.z + back[2] * fit.distance,
    );
  };

  const burst = (
    x: number,
    y: number,
    z: number,
    count: number,
    color: string,
    speed: number,
    lift = 0,
    gravity = 9,
    size = 0.05,
  ) => {
    const paint = tint(color).multiplyScalar(theme.bloom > 0 ? 1.8 : 1);
    for (let i = 0; i < count; i++) {
      const turn = random() * Math.PI * 2,
        tilt = (random() - 0.5) * Math.PI,
        v = speed * (0.35 + random() * 0.65);
      const index = nextSpark++ % SPARKS;
      const before = flying[index];
      if (!before || before.life >= before.ms) alive++;
      flying[index] = {
        x,
        y,
        z,
        vx: Math.cos(turn) * Math.cos(tilt) * v,
        vy: Math.sin(tilt) * v + lift,
        vz: Math.sin(turn) * Math.cos(tilt) * v,
        gravity,
        life: 0,
        ms: 300 + random() * 450,
        size: size * (0.6 + random() * 0.8),
        spin: random() * 6,
      };
      sparks.setColorAt(index, paint);
    }
    if (sparks.instanceColor) sparks.instanceColor.needsUpdate = true;
  };

  const watch = createCueWatch();
  let lastNow = -1,
    destroyed = false,
    shake = 0,
    flow = 0,
    live = 0;

  const react = (cues: readonly Cue[], view: WorldView) => {
    const lanes = view.riders.length;
    const at = (slot: number) => {
      const rider = view.riders[slot]!;
      return {
        x: rider.x * UNIT,
        y: Math.max(0, rider.y * UNIT),
        z: laneZ(slot, lanes),
      };
    };
    for (const cue of cues) {
      const actor = "slot" in cue ? riders[cue.slot] : undefined;
      switch (cue.kind) {
        case "land": {
          if (actor) actor.squash = 1;
          const p = at(cue.slot);
          burst(p.x, 0.04, p.z, 6, "#ffffff", 0.9, 0.5, 4, 0.035);
          break;
        }
        case "jump":
          if (actor) actor.squash = -0.8;
          break;
        case "double": {
          // The second jump kicks off thin air: a stretch and a puff where the feet were.
          if (actor) actor.squash = -0.9;
          const p = at(cue.slot);
          burst(p.x, p.y, p.z, 10, "#ffffff", 1.4, -0.6, 2, 0.045);
          break;
        }
        case "volley":
          warden.hurl();
          for (const lane of cue.lanes)
            burst(
              ARCH_X - 0.1,
              0.5,
              laneZ(lane, lanes),
              8,
              theme.danger,
              2,
              0.8,
            );
          break;
        case "hit": {
          const p = at(cue.slot);
          if (actor) actor.flash = 1;
          burst(p.x + 0.1, p.y + 0.45, p.z, 18, "#fff6ea", 3.2, 1);
          burst(p.x + 0.1, p.y + 0.45, p.z, 12, laneColor(cue.slot), 2.4, 0.8);
          if (!calm) shake = Math.max(shake, cue.out ? 0.22 : 0.13);
          break;
        }
        case "recover": {
          const p = at(cue.slot);
          burst(p.x, p.y + 0.3, p.z, 14, theme.flip, 1.6, 1.6, 3);
          break;
        }
        case "dodge":
          if (actor && cue.streak > 0) actor.cheer = 0.4;
          break;
        case "round":
          for (const slot of cue.winners) {
            const winner = riders[slot];
            if (winner) winner.cheer = 1;
          }
          break;
        case "over":
          for (const slot of cue.winners) {
            const winner = riders[slot];
            if (winner) winner.cheer = 1;
            const p = at(slot);
            burst(p.x, p.y + 1, p.z, 46, laneColor(slot), 3.6, 3, 6, 0.07);
            burst(p.x, p.y + 1, p.z, 24, laneLight(slot), 3, 2.6, 6, 0.06);
          }
          break;
        default:
          break;
      }
    }
  };

  const spot = new THREE.Vector3();
  const tags: Tag[] = [],
    hints: Hint[] = [];
  const draw: Scene["draw"] = (view, nowMs, local, names = []) => {
    if (destroyed) return [];
    resize();
    const dtMs = lastNow < 0 ? 0 : Math.min(100, Math.max(0, nowMs - lastNow));
    lastNow = nowMs;
    const cues = watch(view);
    hud.react(cues, view, nowMs, names);
    const lanes = view.riders.length;
    set.layout(lanes, view.maxHits);
    if (riders.length !== lanes) {
      for (const rider of riders) {
        scene.remove(rider.root);
        release(rider.root);
      }
      riders = view.riders.map((_, slot) => {
        const rider = buildRider(slot, theme);
        scene.add(rider.root);
        return rider;
      });
    }
    react(cues, view);
    flow += view.speed * UNIT * (dtMs / 1000) * STEPS_PER_SECOND;
    live +=
      ((view.phase === "play" ? 1 : 0) - live) * Math.min(1, dtMs / 160 || 1);
    surges.show(view, nowMs, live);
    warden.show(view.boss, nowMs, dtMs);
    tags.length = 0;
    for (const each of view.riders) {
      const rider = riders[each.slot]!;
      rider.pose(each, view, nowMs, dtMs, each.slot === local);
      if (rider.splash)
        burst(
          each.x * UNIT,
          PIT_Y + 0.1,
          laneZ(each.slot, lanes),
          30,
          theme.pit.c,
          2.6,
          4.5,
          9,
          0.09,
        );
    }
    // Sparks.
    for (let index = 0; alive > 0 && index < flying.length; index++) {
      const p = flying[index];
      if (!p || p.life >= p.ms) continue;
      p.life += dtMs;
      if (p.life >= p.ms) alive--;
      const dt = dtMs / 1000;
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const left = 1 - p.life / p.ms;
      placing.position.set(p.x, p.y, p.z);
      placing.rotation.set(p.spin + p.life / 90, p.spin, 0);
      placing.scale.setScalar(left > 0 ? p.size * Math.min(1, left * 2) : 0);
      placing.updateMatrix();
      sparks.setMatrixAt(index, placing.matrix);
    }
    if (alive > 0 || settling) sparks.instanceMatrix.needsUpdate = true;
    settling = alive > 0;
    set.update(
      nowMs,
      dtMs,
      flow,
      view.surges.some((surge) => surge.flips),
    );
    // The camera: where the fit put it, shaken by a hit and breathing a little.
    shake = Math.max(0, shake - dtMs / 1400);
    camera.position.copy(eye);
    if (shake > 0)
      camera.position.add(
        spot.set(
          (random() - 0.5) * shake,
          (random() - 0.5) * shake,
          (random() - 0.5) * shake,
        ),
      );
    if (!calm) camera.position.y += Math.sin(nowMs / 2300) * 0.04;
    camera.lookAt(aim);
    if (composer) composer.render();
    else renderer.render(scene, camera);

    // Where the flat layer puts its names and arrows.
    camera.updateMatrixWorld();
    for (const each of view.riders) {
      riders[each.slot]!.crown(spot).project(camera);
      tags.push({ slot: each.slot, x: (spot.x + 1) / 2, y: (1 - spot.y) / 2 });
    }
    hints.length = 0;
    surges.each((surge, near, dim) => {
      spot.copy(near).project(camera);
      hints.push({
        kind: surge.kind,
        flips: surge.flips,
        x: (spot.x + 1) / 2,
        y: (1 - spot.y) / 2,
        dim,
      });
    });
    hud.draw(view, nowMs, local, names, tags, hints);
    return cues;
  };

  // A context taken away cannot be drawn on again here: say so, and whoever owns the picture shows another.
  const lost = (event: Event) => {
    if (destroyed) return;
    event.preventDefault();
    options.onContextLost?.();
  };
  canvas.addEventListener("webglcontextlost", lost);
  const shutDown = () => {
    canvas.removeEventListener("webglcontextlost", lost);
    demolish();
    dropComposer();
    renderer.dispose();
    renderer.forceContextLoss();
  };
  try {
    build();
  } catch (error) {
    // A look that cannot be built must not leave a context behind: the 2D look takes over.
    destroyed = true;
    shutDown();
    throw error;
  }
  const stopPlaytestCapture = registerPlaytestCapture(doc, async () => {
    if (
      destroyed ||
      !canvas.isConnected ||
      renderer.getContext().isContextLost()
    )
      return new Map();
    // Copy the framebuffer in the same turn as the redraw. Capture leaves the
    // match, presentation clock, particles and camera untouched.
    if (composer) composer.render(0);
    else renderer.render(scene, camera);
    return new Map([[canvas, canvas.toDataURL("image/png")]]);
  });
  return {
    resize,
    draw,
    setTheme(next) {
      demolish();
      theme = next;
      build();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopPlaytestCapture();
      shutDown();
    },
  };
}
