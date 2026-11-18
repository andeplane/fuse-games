import { getLevel, levelCount } from "../levels/index.js";
import { validHazards } from "./hazards.js";
import { validRulerState } from "./rulers.js";
import type { World } from "./simulation.js";

const plain = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const integer = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const fixed = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && integer(v * 16, min * 16, max * 16);
const exact = (v: Record<string, unknown>, fields: readonly string[]) =>
  Object.keys(v).length === fields.length &&
  fields.every((k) => Object.hasOwn(v, k));
const bodyFields = ["x", "y", "vx", "vy", "grounded", "facing"];
const playerFields = [
  ...bodyFields,
  "slot",
  "lives",
  "score",
  "invincible",
  "held",
  "respawn",
  "respawnTicks",
  "power",
  "powerTicks",
];
const enemyFields = [
  ...bodyFields,
  "id",
  "type",
  "stun",
  "anger",
  "hp",
  "kicked",
  "phase",
  "variation",
];
const worldFields = [
  "pack",
  "levelIndex",
  "rng",
  "tick",
  "outcome",
  "players",
  "enemies",
  "nextPest",
  "nextSpawnAt",
  "tnt",
  "bumps",
  "broken",
  "moved",
  "revealed",
  "pickups",
  "hazards",
];
const body = (v: Record<string, unknown>) =>
  fixed(v.x, -256, 896) &&
  fixed(v.y, -1024, 640) &&
  fixed(v.vx, -64, 64) &&
  fixed(v.vy, -64, 64) &&
  (v.facing === 1 || v.facing === -1) &&
  typeof v.grounded === "boolean";
const cell = (v: Record<string, unknown>) =>
  integer(v.column, 0, 19) && integer(v.row, 0, 29);
const cellIds = (a: unknown): a is number[] =>
  Array.isArray(a) &&
  a.length <= 600 &&
  a.every((n) => integer(n, 0, 599)) &&
  new Set(a).size === a.length;

/** Validate before restoring. The level owns the roster of creatures: a checkpoint
 * cannot introduce a new kind or reuse a defeated spawn twice. */
export function validWorld(raw: unknown): raw is World {
  if (
    !plain(raw) ||
    !exact(raw, worldFields) ||
    (raw.pack !== "original" && raw.pack !== "bonus") ||
    !integer(raw.levelIndex, 0, levelCount(raw.pack) - 1) ||
    !integer(raw.tick, 0, 0xffffffff) ||
    !integer(raw.rng, 0, 0xffffffff) ||
    !integer(raw.tnt, 0, 3) ||
    !integer(raw.nextSpawnAt, 0, 0xffffffff) ||
    !(
      raw.outcome === "playing" ||
      raw.outcome === "cleared" ||
      raw.outcome === "lost"
    ) ||
    !Array.isArray(raw.players) ||
    raw.players.length > 2 ||
    !Array.isArray(raw.enemies) ||
    !Array.isArray(raw.bumps) ||
    raw.bumps.length > 600 ||
    !Array.isArray(raw.pickups) ||
    raw.pickups.length > 600 ||
    !cellIds(raw.broken) ||
    !cellIds(raw.revealed) ||
    !cellIds(raw.moved) ||
    !validHazards(raw.hazards)
  )
    return false;
  const level = getLevel(raw.levelIndex + 1, raw.pack);
  if (
    !integer(raw.nextPest, 0, level.pests.length) ||
    raw.enemies.length > raw.nextPest + (level.boss ? 1 : 0)
  )
    return false;
  const slots = new Set<number>(),
    ids = new Set<number>();
  for (const p of raw.players) {
    if (
      !plain(p) ||
      !exact(p, playerFields) ||
      !body(p) ||
      !integer(p.slot, 0, 1) ||
      slots.has(p.slot) ||
      !integer(p.lives, 0, 99) ||
      !integer(p.score, 0, 99_999_999) ||
      !integer(p.invincible, 0, 302) ||
      !integer(p.held, 0, 7) ||
      !(
        p.respawn === "active" ||
        p.respawn === "rising" ||
        p.respawn === "waiting" ||
        p.respawn === "climbing"
      ) ||
      !integer(p.respawnTicks, 0, 901) ||
      !(p.power === 0 || p.power === 11 || p.power === 13) ||
      !integer(p.powerTicks, 0, 65535)
    )
      return false;
    slots.add(p.slot);
  }
  for (const e of raw.enemies) {
    if (
      !plain(e) ||
      !(e.id === -1
        ? exact(e, [...enemyFields, "ruler"]) && validRulerState(e.ruler)
        : exact(e, enemyFields)) ||
      !body(e) ||
      !integer(e.id, -1, raw.nextPest - 1) ||
      ids.has(e.id) ||
      !integer(e.hp, 0, level.boss?.hp ?? 1) ||
      !integer(e.anger, 0, 32) ||
      !integer(e.stun, 0, 501) ||
      !integer(e.phase, 0, 65535) ||
      !integer(e.variation, 0, 31) ||
      typeof e.kicked !== "boolean" ||
      e.kicked !== (e.hp === 0) ||
      e.type !==
        (e.id === -1 ? level.boss?.spriteId : level.pests[e.id]?.type) ||
      typeof e.type !== "number"
    )
      return false;
    ids.add(e.id);
  }
  if (raw.outcome === "lost" && raw.players.some((p) => p.lives > 0))
    return false;
  if (
    raw.outcome === "cleared" &&
    (raw.enemies.length || raw.nextPest !== level.pests.length)
  )
    return false;
  const tick = raw.tick;
  return (
    raw.bumps.every(
      (b) =>
        plain(b) &&
        exact(b, ["column", "row", "until"]) &&
        cell(b) &&
        integer(b.until, tick + 1, tick + 7),
    ) &&
    raw.pickups.every(
      (p) =>
        plain(p) &&
        exact(p, ["column", "row", "type"]) &&
        cell(p) &&
        integer(p.type, 11, 17),
    )
  );
}
