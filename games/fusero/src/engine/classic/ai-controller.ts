/* Altered Classic DeathMatch controller from CWormBot.cpp:993–1122,1180–1363,
 * 1430–1644,3304–3314,4120–4126. LGPL, OpenLieroX
 * 0a20c6d0a10ed63b28a15f05c771913c294efbf6.
 * Jason Boettcher, Dark Charlie, Albert Zeyer and contributors.
 */
import { aiNow, emptyAiControls, type NativeAiFrame } from "./ai-state.js";
import { AI_R2D, findAiTarget, reloadAiWeapons } from "./ai-targeting.js";
import { createAiPath, moveAiToTarget } from "./ai-navigation.js";
import { aiRopeAttached, shootAi } from "./ai-combat.js";
import { weaponById } from "./catalog.js";
import { atan2 } from "./math.js";
import { checkOnGround, ropeForce } from "./physics.js";
import { f, mul, sub } from "./physics-types.js";
import { randomSigned } from "./random.js";
import { aiAreaFree, len2, minus, point, PX_ROCK } from "./ai-geometry.js";

function findNewAiTarget(frame: NativeAiFrame): boolean {
  const target = findAiTarget(frame);
  if (!target) return false;
  frame.ai.targetWormId = target.id;
  frame.ai.targetType = "worm";
  frame.ai.mode = "moving";
  return true;
}
function findAiBonus(frame: NativeAiFrame, type: "weapon" | "health"): boolean {
  if (!frame.world.settings.bonuses) return false;
  let chosen: (typeof frame.world.bonuses)[number] | undefined,
    distance = -1;
  for (const bonus of [...frame.world.bonuses].sort((a, b) => a.id - b.id)) {
    if (bonus.type !== type) continue;
    const d = len2(minus(bonus, frame.worm));
    if (distance < 0 || d < distance) {
      chosen = bonus;
      distance = d;
    }
  }
  if (!chosen) return false;
  frame.ai.bonusId = chosen.id;
  frame.ai.bonusPosition = point(chosen.x, chosen.y);
  frame.ai.targetType = "bonus";
  frame.ai.mode = "moving";
  createAiPath(frame);
  return true;
}
function randomAiSpot(frame: NativeAiFrame, high = false): boolean {
  const width = f(frame.terrain.width),
    height = high ? f(f(frame.terrain.height) / 5) : f(frame.terrain.height);
  for (let i = 0; i < 10; i++) {
    const x = Math.trunc(mul(Math.abs(randomSigned(frame.world)), width));
    const y = Math.trunc(mul(Math.abs(randomSigned(frame.world)), height));
    if (!aiAreaFree(frame.terrain, x - 3, y - 3, x + 3, y + 3, PX_ROCK))
      continue;
    frame.ai.targetPosition = point(x, y);
    frame.ai.targetType = "position";
    frame.ai.mode = "moving";
    return true;
  }
  return false;
}

export function thinkAi(frame: NativeAiFrame): void {
  const { ai, worm } = frame;
  ai.targetWormId = null;
  ai.bonusId = null;
  ai.targetType = "none";
  ai.lastThinkMs = aiNow(frame);
  reloadAiWeapons(frame);
  if (worm.health < 15 && findAiBonus(frame, "health")) return;
  const missing = worm.slots.findIndex((slot) => !weaponById(slot.weaponId));
  if (missing >= 0 && findAiBonus(frame, "weapon")) {
    worm.weapon = missing;
    return;
  }
  if (findNewAiTarget(frame)) {
    createAiPath(frame);
    return;
  }
  ai.lastShootMs = 0;
  if (worm.health < 80 && findAiBonus(frame, "health")) return;
  if (ai.targetPosition.y < 75 && ai.mode === "moving") {
    if (worm.health < 100 && findAiBonus(frame, "health")) return;
    return;
  }
  if (randomAiSpot(frame, true)) createAiPath(frame);
}

/** Called with the newly positioned worm, before its ordinary post-spawn physics. */
export function respawnAi(frame: NativeAiFrame): void {
  frame.ai.mode = "think";
  frame.ai.lastShootMs = 0;
  frame.ai.lastGoBackMs = 0;
  frame.ai.spawnedAtMs = aiNow(frame);
  if (findNewAiTarget(frame)) createAiPath(frame, true);
}

/** One native input sample. The caller then executes the shared Classic physics/weapon kernels. */
export function inputAi(frame: NativeAiFrame): void {
  const { worm, ai, controls } = frame;
  if (!worm.alive) {
    if (worm.canRespawnNow) worm.respawnRequested = true;
    return;
  }
  Object.assign(controls, emptyAiControls());
  if (aiNow(frame) - ai.spawnedAtMs < 400) return;
  worm.onGround = checkOnGround(worm, frame.physicsTerrain);
  ai.randomSpread = 0;
  ai.lastRandomChangeMs = 0;
  if (aiNow(frame) - ai.lastThinkMs > 3000 && ai.mode !== "think")
    ai.mode = "think";
  if (aiNow(frame) - ai.lastThinkMs > 500 && !ai.pathFinished)
    ai.mode = "think";
  if (ai.targetType === "worm") {
    const target = frame.world.worms.find(
      (entry) => entry.id === ai.targetWormId,
    );
    if (
      !target?.alive ||
      !frame.targets.some((entry) => entry.id === target.id)
    )
      ai.mode = "think";
  }
  if (aiNow(frame) - ai.lastCarveMs > 200) {
    ai.lastCarveMs = aiNow(frame);
    controls.carve = true;
  } else controls.carve = false;
  if (shootAi(frame)) {
    if (aiRopeAttached(frame)) {
      const force = ropeForce(worm);
      let angle = f(atan2(f(force.x / force.y), 1));
      if (force.x < 0 || force.y > 0) angle = -angle;
      angle = mul(angle, AI_R2D);
      if (Math.abs(sub(worm.aim, angle)) <= 50) worm.rope = null;
    }
    controls.move = false;
  } else {
    reloadAiWeapons(frame);
    if (ai.mode === "think") thinkAi(frame);
    else moveAiToTarget(frame);
  }
  worm.moveFacing = worm.facing;
}

/** Keep the selected fixed native bonus slot's last position even after removal. */
export function syncAiBonusPosition(frame: NativeAiFrame): void {
  if (frame.ai.bonusId === null) return;
  const bonus = frame.world.bonuses.find(
    (entry) => entry.id === frame.ai.bonusId,
  );
  if (bonus) frame.ai.bonusPosition = point(bonus.x, bonus.y);
}
