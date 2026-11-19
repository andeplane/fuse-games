// SPDX-License-Identifier: GPL-2.0-or-later
// Adapted in 2026 from Ronny Wester's C-Dogs. See REFERENCE.md and COPYING.
import type { Shot } from "./index.js";
import { WEAPON_COUNT } from "./profiles.js";

const kinds = [
  "bullet",
  "bolt",
  "sniper",
  "brown",
  "petrifier",
  "flame",
  "grenade",
  "molotov",
  "mine",
  "armedMine",
  "triggeredMine",
  "dynamite",
  "gas",
  "firePatch",
  "fireball",
  "spark",
] as const;
export type ShotKind = (typeof kinds)[number];
const effects = ["none", "flame", "poison", "petrify", "confuse"] as const;
export type Effect = (typeof effects)[number];

type ShotRecord = Record<string, unknown>;
const record = (v: unknown): v is ShotRecord =>
  !!v && typeof v === "object" && !Array.isArray(v);
const integer = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const fixed = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isInteger(v * 256) && v >= min && v <= max;
const worldCoordinate = (v: unknown) => fixed(v, -1024, 8192);
const velocity = (v: unknown) => fixed(v, -128, 128);
const radius = (v: unknown) => integer(v, 0, 10);
const shotChecks = {
  owner: (s) =>
    typeof s.owner === "string" && s.owner.length > 0 && s.owner.length <= 160,
  weapon: (s) => integer(s.weapon, 0, WEAPON_COUNT - 1),
  kind: (s) => kinds.some((kind) => s.kind === kind),
  special: (s) => effects.some((effect) => s.special === effect),
  x: (s) => worldCoordinate(s.x),
  y: (s) => worldCoordinate(s.y),
  dx: (s) => velocity(s.dx),
  dy: (s) => velocity(s.dy),
  z: (s) => integer(s.z, -4096, 4096),
  dz: (s) => integer(s.dz, -128, 128),
  age: (s) => integer(s.age, -16, 0x7fffffff),
  range: (s) => integer(s.range, 0, 210),
  power: (s) => integer(s.power, 0, 50),
  radiusX: (s) => radius(s.radiusX),
  radiusY: (s) => radius(s.radiusY),
  frame: (s) => integer(s.frame, 0, 7),
  always: (s) => typeof s.always === "boolean",
} satisfies Record<keyof Shot, (s: ShotRecord) => boolean>;
const fields = new Set(Object.keys(shotChecks));
const checks = Object.values(shotChecks);

export function isShot(raw: unknown): raw is Shot {
  return record(raw) && checks.every((check) => check(raw));
}

/** Mission checkpoints also reject extra enumerable shot keys. */
export function isCheckpointShot(raw: unknown): raw is Shot {
  return isShot(raw) && Object.keys(raw).every((key) => fields.has(key));
}
