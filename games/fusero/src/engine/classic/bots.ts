/**
 * Fuse's deterministic bot control policy, not a port of OpenLieroX's bot AI.
 * It only returns normal player controls. Aim, carving, movement, rope flight,
 * shots, charge and reload all run through the same Classic kernels as humans.
 */
import { atan2 } from "./math.js";
import {
  weaponById,
  CLASSIC_PROJECTILES,
  type ClassicWeapon,
} from "./catalog.js";
import { materialAt, AIR } from "./terrain.js";
import {
  LEFT,
  RIGHT,
  UP,
  DOWN,
  JUMP,
  FIRE,
  ROPE,
  CARVE,
  SLOT1,
  type PhysicsWorm,
} from "./physics-types.js";
import type { World, Worm } from "./model.js";

/** One-pixel DDA, including the first blocking material for safe short-range fire. */
function sight(
  world: World,
  from: PhysicsWorm,
  to: PhysicsWorm,
): { clear: boolean; firstWall: number } {
  const dx = to.x - from.x,
    dy = to.y - from.y,
    steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)));
  for (let step = 7; step < steps - 5; step++) {
    const x = from.x + (dx * step) / steps,
      y = from.y + (dy * step) / steps;
    if (materialAt(world.terrain, x, y) !== AIR)
      return { clear: false, firstWall: step };
  }
  return { clear: true, firstWall: Infinity };
}
/** Time windows are wider than the room's 50ms input interval and always include releases. */
const pulse = (elapsedMs: number, slot: number, period: number): boolean =>
  (elapsedMs + slot * 137) % period < 100;

function weaponScore(
  weapon: ClassicWeapon,
  distance: number,
  clear: boolean,
): number {
  if (weapon.type === "beam")
    return clear && distance < weapon.beam.length ? 120 : -100;
  const projectile = CLASSIC_PROJECTILES[weapon.projectileId];
  const power =
    projectile?.playerHit.type === 1 || projectile?.playerHit.type === 2
      ? projectile.playerHit.damage
      : 10;
  // Prefer direct, faster shots at range; the policy never changes native weapon powers.
  return (
    20 +
    Math.min(50, weapon.speed / 8) +
    Math.min(25, power / 2) +
    (clear ? 5 : 0) -
    Math.min(30, weapon.spread * 0.2) -
    (weapon.speed < 100 && distance > 180 ? 40 : 0)
  );
}
function selectWeapon(
  world: World,
  worm: Worm,
  distance: number,
  clear: boolean,
): number {
  let chosen = worm.weapon,
    best = -Infinity;
  const ready = worm.slots.some((slot) => !slot.reloading && slot.charge > 0);
  for (const [index, slot] of worm.slots.entries()) {
    const weapon = weaponById(slot.weaponId);
    if (!weapon) continue;
    let score = weaponScore(weapon, distance, clear);
    if (ready) {
      if (slot.reloading || slot.charge <= 0) score -= 1000;
      else score += slot.charge * 5;
    } else {
      // Only the selected slot reloads in Classic. Keep the quickest charge selected.
      const perSecond =
        (weapon.recharge / 10) *
        (world.settings.loadingTime === 0
          ? 1
          : 100 / world.settings.loadingTime);
      score =
        world.settings.loadingTime === 0
          ? 0
          : -(1 - slot.charge) / Math.max(0.00001, perSecond);
    }
    if (index === worm.weapon) score += 0.1;
    if (score > best) {
      best = score;
      chosen = index;
    }
  }
  return chosen;
}

export function botInput(world: World, worm: Worm): number {
  if (world.phase !== "play" || !worm.alive || !worm.weaponsReady) return 0;
  const candidates = world.worms.filter(
    (other) => other.id !== worm.id && other.alive,
  );
  candidates.sort((a, b) => {
    const ad = (a.x - worm.x) ** 2 + (a.y - worm.y) ** 2,
      bd = (b.x - worm.x) ** 2 + (b.y - worm.y) ** 2;
    return (
      ad - bd || a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
  });
  const target = candidates[0];
  if (!target) return 0;
  const dx = target.x - worm.x,
    dy = target.y - worm.y,
    distance = Math.sqrt(dx * dx + dy * dy),
    line = sight(world, worm, target);
  const selected = selectWeapon(world, worm, distance, line.clear),
    slot = worm.slots[selected],
    weapon = slot ? weaponById(slot.weaponId) : undefined;
  let desiredY = dy;
  if (weapon?.type === "projectile") {
    const projectile = CLASSIC_PROJECTILES[weapon.projectileId];
    // Predict only the aim point; all actual trajectory/impact decisions remain native physics.
    const travel = Math.min(1.5, distance / Math.max(40, weapon.speed));
    const gravity = projectile?.customGravity ? (projectile.gravity ?? 0) : 100;
    desiredY += target.vy * travel - 0.5 * gravity * travel * travel;
  }
  const desired = Math.max(
    -90,
    Math.min(60, (atan2(desiredY, Math.abs(dx)) * 180) / Math.PI),
  );
  const error = desired - worm.aim;
  let bits = error > 1.5 ? DOWN : error < -1.5 ? UP : 0;
  if (Math.abs(dx) > 55 || (dx < 0 ? worm.facing !== -1 : worm.facing !== 1))
    bits |= dx < 0 ? LEFT : RIGHT;
  const offset = worm.slot * 137;
  // Walking phones auto-carve every200ms; bots request the same ordinary carve pulse.
  if (bits & (LEFT | RIGHT) && pulse(world.elapsedMs, worm.slot, 200))
    bits |= CARVE;
  const toward = dx < 0 ? -1 : 1;
  const obstruction =
    materialAt(world.terrain, worm.x + toward * 7, worm.y) !== AIR;
  if (
    (obstruction || dy < -18) &&
    worm.onGround &&
    pulse(world.elapsedMs, worm.slot, 1700)
  )
    bits |= JUMP;
  if (selected !== worm.weapon) bits |= SLOT1 << selected;

  const ropePhase = (world.elapsedMs + offset) % 4200;
  const hook = worm.rope;
  if (hook) {
    // A rope persists after button release. Jump is the normal detach action.
    const stuckHook =
      hook.state === "falling" && ropePhase >= 1500 && ropePhase < 1600;
    const reachedHeight =
      (hook.state === "terrain" || hook.state === "worm") &&
      worm.y < hook.y + 36;
    if (stuckHook || reachedHeight) bits |= JUMP;
  } else if (dy < -35 && ropePhase < 500) {
    // Aim upward first, then press rope once. A failed cast waits for the next control window.
    if (worm.aim > -55) {
      bits &= ~DOWN;
      bits |= UP;
    } else if (ropePhase >= 200 && ropePhase < 300) bits |= ROPE;
  }
  const facingTarget = dx < 0 ? worm.facing === -1 : worm.facing === 1;
  if (
    weapon &&
    slot &&
    !slot.reloading &&
    slot.charge > 0 &&
    facingTarget &&
    Math.abs(error) < 7 &&
    (line.clear || line.firstWall > 16) &&
    !(bits & (ROPE | JUMP))
  )
    bits |= FIRE;
  return bits;
}
