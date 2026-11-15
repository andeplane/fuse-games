/*
 * OpenLieroX LX56 worm/input physics — altered TypeScript port for Fusero.
 * Code under LGPL, based on Jason Boettcher's work, enhanced by Dark Charlie
 * and Albert Zeyer. Original PhysicsLX56.cpp created 9/2/2008.
 * Pinned source: 0a20c6d0a10ed63b28a15f05c771913c294efbf6,
 * src/common/PhysicsLX56.cpp:88–447; CWorm.cpp:1363;
 * CWormHuman.cpp:222–265,384–578. See distributed upstream COPYING.LIB.
 */
import {
  CLASSIC_PHYSICS,
  LEFT,
  RIGHT,
  UP,
  DOWN,
  JUMP,
  FIRE,
  ROPE,
  NEXT,
  PREV,
  CARVE,
  SLOT1,
  SLOT2,
  SLOT3,
  SLOT4,
  SLOT5,
  SELECT_MOD,
  STRAFE,
  INPUT_MASK,
  f,
  add,
  sub,
  mul,
  seconds,
  length2,
  wrap,
  faceDirection,
  type PhysicsWorm,
  type PhysicsTerrainPort,
  type ClassicControls,
  type ClassicPhysicsConfig,
} from "./physics-types.js";
import { shootRope, stepClassicRope, ropeForce } from "./rope.js";
export * from "./physics-types.js";
export { shootRope, stepClassicRope, ropeForce } from "./rope.js";

const clamp = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, n));
export function stepClassicAim(
  worm: PhysicsWorm,
  input: number,
  dtMs = 11,
  config: Readonly<ClassicPhysicsConfig> = CLASSIC_PHYSICS,
): void {
  const dt = seconds(dtMs),
    speed = Math.max(Math.abs(f(config.aimMaxSpeed)), 20),
    accel = Math.max(Math.abs(f(config.aimAcceleration)), 100);
  if (input & UP) {
    worm.aimSpeed = sub(worm.aimSpeed, mul(accel, dt));
    if (!config.aimLikeLX56)
      worm.aimSpeed = clamp(worm.aimSpeed, -speed, speed);
  } else if (input & DOWN) {
    worm.aimSpeed = add(worm.aimSpeed, mul(accel, dt));
    if (!config.aimLikeLX56)
      worm.aimSpeed = clamp(worm.aimSpeed, -speed, speed);
  } else {
    worm.aimSpeed = clamp(worm.aimSpeed, -speed, speed);
    if (config.aimLikeLX56) {
      const reduction = mul(200, dt);
      worm.aimSpeed =
        worm.aimSpeed > 0
          ? Math.max(0, sub(worm.aimSpeed, reduction))
          : Math.min(0, add(worm.aimSpeed, reduction));
    } else
      worm.aimSpeed = mul(
        worm.aimSpeed,
        f(Math.pow(f(config.aimFriction), mul(dt, 100))),
      );
    if (Math.abs(worm.aimSpeed) < 5) worm.aimSpeed = 0;
  }
  const angle = add(worm.aim, mul(worm.aimSpeed, dt));
  worm.aim = clamp(angle, -90, config.fullAimAngle ? 90 : 60);
  if (worm.aim !== angle) worm.aimSpeed = 0;
}
/** Human keyboard input: direction chords carve, jump clears rope, rope press rethrows. */
export function stepClassicControls(
  worm: PhysicsWorm,
  input: number,
  dtMs = 11,
  config: Readonly<ClassicPhysicsConfig> = CLASSIC_PHYSICS,
): ClassicControls {
  const bits = input & INPUT_MASK,
    pressed = bits & ~worm.input;
  const controls: ClassicControls = {
    move: false,
    jump: false,
    carve: false,
    shoot: false,
    weaponDelta: 0,
    weaponSlot: null,
  };
  if (!worm.alive) {
    worm.input = bits;
    return controls;
  }
  stepClassicAim(worm, bits, dtMs, config);
  // Upstream captures this before keyboard walking changes facing for this frame.
  const ropeDirection = faceDirection(worm);
  const selecting = !!(bits & SELECT_MOD);
  controls.shoot = !!(bits & FIRE);
  if (selecting)
    controls.weaponDelta = (pressed & RIGHT ? 1 : 0) - (pressed & LEFT ? 1 : 0);
  for (const [slot, bit] of [SLOT1, SLOT2, SLOT3, SLOT4, SLOT5].entries())
    if (bits & bit) controls.weaponSlot = slot;
  // Direct slot keys overwrite a preceding modifier/direction change; dedicated
  // previous/next is processed afterwards by the native input handler.
  if (controls.weaponSlot !== null) controls.weaponDelta = 0;
  controls.weaponDelta += (pressed & NEXT ? 1 : 0) - (pressed & PREV ? 1 : 0);
  if (!selecting) {
    if (bits & LEFT) {
      controls.move = true;
      if (!(bits & RIGHT)) {
        worm.moveFacing = -1;
        if (!(bits & STRAFE)) worm.facing = -1;
      }
      if (pressed & RIGHT) controls.carve = true;
    }
    if (bits & RIGHT) {
      controls.move = true;
      if (!(bits & LEFT)) {
        worm.moveFacing = 1;
        if (!(bits & STRAFE)) worm.facing = 1;
      }
      if (pressed & LEFT) controls.carve = true;
    }
  }
  controls.carve ||= !!(pressed & CARVE);
  controls.jump = !!(pressed & JUMP);
  if (controls.jump) worm.rope = null;
  if (pressed & ROPE) shootRope(worm, ropeDirection, config);
  worm.input = bits;
  return controls;
}
function pixelSolid(
  terrain: PhysicsTerrainPort,
  x: number,
  y: number,
  infinite: boolean,
): boolean {
  if (infinite) {
    x = wrap(x, terrain.width);
    y = wrap(y, terrain.height);
  }
  return !terrain.material(Math.trunc(x), Math.trunc(y)).wormPass;
}
export function checkOnGround(
  worm: PhysicsWorm,
  terrain: PhysicsTerrainPort,
  config: Readonly<ClassicPhysicsConfig> = CLASSIC_PHYSICS,
): boolean {
  const x = Math.trunc(worm.x),
    y = Math.trunc(worm.y);
  for (let dy = 6; dy > 0; dy--)
    if (
      pixelSolid(terrain, x - 2, y + dy, config.infiniteMap) ||
      pixelSolid(terrain, x + 2, y + dy, config.infiniteMap)
    )
      return true;
  return false;
}
/** The native cross-shaped pixel sweep, including its asymmetric ceiling/ground handling. */
export function moveAndCheckWormCollision(
  worm: PhysicsWorm,
  terrain: PhysicsTerrainPort,
  dt: number,
  jump: boolean,
  config: Readonly<ClassicPhysicsConfig> = CLASSIC_PHYSICS,
  oldX = worm.x,
  oldY = worm.y,
  jumpInput = jump,
): boolean {
  const dx = mul(mul(worm.vx, dt), config.speedFactor),
    dy = mul(mul(worm.vy, dt), config.speedFactor);
  const movement = length2(dx, dy);
  if (movement > mul(terrain.width, terrain.height)) return true;
  if (movement > 10 && dt > f(0.001)) {
    dt = f(dt / 2);
    if (
      moveAndCheckWormCollision(
        worm,
        terrain,
        dt,
        jump,
        config,
        oldX,
        oldY,
        jumpInput,
      )
    )
      return true;
    return moveAndCheckWormCollision(
      worm,
      terrain,
      dt,
      jump,
      config,
      oldX,
      oldY,
      jumpInput,
    );
  }
  let px = add(worm.x, dx),
    py = add(worm.y, dy);
  if (config.infiniteMap) {
    px = wrap(px, terrain.width);
    py = wrap(py, terrain.height);
  }
  worm.x = px;
  worm.y = py;
  let clip = 0,
    collision = false;
  const y = Math.trunc(py);
  if (y >= 0 && y < terrain.height)
    for (let x = -3; x < 4; x++) {
      if (!config.infiniteMap && add(px, x) <= 2) {
        clip |= 1;
        worm.x = 5;
        collision = true;
        worm.vx = Math.abs(worm.vx) > 40 ? mul(worm.vx, -0.4) : 0;
        continue;
      }
      if (!config.infiniteMap && add(px, x) >= terrain.width) {
        clip |= 2;
        worm.x = f(terrain.width - 5);
        collision = true;
        worm.vx = Math.abs(worm.vx) > 40 ? mul(worm.vx, -0.4) : 0;
        continue;
      }
      if (pixelSolid(terrain, Math.trunc(px) + x, y, config.infiniteMap)) {
        collision = true;
        if (x < 0) {
          clip |= 1;
          worm.x = add(add(px, x), 4);
        } else {
          clip |= 2;
          worm.x = sub(add(px, x), 4);
        }
        worm.vx = Math.abs(worm.vx) > 40 ? mul(worm.vx, -0.4) : 0;
      }
    }
  if (config.infiniteMap) px = wrap(px, terrain.width);
  worm.onGround = false;
  let hit = false;
  const x = Math.trunc(px);
  if (x >= 0 && x < terrain.width)
    for (let y = 5; y > -5; y--) {
      if (!config.infiniteMap && add(py, y) <= 1) {
        worm.y = 6;
        collision = true;
        clip |= 4;
        worm.vy = Math.abs(worm.vy) > 40 ? mul(worm.vy, -0.4) : 0;
        break;
      }
      if (!config.infiniteMap && add(py, y) >= terrain.height) {
        worm.y = f(terrain.height - 5);
        clip |= 8;
        collision = true;
        worm.onGround = true;
        worm.vy = Math.abs(worm.vy) > 40 ? mul(worm.vy, -0.4) : 0;
        continue;
      }
      if (pixelSolid(terrain, x, Math.trunc(py) + y, config.infiniteMap)) {
        collision = true;
        if (!hit && !jump)
          worm.vy =
            Math.abs(worm.vy) > 40 &&
            ((worm.vy > 0 && y > 0) || (worm.vy < 0 && y < 0))
              ? mul(worm.vy, -0.4)
              : 0;
        hit = true;
        worm.onGround = true;
        if (y < 0) {
          clip |= 4;
          worm.y = add(add(py, y), 5);
        } else {
          clip |= 8;
          worm.y = sub(add(py, y), 5);
        }
      }
    }
  if (config.infiniteMap) py = wrap(py, terrain.height);
  if (clip & 1 && clip & 2) worm.x = oldX;
  if (clip & 4 && clip & 8) {
    worm.y = oldY;
    if (!jumpInput) worm.x = oldX;
  }
  return collision;
}
/** Called after input/carving/rope and before the selected weapon's timer updates. */
export function stepClassicMovement(
  worm: PhysicsWorm,
  terrain: PhysicsTerrainPort,
  controls: ClassicControls,
  dtMs = 11,
  config: Readonly<ClassicPhysicsConfig> = CLASSIC_PHYSICS,
): void {
  if (!worm.alive) return;
  const dt = seconds(dtMs);
  if (controls.move) {
    const speed = worm.onGround ? config.groundSpeed : config.airSpeed,
      max = worm.onGround ? config.maxGroundMoveSpeed : config.maxAirMoveSpeed;
    if (worm.moveFacing === 1) {
      if (worm.vx < f(max)) worm.vx = add(worm.vx, mul(mul(speed, dt), 90));
    } else if (worm.vx > -f(max))
      worm.vx = sub(worm.vx, mul(mul(speed, dt), 90));
  }
  let jumped = false;
  if (controls.jump && checkOnGround(worm, terrain, config)) {
    worm.vy = f(config.jumpForce);
    worm.onGround = false;
    jumped = true;
  }
  if (!worm.onGround) {
    const drag = f(config.airFriction);
    worm.vx = sub(
      worm.vx,
      mul(mul(mul(mul(worm.vx, worm.vx), Math.sign(worm.vx)), drag), dt),
    );
    worm.vy = add(
      worm.vy,
      -mul(mul(mul(mul(worm.vy, worm.vy), Math.sign(worm.vy)), drag), dt),
    );
  }
  worm.vy = add(worm.vy, mul(config.gravity, dt));
  moveAndCheckWormCollision(
    worm,
    terrain,
    dt,
    jumped,
    config,
    worm.x,
    worm.y,
    controls.jump,
  );
  if (worm.onGround) {
    worm.vx = mul(worm.vx, sub(1, config.groundFriction));
    if (Math.abs(worm.vx) < f(config.groundStopSpeed) && !controls.move)
      worm.vx = 0;
  }
}
/**
 * Native movement uses11ms while human aim uses elapsed outer input-clock time
 * (CWormHuman.cpp130–135). A catch-up call at the same outer time may pass0.
 */
export function stepWorm(
  worm: PhysicsWorm,
  worms: readonly PhysicsWorm[],
  terrain: PhysicsTerrainPort,
  input: number,
  dtMs = 11,
  config: Readonly<ClassicPhysicsConfig> = CLASSIC_PHYSICS,
  inputDtMs = dtMs,
  controlsEnabled = true,
): ClassicControls {
  const controls: ClassicControls = controlsEnabled
    ? stepClassicControls(worm, input, inputDtMs, config)
    : {
        move: false,
        jump: false,
        carve: false,
        shoot: false,
        weaponDelta: 0,
        weaponSlot: null,
      };
  // Native weapon selection clears controls without pausing existing momentum,
  // rope physics, gravity or friction. It also skips aim/input acceleration.
  if (!controlsEnabled) worm.input = 0;
  return stepWormWithControls(worm, worms, terrain, controls, dtMs, config);
}

/**
 * Common native simulation after either CWormHuman or CWormBot has produced
 * its input state. Input-side rope actions and absolute aim/facing updates have
 * already happened. Unlike human key handling, this does not detach on jump.
 */
export function stepWormWithControls(
  worm: PhysicsWorm,
  worms: readonly PhysicsWorm[],
  terrain: PhysicsTerrainPort,
  controls: ClassicControls,
  dtMs = 11,
  config: Readonly<ClassicPhysicsConfig> = CLASSIC_PHYSICS,
): ClassicControls {
  if (!worm.alive) return controls;
  if (controls.carve) {
    const d = faceDirection({ aim: worm.aim, facing: worm.moveFacing });
    terrain.carve(add(worm.x, mul(d.x, 4)), add(worm.y, mul(d.y, 4)), 4);
  }
  if (worm.rope) {
    stepClassicRope(worm, worms, terrain, seconds(dtMs), config);
    const force = ropeForce(worm, config);
    worm.vx = add(worm.vx, mul(force.x, seconds(dtMs)));
    worm.vy = add(worm.vy, mul(force.y, seconds(dtMs)));
  }
  stepClassicMovement(worm, terrain, controls, dtMs, config);
  return controls;
}
