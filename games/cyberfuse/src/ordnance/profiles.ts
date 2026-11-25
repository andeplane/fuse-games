// SPDX-License-Identifier: GPL-2.0-or-later
// Adapted in 2026 from Ronny Wester's C-Dogs. See REFERENCE.md and COPYING.
import type { Burst } from "./index.js";
import type { Effect, ShotKind } from "./shot-checkpoint.js";

export interface MuzzleShot {
  type: "muzzle";
  kind: ShotKind;
  speed: number;
  range: number;
  power: number;
  radius?: number;
  spread?: readonly number[] | "random";
  frameFacing?: boolean;
  special?: Effect;
  advance?: "flame" | "petrifier";
}
type Launch =
  | MuzzleShot
  | { type: "contact" }
  | { type: "lob"; kind: "grenade" | "molotov" }
  | { type: "placed"; kind: "mine" | "dynamite"; range: number }
  | { type: "gas" };
interface WeaponProfile {
  lock: number;
  cost: number;
  launch: Launch;
  burst?: Burst | "shrapnel";
}
const grenade = { type: "lob", kind: "grenade" } as const;
const weaponProfiles = [
  { lock: 0, cost: 0, launch: { type: "contact" } },
  {
    lock: 6,
    cost: 1,
    launch: {
      type: "muzzle",
      kind: "bullet",
      speed: 768,
      range: 60,
      power: 10,
      spread: "random",
    },
  },
  { lock: 30, cost: 20, launch: grenade },
  {
    lock: 6,
    cost: 1,
    launch: {
      type: "muzzle",
      kind: "flame",
      speed: 384,
      range: 30,
      power: 12,
      radius: 5,
      special: "flame",
      advance: "flame",
    },
  },
  {
    lock: 50,
    cost: 5,
    launch: {
      type: "muzzle",
      kind: "bullet",
      speed: 640,
      range: 50,
      power: 15,
      spread: [16, 8, 0, -8, -16],
    },
  },
  {
    lock: 20,
    cost: 2,
    launch: {
      type: "muzzle",
      kind: "bolt",
      speed: 1024,
      range: 90,
      power: 20,
      radius: 2,
      frameFacing: true,
    },
  },
  { lock: 30, cost: 20, launch: grenade, burst: "shrapnel" },
  {
    lock: 30,
    cost: 20,
    launch: { type: "lob", kind: "molotov" },
    burst: "fire",
  },
  {
    lock: 100,
    cost: 5,
    launch: {
      type: "muzzle",
      kind: "sniper",
      speed: 1024,
      range: 90,
      power: 50,
      frameFacing: true,
    },
  },
  { lock: 100, cost: 10, launch: { type: "placed", kind: "mine", range: 140 } },
  {
    lock: 100,
    cost: 5,
    launch: { type: "placed", kind: "dynamite", range: 210 },
  },
  { lock: 30, cost: 10, launch: grenade, burst: "poison" },
  {
    lock: 100,
    cost: 7,
    launch: {
      type: "muzzle",
      kind: "petrifier",
      speed: 768,
      range: 45,
      power: 0,
      radius: 5,
      special: "petrify",
      advance: "petrifier",
    },
  },
  {
    lock: 30,
    cost: 7,
    launch: { type: "muzzle", kind: "brown", speed: 768, range: 45, power: 15 },
  },
  { lock: 30, cost: 10, launch: grenade, burst: "confuse" },
  { lock: 6, cost: 1, launch: { type: "gas" } },
] as const satisfies readonly WeaponProfile[];
export const profiles: readonly WeaponProfile[] = weaponProfiles;
export const WEAPON_COUNT = weaponProfiles.length;
