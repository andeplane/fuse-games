import { offset as at, type Local } from "../pixel/kit.js";
import type { Point, Rig, ShapeOptions } from "../pixel/rig.js";

export const MOUNT_WALK_STEPS = 5;
export const MOUNT_SOLE = 0.5;
const STRIDE = 1.25 * MOUNT_WALK_STEPS;
const EDGELESS = { edge: "none" } as const;

/** Sample the planted half and the raised swing of a four-frame walk. */
export function sampleMountFoot(
  aboveFeet: Local,
  { frame, phase, centre }: { frame: number; phase: number; centre: number },
): readonly [foot: Point, lifted: boolean] {
  const q = (frame / 4 + phase) % 1;
  if (q < 0.5)
    return [aboveFeet(centre + STRIDE * (1 - 4 * q), MOUNT_SOLE), false];
  const lift = 4 * Math.sin((q - 0.5) * 2 * Math.PI);
  return [
    aboveFeet(centre + STRIDE * (4 * q - 3), MOUNT_SOLE + lift),
    lift > 0,
  ];
}

export const walkTail = (tail: readonly Point[], sway: number): Point[] =>
  tail.map((point, index) => at(point, 0, (sway * index) / 3));

export const outline = (local: Local, pairs: readonly number[]): Point[] =>
  Array.from({ length: pairs.length / 2 }, (_, i) =>
    local(pairs[2 * i]!, pairs[2 * i + 1]!),
  );

export function taperedChain(
  rig: Rig,
  spine: readonly Point[],
  girth: readonly number[],
  material: string,
  options: ShapeOptions,
): void {
  spine.forEach((point, index) => {
    const next = spine[index + 1];
    if (next)
      rig.capsule(
        point,
        next,
        girth[index]!,
        girth[index + 1]!,
        material,
        options,
      );
  });
}

/** The blanket and leather seat, drawn behind the rider-side legs. */
export function drawSaddle(
  rig: Rig,
  torso: Local,
  {
    blanket,
    cloth,
    girth,
    goldTrim,
  }: {
    blanket: readonly number[];
    cloth: string;
    girth: number;
    goldTrim?: boolean;
  },
): void {
  rig.poly(outline(torso, blanket), cloth, { bevel: 1.2 });
  if (goldTrim)
    rig.capsule(torso(-5.5, 3.4), torso(5, 3.4), 0.7, 0.7, "n", EDGELESS);
  rig.capsule(torso(4.2, -4.5), torso(4.5, girth), 1.1, 1.1, "l", EDGELESS);
  rig.capsule(torso(-5, -7.4), torso(4, -7.4), 1.9, 1.9, "l");
  rig.capsule(torso(-5.6, -7.6), torso(-6.8, -10), 1.6, 1.3, "l");
  rig.capsule(torso(4.6, -8), torso(5.6, -10.2), 1.2, 1.1, "n");
}

/** Hang the stirrup in front of the rider-side legs. */
export function drawStirrup(rig: Rig, torso: Local, saddle: Point): void {
  const stirrup = at(saddle, 4, -0.5);
  rig.capsule(torso(1.5, -6), at(stirrup, 0, -1.5), 0.6, 0.6, "l", EDGELESS);
  rig.capsule(at(stirrup, -1.3, 0), at(stirrup, 1.3, 0), 0.8, 0.8, "n");
}
