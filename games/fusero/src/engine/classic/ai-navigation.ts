/* Altered Classic DeathMatch port of CWormBot.cpp:2869–2983,3200–3942,3951–4034.
 * OpenLieroX 0a20c6d0a10ed63b28a15f05c771913c294efbf6. LGPL.
 * Jason Boettcher, Dark Charlie, Albert Zeyer and contributors.
 */
import { aiNow, type NativeAiFrame } from "./ai-state.js";
import { aiTargetPosition, reloadAiWeapons, setAiAim } from "./ai-targeting.js";
import {
  aiRopeAttached,
  findAiClearingWeapon,
  traceAiWeapon,
} from "./ai-combat.js";
import { requestAiSearch, MAX_AI_PATH_NODES } from "./ai-path.js";
import { CLASSIC_PROJECTILES, weaponById } from "./catalog.js";
import { cos, sin } from "./math.js";
import { checkOnGround, ropeForce, shootRope } from "./physics.js";
import {
  CLASSIC_PHYSICS,
  add,
  f,
  mul,
  sub,
  seconds,
  faceDirection,
} from "./physics-types.js";
import { randomSigned } from "./random.js";
import {
  len,
  len2,
  minus,
  normalized,
  plus,
  point,
  times,
  traceLine,
  traceWorm,
  fastTrace,
  PX_DIRT,
  PX_EMPTY,
  PX_ROCK,
  type AiPoint,
  type AiTerrain,
} from "./ai-geometry.js";

/** CMap::PixelFlagAccess uses exclusive right/bottom coordinates. */
export function aiAreaFree(
  terrain: AiTerrain,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  blocked: number,
): boolean {
  for (let y = y1; y < y2; y++)
    for (let x = x1; x < x2; x++)
      if (terrain.flag(x, y) & blocked) return false;
  return true;
}
export function aiIsInAir(terrain: AiTerrain, pos: AiPoint, area = 1): boolean {
  if (
    pos.x < 0 ||
    pos.y < 0 ||
    pos.x >= terrain.width ||
    pos.y >= terrain.height
  )
    return false;
  const width = area * 15,
    x = Math.trunc(pos.x) - Math.trunc(width / 2),
    y = Math.trunc(pos.y) - Math.trunc(width / 2);
  return aiAreaFree(terrain, x, y, x + width, y + width, PX_DIRT | PX_ROCK);
}

export function findAiShootingSpot(frame: NativeAiFrame): AiPoint {
  const enemy = frame.world.worms.find(
    (entry) => entry.id === frame.ai.targetWormId,
  );
  if (!enemy) return point(0, 0);
  let straight = false,
    falling = false;
  for (const slot of frame.worm.slots) {
    const weapon = weaponById(slot.weaponId);
    if (weapon?.type !== "projectile") continue;
    const projectile = CLASSIC_PROJECTILES[weapon.projectileId]!;
    const gravity = projectile.customGravity ? f(projectile.gravity!) : 100;
    if (gravity >= 5) falling = true;
    else if (gravity >= -5) straight = true;
  }
  const pi = f(Math.PI);
  let lower = 0,
    upper = 0;
  if (falling || (straight && checkOnGround(enemy, frame.physicsTerrain))) {
    lower = f(pi / 2);
    upper = f(mul(3, pi) / 2);
  } else if (straight) upper = mul(2, pi);
  else {
    lower = f(-pi / 2);
    upper = f(pi / 2);
  }
  for (let angle = lower; angle <= upper; angle = add(angle, 0.3)) {
    const pos = point(
      add(mul(40, f(sin(angle))), enemy.x),
      add(mul(40, f(cos(angle))), enemy.y),
    );
    if (
      aiIsInAir(frame.terrain, pos) &&
      traceLine(frame.terrain, pos, enemy).distance >= 40
    )
      return pos;
  }
  let pos = point(enemy.x, enemy.y);
  for (let i = 0; i < 10; i++) {
    pos.x = add(pos.x, 5);
    if (!traceWorm(frame.terrain, pos, enemy).clear) {
      pos.x = sub(pos.x, 5);
      if (Math.abs(sub(enemy.x, pos.x)) >= 15) return pos;
    }
  }
  pos = point(enemy.x, enemy.y);
  for (let i = 0; i < 10; i++) {
    pos.x = sub(pos.x, 5);
    if (!traceWorm(frame.terrain, pos, enemy).clear) {
      // Source subtracts a second time here, rather than undoing the first subtraction.
      pos.x = sub(pos.x, 5);
      if (Math.abs(sub(enemy.x, pos.x)) >= 15) return pos;
    }
  }
  return pos;
}

/** AI_CreatePath preserves the old usable path until the scheduled search publishes a replacement. */
export function createAiPath(
  frame: NativeAiFrame,
  forceBreak = false,
): boolean {
  const { ai, worm, world, terrain } = frame;
  let target = aiTargetPosition(frame);
  if (ai.targetType === "worm" && ai.targetWormId !== null)
    target = findAiShootingSpot(frame);
  const restart = (forced: boolean) => {
    ai.pathFinished = false;
    ai.searchStartedAtMs = aiNow(frame);
    requestAiSearch(ai.search, worm, target, aiNow(frame), forced);
  };
  if (forceBreak) {
    restart(true);
    return false;
  }
  if (!ai.pathFinished) {
    if (ai.search.status !== "searching") {
      ai.pathFinished = true;
      if (ai.search.status === "found" && ai.search.result.length) {
        ai.path = ai.search.result.map((p) => ({ ...p }));
        ai.currentNode = 0;
        ai.lastPathCreatedMs = aiNow(frame);
        return true;
      }
    } else {
      if (
        !ai.search.pendingRestart &&
        (aiNow(frame) - ai.searchStartedAtMs >= 5000 ||
          !traceWorm(terrain, worm, ai.search.start).clear ||
          !traceWorm(terrain, target, ai.search.target).clear)
      )
        restart(true);
      return false;
    }
  }
  const last = ai.path.at(-1);
  if (last && traceWorm(terrain, last, target).clear) {
    for (let i = 0; i < ai.path.length; i++)
      if (traceWorm(terrain, ai.path[i]!, worm).clear) {
        if (ai.path.length >= MAX_AI_PATH_NODES) {
          restart(false);
          return false;
        }
        ai.currentNode = i;
        ai.path.push({ ...target });
        return true;
      }
  }
  if (aiNow(frame) - ai.lastPathCreatedMs <= 500) return ai.path.length > 0;
  restart(false);
  return false;
}

export function bestAiRopeSpot(
  frame: NativeAiFrame,
  targetPosition: AiPoint,
): AiPoint {
  const { worm, terrain } = frame;
  let dir = minus(targetPosition, worm);
  if (len2(dir) < f(0.001)) return { ...targetPosition };
  dir = times(dir, f(Math.trunc(CLASSIC_PHYSICS.ropeMaxLength) / len(dir)));
  dir = point(-dir.y, dir.x);
  const target = point(targetPosition.x, sub(targetPosition.y, 30)),
    aim = faceDirection(worm);
  const step = mul(0.05, f(Math.PI)),
    cosine = f(cos(-step)),
    sine = f(sin(-step));
  let best = { ...targetPosition },
    bestValue = -1;
  for (let angle = 0; angle < f(Math.PI); angle = add(angle, step)) {
    fastTrace(terrain, plus(worm, dir), worm, PX_DIRT | PX_ROCK, (x, y) => {
      const suggestion = point(x, y);
      let distance = len(minus(worm, suggestion));
      if (distance < 30 || (worm.y > target.y && y > sub(worm.y, 10)))
        return false;
      const targetDistance = len(minus(suggestion, target));
      const proximity =
        targetDistance !== 0 ? f(1 / targetDistance) : f(999999999999999);
      // Native uses the absolute suggestion vector, not suggestion minus worm.
      const suggestionLength = len(suggestion);
      const angleDiff = len(
        minus(
          aim,
          point(
            f(suggestion.x / suggestionLength),
            f(suggestion.y / suggestionLength),
          ),
        ),
      );
      const alignment = angleDiff !== 0 ? f(1 / angleDiff) : f(999999999999999);
      distance = mul(-distance, sub(distance, 200));
      if (distance < 0) distance = 0;
      let value = add(
        add(mul(proximity, 100000), mul(alignment, 10000)),
        mul(distance, 0.001),
      );
      if (sub(worm.y, target.y) > 40) value = proximity;
      if (bestValue < value) {
        bestValue = value;
        best = suggestion;
      }
      return false;
    });
    dir = point(
      add(mul(dir.x, cosine), mul(dir.y, -sine)),
      add(mul(dir.x, sine), mul(dir.y, cosine)),
    );
  }
  return bestValue < 0 ? { ...targetPosition } : best;
}

function jumpingDisadvantages(frame: NativeAiFrame): boolean {
  const node =
    frame.ai.currentNode === null
      ? undefined
      : frame.ai.path[frame.ai.currentNode];
  if (!node) return false;
  const dt = f(0.3),
    force = f(CLASSIC_PHYSICS.jumpForce);
  // The source accidentally uses jump force as gravity in this predictor.
  const dy = add(mul(mul(mul(force, dt), dt), 0.5), mul(force, dt));
  return !traceWorm(frame.terrain, node, plus(frame.worm, point(0, dy))).clear;
}
export function jumpAi(frame: NativeAiFrame): boolean {
  const { ai, worm } = frame;
  if (
    seconds(aiNow(frame) - ai.lastJumpMs) > f(0.3) &&
    worm.onGround &&
    !jumpingDisadvantages(frame)
  ) {
    ai.lastJumpMs = aiNow(frame);
    frame.controls.jump = true;
  }
  return frame.controls.jump;
}
function movingDisadvantages(frame: NativeAiFrame, target: AiPoint): boolean {
  let speed = frame.worm.onGround
    ? CLASSIC_PHYSICS.groundSpeed
    : CLASSIC_PHYSICS.airSpeed;
  if (frame.worm.facing === -1) speed = -speed;
  const dx = mul(
    Math.max(-30, Math.min(30, add(frame.worm.vx, mul(speed, 90)))),
    0.3,
  );
  return !traceWorm(frame.terrain, target, plus(frame.worm, point(dx, 0)))
    .clear;
}

export function simpleMoveAi(frame: NativeAiFrame, haveTarget: boolean): void {
  const { worm, ai, controls, world } = frame;
  controls.move = true;
  controls.shoot = false;
  controls.jump = false;
  ai.targetPosition = aiTargetPosition(frame);
  if (ai.targetType === "worm" && ai.targetWormId !== null)
    ai.targetPosition = findAiShootingSpot(frame);
  setAiAim(frame, ai.targetPosition);
  const trace = traceLine(frame.terrain, ai.targetPosition, worm, 1);
  if (trace.fraction < 0.75 || ai.targetPosition.y < worm.y) {
    if (haveTarget && aiNow(frame) - ai.lastFaceMs > 1000) {
      worm.facing = worm.facing === 1 ? -1 : 1;
      ai.lastFaceMs = aiNow(frame);
    }
    const target = plus(
      worm,
      point(
        mul(randomSigned(world), 10),
        add(mul(randomSigned(world), 10), 10),
      ),
    );
    if (setAiAim(frame, target)) shootRope(worm, faceDirection(worm));
    else {
      jumpAi(frame);
      controls.move = true;
      worm.rope = null;
    }
    return;
  }
  worm.rope = null;
}

export function moveAiToTarget(frame: NativeAiFrame): void {
  const { worm, ai, world, controls, terrain } = frame;
  if (
    ai.targetType === "none" ||
    (ai.targetType === "worm" &&
      !world.worms.some((entry) => entry.id === ai.targetWormId))
  ) {
    ai.mode = "think";
    return;
  }
  controls.move = false;
  controls.shoot = false;
  controls.jump = false;
  ai.ropeAttachedMs = aiRopeAttached(frame)
    ? ai.ropeAttachedMs + frame.deltaMs
    : 0;
  if (ai.ropeAttachedMs > 5000) {
    worm.rope = null;
    ai.ropeAttachedMs = 0;
  }
  ai.ropeFlightMs =
    worm.rope?.state === "shooting" && !aiRopeAttached(frame)
      ? ai.ropeFlightMs + frame.deltaMs
      : 0;
  if (ai.ropeFlightMs >= 2000) {
    worm.rope = null;
    ai.ropeFlightMs = 0;
  }
  ai.targetPosition = aiTargetPosition(frame);
  if (ai.targetType === "worm" && ai.targetWormId !== null)
    ai.targetPosition = findAiShootingSpot(frame);
  if (ai.gameType === "100lt" && worm.onGround) {
    for (const enemy of frame.targets)
      if (enemy.id !== worm.id && len2(minus(worm, enemy)) <= 2500)
        if (traceLine(terrain, enemy, worm).type & PX_EMPTY) jumpAi(frame);
  }
  if (ai.stuck) {
    controls.move = true;
    jumpAi(frame);
    if (aiNow(frame) - ai.lastFaceMs >= 500) {
      worm.facing = worm.facing === 1 ? -1 : 1;
      ai.lastFaceMs = aiNow(frame);
    }
    if (aiNow(frame) - ai.stuckPauseAtMs > 2000) ai.stuck = false;
    return;
  }
  if (!ai.path.length || ai.currentNode === null) {
    ai.mode = "think";
    simpleMoveAi(frame, ai.targetWormId !== null);
    return;
  }
  if (
    len2(minus(ai.path[ai.currentNode]!, worm)) <= 100 &&
    ai.currentNode + 1 < ai.path.length
  )
    ai.currentNode++;
  let newNode = false;
  for (let i = ai.currentNode + 1; i < ai.path.length; i++)
    if (traceWorm(terrain, ai.path[i]!, worm).clear) {
      ai.currentNode = i;
      newNode = true;
    }
  if (!newNode && aiNow(frame) - ai.lastGoBackMs >= 1000) {
    for (let i = ai.currentNode; i >= 0; i--)
      if (traceWorm(terrain, ai.path[i]!, worm).clear) {
        if (ai.currentNode !== i) {
          ai.currentNode = i;
          ai.lastGoBackMs = aiNow(frame);
          newNode = true;
        }
        break;
      }
  }
  const node = ai.path[ai.currentNode]!;
  if (aiRopeAttached(frame)) {
    const force = normalized(ropeForce(worm));
    if (len2(minus(plus(force, worm), node)) > len2(minus(worm, node))) {
      worm.rope = null;
      ai.ropeAttachedMs = 0;
    }
  }
  const seeTarget = !!(traceAiWeapon(frame, ai.targetPosition).type & PX_EMPTY);
  if (
    ai.gameType === "rifles" &&
    ai.difficulty >= 2 &&
    worm.slots.filter((slot) => !slot.reloading).length <= 3 &&
    !seeTarget
  ) {
    const missing = ai.path.length - 1 - ai.currentNode;
    if (missing >= 3) reloadAiWeapons(frame);
    if (missing >= 3 && missing <= 5) {
      if (ai.ropeAttachedMs >= 700) worm.rope = null;
      return;
    }
  }
  let fireRope = false;
  const trace = traceLine(terrain, node, worm);
  const directPossible =
    f(trace.distance * trace.distance) > len2(minus(node, worm));
  if (
    Math.abs(sub(node.x, worm.x)) <= 50 &&
    trace.type & PX_DIRT &&
    node.y < worm.y
  ) {
    const clearing = findAiClearingWeapon(frame);
    if (clearing !== -1) {
      worm.weapon = clearing;
      controls.shoot = setAiAim(frame, node);
      if (controls.shoot) {
        controls.move = false;
        controls.jump = false;
      }
    } else {
      setAiAim(frame, node);
      jumpAi(frame);
      fireRope = true;
    }
  }
  if (
    !fireRope &&
    !directPossible &&
    trace.type & PX_DIRT &&
    trace.distance < 10
  ) {
    if (
      node.y < worm.y &&
      sub(worm.y, node.y) >= 10 &&
      sub(worm.y, node.y) <= 30
    )
      jumpAi(frame);
  } else {
    fireRope = true;
    for (const [index, slot] of worm.slots.entries()) {
      const weapon = weaponById(slot.weaponId);
      if (weapon && weapon.recoil < 0 && !slot.reloading) {
        worm.weapon = index;
        controls.shoot = setAiAim(frame, node);
        if (controls.shoot) fireRope = false;
        break;
      }
    }
  }
  if (
    fireRope &&
    ai.gameType === "rifles" &&
    seeTarget &&
    len2(minus(worm, ai.targetPosition)) <= 3600
  )
    fireRope = false;
  let stillAiming = false,
    ropeSpot = point(0, 0);
  if (fireRope) {
    fireRope = false;
    ropeSpot = bestAiRopeSpot(frame, node);
    const aimed = setAiAim(frame, ropeSpot);
    if (!aimed) stillAiming = true;
    if (aimed || !worm.onGround) {
      if (!worm.rope || (aiRopeAttached(frame) && ai.ropeAttachedMs > 500))
        fireRope = true;
      if (sub(worm.y, node.y) > 10) jumpAi(frame);
    }
  }
  if (fireRope) {
    shootRope(worm, faceDirection(worm));
    ai.ropeFlightMs = 0;
    ai.ropeAttachedMs = 0;
  } else {
    if (!seeTarget && !stillAiming) setAiAim(frame, node);
    if (sub(worm.y, node.y) <= 30 && sub(worm.y, node.y) > 10)
      if (!jumpAi(frame)) controls.move = true;
    if (
      stillAiming &&
      movingDisadvantages(frame, plus(worm, times(minus(ropeSpot, worm), 0.8)))
    ) {
      controls.move = false;
      return;
    }
  }
  if (
    aiRopeAttached(frame) &&
    !worm.onGround &&
    worm.rope!.y > worm.y &&
    node.y < worm.y &&
    Math.abs(sub(worm.rope!.x, worm.x)) <= 50 &&
    worm.vy <= 0
  ) {
    // Source's local `CVec force` is zero. Positive Classic gravity makes its
    // time estimate infinite and the resulting velocity comparison negative.
    worm.rope = null;
  }
  if (
    Math.abs(sub(ai.stuckPosition.x, worm.x)) < 5 &&
    Math.abs(sub(ai.stuckPosition.y, worm.y)) < 5
  ) {
    ai.stuckMs += frame.deltaMs;
    if (seconds(ai.stuckMs) > 3) {
      jumpAi(frame);
      controls.move = true;
      controls.carve = true;
      ai.stuck = true;
      ai.stuckPauseAtMs = aiNow(frame);
      worm.aim = Math.max(
        -90,
        Math.min(60, sub(worm.aim, mul(100, seconds(frame.deltaMs)))),
      );
      if (ai.stuckMs >= 5000) {
        if (ai.currentNode > 0) ai.currentNode--;
        ai.stuckMs = 0;
      }
      createAiPath(frame);
      return;
    }
  } else {
    ai.stuck = false;
    ai.stuckMs = 0;
    ai.stuckPosition = point(worm.x, worm.y);
  }
  controls.move = Math.abs(sub(worm.x, ai.path[ai.currentNode]!.x)) > 3;
}
