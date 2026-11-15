/* Altered Classic port of OpenLieroX CWormBot.cpp:1776–2633,2695–2809,
 * CProjectile.cpp:173–226 and MathLib.cpp:204–222.
 * Pinned 0a20c6d0a10ed63b28a15f05c771913c294efbf6. LGPL.
 * Jason Boettcher, Dark Charlie, Albert Zeyer and contributors.
 */
import {
  CLASSIC_PROJECTILES,
  weaponById,
  type ClassicProjectile,
} from "./catalog.js";
import { aiNow, type NativeAiFrame } from "./ai-state.js";
import {
  aiTargetPosition,
  findAiTarget,
  setAiAim,
  AI_D2R,
  AI_R2D,
} from "./ai-targeting.js";
import { checkOnGround } from "./physics.js";
import { f, add, sub, mul } from "./physics-types.js";
import { atan2, cos, sin } from "./math.js";
import { randomInt, randomSigned } from "./random.js";
import {
  len,
  len2,
  minus,
  normalized,
  plus,
  point,
  times,
  traceWorm,
  PX_DIRT,
  PX_EMPTY,
  PX_ROCK,
  type AiPoint,
  type AiTerrain,
} from "./ai-geometry.js";

export const aiRopeAttached = (frame: NativeAiFrame): boolean =>
  frame.worm.rope?.state === "terrain" || frame.worm.rope?.state === "worm";
const currentWeapon = (frame: NativeAiFrame) =>
  weaponById(frame.worm.slots[frame.worm.weapon]!.weaponId);

export function findAiClearingWeapon(frame: NativeAiFrame): number {
  const ignoreSelfHit = !frame.world.settings.selfInjure;
  for (const [index, slot] of frame.worm.slots.entries()) {
    const weapon = weaponById(slot.weaponId);
    if (weapon?.type !== "projectile") continue;
    const projectile = CLASSIC_PROJECTILES[weapon.projectileId]!;
    if (
      !ignoreSelfHit &&
      weapon.speed < 100 &&
      (!projectile.customGravity || projectile.gravity! > 30)
    )
      continue;
    if (/dirt|napalm|grenade|nuke|mine/.test(weapon.name.toLowerCase()))
      continue;
    if (
      projectile.hit.type !== 5 &&
      projectile.hit.type !== 6 &&
      projectile.hit.type !== 0 &&
      !slot.reloading
    )
      return index;
  }
  // Native fallback deliberately does not check a beam's Reloading flag.
  return frame.worm.slots.findIndex(
    (slot) => weaponById(slot.weaponId)?.type === "beam",
  );
}

/** traceWeaponLine has its own forward fraction and thin-wall stepping, unlike CWorm::traceLine. */
export function traceAiWeapon(
  frame: NativeAiFrame,
  target: AiPoint,
): { distance: number; fraction: number; type: number } {
  let pos = point(frame.worm.x, frame.worm.y);
  const delta = minus(target, pos),
    total = Math.trunc(len(delta)),
    dir = normalized(delta);
  const weapon = currentWeapon(frame);
  if (!weapon) return { distance: 0, fraction: 0, type: PX_EMPTY };
  let first = 7,
    divisions = 5;
  if (weapon.type === "beam") {
    first = 1;
    divisions = 1;
  } else if (frame.ai.gameType === "rifles") {
    first = 10;
    divisions = 6;
  } else if (frame.ai.gameType === "100lt") {
    first = 6;
    divisions = 3;
  }
  first = Math.max(first + 5, 1);
  divisions = Math.max(1, Math.min(divisions, total));
  let step = first,
    i = 0;
  for (; i < total; i += step) {
    const flag = frame.terrain.flag(pos.x, pos.y);
    if (i > first) step = divisions;
    if (flag & (PX_DIRT | PX_ROCK))
      return {
        distance: i,
        fraction: total ? f(f(i) / f(total)) : 0,
        type: flag,
      };
    pos = plus(pos, times(dir, step));
  }
  return {
    distance: total,
    fraction: total ? f(f(i) / f(total)) : 0,
    type: PX_EMPTY,
  };
}

export function aiRockBetween(
  terrain: AiTerrain,
  from: AiPoint,
  to: AiPoint,
): number {
  let pos = { ...from },
    count = 0;
  const delta = minus(to, pos),
    total = Math.trunc(len(delta)),
    dir = normalized(delta);
  for (let i = 0; i < total; i += 4) {
    if (terrain.flag(pos.x, pos.y) & PX_ROCK) count++;
    pos = plus(pos, times(dir, 4));
  }
  return count;
}

export function chooseAiWeapon(
  frame: NativeAiFrame,
  distance: number,
  direct: boolean,
  traceFraction: number,
): number {
  const { worm, ai, world, controls } = frame;
  const delay = [500, 300, 200, 120][ai.difficulty]!;
  if (aiNow(frame) - ai.lastWeaponChangeMs <= delay) return worm.weapon;
  ai.lastWeaponChangeMs = aiNow(frame);
  const ready = (slot: number) => !worm.slots[slot]!.reloading;
  if (ai.gameType === "rifles")
    return worm.slots.findIndex((slot) => !slot.reloading);
  const target = aiTargetPosition(frame);
  if (ai.gameType === "100lt") {
    const difference = minus(worm, target),
      d = len(difference);
    if (
      worm.y <= target.y &&
      len2(difference) < 10000 &&
      traceWorm(frame.terrain, target, worm).clear &&
      ready(1)
    ) {
      const enemy = world.worms.find((entry) => entry.id === ai.targetWormId);
      if (enemy && checkOnGround(enemy, frame.physicsTerrain)) return 1;
    }
    if (d < 50) {
      if (direct) {
        if (ready(0)) return 0;
        if (ready(4)) return 4;
        if (ready(3)) return 3;
        if (ready(2) && !aiRopeAttached(frame)) {
          controls.move = false;
          return 2;
        }
      } else {
        controls.jump = true;
        return -1;
      }
    }
    if (d > 50 && d <= 300 && direct) {
      if (ready(4)) return 4;
      if (ready(2) && !worm.rope) {
        controls.move = false;
        return 2;
      }
      if (ready(0)) return 0;
      if (ready(3) && !aiRopeAttached(frame)) {
        controls.move = false;
        return 3;
      }
    }
    if (d > 300 && direct) {
      if (ready(3) && !aiRopeAttached(frame)) {
        controls.move = false;
        return 3;
      }
      if (ready(0)) return 0;
      if (ready(4)) return 4;
      if (ready(2) && !worm.rope) {
        controls.move = false;
        return 2;
      }
    }
  }
  const find = (
    predicate: (weapon: NonNullable<ReturnType<typeof weaponById>>) => boolean,
  ) =>
    worm.slots.findIndex((slot) => {
      const weapon = weaponById(slot.weaponId);
      return !slot.reloading && !!weapon && predicate(weapon);
    });
  const beam = () => find((weapon) => weapon.type === "beam");
  const projectile = () =>
    find(
      (weapon) =>
        weapon.type === "projectile" &&
        ![5, 6].includes(CLASSIC_PROJECTILES[weapon.projectileId]!.hit.type),
    );
  const randomReady = (): number => {
    for (let i = 0; i < worm.slots.length; i++) {
      const index = randomInt(world, worm.slots.length - 1),
        slot = worm.slots[index]!;
      if (!slot.reloading && weaponById(slot.weaponId)) return index;
    }
    return -1;
  };
  if (target.y > frame.terrain.height - 50 && distance < 200) {
    const slot = find(
      (weapon) =>
        weapon.type === "projectile" &&
        CLASSIC_PROJECTILES[weapon.projectileId]!.hit.type === 1,
    );
    if (slot >= 0) return slot;
  }
  // The native <100 and <150 blocks have identical active logic.
  if (distance < 150 && direct) {
    const b = beam();
    if (b >= 0) return b;
    const p = projectile();
    if (p >= 0) return p;
  }
  if (direct) {
    const p = projectile();
    if (p >= 0) return p;
    const b = beam();
    if (b >= 0) return b;
    const r = randomReady();
    if (r >= 0) return r;
  }
  // AI_CheckFreeCells is an unconditional true in this pinned source.
  if (
    distance > 190 &&
    worm.health > 25 &&
    traceFraction > 0.5 &&
    sub(target.y, 20) > worm.y
  ) {
    const slot = find(
      (weapon) =>
        weapon.type === "projectile" &&
        [0, 1].includes(CLASSIC_PROJECTILES[weapon.projectileId]!.hit.type),
    );
    if (slot >= 0) return slot;
  }
  const b = beam();
  if (b >= 0) return b;
  const r = randomReady();
  if (r >= 0) return r;
  return find(() => true);
}

/** Legacy ballistic validity calculation; its returned angle is not applied by AI_Shoot. */
export function aiAimingAngle(
  speed: number,
  gravity: number,
  x: number,
  rawY: number,
): { good: boolean; angle: number } {
  const v2 = mul(speed, speed),
    x2 = mul(x, x),
    g2 = mul(gravity, gravity),
    y2 = mul(rawY, rawY);
  let y = rawY;
  if (Math.abs(y) < 3 && y <= 0) y = -y;
  const tmp1 = f(
    Math.abs(
      add(sub(mul(mul(mul(-2, v2), y), gravity), mul(g2, x2)), mul(v2, v2)),
    ),
  );
  const root1 = f(Math.sqrt(tmp1));
  const tmp2 = add(
    add(mul(-x2, root1), mul(mul(x2, y), gravity)),
    mul(v2, add(x2, mul(2, y2))),
  );
  if (tmp2 < 0) return { good: false, angle: 0 };
  const tmp3 = add(sub(root1, mul(y, gravity)), v2);
  if (tmp3 <= 0 || x === 0) return { good: false, angle: 60 };
  const ratio = f(f(Math.sqrt(tmp2)) / mul(x, f(Math.sqrt(tmp3))));
  let angle = f(atan2(ratio, 1));
  if (x < 0) angle = -angle;
  if (y > 0) angle = -angle;
  angle = mul(angle, AI_R2D);
  if (angle > 60) return { good: false, angle: 60 };
  if (angle < -90) return { good: false, angle: -90 };
  return { good: true, angle };
}

/** Source tangent parabola, including the legacy D2R conversion constant. */
export function aiParabola(
  from: AiPoint,
  angle: number,
  to: AiPoint,
): { a: number; b: number; c: number } {
  const p = from.x,
    r = from.y,
    s = to.x,
    t = to.y;
  const cosine = f(cos(angle)),
    sine = f(sin(angle));
  const denominator = mul(mul(sub(p, s), sub(p, s)), cosine);
  if (denominator === 0) return { a: 0, b: 0, c: 0 };
  const a = f(-add(mul(sub(r, t), cosine), mul(sub(s, p), sine)) / denominator);
  const b = f(
    add(
      mul(mul(mul(2, p), sub(r, t)), cosine),
      mul(mul(add(p, s), sub(s, p)), sine),
    ) / denominator,
  );
  const c = f(
    add(
      mul(
        add(
          sub(mul(mul(p, p), t), mul(mul(mul(2, p), r), s)),
          mul(mul(r, s), s),
        ),
        cosine,
      ),
      mul(mul(mul(p, s), sub(p, s)), sine),
    ) / denominator,
  );
  return { a, b, c };
}

function trajectoryCollision(
  terrain: AiTerrain,
  projectile: ClassicProjectile,
  dt: number,
  position: AiPoint,
  velocity: AiPoint,
): boolean {
  const width = projectile.type === "pixel" ? 1 : 2;
  if (len2(times(velocity, dt)) > 4 * width * width + 4 * width + 1) {
    dt = mul(dt, 0.5);
    if (trajectoryCollision(terrain, projectile, dt, position, velocity))
      return true;
    return trajectoryCollision(
      terrain,
      projectile,
      dt,
      plus(position, times(velocity, dt)),
      velocity,
    );
  }
  const pos = plus(position, times(velocity, dt)),
    px = Math.trunc(pos.x),
    py = Math.trunc(pos.y);
  if (
    !Number.isFinite(px) ||
    !Number.isFinite(py) ||
    px - width < 0 ||
    py - width < 0 ||
    px + width >= terrain.width ||
    py + width >= terrain.height
  )
    return true;
  for (let y = py - width; y <= py + width; y++)
    for (let x = px - width; x <= px + width; x++)
      if (terrain.flag(x, y) & (PX_DIRT | PX_ROCK)) return true;
  return false;
}

/** Native gravity/speed noise consumes shared RNG although those two perturbed values are unused afterwards. */
export function aiWeaponCanHit(
  frame: NativeAiFrame,
  targetPosition: AiPoint,
): boolean {
  const { ai, shared, world, worm } = frame;
  if (ai.targetWormId === null) return false;
  const weapon = currentWeapon(frame);
  if (weapon?.type !== "projectile") return false;
  const projectile = CLASSIC_PROJECTILES[weapon.projectileId]!;
  let target = { ...targetPosition };
  if (ai.difficulty < 3) {
    if (aiNow(frame) - shared.trajectoryNoiseAtMs > 500) {
      for (let i = 0; i < 4; i++)
        shared.trajectoryNoise[i] = randomSigned(world);
      shared.trajectoryNoiseAtMs = aiNow(frame);
    }
    const spread = f((3 - ai.difficulty) / 3);
    target = point(
      add(target.x, mul(mul(shared.trajectoryNoise[2], spread), 50)),
      add(target.y, mul(mul(shared.trajectoryNoise[3], spread), 50)),
    );
  }
  let from = point(worm.x, worm.y),
    to = target,
    xVelocity = 1;
  if (from.x > to.x) {
    from = target;
    to = point(worm.x, worm.y);
    xVelocity = -1;
  } else if (from.x === to.x) return true;
  let alpha = mul(worm.aim, AI_D2R);
  if (target.y > worm.y) alpha = -alpha;
  const p = aiParabola(worm, alpha, target);
  if (p.a > f(0.1)) return false;
  const yAt = (x: number) => add(add(mul(mul(p.a, x), x), mul(p.b, x)), p.c);
  let lastY = yAt(add(from.x, 5));
  for (let x = add(from.x, 5); x < to.x; x = add(x, 1)) {
    const y = yAt(x);
    if (
      trajectoryCollision(
        frame.terrain,
        projectile,
        1,
        point(x, y),
        point(xVelocity, sub(y, lastY)),
      )
    )
      return false;
    lastY = y;
  }
  return true;
}

export function canAiShootCurrent(frame: NativeAiFrame): boolean {
  const slot = frame.worm.slots[frame.worm.weapon];
  return (
    !!slot &&
    !slot.reloading &&
    slot.lastFire <= 0 &&
    !!weaponById(slot.weaponId)
  );
}

/** CWormBot::AI_Shoot for Classic DeathMatch on the canonical native local/listen host. */
export function shootAi(frame: NativeAiFrame): boolean {
  if (!canAiShootCurrent(frame)) return false;
  const enemy = findAiTarget(frame);
  if (!enemy) return false;
  const { worm, ai, world, controls } = frame;
  const target = point(enemy.x, enemy.y),
    difference = minus(target, worm),
    distance = len(difference);
  const trace = traceAiWeapon(frame, target);
  let direct = !(trace.type & PX_ROCK);
  if (trace.type & PX_DIRT) {
    direct = false;
    if (
      difference.y < 0 &&
      Math.abs(difference.y) > Math.abs(difference.x) &&
      sub(distance, trace.fraction) > 40
    ) {
      const clearing = findAiClearingWeapon(frame);
      if (clearing >= 0 && aiRockBetween(frame.terrain, worm, target) <= 3) {
        worm.weapon = clearing;
        if (setAiAim(frame, target)) {
          controls.shoot = true;
          return true;
        }
        return false;
      }
    }
  }
  const selected = chooseAiWeapon(frame, distance, direct, trace.fraction);
  if (selected < 0) return false;
  worm.weapon = selected;
  const weapon = currentWeapon(frame);
  if (!weapon) return false;
  let aimed = false,
    wantsShot = false;
  if (weapon.type === "projectile") {
    const projectile = CLASSIC_PROJECTILES[weapon.projectileId]!;
    if (projectile.hit.type !== 5 && projectile.hit.type !== 6) {
      // CVec::Normalize divides by zero for coincident worms. Native continues
      // through that NaN path and still consumes the spread RNG before rejecting
      // the too-close shot; NormalizeVector's zero guard would change the stream.
      const directionLength = len(difference);
      const direction = point(
        f(difference.x / directionLength),
        f(difference.y / directionLength),
      );
      const mySpeed = add(mul(direction.x, worm.vx), mul(direction.y, worm.vy));
      const speed = add(
        add(f(weapon.speed), mul(weapon.speedVar, 100)),
        mySpeed,
      );
      if (!(speed < 0)) {
        let x = sub(target.x, worm.x),
          y = sub(worm.y, target.y);
        const time = mul(
          speed !== 0 ? f(Math.sqrt(add(mul(x, x), mul(y, y))) / speed) : 0,
          0.7,
        );
        if (!(time < 0)) {
          x = add(x, mul(time, enemy.vx));
          y = sub(y, mul(time, enemy.vy));
        }
        let gravity = projectile.customGravity ? f(projectile.gravity!) : 100;
        let child: ClassicProjectile | undefined = projectile;
        const visited = new Set<number>();
        while (child && !visited.has(child.id)) {
          visited.add(child.id);
          if (child.customGravity)
            gravity = Math.max(gravity, f(child.gravity!));
          else if (gravity < 100) gravity = 100;
          if (child.timer?.projectiles) {
            if (child.timerTime >= 0.5) break;
          } else if (
            child.hit.projectiles ||
            child.playerHit.projectiles ||
            child.touch.projectiles
          )
            break;
          child = child.spawn
            ? CLASSIC_PROJECTILES[child.spawn.projectileId]
            : undefined;
        }
        const solution = aiAimingAngle(speed, gravity, x, y);
        if (solution.good) {
          // Alpha/spread is calculated in source but never applied to the worm angle.
          if (aiNow(frame) - ai.lastRandomChangeMs >= 500) {
            const magnitude = randomInt(world, [13, 8, 3, 0][ai.difficulty]!);
            // MathLib's SIGN macro evaluates its argument again when the first
            // draw is nonpositive. A normal Math.sign call consumes too little
            // randomness and changes subsequent aim/trajectory samples.
            const sign =
              randomSigned(world) > 0 ? 1 : randomSigned(world) < 0 ? -1 : 0;
            ai.randomSpread = (magnitude * sign) | 0;
            ai.lastRandomChangeMs = aiNow(frame);
          }
          aimed = gravity <= 10 || speed >= 200 ? direct : true;
          if (aimed) {
            wantsShot = true;
            const squared = len2(difference);
            if (squared >= 2500) {
              aimed = setAiAim(frame, target);
              if (aimed && gravity >= 10 && speed <= 200)
                wantsShot = aimed = aiWeaponCanHit(
                  frame,
                  plus(worm, point(x, -y)),
                );
            } else if (squared >= 100) {
              aimed = setAiAim(frame, target);
              wantsShot = true;
            } else {
              aimed = false;
              wantsShot = false;
            }
          }
        }
      }
    }
  } else {
    const dist = Math.trunc(distance);
    if (direct && weapon.beam.length >= dist)
      wantsShot = aimed = setAiAim(frame, target) || dist <= 25;
    else {
      if (direct) setAiAim(frame, target);
      wantsShot = aimed = false;
    }
  }
  // game.isClient() is false for the pinned local/listen-host timing profile.
  // Its client-only in-flight suicide avoidance block is consequently inactive.
  if (!aimed) {
    ai.badAimMs += frame.deltaMs;
    if (ai.badAimMs > 4000) {
      let empty = true;
      const x = Math.trunc(worm.x),
        y = Math.trunc(sub(worm.y, 5));
      for (let dy = y - 3; empty && dy < y + 3; dy++)
        for (let dx = x - 3; dx < x + 3; dx++)
          if (frame.terrain.flag(dx, dy) & (PX_DIRT | PX_ROCK)) {
            empty = false;
            break;
          }
      if (empty) controls.jump = true;
      ai.badAimMs = 0;
    }
    return wantsShot;
  }
  ai.badAimMs = 0;
  ai.lastShootTarget = target;
  controls.shoot = true;
  ai.lastShootMs = aiNow(frame);
  return true;
}
