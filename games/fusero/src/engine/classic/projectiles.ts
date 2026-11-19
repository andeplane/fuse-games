/* LX56 projectile simulation — altered TypeScript port for Fusero.
 * Original merged ProjAction/CProjectile code by Albert Zeyer, 2009-05-22;
 * based on Jason Boettcher's work, enhanced by Dark Charlie and Albert Zeyer.
 * Code under LGPL. Upstream 0a20c6d0a10ed63b28a15f05c771913c294efbf6:
 * PhysicsLX56_Projectiles.cpp, CProjectile.cpp, CClient_Game.cpp and MathLib.cpp.
 */
import { CLASSIC_PROJECTILES } from "./catalog.js";
import type {
  ClassicAction,
  ClassicProjectile,
  ClassicSpawn,
  ClassicTrail,
  ClassicWeapon,
} from "./catalog-types.js";
import {
  MAX_CLASSIC_PROJECTILES,
  type ClassicProjectileState,
  type CombatWorld,
  type CombatWorm,
  type CombatPorts,
  type CombatEffect,
  type PreparedShot,
} from "./combat-types.js";
import { f, add, sub, mul, seconds, length2 } from "./physics-types.js";
import { fixedRandom, randomInt } from "./random.js";
import { sin, cos, atan2 } from "./math.js";
import { recordedPosition } from "./history.js";

const TOP = 1,
  RIGHT = 2,
  BOTTOM = 4,
  LEFT = 8;
interface Collision {
  worm: CombatWorm | null;
  terrain: boolean;
  border: boolean;
  onlyDirt: boolean;
}
type ProjectileOrigin = Pick<ClassicProjectileState, "x" | "y" | "vx" | "vy">;
const noCollision = (): Collision => ({
  worm: null,
  terrain: false,
  border: false,
  onlyDirt: false,
});
const hasCollision = (c: Collision) => !!c.worm || c.terrain;
const norm = (
  x: number,
  y: number,
): { x: number; y: number; length: number } => {
  const length = f(Math.sqrt(length2(x, y)));
  return length > 0
    ? { x: f(x / length), y: f(y / length), length }
    : { x: 0, y: 0, length: 0 };
};
export function angleVector(angle: number): { x: number; y: number } {
  const radians = mul(angle, f(Math.PI / 180));
  return { x: f(cos(radians)), y: f(sin(radians)) };
}
const nextFixed = (p: ClassicProjectileState): number => {
  const value = fixedRandom(p.randomIndex);
  p.randomIndex = (p.randomIndex + 1) % 255;
  return value;
};
const description = (p: ClassicProjectileState): ClassicProjectile =>
  CLASSIC_PROJECTILES[p.descriptorId]!;

function effect(
  world: CombatWorld,
  kind: CombatEffect["kind"],
  x: number,
  y: number,
  radius: number,
  lifeMs: number,
  extra: Partial<Pick<CombatEffect, "endX" | "endY" | "owner" | "sound">> = {},
): CombatEffect {
  const visual: CombatEffect = {
    id: world.nextId++,
    kind,
    x: f(x),
    y: f(y),
    radius,
    lifeMs,
    ...extra,
  };
  world.effects.push(visual);
  // Presentation pool only: every physical action/projectile still executes at the native 3000-slot limit.
  if (world.effects.length > 12000)
    world.effects.splice(0, world.effects.length - 12000);
  return visual;
}
function calculateCheckSteps(p: ClassicProjectileState): void {
  p.minCheck = 4;
  p.maxCheck = 6;
  p.avgCheck = 4;
  p.checkSpeedLen = Math.trunc(length2(p.vx, p.vy));
  if (p.checkSpeedLen < 14000) {
    p.minCheck = 0;
    p.maxCheck = 3;
    p.avgCheck = 2;
  } else if (p.checkSpeedLen < 75000) {
    p.minCheck = 0;
    p.maxCheck = 4;
    p.avgCheck = 2;
  } else if (p.checkSpeedLen < 250000) {
    p.minCheck = 1;
    p.maxCheck = 5;
    p.avgCheck = 2;
  } else {
    const rnd = (p.randomIndex % 3) * Math.sign(nextFixed(p));
    p.minCheck = 6;
    if (description(p).hit.name === "bounce") {
      p.maxCheck = 2;
      p.avgCheck = 2;
    } else {
      p.maxCheck = 9 + rnd;
      p.avgCheck = 6 + rnd;
    }
  }
}

/** Native FastVector has exactly 3000 reusable slots; exhausted shots fail to spawn in the original too. */
export function spawnClassicProjectile(
  world: CombatWorld,
  descriptorId: number,
  owner: string,
  weaponId: number,
  x: number,
  y: number,
  vx: number,
  vy: number,
  randomIndex: number,
  spawnTimeMs = world.elapsedMs,
  ignoreOwnerBeforeMs = spawnTimeMs + 100,
  rotation = 0,
  pool?: Map<number, ClassicProjectileState>,
): ClassicProjectileState | undefined {
  const d = CLASSIC_PROJECTILES[descriptorId];
  if (!d) throw new Error("Unknown Classic projectile descriptor");
  const occupied =
    pool ??
    new Map(world.projectiles.filter((p) => p.used).map((p) => [p.slot, p]));
  let slot = 0;
  while (slot < MAX_CLASSIC_PROJECTILES && occupied.get(slot)?.used) slot++;
  if (slot === MAX_CLASSIC_PROJECTILES) return;
  const index = ((randomIndex % 255) + 255) % 255;
  const p: ClassicProjectileState = {
    id: world.nextId++,
    slot,
    descriptorId,
    owner,
    weaponId,
    x: f(x),
    y: f(y),
    vx: f(vx),
    vy: f(vy),
    oldX: f(x),
    oldY: f(y),
    life: 0,
    extra: 0,
    randomIndex: index,
    timeVarRandom: fixedRandom(index),
    spawnTimeMs,
    lastSimulationMs: spawnTimeMs,
    ignoreOwnerBeforeMs,
    wallShootTime: 0,
    lastTrailMs: 0,
    rotation: f(rotation),
    frame: 0,
    frameDelta: true,
    firstBounce: true,
    minCheck: 0,
    maxCheck: 0,
    avgCheck: 0,
    checkSpeedLen: 0,
    collisionSide: 0,
    used: true,
  };
  // Spawn calculates the adaptive thresholds before its colour and wallshoot draws.
  calculateCheckSteps(p);
  // Even a one-colour pixel calls GetRandomInt(0) upstream, consuming the shared random stream.
  if (d.type === "pixel" && d.colors.length)
    randomInt(world, d.colors.length - 1);
  p.wallShootTime = add(0.011, f(nextFixed(p) / 1000));
  world.projectiles.push(p);
  occupied.set(slot, p);
  return p;
}

export function spawnShotProjectiles(
  world: CombatWorld,
  worm: CombatWorm,
  weapon: Extract<ClassicWeapon, { type: "projectile" }>,
  angle: number,
  shot?: PreparedShot,
): void {
  const originalVelocity = { x: shot?.vx ?? worm.vx, y: shot?.vy ?? worm.vy };
  const direction = angleVector(angle),
    x = add(shot?.x ?? worm.x, mul(direction.x, 8)),
    y = add(shot?.y ?? worm.y, mul(direction.y, 8));
  worm.vx = sub(worm.vx, mul(direction.x, weapon.recoil));
  worm.vy = sub(worm.vy, mul(direction.y, weapon.recoil));
  effect(world, "muzzle", worm.x, worm.y, 4, 80, {
    owner: worm.id,
    ...(weapon.useSound === 1 && weapon.sound ? { sound: weapon.sound } : {}),
  });
  let random = shot?.randomIndex ?? randomInt(world, 255);
  const d = CLASSIC_PROJECTILES[weapon.projectileId]!;
  for (let i = 0; i < weapon.amount; i++) {
    const spread = angleVector(
      add(angle, mul(fixedRandom(random), weapon.spread)),
    );
    let rotation = 0;
    if (d.type === "image" && d.rotating) {
      const increment = d.rotIncrement || 1;
      rotation =
        randomInt(world, Math.abs(Math.trunc(360 / increment))) * increment;
    }
    random = (random + 1) % 255;
    const variation = fixedRandom(random);
    const vx = add(
      add(
        mul(spread.x, weapon.speed),
        mul(mul(spread.x, weapon.speedVar), variation),
      ),
      originalVelocity.x,
    );
    const vy = add(
      add(
        mul(spread.y, weapon.speed),
        mul(mul(spread.y, weapon.speedVar), variation),
      ),
      originalVelocity.y,
    );
    random = (random * 5) % 255;
    spawnClassicProjectile(
      world,
      weapon.projectileId,
      worm.id,
      weapon.id,
      x,
      y,
      vx,
      vy,
      random,
      shot?.spawnTimeMs ?? world.elapsedMs,
      world.elapsedMs + 100,
      rotation,
    );
    random = (random + 1) % 255;
  }
}

function historicalPosition(
  worm: CombatWorm,
  timeMs: number,
  currentMs: number,
): { x: number; y: number } {
  return recordedPosition(
    worm.positionRecordings,
    Math.max(0, currentMs - timeMs),
  );
}
function wormCollision(
  p: ClassicProjectileState,
  x: number,
  y: number,
  worms: readonly CombatWorm[],
  currentMs: number,
): CombatWorm | null {
  const d = description(p),
    rx = Math.trunc(d.width / 2),
    ry = Math.trunc(d.height / 2);
  const radiusX = rx <= 2 ? 0 : rx,
    radiusY = ry <= 2 ? 0 : ry;
  const px = Math.trunc(x),
    py = Math.trunc(y);
  for (const worm of worms) {
    if (
      !worm.alive ||
      (worm.id === p.owner && p.ignoreOwnerBeforeMs > p.lastSimulationMs)
    )
      continue;
    const pos = historicalPosition(worm, p.lastSimulationMs, currentMs);
    const wx = Math.trunc(pos.x),
      wy = Math.trunc(pos.y);
    if (Math.abs(px - wx) < radiusX + 4 && Math.abs(py - wy) < radiusY + 4) {
      p.collisionSide = 0;
      if (px < wx - 2) p.collisionSide |= LEFT;
      else if (px > wx + 2) p.collisionSide |= RIGHT;
      if (py < wy - 2) p.collisionSide |= TOP;
      else if (py > wy + 2) p.collisionSide |= BOTTOM;
      return worm;
    }
  }
  return null;
}
function finalWormCheck(
  p: ClassicProjectileState,
  origin: ProjectileOrigin,
  worms: readonly CombatWorm[],
  ports: CombatPorts,
  current: Collision,
  currentMs: number,
): Collision {
  if (description(p).playerHit.name === "nothing") return current;
  const direction = norm(sub(p.x, origin.x), sub(p.y, origin.y));
  const length = Math.min(direction.length, ports.width + ports.height);
  for (let distance = 0; distance <= length; distance = add(distance, 2)) {
    const x = add(origin.x, mul(direction.x, distance)),
      y = add(origin.y, mul(direction.y, distance));
    const worm = wormCollision(p, x, y, worms, currentMs);
    if (worm) {
      if (description(p).playerHit.name !== "gothrough") {
        p.x = x;
        p.y = y;
        p.oldX = x;
        p.oldY = y;
        p.vx = origin.vx;
        p.vy = origin.vy;
      }
      return { worm, terrain: false, border: false, onlyDirt: false };
    }
  }
  return current;
}
interface TerrainCollision {
  left: number;
  right: number;
  top: number;
  bottom: number;
  collided: boolean;
  onlyDirt: boolean;
}
function terrainCollision(
  p: ClassicProjectileState,
  ports: CombatPorts,
): TerrainCollision {
  const d = description(p),
    rx = Math.trunc(d.width / 2),
    ry = Math.trunc(d.height / 2),
    px = Math.trunc(p.x),
    py = Math.trunc(p.y);
  const c: TerrainCollision = {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    collided: false,
    onlyDirt: true,
  };
  for (let y = py - ry; y <= py + ry; y++)
    for (let x = px - rx; x <= px + rx; x++) {
      const material = ports.material(x, y);
      if (material.particlePass) continue;
      if (y < py) c.top++;
      else if (y > py) c.bottom++;
      if (x < px) c.left++;
      else if (x > px) c.right++;
      if (!material.destroyable) c.onlyDirt = false;
      c.collided = true;
    }
  return c;
}
function horizontalContactSides(c: TerrainCollision, velocity: number): number {
  let sides = 0;
  if ((c.left > c.right || c.left > 2) && c.left > 1 && velocity <= 0)
    sides |= LEFT;
  if ((c.right > c.left || c.right > 2) && c.right > 1 && velocity >= 0)
    sides |= RIGHT;
  return sides;
}

function verticalContactSides(c: TerrainCollision, velocity: number): number {
  let sides = 0;
  if (c.top > 1 && velocity <= 0) sides |= TOP;
  if (c.bottom > 1 && velocity >= 0) sides |= BOTTOM;
  return sides;
}

function frame(
  p: ClassicProjectileState,
  dt: number,
  worms: readonly CombatWorm[],
  ports: CombatPorts,
  currentMs: number,
): Collision {
  const d = description(p),
    gravity = d.customGravity ? (d.gravity ?? 0) : 100;
  p.vy = add(p.vy, mul(gravity, dt));
  const origin = { x: p.x, y: p.y, vx: p.vx, vy: p.vy };
  const contact = moveAgainstTerrain(p, origin, dt, d, ports);
  return finalWormCheck(p, origin, worms, ports, contact, currentMs);
}

function rewindToSafePosition(
  p: ClassicProjectileState,
  origin: ProjectileOrigin,
): void {
  p.x = p.oldX;
  p.y = p.oldY;
  p.vx = origin.vx;
  p.vy = origin.vy;
}

function moveAgainstTerrain(
  p: ClassicProjectileState,
  origin: ProjectileOrigin,
  dt: number,
  d: ClassicProjectile,
  ports: CombatPorts,
): Collision {
  p.x = add(p.x, mul(p.vx, dt));
  p.y = add(p.y, mul(p.vy, dt));
  if (
    Math.trunc(length2(sub(p.oldX, p.x), sub(p.oldY, p.y))) <
    p.minCheck * p.minCheck
  )
    return noCollision();
  const px = Math.trunc(p.x),
    py = Math.trunc(p.y),
    rx = Math.trunc(d.width / 2),
    ry = Math.trunc(d.height / 2);
  p.collisionSide = 0;
  if (px < 0 || px - rx < 0) p.collisionSide |= LEFT;
  if (px >= ports.width || px + rx >= ports.width) p.collisionSide |= RIGHT;
  if (py < 0 || py - ry < 0) p.collisionSide |= TOP;
  if (py >= ports.height || py + ry >= ports.height) p.collisionSide |= BOTTOM;
  if (p.collisionSide) {
    rewindToSafePosition(p, origin);
    return { worm: null, terrain: true, border: true, onlyDirt: false };
  }
  if (p.lastSimulationMs <= p.spawnTimeMs + p.wallShootTime * 1000)
    return noCollision();
  const c = terrainCollision(p, ports);
  if (c.collided) {
    let ignore = false;
    if (d.hit.name === "explode" && c.onlyDirt) {
      // LX56 explodes inside dirt instead of resetting to the previous safe position.
    } else if (d.hit.name === "bounce" || d.hit.name === "nothing") {
      const bounce = d.hit.name === "bounce";
      if (!bounce) {
        p.x = add(origin.x, mul(mul(p.vx, dt), 0.5));
        p.y = add(origin.y, mul(mul(p.vy, dt), 0.5));
        p.oldX = p.x;
        p.oldY = p.y;
      }
      const vx = Math.trunc(p.vx),
        vy = Math.trunc(p.vy);
      const horizontal = horizontalContactSides(c, vx);
      const vertical = verticalContactSides(c, vy);
      // A velocity truncated to zero still rewinds a bounce, but adds no side bit.
      if (bounce && horizontal) p.x = origin.x;
      if (bounce && vertical) p.y = origin.y;
      if (vx) p.collisionSide |= horizontal;
      if (vy) p.collisionSide |= vertical;
      if (Math.abs(vx) < 2) p.vx = 0;
      if (Math.abs(vy) < 2) p.vy = 0;
    } else if (d.hit.name === "gothrough") {
      p.x = add(origin.x, mul(p.vx, dt));
      p.y = add(origin.y, mul(p.vy, dt));
      ignore = true;
    } else {
      rewindToSafePosition(p, origin);
    }
    if (!ignore)
      return {
        worm: null,
        terrain: true,
        border: false,
        onlyDirt: c.onlyDirt,
      };
  }
  p.oldX = p.x;
  p.oldY = p.y;
  return noCollision();
}
function moveProjectile(
  p: ClassicProjectileState,
  dt: number,
  worms: readonly CombatWorm[],
  ports: CombatPorts,
  currentMs: number,
  dtMs: number,
): Collision {
  const d = description(p);
  if (
    Math.trunc(d.dampening) === 1 &&
    (d.hit.name !== "bounce" || Math.trunc(d.hit.bounceCoeff) === 1)
  ) {
    const len = Math.trunc(length2(p.vx, p.vy));
    if (Math.abs(len - p.checkSpeedLen) > 50000) calculateCheckSteps(p);
  }
  if (d.dampening !== 1) {
    const damping =
      dt === seconds(11)
        ? d.dampening
        : f(Math.pow(d.dampening, f(Math.abs(dt) / seconds(11))));
    p.vx = mul(p.vx, damping);
    p.vy = mul(p.vy, damping);
  }
  const speed2 = length2(p.vx, p.vy);
  if (Math.trunc(mul(mul(speed2, dt), dt)) <= p.maxCheck * p.maxCheck)
    return frame(p, dt, worms, ports, currentMs);
  const check = Math.max(f(p.avgCheck / f(Math.sqrt(speed2))), f(0.001));
  // TimeDiff(float seconds) truncates to Uint64 milliseconds, rather than retaining fractional substeps.
  const checkMs = Math.trunc(mul(check, 1000));
  if (checkMs < dtMs) {
    for (let time = 0; time < dtMs; time += checkMs) {
      const hit = frame(
        p,
        seconds(Math.min(checkMs, dtMs - time)),
        worms,
        ports,
        currentMs,
      );
      if (hasCollision(hit)) return hit;
    }
    return noCollision();
  }
  return frame(p, dt, worms, ports, currentMs);
}

interface Actions {
  explode: boolean;
  damage: number;
  timer: boolean;
  dirt: boolean;
  green: boolean;
  remove: boolean;
  spawn: boolean;
  trail: boolean;
  sound?: string;
}
function explosion(
  world: CombatWorld,
  p: ClassicProjectileState,
  damage: number,
  ports: CombatPorts,
  worms: readonly CombatWorm[],
): CombatEffect | undefined {
  return explosionAt(
    world,
    p.x,
    p.y,
    damage,
    p.owner,
    p.lastSimulationMs,
    ports,
    worms,
  );
}
function explosionAt(
  world: CombatWorld,
  x: number,
  y: number,
  damage: number,
  owner: string,
  timeMs: number,
  ports: CombatPorts,
  worms: readonly CombatWorm[],
): CombatEffect | undefined {
  if (damage === -1) return;
  const bonusCount = ports.explodeBonuses?.(x, y) ?? 0;
  for (let i = 0; i < bonusCount; i++)
    explosionAt(world, x, y, 15, owner, timeMs, ports, worms);
  const removed = ports.carveHole(Math.trunc(damage), x, y);
  ports.onDirtRemoved?.(owner, removed);
  const visual = effect(
    world,
    "explosion",
    x,
    y,
    damage > 5 ? Math.trunc(damage) : 8,
    120,
    { owner },
  );
  for (const worm of worms)
    if (worm.alive) {
      const position = historicalPosition(worm, timeMs, world.elapsedMs);
      if (length2(sub(x, position.x), sub(y, position.y)) <= 25)
        ports.injure(worm.id, damage, owner);
    }
  return visual;
}
function bounce(p: ClassicProjectileState, coefficient: number): void {
  let x = 1,
    y = 1;
  if (p.collisionSide & TOP) {
    x = coefficient;
    y = -coefficient;
  }
  if (p.collisionSide & BOTTOM) {
    x = coefficient;
    y = -coefficient;
  }
  if (p.collisionSide & LEFT) {
    x = -coefficient;
    y = coefficient;
  }
  if (p.collisionSide & RIGHT) {
    x = -coefficient;
    y = coefficient;
  }
  p.vx = mul(p.vx, x);
  p.vy = mul(p.vy, y);
}
function applyAction(
  action: ClassicAction,
  p: ClassicProjectileState,
  collision: Collision | null,
  timer: boolean,
  info: Actions,
  world: CombatWorld,
  worms: readonly CombatWorm[],
  ports: CombatPorts,
  dt: number,
): void {
  let push = true,
    spawn = action.projectiles === 1;
  switch (action.name) {
    case "explode":
      info.explode = true;
      info.damage = action.damage;
      if (timer) info.timer = true;
      if (action.useSound === 1 && action.sound) info.sound = action.sound;
      break;
    case "bounce":
      if (timer) {
        spawn = false;
        break;
      }
      push = false;
      bounce(p, action.bounceCoeff);
      if ((action.bounceExplode ?? 0) > 0)
        explosion(world, p, action.bounceExplode!, ports, worms);
      break;
    case "carve":
      if (timer || collision?.terrain) {
        const removed = ports.carveHole(action.damage, p.x, p.y);
        ports.onDirtRemoved?.(p.owner, removed);
        info.remove = true;
      }
      break;
    case "dirt":
      info.dirt = true;
      break;
    case "greendirt":
      info.green = true;
      break;
    case "disappear2":
      info.remove = true;
      break;
    case "injure":
      if (collision?.worm) {
        info.remove = true;
        ports.injure(collision.worm.id, action.damage, p.owner);
        break;
      }
      if (collision?.border) info.remove = true;
      push = false;
      if (timer) spawn = false;
      break;
    case "disappear":
    case "gothrough":
    case "nothing":
      if (action.name === "disappear" && collision?.worm) break;
      if (collision?.border) info.remove = true;
      push = false;
      if (timer) spawn = false;
      break;
  }
  if (push && collision?.worm) {
    const direction = norm(p.vx, p.vy);
    collision.worm.vx = add(collision.worm.vx, mul(mul(direction.x, 100), dt));
    collision.worm.vy = add(collision.worm.vy, mul(mul(direction.y, 100), dt));
  }
  if (spawn) info.spawn = true;
}

function spawnChildren(
  world: CombatWorld,
  parent: ClassicProjectileState,
  spawn: ClassicSpawn | ClassicTrail,
  trail: boolean,
  pool: Map<number, ClassicProjectileState>,
): void {
  const headingDirection = norm(parent.vx, parent.vy);
  let heading = add(
    f(-atan2(headingDirection.x, headingDirection.y) * (180 / Math.PI)),
    90,
  );
  heading = f(((heading % 360) + 360) % 360);
  for (let i = 0; i < spawn.amount; i++) {
    const useParent =
      trail &&
      "useParentVelocityForSpread" in spawn &&
      spawn.useParentVelocityForSpread === 1;
    const useAngle = "useAngle" in spawn && spawn.useAngle === 1;
    const angle = "angle" in spawn ? spawn.angle : 0;
    const spread = useParent
      ? { x: mul(parent.vx, 0.3), y: mul(parent.vy, 0.3) }
      : angleVector(
          add(
            add(angle, useAngle ? heading : 0),
            mul(nextFixed(parent), spawn.spread),
          ),
        );
    const variation = nextFixed(parent);
    const vx = add(
      mul(spread.x, spawn.speed),
      mul(mul(trail ? 1 : spread.x, spawn.speedVar), variation),
    );
    const vy = add(
      mul(spread.y, spawn.speed),
      mul(mul(trail ? 1 : spread.y, spawn.speedVar), variation),
    );
    // Non-shot fixedRandomIndex is parent.index+1; spawning does not itself consume that index.
    spawnClassicProjectile(
      world,
      spawn.projectileId,
      parent.owner,
      parent.weaponId,
      parent.x,
      parent.y,
      vx,
      vy,
      parent.randomIndex + 1,
      parent.lastSimulationMs,
      parent.ignoreOwnerBeforeMs,
      0,
      pool,
    );
  }
}
function nativeActionExists(action: ClassicAction | undefined): boolean {
  return !!action && action.name !== "nothing";
}
function doFrame(
  world: CombatWorld,
  p: ClassicProjectileState,
  worms: readonly CombatWorm[],
  ports: CombatPorts,
  dtMs: number,
  pool: Map<number, ClassicProjectileState>,
): void {
  const d = description(p),
    dt = seconds(dtMs),
    info: Actions = {
      explode: false,
      damage: 0,
      timer: false,
      dirt: false,
      green: false,
      remove: false,
      spawn: false,
      trail: false,
    };
  if (
    d.timerTime > 0 &&
    add(d.timerTime, mul(d.timerVar, p.timeVarRandom)) < p.life &&
    d.timer
  )
    applyAction(d.timer, p, null, true, info, world, worms, ports, dt);
  const collision = moveProjectile(p, dt, worms, ports, world.elapsedMs, dtMs);
  p.life = add(p.life, dt);
  p.extra = add(p.extra, dt);
  if (d.type === "image") {
    if (d.rotating)
      p.rotation = f(
        ((add(p.rotation, mul(d.rotSpeed, dt)) % 360) + 360) % 360,
      );
    if (d.animating) {
      p.frame = add(p.frame, mul(d.animRate ?? 0, p.frameDelta ? dt : -dt));
      const frames = d.bitmap?.frameCount ?? 1;
      if (p.frame >= frames) {
        if (d.animType === 0) info.remove = true;
        else if (d.animType === 1) p.frame = 0;
        else {
          p.frameDelta = !p.frameDelta;
          p.frame = f(frames - 1);
        }
      } else if (p.frame < 0 && d.animType === 2) {
        p.frameDelta = !p.frameDelta;
        p.frame = 0;
      }
    }
  }
  if (d.trailType === 5 && d.trail && p.lastSimulationMs > p.lastTrailMs) {
    p.lastTrailMs = p.lastSimulationMs + d.trail.delayMs;
    info.trail = true;
  } else if (
    d.trailType > 0 &&
    d.trailType < 5 &&
    p.extra >= (d.trailType <= 2 ? f(0.075) : f(0.05))
  ) {
    p.extra = 0;
    effect(
      world,
      d.trailType === 1
        ? "smoke"
        : d.trailType === 2
          ? "chemical-smoke"
          : d.trailType === 3
            ? "doomsday"
            : "explosion",
      p.x,
      p.y,
      d.trailType === 4 ? 10 : 3,
      75,
    );
  }
  if (collision.terrain)
    applyAction(d.hit, p, collision, false, info, world, worms, ports, dt);
  if (collision.worm && !info.explode)
    applyAction(
      d.playerHit,
      p,
      collision,
      false,
      info,
      world,
      worms,
      ports,
      dt,
    );
  let explosionVisual: CombatEffect | undefined;
  if (info.explode) {
    let damage = info.damage;
    if (info.timer)
      damage =
        d.playerHit.name === "explode"
          ? d.playerHit.damage
          : d.timer?.name === "explode"
            ? d.timer.damage
            : 0;
    explosionVisual = explosion(world, p, damage, ports, worms);
    info.remove = true;
  }
  if (info.dirt) {
    let count = 0;
    for (const [dx, dy] of [
      [-6, -6],
      [6, -6],
      [0, 6],
    ])
      count += ports.placeDirt(add(p.x, dx!), add(p.y, dy!), false);
    ports.onDirtRemoved?.(p.owner, -count);
    info.remove = true;
  }
  if (info.green) {
    const placed = ports.placeDirt(p.x, p.y, true);
    ports.onDirtRemoved?.(p.owner, -placed);
    info.remove = true;
  }
  if (info.trail && d.trail) spawnChildren(world, p, d.trail, true, pool);
  if (info.spawn && d.spawn) spawnChildren(world, p, d.spawn, false, pool);
  // Native Proj_DoActionInfo plays the selected sample after the physical action and child spawns.
  // Every sound-bearing Classic action is a nonnegative explosion, so reuse its existing stable visual id.
  if (info.sound && explosionVisual) explosionVisual.sound = info.sound;
  if (
    !nativeActionExists(d.hit) &&
    !nativeActionExists(d.playerHit) &&
    !nativeActionExists(d.timer)
  ) {
    if (d.type !== "image" || !d.animating || d.animType !== 0)
      info.remove = true;
  }
  if (info.remove) p.used = false;
}

/** Physics catches up each pool slot in native allocation order, including child spawns into later free slots. */
export function stepProjectiles(
  world: CombatWorld,
  worms: readonly CombatWorm[],
  ports: CombatPorts,
  dtMs = 11,
): void {
  const pool = new Map(
    world.projectiles.filter((p) => p.used).map((p) => [p.slot, p]),
  );
  for (let slot = 0; slot < MAX_CLASSIC_PROJECTILES; slot++) {
    const p = pool.get(slot);
    if (!p?.used) continue;
    while (p.used && p.lastSimulationMs + dtMs <= world.elapsedMs) {
      p.lastSimulationMs += dtMs;
      doFrame(world, p, worms, ports, dtMs, pool);
    }
  }
  world.projectiles = world.projectiles.filter((p) => p.used);
}

/** Classic's beam has width one, stops on the first solid pixel or first worm, and has no radial blast. */
export function fireBeam(
  world: CombatWorld,
  worm: CombatWorm,
  weapon: Extract<ClassicWeapon, { type: "beam" }>,
  angle: number,
  ports: CombatPorts,
  origin: Pick<CombatWorm, "x" | "y"> = worm,
): void {
  const direction = angleVector(angle);
  let x = origin.x,
    y = origin.y;
  const limit = Math.min(weapon.beam.length, ports.width + ports.height + 8);
  for (let i = 0; i < limit; i++) {
    const material = ports.material(Math.trunc(x), Math.trunc(y));
    if (weapon.beam.damage !== -1 && ports.beamBonusAt?.(x, y)) {
      explosionAt(world, x, y, 0, worm.id, world.elapsedMs, ports, world.worms);
      break;
    }
    if (x <= 0 || y <= 0 || !material.particlePass) {
      if (weapon.beam.damage !== -1) {
        const removed = ports.carveHole(weapon.beam.damage, x, y);
        ports.onDirtRemoved?.(worm.id, removed);
      }
      break;
    }
    let hit = false;
    for (const target of world.worms)
      if (
        target.alive &&
        target.id !== worm.id &&
        length2(sub(x, target.x), sub(y, target.y)) < 25
      ) {
        ports.injure(target.id, weapon.beam.playerDamage, worm.id);
        hit = true;
        break;
      }
    if (hit) break;
    x = add(x, direction.x);
    y = add(y, direction.y);
  }
  effect(world, "beam", origin.x, origin.y, 1, 300, {
    endX: x,
    endY: y,
    owner: worm.id,
  });
}
