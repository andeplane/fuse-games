import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { RiderView, WorldView } from "../../engine/view.js";
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
import { box, lamp, mesh, surface, tint } from "./kit.js";
import { PIT_Y } from "./set.js";

/**
 * A jointed figure for every rider. It is posed from the view each frame and keeps nothing of the match; what it
 * remembers between frames (a squash, a flash, a tumble) is cosmetic.
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
