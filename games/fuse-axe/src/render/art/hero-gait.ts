import { armTo, offset, type Pose, type Side } from "../pixel/kit.js";
import type { Point } from "../pixel/rig.js";

const FRAMES = 6;

/** Sample the matching arm swing and footwork for each frame of a hero gait. */
export function heroGait<P extends Pose>(
  sample: (frame: number, frames: number) => P,
  finish: (step: P, swing: number) => P,
): P[] {
  return Array.from({ length: FRAMES }, (_, frame) => {
    const step = sample(frame, FRAMES);
    const swing = Math.cos((frame / FRAMES) * 2 * Math.PI);
    return finish(step, swing);
  });
}

const WALK_SWING = { far: 4, near: -1.5, lift: 0.3 };

export function walkingHands(
  farHand: Point,
  nearHand: Point,
  swing: number,
  { far, near, lift } = WALK_SWING,
): [Point, Point] {
  function raised(hand: Point, reach: number): Point {
    const dx = reach * swing;
    return offset(hand, dx, -Math.abs(dx) * lift);
  }
  return [raised(farHand, far), raised(nearHand, near)];
}

/** At swing 1, the near foot lands ahead with the far fist forward. */
export function sprintArms(
  step: Pose,
  swing: number,
  { reach, lift }: { reach: number; lift: number },
  nearAhead = (1 - swing) / 2,
) {
  const pump = (side: Side, ahead: number) =>
    armTo(
      side,
      side.shoulder,
      offset(side.shoulder, -reach + 2 * reach * ahead, 7 - lift * ahead),
    );
  return {
    far: pump(step.far, (1 + swing) / 2),
    near: pump(step.near, nearAhead),
  };
}

export function trailingSword(swing: number): number {
  return -170 + 120 * ((1 - swing) / 2) ** 2;
}
