import { CLASSIC_PROJECTILES, CLASSIC_WEAPONS } from "./catalog.js";
import {
  MAX_CLASSIC_PROJECTILES,
  type ClassicProjectileState,
  type CombatEffect,
  type PreparedShot,
  type WeaponSlot,
} from "./combat-types.js";
import { parseSettings } from "./match.js";
import { POSITION_RECORDS, type PositionRecorder } from "./history.js";
import type { ClassicBonus } from "./match-types.js";
import type { World, Worm } from "./model.js";
import { INPUT_MASK, type ClassicRope } from "./physics-types.js";
import { decodeTerrain } from "./terrain.js";
import { FIXED_RANDOM } from "./random.js";
import {
  decodeNativeAi,
  decodeNativeAiShared,
  encodeNativeAi,
  encodeNativeAiShared,
} from "./ai-codec.js";

export type WormView = Omit<Worm, "ai">;
export type WorldView = Omit<World, "worms" | "aiShared"> & {
  worms: WormView[];
};

const UINT32 = 0xffff_ffff;
const WORLD_KEYS = [
  "seed",
  "step",
  "phase",
  "winner",
  "settings",
  "terrain",
  "worms",
  "bonuses",
  "nextBonusAtMs",
  "elapsedMs",
  "nextId",
  "rng",
  "projectiles",
  "effects",
  "lastClientPhysicsMs",
  "pendingShots",
  "aiShared",
] as const;
const WORM_KEYS = [
  "id",
  "slot",
  "x",
  "y",
  "vx",
  "vy",
  "aim",
  "facing",
  "moveFacing",
  "aimSpeed",
  "onGround",
  "input",
  "health",
  "alive",
  "rope",
  "weapon",
  "slots",
  "kills",
  "deaths",
  "suicides",
  "damageScore",
  "lives",
  "respawnAtMs",
  "spawnedOnce",
  "respawnRequested",
  "weaponsReady",
  "positionRecordings",
  "lastInputTimeMs",
  "canRespawnNow",
  "ai",
] as const;
const PROJECTILE_KEYS = [
  "id",
  "slot",
  "descriptorId",
  "owner",
  "weaponId",
  "x",
  "y",
  "vx",
  "vy",
  "oldX",
  "oldY",
  "life",
  "extra",
  "randomIndex",
  "timeVarRandom",
  "spawnTimeMs",
  "lastSimulationMs",
  "ignoreOwnerBeforeMs",
  "wallShootTime",
  "lastTrailMs",
  "rotation",
  "frame",
  "frameDelta",
  "firstBounce",
  "minCheck",
  "maxCheck",
  "avgCheck",
  "checkSpeedLen",
  "collisionSide",
  "used",
] as const;
const EFFECT_KINDS = new Set<CombatEffect["kind"]>([
  "explosion",
  "muzzle",
  "beam",
  "smoke",
  "chemical-smoke",
  "doomsday",
]);
const MAX_ROF = Math.max(
  ...CLASSIC_WEAPONS.map((weapon) => Math.fround(weapon.rofMs / 1000)),
);
const MAX_TRAIL_DELAY_MS = Math.max(
  0,
  ...CLASSIC_PROJECTILES.map((projectile) => projectile.trail?.delayMs ?? 0),
);
const FIXED_RANDOM_VALUES = new Set(FIXED_RANDOM);
/** Only actual native UseSound samples may enter the presentation adapter, never peer-supplied paths or URLs. */
const CLASSIC_SOUNDS = new Set<string>();
for (const weapon of CLASSIC_WEAPONS) {
  if (weapon.type === "projectile" && weapon.useSound === 1 && weapon.sound)
    CLASSIC_SOUNDS.add(weapon.sound);
}
for (const projectile of CLASSIC_PROJECTILES) {
  for (const action of [
    projectile.hit,
    projectile.playerHit,
    projectile.timer,
    projectile.explode,
    projectile.touch,
  ])
    if (action?.useSound === 1 && action.sound)
      CLASSIC_SOUNDS.add(action.sound);
}
const WEAPON_PROJECTILES = CLASSIC_WEAPONS.map((weapon) => {
  const reachable = new Set<number>();
  const visit = (id: number) => {
    if (reachable.has(id)) return;
    reachable.add(id);
    const descriptor = CLASSIC_PROJECTILES[id]!;
    if (descriptor.spawn) visit(descriptor.spawn.projectileId);
    if (descriptor.trail) visit(descriptor.trail.projectileId);
  };
  if (weapon.type === "projectile") visit(weapon.projectileId);
  return reachable;
});

function record(raw: unknown): raw is Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return false;
  const prototype: unknown = Object.getPrototypeOf(raw);
  return prototype === Object.prototype || prototype === null;
}
function keys(
  raw: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const present = Object.keys(raw);
  return (
    present.length >= required.length &&
    present.length <= required.length + optional.length &&
    required.every((key) => Object.hasOwn(raw, key)) &&
    present.every((key) => required.includes(key) || optional.includes(key))
  );
}
const integer = (raw: unknown, min = 0, max = UINT32): raw is number =>
  typeof raw === "number" &&
  Number.isSafeInteger(raw) &&
  raw >= min &&
  raw <= max;
/** Native state stores float32 values. Do not constrain legitimate recoil or long-lived mines to prototype limits. */
const native = (raw: unknown): raw is number =>
  typeof raw === "number" && Number.isFinite(raw) && Math.fround(raw) === raw;
const positiveNative = (raw: unknown): raw is number => native(raw) && raw >= 0;
const clock = (raw: unknown): raw is number =>
  integer(raw, 0, UINT32 * 11 + 60_000);
const memberId = (raw: unknown): raw is string =>
  typeof raw === "string" &&
  /^[\w:.-]{1,64}$/.test(raw) &&
  !(raw in Object.prototype);
const weaponId = (raw: unknown): raw is number =>
  integer(raw, 0, CLASSIC_WEAPONS.length - 1);
const descriptorId = (raw: unknown): raw is number =>
  integer(raw, 0, CLASSIC_PROJECTILES.length - 1);

function rope(raw: unknown): ClassicRope | null | undefined {
  if (raw === null) return null;
  if (!record(raw) || !keys(raw, ["x", "y", "vx", "vy", "state", "attachedId"]))
    return;
  const { x, y, vx, vy, state, attachedId } = raw;
  if (
    !native(x) ||
    !native(y) ||
    !native(vx) ||
    !native(vy) ||
    (state !== "shooting" &&
      state !== "falling" &&
      state !== "terrain" &&
      state !== "worm") ||
    (state === "worm" ? !memberId(attachedId) : attachedId !== null)
  )
    return;
  return {
    x,
    y,
    vx,
    vy,
    state,
    attachedId: state === "worm" ? (attachedId as string) : null,
  };
}

function slots(raw: unknown): WeaponSlot[] | undefined {
  if (!Array.isArray(raw) || raw.length !== 5) return;
  const result: WeaponSlot[] = [];
  for (const value of raw) {
    if (
      !record(value) ||
      !keys(value, ["weaponId", "charge", "reloading", "lastFire"])
    )
      return;
    const { weaponId: id, charge, reloading, lastFire } = value;
    if (
      !weaponId(id) ||
      !native(charge) ||
      charge < 0 ||
      charge > 1 ||
      typeof reloading !== "boolean" ||
      !native(lastFire) ||
      lastFire < -Math.fround(0.011) ||
      lastFire > MAX_ROF
    )
      return;
    result.push({ weaponId: id, charge, reloading, lastFire });
  }
  return result;
}

function positionRecorder(raw: unknown): PositionRecorder | undefined {
  if (!record(raw) || !keys(raw, ["cursor", "count", "positions"])) return;
  const { cursor, count, positions } = raw;
  if (
    !integer(cursor, 0, POSITION_RECORDS - 1) ||
    !integer(count, 0, POSITION_RECORDS) ||
    !Array.isArray(positions) ||
    positions.length !== POSITION_RECORDS
  )
    return;
  const decoded: PositionRecorder["positions"] = [];
  for (const value of positions) {
    if (!record(value) || !keys(value, ["x", "y"])) return;
    const { x, y } = value;
    if (!native(x) || !native(y)) return;
    decoded.push({ x, y });
  }
  return { cursor, count, positions: decoded };
}

function worm(
  raw: unknown,
  elapsedMs: number,
  width: number,
  height: number,
): Worm | undefined {
  if (!record(raw) || !keys(raw, WORM_KEYS)) return;
  const {
    id,
    slot,
    x,
    y,
    vx,
    vy,
    aim,
    facing,
    moveFacing,
    aimSpeed,
    onGround,
    input,
    health,
    alive,
    weapon,
    kills,
    deaths,
    suicides,
    damageScore,
    lives,
    respawnAtMs,
    spawnedOnce,
    respawnRequested,
    weaponsReady,
    lastInputTimeMs,
    canRespawnNow,
  } = raw;
  const decodedRope = rope(raw.rope),
    decodedSlots = slots(raw.slots);
  const decodedPositions = positionRecorder(raw.positionRecordings);
  const ai = decodeNativeAi(raw.ai, elapsedMs, width, height);
  if (
    !memberId(id) ||
    !integer(slot, 0, 4) ||
    !native(x) ||
    !native(y) ||
    !native(vx) ||
    !native(vy) ||
    !native(aim) ||
    aim < -90 ||
    aim > 60 ||
    (facing !== -1 && facing !== 1) ||
    (moveFacing !== -1 && moveFacing !== 1) ||
    !native(aimSpeed) ||
    typeof onGround !== "boolean" ||
    !integer(input, 0, INPUT_MASK) ||
    !native(health) ||
    health < 0 ||
    health > 100 ||
    typeof alive !== "boolean" ||
    !integer(weapon, 0, 4) ||
    !integer(kills) ||
    !integer(deaths) ||
    !integer(suicides) ||
    !native(damageScore) ||
    !(lives === -2 || integer(lives, -1, 150)) ||
    !(respawnAtMs === null || clock(respawnAtMs)) ||
    typeof spawnedOnce !== "boolean" ||
    typeof respawnRequested !== "boolean" ||
    typeof weaponsReady !== "boolean" ||
    !clock(lastInputTimeMs) ||
    lastInputTimeMs > Math.max(0, elapsedMs - 10) ||
    typeof canRespawnNow !== "boolean" ||
    decodedRope === undefined ||
    !decodedSlots ||
    !decodedPositions ||
    ai === undefined ||
    (alive && lives === -1)
  )
    return;
  return {
    id,
    slot,
    x,
    y,
    vx,
    vy,
    aim,
    facing,
    moveFacing,
    aimSpeed,
    onGround,
    input,
    health,
    alive,
    rope: decodedRope,
    weapon,
    slots: decodedSlots,
    kills,
    deaths,
    suicides,
    damageScore,
    lives,
    respawnAtMs,
    spawnedOnce,
    respawnRequested,
    weaponsReady,
    lastInputTimeMs,
    canRespawnNow,
    positionRecordings: decodedPositions,
    ai,
  };
}

function projectile(
  raw: unknown,
  elapsedMs: number,
): ClassicProjectileState | undefined {
  // Repeating native property names for all 3000 pool slots wastes most of the recovery budget.
  // Field order is fixed by this game's rules version; malformed/missing tuple fields never default.
  if (!Array.isArray(raw) || raw.length !== PROJECTILE_KEYS.length) return;
  const fields: Record<string, unknown> = Object.fromEntries(
    PROJECTILE_KEYS.map((key, index) => [key, raw[index]]),
  );
  const {
    id,
    slot,
    descriptorId: descriptor,
    owner,
    weaponId: weapon,
    x,
    y,
    vx,
    vy,
    oldX,
    oldY,
    life,
    extra,
    randomIndex,
    timeVarRandom,
    spawnTimeMs,
    lastSimulationMs,
    ignoreOwnerBeforeMs,
    wallShootTime,
    lastTrailMs,
    rotation,
    frame,
    frameDelta,
    firstBounce,
    minCheck,
    maxCheck,
    avgCheck,
    checkSpeedLen,
    collisionSide,
    used,
  } = fields;
  if (
    !integer(id, 1) ||
    !integer(slot, 0, MAX_CLASSIC_PROJECTILES - 1) ||
    !descriptorId(descriptor) ||
    !memberId(owner) ||
    !weaponId(weapon) ||
    !WEAPON_PROJECTILES[weapon]?.has(descriptor) ||
    ![x, y, vx, vy, oldX, oldY].every(native) ||
    !positiveNative(life) ||
    !positiveNative(extra) ||
    !integer(randomIndex, 0, 254) ||
    !native(timeVarRandom) ||
    timeVarRandom < -1 ||
    timeVarRandom > 1 ||
    !FIXED_RANDOM_VALUES.has(timeVarRandom) ||
    !clock(spawnTimeMs) ||
    !clock(lastSimulationMs) ||
    spawnTimeMs > lastSimulationMs ||
    // Native 100 Hz outer frames, delayed shoot delivery and 11 ms client ticks have separate clocks.
    // Keep their bounded phase lag without allowing a peer to request unbounded projectile catch-up.
    lastSimulationMs > elapsedMs ||
    elapsedMs - lastSimulationMs > 32 ||
    !clock(ignoreOwnerBeforeMs) ||
    ignoreOwnerBeforeMs > elapsedMs + 100 ||
    !native(wallShootTime) ||
    wallShootTime < 0 ||
    wallShootTime > 0.013 ||
    !clock(lastTrailMs) ||
    lastTrailMs > elapsedMs + MAX_TRAIL_DELAY_MS ||
    !native(rotation) ||
    rotation < 0 ||
    rotation > 360 ||
    !positiveNative(frame) ||
    typeof frameDelta !== "boolean" ||
    typeof firstBounce !== "boolean" ||
    !integer(minCheck, 0, 11) ||
    !integer(maxCheck, 2, 11) ||
    !integer(avgCheck, 2, 11) ||
    !integer(checkSpeedLen) ||
    !integer(collisionSide, 0, 15) ||
    used !== true
  )
    return;
  // The explicit scalar checks above narrow independent fields, unlike an array.every type assertion.
  if (
    !native(x) ||
    !native(y) ||
    !native(vx) ||
    !native(vy) ||
    !native(oldX) ||
    !native(oldY)
  )
    return;
  return {
    id,
    slot,
    descriptorId: descriptor,
    owner,
    weaponId: weapon,
    x,
    y,
    vx,
    vy,
    oldX,
    oldY,
    life,
    extra,
    randomIndex,
    timeVarRandom,
    spawnTimeMs,
    lastSimulationMs,
    ignoreOwnerBeforeMs,
    wallShootTime,
    lastTrailMs,
    rotation,
    frame,
    frameDelta,
    firstBounce,
    minCheck,
    maxCheck,
    avgCheck,
    checkSpeedLen,
    collisionSide,
    used,
  };
}

function effect(raw: unknown): CombatEffect | undefined {
  if (
    !record(raw) ||
    !keys(
      raw,
      ["id", "kind", "x", "y", "radius", "lifeMs"],
      ["endX", "endY", "owner", "sound"],
    )
  )
    return;
  const { id, kind, x, y, radius, lifeMs, endX, endY, owner, sound } = raw;
  if (
    !integer(id, 1) ||
    typeof kind !== "string" ||
    !EFFECT_KINDS.has(kind as CombatEffect["kind"]) ||
    !native(x) ||
    !native(y) ||
    !positiveNative(radius) ||
    !integer(lifeMs, 0, 60_000) ||
    (endX !== undefined && !native(endX)) ||
    (endY !== undefined && !native(endY)) ||
    (endX === undefined) !== (endY === undefined) ||
    (owner !== undefined && !memberId(owner)) ||
    (sound !== undefined &&
      (typeof sound !== "string" ||
        !CLASSIC_SOUNDS.has(sound) ||
        (kind !== "muzzle" && kind !== "explosion")))
  )
    return;
  return {
    id,
    kind: kind as CombatEffect["kind"],
    x,
    y,
    radius,
    lifeMs,
    ...(endX !== undefined && endY !== undefined ? { endX, endY } : {}),
    ...(typeof owner === "string" ? { owner } : {}),
    ...(typeof sound === "string" ? { sound } : {}),
  };
}

function bonus(raw: unknown, elapsedMs: number): ClassicBonus | undefined {
  if (
    !record(raw) ||
    !keys(raw, [
      "id",
      "x",
      "y",
      "vx",
      "vy",
      "life",
      "flashTime",
      "type",
      "weaponId",
      "spawnedAtMs",
    ])
  )
    return;
  const {
    id,
    x,
    y,
    vx,
    vy,
    life,
    flashTime,
    type,
    weaponId: weapon,
    spawnedAtMs,
  } = raw;
  if (
    !integer(id, 0, 31) ||
    !native(x) ||
    !native(y) ||
    !native(vx) ||
    !native(vy) ||
    !positiveNative(life) ||
    !positiveNative(flashTime) ||
    flashTime > Math.fround(0.3) ||
    (type !== "health" && type !== "weapon") ||
    !(weaponId(weapon) || (type === "health" && weapon === -1)) ||
    !clock(spawnedAtMs) ||
    spawnedAtMs > elapsedMs
  )
    return;
  return {
    id,
    x,
    y,
    vx,
    vy,
    life,
    flashTime,
    type,
    weaponId: weapon,
    spawnedAtMs,
  };
}

function pendingShot(
  raw: unknown,
  elapsedMs: number,
): PreparedShot | undefined {
  if (
    !record(raw) ||
    !keys(raw, [
      "owner",
      "weaponId",
      "angle",
      "x",
      "y",
      "vx",
      "vy",
      "randomIndex",
      "spawnTimeMs",
    ])
  )
    return;
  const {
    owner,
    weaponId: weapon,
    angle,
    x,
    y,
    vx,
    vy,
    randomIndex,
    spawnTimeMs,
  } = raw;
  if (
    !memberId(owner) ||
    !weaponId(weapon) ||
    !integer(angle, 0, 359) ||
    !native(x) ||
    !native(y) ||
    !native(vx) ||
    !native(vy) ||
    !integer(randomIndex, 0, 255) ||
    elapsedMs < 10 ||
    spawnTimeMs !== elapsedMs - 10
  )
    return;
  return {
    owner,
    weaponId: weapon,
    angle,
    x,
    y,
    vx,
    vy,
    randomIndex,
    spawnTimeMs,
  };
}

/** Independent presentation/checkpoint copies cannot mutate the authoritative world or its nested arrays. */
function cloneSharedState(world: World): WorldView {
  const { aiShared, ...visible } = world;
  void aiShared;
  return {
    ...visible,
    settings: { ...world.settings },
    terrain: { ...world.terrain, rows: [...world.terrain.rows] },
    worms: world.worms.map((value) => {
      const { ai, ...visibleWorm } = value;
      void ai;
      return {
        ...visibleWorm,
        rope: value.rope ? { ...value.rope } : null,
        slots: value.slots.map((slot) => ({ ...slot })),
        positionRecordings: {
          ...value.positionRecordings,
          positions: value.positionRecordings.positions.map((position) => ({
            ...position,
          })),
        },
      };
    }),
    projectiles: world.projectiles,
    effects: world.effects.map((value) => ({ ...value })),
    bonuses: world.bonuses.map((value) => ({ ...value })),
    pendingShots: world.pendingShots.map((value) => ({ ...value })),
  };
}
export function toView(world: World): WorldView {
  return {
    ...cloneSharedState(world),
    projectiles: world.projectiles.map((value) => ({ ...value })),
  };
}
export function encodeWorld(world: World): unknown {
  const view = cloneSharedState(world);
  return {
    ...view,
    aiShared: encodeNativeAiShared(world.aiShared),
    worms: view.worms.map((value, index) => ({
      ...value,
      ai: encodeNativeAi(world.worms[index]!.ai),
    })),
    projectiles: world.projectiles.map((value) =>
      PROJECTILE_KEYS.map((key) => value[key]),
    ),
  };
}

/** Validate the complete candidate before returning a fresh state; failed recovery never modifies a healthy world. */
export function decodeWorld(raw: unknown): World | undefined {
  if (!record(raw) || !keys(raw, WORLD_KEYS)) return;
  const {
    seed,
    rng,
    step,
    elapsedMs,
    phase,
    winner,
    nextId,
    nextBonusAtMs,
    lastClientPhysicsMs,
  } = raw;
  if (
    !integer(seed) ||
    !integer(rng) ||
    !integer(step) ||
    !clock(elapsedMs) ||
    elapsedMs !== step * 10 ||
    !clock(lastClientPhysicsMs) ||
    lastClientPhysicsMs !== Math.floor(Math.max(0, elapsedMs - 10) / 11) * 11 ||
    (phase !== "play" && phase !== "done") ||
    !integer(nextId, 1) ||
    !clock(nextBonusAtMs) ||
    !Array.isArray(raw.worms) ||
    raw.worms.length < 1 ||
    raw.worms.length > 5 ||
    !Array.isArray(raw.projectiles) ||
    raw.projectiles.length > MAX_CLASSIC_PROJECTILES ||
    !Array.isArray(raw.effects) ||
    raw.effects.length > 12_000 ||
    !Array.isArray(raw.bonuses) ||
    raw.bonuses.length > 32 ||
    !Array.isArray(raw.pendingShots) ||
    raw.pendingShots.length > 5
  )
    return;
  const settings = parseSettings(raw.settings),
    terrain = decodeTerrain(raw.terrain),
    aiShared = decodeNativeAiShared(raw.aiShared, elapsedMs);
  if (!settings || !terrain || !aiShared) return;
  const within = (x: number, y: number) =>
    x >= -32 && y >= -32 && x <= terrain.width + 32 && y <= terrain.height + 32;
  const worms: Worm[] = [];
  for (const value of raw.worms) {
    const decoded = worm(value, elapsedMs, terrain.width, terrain.height);
    if (!decoded) return;
    worms.push(decoded);
  }
  const memberIds = new Set(worms.map((value) => value.id));
  if (
    memberIds.size !== worms.length ||
    worms.some(
      (value, index) => index > 0 && value.slot <= worms[index - 1]!.slot,
    ) ||
    worms.some(
      (value) =>
        !within(value.x, value.y) ||
        (value.rope && !within(value.rope.x, value.rope.y)) ||
        value.positionRecordings.positions.some(
          (position) => !within(position.x, position.y),
        ),
    ) ||
    (phase === "play"
      ? winner !== null
      : !memberId(winner) || !memberIds.has(winner)) ||
    worms.some(
      (value) =>
        value.rope?.state === "worm" &&
        (!memberIds.has(value.rope.attachedId!) ||
          value.rope.attachedId === value.id),
    ) ||
    worms.some(
      (value) =>
        value.ai?.targetWormId !== null &&
        value.ai?.targetWormId !== undefined &&
        !memberIds.has(value.ai.targetWormId),
    )
  )
    return;
  const projectiles: ClassicProjectileState[] = [],
    effects: CombatEffect[] = [],
    bonuses: ClassicBonus[] = [];
  for (const value of raw.projectiles) {
    const decoded = projectile(value, elapsedMs);
    if (
      !decoded ||
      !memberIds.has(decoded.owner) ||
      !within(decoded.x, decoded.y) ||
      !within(decoded.oldX, decoded.oldY)
    )
      return;
    projectiles.push(decoded);
  }
  for (const value of raw.effects) {
    const decoded = effect(value);
    if (
      !decoded ||
      (decoded.owner !== undefined && !memberIds.has(decoded.owner))
    )
      return;
    effects.push(decoded);
  }
  for (const value of raw.bonuses) {
    const decoded = bonus(value, elapsedMs);
    if (!decoded || !within(decoded.x, decoded.y)) return;
    bonuses.push(decoded);
  }
  const ids = [...projectiles, ...effects].map((value) => value.id);
  const pendingShots: PreparedShot[] = [];
  for (const value of raw.pendingShots) {
    const decoded = pendingShot(value, elapsedMs);
    if (
      !decoded ||
      !memberIds.has(decoded.owner) ||
      !within(decoded.x, decoded.y)
    )
      return;
    pendingShots.push(decoded);
  }
  const slotsById = new Map(worms.map((value) => [value.id, value.slot]));
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => id >= nextId) ||
    new Set(projectiles.map((value) => value.slot)).size !==
      projectiles.length ||
    new Set(bonuses.map((value) => value.id)).size !== bonuses.length ||
    pendingShots.some(
      (value, index) =>
        index > 0 &&
        slotsById.get(value.owner)! <=
          slotsById.get(pendingShots[index - 1]!.owner)!,
    )
  )
    return;
  return {
    seed,
    rng,
    step,
    elapsedMs,
    phase,
    winner: winner as string | null,
    nextId,
    nextBonusAtMs,
    settings,
    terrain,
    worms,
    projectiles,
    effects,
    bonuses,
    lastClientPhysicsMs,
    pendingShots,
    aiShared,
  };
}
