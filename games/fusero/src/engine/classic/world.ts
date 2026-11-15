/* Source-derived OpenLieroX Classic composition for Fuse's deterministic input log.
 * Altered TypeScript port; original code under LGPL, based on Jason Boettcher's
 * work and enhancements by Dark Charlie, Albert Zeyer and OpenLieroX contributors.
 * Pinned source: 0a20c6d0a10ed63b28a15f05c771913c294efbf6.
 * Ordering follows PhysicsLX56.cpp and CClient_Game.cpp; see SOURCE-PARITY.md.
 */
import type { CombatPorts } from "./combat-types.js";
import type { World, Worm } from "./model.js";
import type { ClassicSettings, MatchRandom } from "./match-types.js";
import {
  asPhysicsTerrain,
  carveHole,
  carveSpawn,
  CLASSIC_MATERIALS,
  findSpot,
  isRock,
  materialAt,
  placeDirt,
  placeGreenDirt,
} from "./terrain.js";
import {
  createClassicLevel,
  CLASSIC_LEVEL_WIDTH,
  CLASSIC_LEVEL_HEIGHT,
} from "./level.js";
import {
  allowedWeaponIds,
  collectBonus,
  defaultLoadout,
  parseSettings,
  recordInjury,
  resetSpawnMatchState,
  updateRespawnEligibility,
  simulateBonuses,
  stepBonuses,
  stepMatch,
  takeExplosionBonus,
  validLoadout,
  BONUS_FREQUENCY_MS,
} from "./match.js";
import {
  createWeaponSlots,
  prepareWeaponShot,
  processWeaponShot,
  stepWeaponTimers,
  stepClientWeapon,
} from "./weapons.js";
import { stepProjectiles } from "./projectiles.js";
import { JUMP, INPUT_MASK, stepWorm, f, length2 } from "./physics.js";
import { randomInt, randomUnit } from "./random.js";
import {
  createPositionRecorder,
  recordPosition,
  resetPositionRecorder,
} from "./history.js";

export const RULES = "fusero-classic-3";
export const CAPACITY = 5;
export const WIDTH = CLASSIC_LEVEL_WIDTH;
export const HEIGHT = CLASSIC_LEVEL_HEIGHT;
export const CELL = 1;
export const PHYSICS_MS = 11;
export const OUTER_MS = 10;
export const isInput = (raw: unknown): raw is number =>
  typeof raw === "number" &&
  Number.isInteger(raw) &&
  raw >= 0 &&
  raw <= INPUT_MASK;
export const wormId = (raw: unknown): raw is string =>
  typeof raw === "string" &&
  /^[\w:.-]{1,64}$/.test(raw) &&
  !(raw in Object.prototype);
export function seedOf(text: string): number {
  let seed = 2166136261;
  for (let i = 0; i < text.length; i++)
    seed = Math.imul(seed ^ text.charCodeAt(i), 16777619) >>> 0;
  return seed || 1;
}

export interface Entrant {
  id: string;
  slot: number;
  loadout?: readonly number[];
}
/** The adapter closes over authoritative rng state, never an external mutable random generator. */
const matchRandom = (world: World): MatchRandom => ({
  nextFloat: () => randomUnit(world),
  nextInt: (maximum) => randomInt(world, maximum),
});

function spawn(world: World, worm: Worm): void {
  const position = findSpot(world.terrain, () => randomUnit(world));
  resetSpawnMatchState(worm, position);
  worm.vx = 0;
  worm.vy = 0;
  worm.aim = 0;
  worm.aimSpeed = 0;
  worm.facing = 1;
  worm.moveFacing = 1;
  worm.onGround = false;
  worm.input = 0;
  worm.rope = null;
  worm.lastInputTimeMs = world.elapsedMs;
  worm.canRespawnNow = false;
  for (const slot of worm.slots) {
    slot.charge = 1;
    slot.reloading = false;
    slot.lastFire = 0;
  }
  resetPositionRecorder(worm.positionRecordings, worm);
  carveSpawn(world.terrain, worm.x, worm.y);
}

export function createWorld(
  seed: number,
  entrants: readonly Entrant[],
  rawSettings: ClassicSettings,
): World {
  const settings = parseSettings(rawSettings);
  if (!settings || !Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff)
    throw new Error("Invalid Classic world configuration");
  const seats = [...entrants].sort((a, b) => a.slot - b.slot);
  if (
    !seats.length ||
    seats.length > CAPACITY ||
    new Set(seats.map((seat) => seat.id)).size !== seats.length ||
    new Set(seats.map((seat) => seat.slot)).size !== seats.length ||
    seats.some(
      (seat) =>
        !wormId(seat.id) ||
        !Number.isInteger(seat.slot) ||
        seat.slot < 0 ||
        seat.slot >= CAPACITY,
    )
  )
    throw new Error("Invalid Classic entrants");
  const world: World = {
    seed,
    rng: seed,
    step: 0,
    elapsedMs: 0,
    lastClientPhysicsMs: 0,
    pendingShots: [],
    phase: "play",
    winner: null,
    settings,
    terrain: createClassicLevel(settings.level),
    worms: [],
    projectiles: [],
    effects: [],
    nextId: 1,
    bonuses: [],
    nextBonusAtMs: BONUS_FREQUENCY_MS,
  };
  world.worms = seats.map((seat) => {
    const loadout = validLoadout(seat.loadout, settings)
      ? seat.loadout
      : defaultLoadout(settings);
    return {
      id: seat.id,
      slot: seat.slot,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      aim: 0,
      facing: 1,
      moveFacing: 1,
      aimSpeed: 0,
      onGround: false,
      input: 0,
      health: 100,
      alive: false,
      rope: null,
      weapon: 0,
      slots: createWeaponSlots(loadout),
      kills: 0,
      deaths: 0,
      suicides: 0,
      damageScore: 0,
      lives: settings.lives,
      respawnAtMs: null,
      spawnedOnce: false,
      respawnRequested: false,
      weaponsReady: true,
      positionRecordings: createPositionRecorder(),
      lastInputTimeMs: 0,
      canRespawnNow: false,
    };
  });
  for (const worm of world.worms) spawn(world, worm);
  return world;
}

function combatPorts(world: World): CombatPorts {
  return {
    width: world.terrain.width,
    height: world.terrain.height,
    material: (x, y) => CLASSIC_MATERIALS[materialAt(world.terrain, x, y)]!,
    carveHole: (size, x, y) => carveHole(world.terrain, size, x, y),
    placeDirt: (x, y, green) =>
      green
        ? placeGreenDirt(world.terrain, x, y)
        : placeDirt(world.terrain, 5, x, y),
    injure: (victim, damage, owner) => {
      recordInjury(world, victim, damage, owner, world.settings);
    },
    beamBonusAt: (x, y) =>
      world.settings.bonuses &&
      world.bonuses.some(
        (bonus) => length2(f(bonus.x - x), f(bonus.y - y)) < 9,
      ),
    explodeBonuses: (x, y) => {
      let count = 0;
      while (takeExplosionBonus(world.bonuses, x, y)) count++;
      return count;
    },
  };
}

/** One 100 FPS outer frame: packet delivery, 11ms client physics, server, then clock advance. */
export function stepWorld(
  world: World,
  inputs: ReadonlyMap<string, number>,
): void {
  if (world.phase !== "play") return;
  world.effects = world.effects.filter((effect) => {
    effect.lifeMs -= OUTER_MS;
    return effect.lifeMs > 0;
  });
  const terrain = asPhysicsTerrain(world.terrain),
    ports = combatPorts(world),
    random = matchRandom(world);
  const delivered = world.pendingShots;
  world.pendingShots = [];
  for (const shot of delivered) processWeaponShot(world, shot, ports);
  while (world.lastClientPhysicsMs + PHYSICS_MS <= world.elapsedMs) {
    world.lastClientPhysicsMs += PHYSICS_MS;
    for (const worm of world.worms) {
      const input = (inputs.get(worm.id) ?? 0) & INPUT_MASK;
      const inputDtMs = world.elapsedMs - worm.lastInputTimeMs;
      worm.lastInputTimeMs = world.elapsedMs;
      if (!worm.alive) {
        const pressed = input & ~worm.input;
        worm.input = input;
        // Native CWormHuman accepts a new jump only after bCanRespawnNow; fire and early/held jumps do not request it.
        if (pressed & JUMP && worm.canRespawnNow) worm.respawnRequested = true;
        continue;
      }
      const controls = stepWorm(
        worm,
        world.worms,
        terrain,
        input,
        PHYSICS_MS,
        undefined,
        inputDtMs,
        worm.weaponsReady,
      );
      if (controls.weaponSlot !== null) worm.weapon = controls.weaponSlot;
      worm.weapon = (((worm.weapon + controls.weaponDelta) % 5) + 5) % 5;
      stepWeaponTimers(worm, PHYSICS_MS, world.settings.loadingTime);
      recordPosition(worm.positionRecordings, worm);
      // Native client checks bonus pickups after worm physics and before the server shot.
      for (const bonus of [...world.bonuses].sort((a, b) => a.id - b.id)) {
        if (collectBonus(worm, bonus, random))
          world.bonuses.splice(world.bonuses.indexOf(bonus), 1);
      }
      if (controls.shoot) {
        const shot = prepareWeaponShot(world, worm);
        if (shot) world.pendingShots.push(shot);
        stepClientWeapon(worm, OUTER_MS);
      }
    }
    stepProjectiles(world, world.worms, ports, PHYSICS_MS);
    simulateBonuses(world.bonuses, terrain, PHYSICS_MS);
  }
  // The server grants eligibility after this frame's human input was consumed.
  for (const worm of world.worms) {
    if (worm.alive) {
      worm.canRespawnNow = false;
      continue;
    }
    if (updateRespawnEligibility(worm, world.elapsedMs, world.settings)) {
      const consumedInput = worm.input;
      spawn(world, worm);
      worm.input = consumedInput;
    }
  }
  stepBonuses(
    world,
    world.settings,
    {
      width: world.terrain.width,
      height: world.terrain.height,
      isRock: (x, y) => isRock(world.terrain, x, y),
    },
    random,
    allowedWeaponIds(world.settings),
  );
  // Presentation entities are bounded independently of all authoritative projectile slots and terrain.
  if (world.effects.length > 512)
    world.effects.splice(0, world.effects.length - 512);
  stepMatch(
    world,
    world.settings,
    world.worms.length === 1,
    world.elapsedMs + OUTER_MS,
  );
  world.step++;
  world.elapsedMs = world.step * OUTER_MS;
}

export const roundDone = (world: World): boolean => world.phase === "done";
export type { World, Worm } from "./model.js";
