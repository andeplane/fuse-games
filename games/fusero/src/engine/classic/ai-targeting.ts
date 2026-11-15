/* Altered OpenLieroX Classic AI port: CWormBot.cpp:1297–1363,1594–1713.
 * Pinned 0a20c6d0a10ed63b28a15f05c771913c294efbf6. LGPL.
 * Jason Boettcher, Dark Charlie, Albert Zeyer and contributors.
 */
import { aiNow, type NativeAiFrame } from "./ai-state.js";
import type { Worm } from "./model.js";
import {
  len2,
  minus,
  normalized,
  point,
  traceLine,
  PX_ROCK,
  type AiPoint,
} from "./ai-geometry.js";
import { add, f, mul, seconds, sub } from "./physics-types.js";
import { atan2 } from "./math.js";
import { randomSigned } from "./random.js";

export const AI_R2D = f(5.729578e1);
export const AI_D2R = f(1.745329e-2);

/** Source prefers the nearest non-rock first obstacle, including dirt before a later rock. */
export function findAiTarget(frame: NativeAiFrame): Worm | undefined {
  let target: Worm | undefined, nonSight: Worm | undefined;
  let distance = -1,
    sightDistance = -1;
  for (const candidate of frame.targets) {
    if (!candidate.alive || candidate.id === frame.worm.id) continue;
    const squared = len2(minus(candidate, frame.worm));
    const trace = traceLine(frame.terrain, candidate, frame.worm, 1);
    if (!(trace.type & PX_ROCK)) {
      if (sightDistance < 0 || squared < sightDistance) {
        target = candidate;
        sightDistance = squared;
        if (distance < 0 || squared < distance) {
          nonSight = candidate;
          distance = squared;
        }
      }
    } else if (distance < 0 || squared < distance) {
      nonSight = candidate;
      distance = squared;
    }
  }
  // Native compares squared distances against 50, not 50 squared.
  if (
    sub(sightDistance, distance) > 50 ||
    frame.ai.gameType === "rifles" ||
    !target
  )
    if (nonSight) target = nonSight;
  return target;
}

export function aiTargetPosition(frame: NativeAiFrame): AiPoint {
  const { ai, world } = frame;
  if (ai.targetType === "bonus") {
    if (ai.bonusId === null) {
      ai.mode = "think";
      return point(0, 0);
    }
    const bonus = world.bonuses.find((entry) => entry.id === ai.bonusId);
    if (bonus) ai.bonusPosition = point(bonus.x, bonus.y);
    else ai.mode = "think";
    // Native bonus slots retain their last position when Used becomes false.
    return { ...ai.bonusPosition };
  }
  if (ai.targetType === "position") return { ...ai.targetPosition };
  if (ai.targetType !== "worm") ai.mode = "think";
  const target = world.worms.find((entry) => entry.id === ai.targetWormId);
  if (target?.alive) return point(target.x, target.y);
  ai.mode = "think";
  return point(0, 0);
}

export function reloadAiWeapons(frame: NativeAiFrame): void {
  const slot = frame.worm.slots.findIndex((entry) => entry.reloading);
  if (slot >= 0) frame.worm.weapon = slot;
}

/** Absolute native aim; separate from the human keyboard acceleration handler. */
export function setAiAim(frame: NativeAiFrame, target: AiPoint): boolean {
  const { worm, ai, shared, world } = frame;
  const direction = normalized(minus(target, worm));
  const wanted = direction.x < 0 ? -1 : 1;
  if (aiNow(frame) - ai.lastFaceMs > 300) {
    worm.facing = wanted;
    ai.lastFaceMs = aiNow(frame);
  }
  let angle = mul(f(atan2(direction.x, direction.y)), AI_R2D);
  angle = wanted === -1 ? add(angle, 90) : add(-angle, 90);
  angle = Math.max(-90, angle);
  const difficulty = ai.difficulty;
  if (difficulty !== 3) {
    if (aiNow(frame) - shared.angleNoiseAtMs > 500) {
      for (let level = 0; level < 3; level++)
        shared.angleNoise[level] = mul(
          mul(randomSigned(world), f((3 - level) / 3)),
          50,
        );
      shared.angleNoiseAtMs = aiNow(frame);
    }
    angle = Math.max(-90, add(angle, shared.angleNoise[difficulty]));
  }
  const speed = mul(100, seconds(frame.deltaMs));
  if (angle > worm.aim) worm.aim = add(worm.aim, speed);
  else if (angle < worm.aim) worm.aim = sub(worm.aim, speed);
  if (Math.abs(sub(worm.aim, angle)) < 3) worm.aim = angle;
  const good =
    Math.abs(sub(worm.aim, angle)) < add(3, f(mul(20, 3 - ai.difficulty) / 3));
  worm.aim = Math.max(-90, Math.min(60, worm.aim));
  return good;
}
