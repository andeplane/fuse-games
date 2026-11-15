/* Altered TypeScript port of OpenLieroX LX56 weapon charge and shooting.
 * Source: PhysicsLX56.cpp:471-499, CServer_Game.cpp:366-466, CClient_Game.cpp:852-1048.
 * Based on Jason Boettcher's work, enhanced by Dark Charlie and Albert Zeyer.
 * Code under LGPL. Pinned upstream 0a20c6d0a10ed63b28a15f05c771913c294efbf6.
 */
import { weaponById } from "./catalog.js";
import type {
  CombatPorts,
  CombatWorld,
  CombatWorm,
  WeaponSlot,
  PreparedShot,
} from "./combat-types.js";
export type { PreparedShot } from "./combat-types.js";
import { f, seconds, add, sub, mul } from "./physics-types.js";
import { fireBeam, spawnShotProjectiles } from "./projectiles.js";
import { randomInt } from "./random.js";

export function createWeaponSlots(loadout: readonly number[]): WeaponSlot[] {
  if (loadout.length !== 5 || loadout.some((id) => !weaponById(id)))
    throw new Error("A Classic loadout has five valid weapon slots");
  return loadout.map((weaponId) => ({
    weaponId,
    charge: 1,
    reloading: false,
    lastFire: 0,
  }));
}

/** Only the selected weapon's timers advance. A negative LastFire is retained, as in native float arithmetic. */
export function stepWeaponTimers(
  worm: CombatWorm,
  dtMs = 11,
  loadingTime = 100,
): void {
  const slot = worm.slots[worm.weapon];
  if (!slot) return;
  const weapon = weaponById(slot.weaponId);
  if (!weapon) return;
  const dt = seconds(dtMs);
  if (slot.lastFire > 0) slot.lastFire = sub(slot.lastFire, dt);
  if (slot.reloading) {
    if (Math.trunc(loadingTime) === 0) slot.charge = 1;
    else {
      const recharge = f(weapon.recharge / 10);
      const loadingScale = f(1 / mul(Math.trunc(loadingTime), 0.01));
      slot.charge = add(slot.charge, mul(dt, mul(recharge, loadingScale)));
    }
    if (slot.charge >= 1) {
      slot.charge = 1;
      slot.reloading = false;
    }
  }
}

/** Native PlayerShoot's beam countdown shares the slot used by the listen server's ROF gate.
 * It runs once per executed LX physics iteration, using Game's10ms outer-frame delta.
 */
export function stepClientWeapon(worm: CombatWorm, frameDtMs = 10): void {
  const slot = worm.slots[worm.weapon];
  if (!worm.alive || !slot || slot.reloading) return;
  if (weaponById(slot.weaponId)?.type === "beam" && slot.lastFire > 0)
    slot.lastFire = sub(slot.lastFire, seconds(frameDtMs));
}

/** The integer shot angle is part of the original server shoot-list contract. */
export function shotAngle(worm: Pick<CombatWorm, "aim" | "facing">): number {
  let angle = worm.facing === -1 ? sub(180, worm.aim) : worm.aim;
  if (angle < 0) angle = add(angle, 360);
  if (angle > 360) angle = sub(angle, 360);
  if (angle === 360) angle = 0;
  return Math.trunc(angle);
}

export function prepareWeaponShot(
  world: CombatWorld,
  worm: CombatWorm,
): PreparedShot | undefined {
  if (!worm.alive) return;
  const slot = worm.slots[worm.weapon];
  if (!slot || slot.reloading || slot.lastFire > 0) return;
  const weapon = weaponById(slot.weaponId);
  if (!weapon) return;
  slot.lastFire = f(weapon.rofMs / 1000);
  const shot: PreparedShot = {
    owner: worm.id,
    weaponId: weapon.id,
    angle: shotAngle(worm),
    x: worm.x,
    y: worm.y,
    vx: worm.vx,
    vy: worm.vy,
    randomIndex: randomInt(world, 255),
    spawnTimeMs: world.elapsedMs,
  };
  slot.charge = sub(slot.charge, f(weapon.drain / 100));
  if (slot.charge <= 0) {
    slot.charge = 0;
    slot.reloading = true;
  }
  return shot;
}
export function processWeaponShot(
  world: CombatWorld,
  shot: PreparedShot,
  ports: CombatPorts,
): boolean {
  const worm = world.worms.find((w) => w.id === shot.owner);
  if (!worm?.alive) return false;
  const weapon = weaponById(shot.weaponId);
  if (!weapon) return false;
  if (weapon.type === "beam") {
    // ProcessShot_Beam selects the reliable shot's weapon before setting its drawing timer.
    if (worm.slots[worm.weapon]?.weaponId !== weapon.id) {
      const matching = worm.slots.findIndex(
        (slot) => slot.weaponId === weapon.id,
      );
      if (matching >= 0) worm.weapon = matching;
    }
    const slot = worm.slots[worm.weapon];
    if (slot) slot.lastFire = f(0.3);
    fireBeam(world, worm, weapon, shot.angle, ports, shot);
  } else spawnShotProjectiles(world, worm, weapon, shot.angle, shot);
  return true;
}
export function fireWeapon(
  world: CombatWorld,
  worm: CombatWorm,
  ports: CombatPorts,
): boolean {
  const shot = prepareWeaponShot(world, worm);
  return shot ? processWeaponShot(world, shot, ports) : false;
}
