/*
 * OpenLieroX CNinjaRope / PhysicsLX56 — altered TypeScript port for Fusero.
 * Based on Jason Boettcher's work, enhanced by Dark Charlie and Albert Zeyer.
 * Code under LGPL. Upstream commit 0a20c6d0a10ed63b28a15f05c771913c294efbf6.
 * See src/client/CNinjaRope.cpp:95,231,249 and src/common/PhysicsLX56.cpp:505.
 */
import {
  CLASSIC_PHYSICS,
  add,
  mul,
  sub,
  f,
  length2,
  wrap,
  faceDirection,
  type PhysicsWorm,
  type PhysicsTerrainPort,
  type ClassicPhysicsConfig,
} from "./physics-types.js";

export function shootRope(
  worm: PhysicsWorm,
  direction = faceDirection(worm),
  config: Readonly<ClassicPhysicsConfig> = CLASSIC_PHYSICS,
): void {
  worm.rope = {
    x: worm.x,
    y: worm.y,
    vx: mul(direction.x, config.ropeSpeed),
    vy: mul(direction.y, config.ropeSpeed),
    state: "shooting",
    attachedId: null,
  };
  if (config.ropeAddParentSpeed) {
    worm.rope.vx = add(worm.rope.vx, worm.vx);
    worm.rope.vy = add(worm.rope.vy, worm.vy);
  }
}
export function ropeForce(
  worm: PhysicsWorm,
  config: Readonly<ClassicPhysicsConfig> = CLASSIC_PHYSICS,
): { x: number; y: number } {
  const rope = worm.rope;
  if (!rope || (rope.state !== "terrain" && rope.state !== "worm"))
    return { x: 0, y: 0 };
  const dx = sub(worm.x, rope.x),
    dy = sub(worm.y, rope.y),
    d2 = length2(dx, dy);
  if (d2 < mul(config.ropeRestLength, config.ropeRestLength) || d2 === 0)
    return { x: 0, y: 0 };
  const distance = f(Math.sqrt(d2)),
    force = mul(config.ropeStrength, -100);
  return { x: mul(f(dx / distance), force), y: mul(f(dy / distance), force) };
}
/** Includes the original flight substeps, falling tether and terrain/player attachment order. */
export function stepClassicRope(
  owner: PhysicsWorm,
  worms: readonly PhysicsWorm[],
  terrain: PhysicsTerrainPort,
  dt: number,
  config: Readonly<ClassicPhysicsConfig> = CLASSIC_PHYSICS,
): void {
  const rope = owner.rope;
  if (!rope) return;
  let fy = f(
      rope.state === "shooting"
        ? config.ropeGravity
        : config.ropeFallingGravity,
    ),
    fx = 0;
  const futureVY = add(rope.vy, mul(fy, dt));
  if (
    mul(mul(mul(length2(rope.vx, futureVY), dt), dt), config.ropePrecision) > 5
  ) {
    stepClassicRope(owner, worms, terrain, f(dt / 2), config);
    stepClassicRope(owner, worms, terrain, f(dt / 2), config);
    return;
  }
  if (rope.state === "shooting") {
    rope.vy = add(rope.vy, mul(fy, dt));
    rope.x = add(rope.x, mul(rope.vx, dt));
    rope.y = add(rope.y, mul(rope.vy, dt));
    if (
      length2(sub(owner.x, rope.x), sub(owner.y, rope.y)) >
      mul(config.ropeMaxLength, config.ropeMaxLength)
    ) {
      rope.vx = 0;
      rope.vy = 0;
      rope.state = "falling";
    }
  } else if (rope.state === "falling") {
    const dx = sub(owner.x, rope.x),
      dy = sub(owner.y, rope.y),
      d2 = length2(dx, dy);
    if (d2 > mul(config.ropeRestLength, config.ropeRestLength)) {
      const inverse = d2 ? f(1 / Math.sqrt(d2)) : 1;
      fx = add(fx, mul(mul(mul(dx, inverse), 10000), dt));
      fy = add(fy, mul(mul(mul(dy, inverse), 10000), dt));
    }
    rope.vx = add(rope.vx, mul(fx, dt));
    rope.vy = add(rope.vy, mul(fy, dt));
    rope.x = add(rope.x, mul(rope.vx, dt));
    rope.y = add(rope.y, mul(rope.vy, dt));
  }
  let outside = false;
  if (
    rope.attachedId === null &&
    !config.infiniteMap &&
    (rope.x <= 0 ||
      rope.y <= 0 ||
      rope.x >= terrain.width - 1 ||
      rope.y >= terrain.height - 1)
  ) {
    rope.state = "terrain";
    rope.vx = 0;
    rope.vy = 0;
    rope.x = Math.min(terrain.width - 1, Math.max(0, rope.x));
    rope.y = Math.min(terrain.height - 1, Math.max(0, rope.y));
    outside = true;
  }
  if (rope.attachedId === null) {
    // The native routine clears HookAttached before rechecking the material each step.
    if (rope.state === "terrain") rope.state = "falling";
    const px = wrap(Math.trunc(rope.x), terrain.width),
      py = wrap(Math.trunc(rope.y), terrain.height);
    const material = terrain.material(px, py);
    if (!material.particlePass || outside) {
      if (!outside && !material.canHook) {
        rope.vx = 0;
        rope.vy = 0;
        rope.state = "falling";
      } else {
        rope.state = "terrain";
        rope.vx = 0;
        rope.vy = 0;
      }
    }
  }
  if (
    config.ropeCanAttachWorm &&
    rope.state !== "terrain" &&
    rope.state !== "worm" &&
    rope.attachedId === null
  ) {
    for (const worm of worms)
      if (
        worm.id !== owner.id &&
        worm.alive &&
        length2(sub(worm.x, rope.x), sub(worm.y, rope.y)) < 25
      ) {
        rope.state = "worm";
        rope.attachedId = worm.id;
        rope.vx = 0;
        rope.vy = 0;
        break;
      }
  } else if (rope.state === "worm" && rope.attachedId !== null) {
    const target = worms.find((w) => w.id === rope.attachedId && w.alive);
    if (!target) {
      rope.state = "falling";
      rope.attachedId = null;
      rope.vx = 0;
      rope.vy = 0;
    } else {
      rope.x = target.x;
      rope.y = target.y;
    }
  }
}
