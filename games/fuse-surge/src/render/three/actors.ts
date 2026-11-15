import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { RiderView, SurgeView, WorldView } from "../../engine/view.js";
import { HIGH, HIGH_BOTTOM, LOW_TOP, SPAWN_X } from "../../engine/view-kit.js";
import type { Theme } from "../looks.js";
import { laneColor, laneDeep, laneLight } from "../palette.js";
import {
  DECK_DEPTH,
  FOOT,
  HEAD,
  NECK,
  RIDER_SCALE as BIG,
  SHIN,
  THIGH,
  TORSO,
  UNIT,
  easeJoints,
  hipOf,
  jointsOf,
  laneZ,
  stanceOf,
  type Joints,
} from "../stage-kit.js";
import {
  bar,
  box,
  lamp,
  mesh,
  painted,
  release,
  surface,
  tint,
} from "./kit.js";
import { PIT_Y, RAIL_Z } from "./set.js";

/**
 * The things that move: a jointed figure for every rider and a model for every surge. They are posed from the view
 * each frame and keep nothing of the match; what they remember between frames (a squash, a flash, a tumble) is
 * cosmetic.
 */

// ---- riders ----
export interface RiderActor {
  root: THREE.Group;
  /** A landing (1) or a take-off (−1) to squash for, a hit to flash for, a cheer to hold. */
  squash: number;
  flash: number;
  cheer: number;
  /** True for one frame as a fallen rider goes under the pit's surface. */
  splash: boolean;
  pose(
    each: RiderView,
    view: WorldView,
    nowMs: number,
    dtMs: number,
    local: boolean,
  ): void;
  /** The top of the head in the world, for the name over it. */
  crown(out: THREE.Vector3): THREE.Vector3;
}

export function buildRider(slot: number, theme: Theme): RiderActor {
  const style = theme.rider;
  const base = (color: string) =>
    surface({
      color,
      rough: style.rough,
      metal: style.metal,
      glow: style.glow || 0.0001,
    });
  // The suit is a shade deeper than the helmet, so a bright lamp does not wash the lane's colour out.
  const main = base(laneColor(slot)),
    suit = base(
      `#${tint(laneColor(slot))
        .lerp(tint(laneDeep(slot)), 0.45)
        .getHexString()}`,
    ),
    light = base(laneLight(slot)),
    deep = base(laneDeep(slot));
  const glass = surface({
    color: "#0a1024",
    rough: 0.08,
    metal: 0.6,
    glow: 0.12,
    glowColor: laneColor(slot),
  });
  const spark = lamp("#fff3a8", 2.5);
  const tinted = [main, suit, light, deep];
  const glows = tinted.map((material) => material.emissive.clone());

  const root = new THREE.Group();
  /** Tumbles and squashes about the middle of the body. */
  const body = new THREE.Group();
  const hips = new THREE.Group();
  const torso = new THREE.Group();
  const head = new THREE.Group();
  // A little larger than life, so a rider reads from across the deck; a duck still fits under a high surge.
  root.scale.setScalar(BIG);
  root.add(body);
  body.add(hips);
  hips.add(torso);
  torso.add(
    mesh(new RoundedBoxGeometry(0.24, TORSO, 0.34, 3, 0.08), suit, [
      0,
      TORSO / 2,
      0,
    ]),
    mesh(new RoundedBoxGeometry(0.1, 0.18, 0.22, 2, 0.04), deep, [
      -0.15,
      TORSO * 0.55,
      0,
    ]),
    mesh(box(0.26, 0.05, 0.36), deep, [0, 0.04, 0]),
  );
  head.position.y = TORSO;
  torso.add(head);
  // The body faces the surges; the head is turned toward the camera, so the visor is what you see.
  const face = new THREE.Group();
  face.rotation.y = -0.95;
  const visor = mesh(new THREE.SphereGeometry(HEAD * 0.74, 20, 14), glass, [
    0.08,
    NECK + 0.005,
    0,
  ]);
  visor.scale.set(1, 0.8, 1.2);
  face.add(
    visor,
    mesh(new THREE.SphereGeometry(0.022, 8, 6), lamp("#ffffff"), [
      0.195,
      NECK + 0.05,
      0.06,
    ]),
  );
  head.add(
    mesh(new THREE.SphereGeometry(HEAD, 24, 18), main, [0, NECK, 0]),
    face,
    mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 6), light, [
      -0.04,
      NECK + HEAD + 0.03,
      0,
    ]),
    mesh(
      new THREE.SphereGeometry(0.03, 10, 8),
      spark,
      [-0.04, NECK + HEAD + 0.09, 0],
      "none",
    ),
  );
  const limb = (
    length: number,
    radius: number,
    material: THREE.Material,
  ): THREE.Mesh =>
    mesh(
      new THREE.CapsuleGeometry(radius, Math.max(0.01, length - radius), 4, 10),
      material,
      [0, -length / 2, 0],
    );
  const arm = (side: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(0, TORSO - 0.04, side * 0.21);
    pivot.add(
      limb(0.17, 0.05, deep),
      mesh(new THREE.SphereGeometry(0.06, 12, 10), light, [0, -0.19, 0]),
    );
    torso.add(pivot);
    return pivot;
  };
  const leg = (side: number) => {
    const thigh = new THREE.Group(),
      shin = new THREE.Group();
    thigh.position.set(0, 0, side * 0.085);
    thigh.add(limb(THIGH, 0.06, deep));
    shin.position.y = -THIGH;
    shin.add(
      limb(SHIN, 0.055, deep),
      mesh(new RoundedBoxGeometry(0.15, FOOT + 0.02, 0.1, 2, 0.025), light, [
        0.035,
        -SHIN - FOOT / 2 + 0.01,
        0,
      ]),
    );
    thigh.add(shin);
    hips.add(thigh);
    return { thigh, shin };
  };
  const armL = arm(1),
    armR = arm(-1),
    legL = leg(1),
    legR = leg(-1);

  // A soft shadow on the deck that thins as the rider rises, and a ring under this device's own rider.
  const shade = mesh(
    new THREE.CircleGeometry(0.3, 20).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    }),
    [0, 0.012, 0],
    "none",
  );
  const ring = mesh(
    new THREE.RingGeometry(0.33, 0.4, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    }),
    [0, 0.014, 0],
    "none",
  );
  const ground = new THREE.Group();
  ground.add(shade, ring);

  let joints: Joints = jointsOf("idle", 0, slot);
  joints.hip = hipOf(joints);
  let spin = 0,
    wet = false,
    placed = false;
  const white = new THREE.Color(0xffffff);

  const actor: RiderActor = {
    root: new THREE.Group(),
    squash: 0,
    flash: 0,
    cheer: 0,
    splash: false,
    pose(each, view, nowMs, dtMs, local) {
      const t = nowMs / 1000;
      const lanes = view.riders.length;
      const settled = view.phase === "over" && !each.out;
      const stance = stanceOf(each, view, actor.cheer > 0.5);
      actor.squash += (0 - actor.squash) * Math.min(1, dtMs / 90);
      actor.flash = Math.max(0, actor.flash - dtMs / 420);
      actor.cheer = Math.max(0, actor.cheer - dtMs / 2600);
      easeJoints(
        joints,
        jointsOf(stance, t, slot),
        // A duck folds at once: the rules clear a high surge on the tick, so the figure must not lag under it.
        placed ? 1 - Math.exp(-dtMs / (stance === "duck" ? 22 : 55)) : 1,
      );
      placed = true;
      const x = each.x * UNIT,
        z = laneZ(slot, lanes);
      const won = stance === "win";
      const hop =
        won && !each.air ? Math.abs(Math.sin(t * 6.5 + slot)) * 0.14 : 0;
      const y = settled ? 0 : each.y * UNIT;
      root.position.set(x, y + hop, z);
      // Knocked off, it tumbles backwards as it drops.
      if (each.out) spin += dtMs / 130;
      else spin = 0;
      const hip = joints.hip ?? hipOf(joints);
      body.position.y = hip + TORSO / 2;
      hips.position.y = -TORSO / 2;
      body.rotation.z = spin;
      const squash = actor.squash * 0.2;
      body.scale.set(1 + squash, 1 - squash, 1 + squash);
      // The squash keeps the feet where they are.
      body.position.y -= (hip + TORSO / 2) * squash * (each.air ? 0 : 1);
      torso.rotation.z = -joints.torso;
      head.rotation.z = -joints.head;
      armL.rotation.z = joints.armL;
      armR.rotation.z = joints.armR;
      legL.thigh.rotation.z = joints.thighL;
      legL.shin.rotation.z = joints.shinL;
      legR.thigh.rotation.z = joints.thighR;
      legR.shin.rotation.z = joints.shinR;
      // Struck and not yet fair game again: it flickers. Struck this instant: it flashes white.
      const blink =
        each.safe && !each.reeling && Math.floor(nowMs / 70) % 2 === 1;
      const under = y < PIT_Y - 0.2;
      root.visible = !blink && !under;
      actor.splash = each.out && under && !wet;
      wet = each.out && under;
      const flash =
        each.reeling && Math.floor(nowMs / 50) % 2 ? 1 : actor.flash;
      tinted.forEach((material, index) => {
        material.emissive.copy(glows[index]!).lerp(white, flash);
        material.emissiveIntensity = Math.max(style.glow, flash);
      });
      spark.color.setScalar(Math.floor(nowMs / 120 + slot) % 2 ? 2.6 : 1.4);
      spark.color.b *= 0.6;
      // What lies on the deck stays there.
      const onDeck = each.x >= 0 && y >= 0 && !each.out;
      ground.visible = onDeck;
      ground.position.set(x, 0, z);
      const lift = Math.min(1, Math.max(0, y) / 1.4);
      shade.scale.setScalar(1 - 0.45 * lift);
      (shade.material as THREE.MeshBasicMaterial).opacity = 0.32 - 0.2 * lift;
      ring.visible = local;
      ring.rotation.y = t * 0.8;
      ring.scale.setScalar(1 + 0.05 * Math.sin(t * 5));
    },
    crown(out) {
      const hip = joints.hip ?? hipOf(joints);
      return out.set(
        root.position.x,
        root.position.y +
          (hip +
            TORSO * Math.cos(joints.torso) +
            NECK * Math.cos(joints.torso + joints.head) +
            HEAD) *
            BIG +
          0.28,
        root.position.z,
      );
    },
  };
  actor.root.add(root, ground);
  return actor;
}

// ---- surges ----
/** The top beam a high surge hangs from, and the length of anything that spans the deck. */
const TOP = 2.35,
  SPAN = DECK_DEPTH + 0.5;

function stripes(
  doc: Document,
  a: string,
  b: string,
  slant: number,
): THREE.CanvasTexture {
  const texture = painted(doc, 128, 128, (c) => {
    c.fillStyle = a;
    c.fillRect(0, 0, 128, 128);
    c.strokeStyle = b;
    c.lineWidth = 32;
    for (let i = -2; i < 5; i++) {
      c.beginPath();
      c.moveTo(i * 64, 0);
      c.lineTo(i * 64 + slant * 128, 128);
      c.stroke();
    }
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** A low surge: something that rolls along the deck, as high as a rider must jump. */
function buildRoller(theme: Theme, doc: Document): THREE.Group {
  const spec = theme.low,
    radius = (LOW_TOP * UNIT) / 2;
  const made = new THREE.Group();
  /** What turns as it rolls. */
  const wheel = new THREE.Group();
  wheel.name = "wheel";
  wheel.position.y = radius;
  made.add(wheel);
  switch (spec.style) {
    case "coil": {
      wheel.add(
        mesh(
          bar(radius * 0.66, SPAN, 20),
          surface({ color: "#1a2350", rough: 0.35, metal: 0.8 }),
        ),
      );
      const hot = lamp(spec.color, spec.glow);
      for (let i = 0; i < 11; i++)
        wheel.add(
          mesh(
            new THREE.TorusGeometry(radius * 0.82, radius * 0.2, 8, 20),
            hot,
            [0, 0, -SPAN / 2 + 0.3 + (i * (SPAN - 0.6)) / 10],
            "cast",
          ),
        );
      for (let i = 0; i < 3; i++) {
        const fin = mesh(
          box(0.035, radius * 0.5, SPAN - 0.5),
          lamp(spec.accent, spec.glow),
          [0, 0, 0],
          "none",
        );
        fin.position.set(
          Math.cos((i * Math.PI * 2) / 3) * radius * 0.78,
          Math.sin((i * Math.PI * 2) / 3) * radius * 0.78,
          0,
        );
        fin.rotation.z = (i * Math.PI * 2) / 3 + Math.PI / 2;
        wheel.add(fin);
      }
      break;
    }
    case "log": {
      const bark = surface({ color: spec.color, rough: 1, flat: true });
      const cut = surface({ color: spec.accent, rough: 0.9 });
      wheel.add(mesh(bar(radius, SPAN, 11), [bark, cut, cut]));
      for (let i = 0; i < 7; i++) {
        const turn = i * 2.4;
        wheel.add(
          mesh(new THREE.DodecahedronGeometry(0.07, 0), bark, [
            Math.cos(turn) * radius * 0.95,
            Math.sin(turn) * radius * 0.95,
            -SPAN / 2 + 0.5 + i * 0.75,
          ]),
        );
      }
      for (const z of [-SPAN / 2 + 0.25, SPAN / 2 - 0.25])
        wheel.add(
          mesh(
            bar(radius * 1.06, 0.12, 11),
            surface({ color: "#5d4a3a", rough: 0.6, metal: 0.4 }),
            [0, 0, z],
          ),
        );
      break;
    }
    case "candy": {
      const wrap = stripes(doc, spec.accent, spec.color, 0.7);
      wrap.repeat.set(3, 9);
      wheel.add(
        mesh(
          bar(radius, SPAN - radius * 2, 28),
          surface({ color: "#ffffff", rough: 0.2, map: wrap }),
        ),
      );
      for (const z of [-1, 1])
        wheel.add(
          mesh(
            new THREE.SphereGeometry(radius, 24, 16),
            surface({ color: spec.color, rough: 0.2 }),
            [0, 0, z * (SPAN / 2 - radius)],
          ),
        );
      break;
    }
    case "prism": {
      wheel.add(
        mesh(
          bar(radius * 1.04, SPAN, 6),
          surface({
            color: spec.color,
            rough: 0.06,
            metal: 0.1,
            flat: true,
            opacity: 0.93,
            glow: spec.glow * 0.3,
          }),
        ),
        mesh(
          bar(radius * 0.3, SPAN - 0.2, 6),
          lamp(spec.accent, 1 + spec.glow),
          [0, 0, 0],
          "none",
        ),
      );
      break;
    }
    case "ingot": {
      const heat = painted(doc, 128, 64, (c, w, h) => {
        c.fillStyle = spec.color;
        c.fillRect(0, 0, w, h);
        for (let i = 0; i < 46; i++) {
          c.fillStyle = i % 3 ? spec.accent : "#7a2408";
          c.globalAlpha = 0.5;
          c.beginPath();
          c.ellipse(
            (i * 53) % w,
            (i * 29) % h,
            5 + (i % 5) * 3,
            3 + (i % 4),
            i,
            0,
            7,
          );
          c.fill();
        }
      });
      heat.wrapS = heat.wrapT = THREE.RepeatWrapping;
      heat.repeat.set(2, 6);
      const glowing = new THREE.MeshBasicMaterial({
        map: heat,
        color: tint("#ffffff").multiplyScalar(spec.glow),
      });
      glowing.toneMapped = false;
      wheel.add(mesh(bar(radius * 0.84, SPAN, 20), glowing, [0, 0, 0], "cast"));
      const flange = surface({ color: "#2a2c31", rough: 0.5, metal: 0.8 });
      for (let i = 0; i < 6; i++)
        wheel.add(
          mesh(bar(radius, 0.14, 8), flange, [
            0,
            0,
            -SPAN / 2 + 0.2 + (i * (SPAN - 0.4)) / 5,
          ]),
        );
      break;
    }
  }
  if (spec.glow > 0) {
    // The light it throws on the deck.
    const pool = mesh(
      new THREE.PlaneGeometry(1.5, SPAN).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: tint(spec.color),
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        map: painted(doc, 64, 8, (c, w, h) => {
          const fade = c.createLinearGradient(0, 0, w, 0);
          fade.addColorStop(0, "#000000");
          fade.addColorStop(0.5, "#ffffff");
          fade.addColorStop(1, "#000000");
          c.fillStyle = fade;
          c.fillRect(0, 0, w, h);
        }),
      }),
      [0, 0.016, 0],
      "none",
    );
    made.add(pool);
  }
  return made;
}

/** A high surge: a gantry on the rails with something hanging down to head height, to be ducked under. */
function buildHanger(theme: Theme, doc: Document): THREE.Group {
  const spec = theme.high,
    low = HIGH_BOTTOM * UNIT + 0.03;
  const made = new THREE.Group();
  const frame = surface({
    color: theme.deck.side,
    rough: 0.5,
    metal: theme.deck.metal,
  });
  for (const side of [-1, 1])
    made.add(
      mesh(box(0.4, 0.16, 0.24), frame, [0, 0.14, side * RAIL_Z]),
      mesh(box(0.1, TOP, 0.1), frame, [0, TOP / 2, side * RAIL_Z]),
    );
  made.add(mesh(box(0.16, 0.16, SPAN + 0.3), frame, [0, TOP, 0]));
  /** What hangs: it sways a little from the beam. */
  const hung = new THREE.Group();
  hung.name = "hung";
  hung.position.y = TOP;
  made.add(hung);
  const drop = TOP - low;
  switch (spec.style) {
    case "field": {
      const sheet = stripes(doc, "#000000", "#ffffff", 0);
      sheet.repeat.set(10, 1);
      sheet.name = "scroll";
      const veil = new THREE.MeshBasicMaterial({
        color: tint(spec.color).multiplyScalar(1.2),
        map: sheet,
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      veil.toneMapped = false;
      hung.add(
        mesh(
          new THREE.PlaneGeometry(SPAN - 0.4, drop - 0.1).rotateY(Math.PI / 2),
          veil,
          [0, -drop / 2, 0],
          "none",
        ),
        mesh(
          bar(0.055, SPAN - 0.3, 10),
          lamp(spec.color, spec.glow),
          [0, -drop + 0.05, 0],
          "cast",
        ),
        mesh(
          bar(0.03, SPAN - 0.3, 8),
          lamp(spec.accent, spec.glow),
          [0, -0.12, 0],
          "none",
        ),
      );
      break;
    }
    case "slats": {
      const a = surface({ color: spec.color, rough: theme.rider.rough + 0.2 }),
        b = surface({ color: spec.accent, rough: theme.rider.rough + 0.2 });
      const count = 8,
        pitch = (SPAN - 0.5) / count;
      for (let i = 0; i < count; i++)
        hung.add(
          mesh(
            new RoundedBoxGeometry(0.09, drop - 0.2, pitch * 0.78, 2, 0.03),
            i % 2 ? b : a,
            [
              0,
              -(drop - 0.2) / 2 - 0.08,
              -(SPAN - 0.5) / 2 + pitch * (i + 0.5),
            ],
          ),
        );
      hung.add(mesh(box(0.13, 0.13, SPAN - 0.4), b, [0, -drop + 0.065, 0]));
      break;
    }
    case "icicles": {
      const ice = surface({
        color: spec.color,
        rough: 0.08,
        metal: 0.1,
        flat: true,
        opacity: 0.88,
        glow: spec.glow,
        glowColor: spec.accent,
      });
      const count = 15,
        pitch = (SPAN - 0.5) / count;
      for (let i = 0; i < count; i++) {
        const length = drop - ((i * 7) % 4) * 0.07;
        hung.add(
          mesh(
            new THREE.ConeGeometry(
              0.17 + ((i * 3) % 3) * 0.03,
              length,
              6,
            ).rotateX(Math.PI),
            ice,
            [0, -length / 2, -(SPAN - 0.5) / 2 + pitch * (i + 0.5)],
          ),
        );
      }
      hung.add(mesh(box(0.3, 0.2, SPAN - 0.3), ice, [0, -0.02, 0]));
      break;
    }
    case "slab": {
      const tall = 0.95;
      hung.add(
        mesh(
          box(0.18, tall, SPAN - 0.5),
          surface({ color: spec.color, rough: 0.5, metal: 0.8 }),
          [0, -drop + tall / 2, 0],
        ),
        mesh(
          box(0.2, 0.09, SPAN - 0.5),
          lamp(spec.accent, spec.glow),
          [0, -drop + 0.045, 0],
          "none",
        ),
      );
      const chain = surface({ color: "#17181b", rough: 0.6, metal: 0.7 });
      for (let i = 0; i < 4; i++)
        hung.add(
          mesh(
            new THREE.CylinderGeometry(0.025, 0.025, drop - tall, 6),
            chain,
            [0, -(drop - tall) / 2, -(SPAN - 1.2) / 2 + (i * (SPAN - 1.2)) / 3],
          ),
        );
      break;
    }
  }
  return made;
}

interface SurgeParts {
  model: THREE.Group;
  /** What turns as a low surge rolls, what sways under a high one, and a veil's running texture. */
  wheel: THREE.Object3D | undefined;
  hung: THREE.Object3D | undefined;
  scroll: THREE.Texture | undefined;
}
interface SurgeActor extends SurgeParts {
  root: THREE.Group;
  kind: number;
  marker: THREE.Mesh;
  seen: number;
}
export interface SurgeCrew {
  group: THREE.Group;
  /** Shows the view's surges; `live` is 1 while a round is played and falls to 0 as it ends. */
  show(view: WorldView, nowMs: number, live: number): void;
  /** Each surge's near end in the world and how faded it is, for the arrows. */
  each(
    visit: (surge: SurgeView, near: THREE.Vector3, dim: number) => void,
  ): void;
}

export function buildSurges(theme: Theme, doc: Document): SurgeCrew {
  const group = new THREE.Group();
  const actors = new Map<number, SurgeActor>();
  const flipLamp = lamp(theme.flip, 2);
  const flipShape = new THREE.OctahedronGeometry(0.2, 0);
  const near = new THREE.Vector3();
  let frame = 0;
  const shown: { surge: SurgeView; x: number; y: number; dim: number }[] = [];
  // Every marker shares one shape and one lamp; this hidden one keeps them in the scene, so they are freed with it
  // even when no surge is on the deck.
  const keeper = mesh(flipShape, flipLamp, [0, 0, 0], "none");
  keeper.visible = false;
  group.add(keeper);
  /** A model for a kind, with the parts that move found once. */
  const parts = (kind: number): SurgeParts => {
    const model =
      kind === HIGH ? buildHanger(theme, doc) : buildRoller(theme, doc);
    let scroll: THREE.Texture | undefined;
    model.traverse((node) => {
      const material = (node as Partial<THREE.Mesh>).material;
      const map =
        material instanceof THREE.MeshBasicMaterial ? material.map : null;
      if (map?.name === "scroll") scroll = map;
    });
    return {
      model,
      wheel: model.getObjectByName("wheel"),
      hung: model.getObjectByName("hung"),
      scroll,
    };
  };
  return {
    group,
    show(view, nowMs, live) {
      frame++;
      shown.length = 0;
      const t = nowMs / 1000;
      for (const surge of view.surges) {
        let actor = actors.get(surge.id);
        if (!actor) {
          const root = new THREE.Group();
          const marker = mesh(flipShape, flipLamp, [0, TOP + 0.55, 0], "none");
          actor = {
            root,
            kind: surge.kind,
            marker,
            seen: 0,
            ...parts(surge.kind),
          };
          root.add(actor.model, marker);
          group.add(root);
          actors.set(surge.id, actor);
        } else if (actor.kind !== surge.kind) {
          // It flipped at the gate: the other kind takes its place.
          actor.root.remove(actor.model);
          release(actor.model);
          actor.kind = surge.kind;
          Object.assign(actor, parts(surge.kind));
          actor.root.add(actor.model);
        }
        actor.seen = frame;
        const x = surge.x * UNIT;
        // Past the deck's edge it drops into the pit; fresh out of the arch it grows to full size.
        const over = Math.max(0, -x);
        const fall = over * over * 2.6;
        const grown = Math.min(
          1,
          Math.max(0.2, (SPAWN_X * UNIT - x) / 0.5 + 0.2),
        );
        actor.root.position.set(x, -fall, 0);
        actor.root.rotation.z = over * 0.5;
        const size = Math.max(0.001, live) * grown;
        actor.root.scale.set(size, size, 1);
        actor.root.visible = live > 0.02;
        if (actor.wheel)
          actor.wheel.rotation.z =
            (-x / ((LOW_TOP * UNIT) / 2)) % (Math.PI * 2);
        if (actor.hung)
          actor.hung.rotation.z = Math.sin(t * 3 + surge.id) * 0.035;
        if (actor.scroll) actor.scroll.offset.x = t * 0.6;
        actor.marker.visible = surge.flips;
        actor.marker.rotation.y = t * 4;
        actor.marker.position.y =
          (surge.kind === HIGH ? TOP + 0.5 : 1.0) + Math.sin(t * 6) * 0.06;
        shown.push({
          surge,
          x,
          y: -fall,
          dim: live * Math.min(1, Math.max(0, 1 + x / 1.1)),
        });
      }
      for (const [id, actor] of actors)
        if (actor.seen !== frame) {
          group.remove(actor.root);
          release(actor.model);
          actors.delete(id);
        }
    },
    each(visit) {
      for (const item of shown)
        visit(item.surge, near.set(item.x, item.y, RAIL_Z + 0.2), item.dim);
    },
  };
}
