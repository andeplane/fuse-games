import type { RiderView, WorldView } from "../engine/view.js";

/**
 * The arithmetic the 3D picture stands on, kept apart from the renderer so it can be tested without a GPU: where a
 * lane is, which stance a rider is in and what its joints do, and how far back the camera sits to hold the deck.
 */

/** World units per deck pixel: a rider 84 px tall stands 0.84 high. */
export const UNIT = 0.01;
/** The deck from its back rail to its front one, world units. */
export const DECK_DEPTH = 5.2;
/** A lane's centre line: lane 0 is at the back, away from the camera. */
export const laneZ = (slot: number, lanes: number): number =>
  -DECK_DEPTH / 2 + (DECK_DEPTH * (slot + 0.5)) / Math.max(1, lanes);

export type Stance =
  "out" | "reel" | "rise" | "fall" | "dive" | "duck" | "win" | "walk" | "idle";

/** What a rider is doing, as the picture shows it. A finished match stands its survivors on the deck. */
export function stanceOf(
  rider: RiderView,
  view: WorldView,
  cheering = false,
): Stance {
  if (rider.out) return "out";
  if (rider.reeling) return "reel";
  const settled = view.phase === "over";
  if (rider.air && !settled)
    return rider.vy > 0.5 ? "rise" : rider.vy < -6 ? "dive" : "fall";
  if (rider.duck && !settled) return "duck";
  const won =
    (view.phase === "break" && view.lastWinners.includes(rider.slot)) ||
    (settled && view.winners.includes(rider.slot));
  if (won || cheering) return "win";
  if (Math.abs(rider.x - rider.foothold) > 1.5) return "walk";
  return "idle";
}

/** The figure's bones, world units: it stands `STAND_H` tall with its joints at rest. */
export const FOOT = 0.05,
  SHIN = 0.11,
  THIGH = 0.11,
  TORSO = 0.26,
  NECK = 0.14,
  HEAD = 0.17;

/**
 * A pose, in radians. The figure faces the surges (+x); a positive angle swings forward. `torso` and `head` pitch
 * from upright, `arm` swings from hanging (π points straight up), `thigh` swings from hanging and `shin` bends from
 * the thigh's line (negative folds the knee). `hip` is the hips' height over the feet's level; a grounded pose
 * leaves it out and stands on its lower foot.
 */
export interface Joints {
  torso: number;
  head: number;
  armL: number;
  armR: number;
  thighL: number;
  shinL: number;
  thighR: number;
  shinR: number;
  hip?: number;
}

const leg = (thigh: number, shin: number) =>
  THIGH * Math.cos(thigh) + SHIN * Math.cos(thigh + shin);
/**
 * The figure is drawn a little larger than life, so a rider reads from across the deck. It stays small enough that a
 * duck still fits under a high surge: what you see is what clears.
 */
export const RIDER_SCALE = 1.15;

/** How high the hips sit with a pose's feet on the deck. */
export const hipOf = (joints: Joints): number =>
  joints.hip ??
  FOOT +
    Math.max(
      leg(joints.thighL, joints.shinL),
      leg(joints.thighR, joints.shinR),
    );
/** The top of the head over the feet's level: what must fit under a high surge. */
export const crownOf = (joints: Joints): number =>
  hipOf(joints) +
  TORSO * Math.cos(joints.torso) +
  NECK * Math.cos(joints.torso + joints.head) +
  HEAD;

/** A stance's pose at time `t` seconds; `seed` keeps riders out of step with each other. */
export function jointsOf(stance: Stance, t: number, seed = 0): Joints {
  const s = t + seed * 1.37;
  switch (stance) {
    case "walk": {
      const gait = Math.sin(s * 15);
      return {
        torso: 0.14,
        head: -0.05,
        armL: -0.8 * gait,
        armR: 0.8 * gait,
        thighL: 0.7 * gait,
        shinL: -0.25 - 0.5 * Math.max(0, -gait),
        thighR: -0.7 * gait,
        shinR: -0.25 - 0.5 * Math.max(0, gait),
      };
    }
    case "rise":
      return {
        torso: 0.12,
        head: -0.1,
        armL: 2.8,
        armR: 2.6,
        thighL: 1.05,
        shinL: -1.6,
        thighR: 0.85,
        shinR: -1.5,
        hip: 0.27,
      };
    case "fall": {
      const flutter = Math.sin(s * 22) * 0.18;
      return {
        torso: -0.04,
        head: 0.1,
        armL: 2.2 + flutter,
        armR: 2.3 - flutter,
        thighL: 0.3,
        shinL: -0.35,
        thighR: -0.15,
        shinR: -0.3,
        hip: 0.27,
      };
    }
    case "dive":
      return {
        torso: 0.38,
        head: -0.25,
        armL: -0.7,
        armR: -0.6,
        thighL: -0.3,
        shinL: -0.15,
        thighR: -0.2,
        shinR: -0.25,
        hip: 0.27,
      };
    case "duck":
      return {
        torso: 1.25,
        head: -0.35,
        armL: 1.5,
        armR: 1.4,
        thighL: 1.25,
        shinL: -2.3,
        thighR: 1.2,
        shinR: -2.25,
      };
    case "reel":
    case "out": {
      const flail = Math.sin(s * 30) * (stance === "out" ? 1.1 : 0.8);
      const joints: Joints = {
        torso: -0.55,
        head: -0.2,
        armL: 2.4 + flail,
        armR: 2.2 - flail,
        thighL: 0.55,
        shinL: -0.6,
        thighR: -0.2,
        shinR: -0.5,
      };
      // Knocked off, it tumbles through the air: there is no deck to stand on.
      if (stance === "out") joints.hip = 0.27;
      return joints;
    }
    case "win": {
      const wave = Math.sin(s * 10) * 0.3;
      return {
        torso: -0.08,
        head: -0.15,
        armL: 2.9 + wave,
        armR: 2.9 - wave,
        thighL: 0.08,
        shinL: -0.12,
        thighR: -0.08,
        shinR: -0.12,
      };
    }
    case "idle":
    default: {
      const breath = Math.sin(s * 2.4);
      return {
        torso: 0.05 + breath * 0.02,
        head: breath * 0.03,
        armL: 0.12 + breath * 0.05,
        armR: -0.1 - breath * 0.05,
        thighL: 0.06,
        shinL: -0.1,
        thighR: -0.06,
        shinR: -0.1,
      };
    }
  }
}

const JOINT_KEYS = [
  "torso",
  "head",
  "armL",
  "armR",
  "thighL",
  "shinL",
  "thighR",
  "shinR",
] as const;
/** Moves `pose` a share `k` (0 to 1) of the way to `target`, and returns it. */
export function easeJoints(pose: Joints, target: Joints, k: number): Joints {
  for (const key of JOINT_KEYS) pose[key] += (target[key] - pose[key]) * k;
  pose.hip = hipOf(pose) + (hipOf(target) - hipOf(pose)) * k;
  return pose;
}

export type Vec3 = readonly [number, number, number];
/** The part of the picture the action must stay inside, as fractions from −1 (left, bottom) to 1 (right, top). */
export interface Window {
  left: number;
  right: number;
  bottom: number;
  top: number;
}
export interface Framing {
  /** The camera's distance from the target along its line of sight. */
  distance: number;
  /** How far to slide the target right and up in the picture's plane to centre the action in the window. */
  right: number;
  up: number;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * The nearest a camera can stand and still hold every point inside `window`. `points` are measured from the
 * target; `right`, `up` and `back` are the camera's unit axes (`back` points from the target to the camera);
 * `tanY` is the tangent of half its vertical field of view and `aspect` the picture's width over its height.
 */
export function frame(
  points: readonly Vec3[],
  axes: { right: Vec3; up: Vec3; back: Vec3 },
  tanY: number,
  aspect: number,
  window: Window,
): Framing {
  const spans = points.map((point) => ({
    x: dot(point, axes.right),
    y: dot(point, axes.up),
    z: dot(point, axes.back),
  }));
  // At a distance, the slide that keeps a point inside one pair of edges is an interval; the points fit when the
  // intervals of all of them overlap.
  const slide = (distance: number) => {
    let x0 = -Infinity,
      x1 = Infinity,
      y0 = -Infinity,
      y1 = Infinity;
    for (const span of spans) {
      const depth = distance - span.z;
      if (depth <= 0) return undefined;
      const kx = tanY * aspect * depth,
        ky = tanY * depth;
      x0 = Math.max(x0, span.x - window.right * kx);
      x1 = Math.min(x1, span.x - window.left * kx);
      y0 = Math.max(y0, span.y - window.top * ky);
      y1 = Math.min(y1, span.y - window.bottom * ky);
    }
    return x0 <= x1 && y0 <= y1
      ? { right: (x0 + x1) / 2, up: (y0 + y1) / 2 }
      : undefined;
  };
  let near = 0,
    far = 1;
  while (!slide(far) && far < 1e6) far *= 2;
  for (let i = 0; i < 40; i++) {
    const mid = (near + far) / 2;
    if (slide(mid)) far = mid;
    else near = mid;
  }
  return { distance: far, ...(slide(far) ?? { right: 0, up: 0 }) };
}
