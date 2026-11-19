// SPDX-License-Identifier: GPL-2.0-or-later
// Adapted in 2026 from Ronny Wester's C-Dogs. See REFERENCE.md and COPYING.
import { profiles, WEAPON_COUNT, type MuzzleShot } from "./profiles.js";
import type { Effect, ShotKind } from "./shot-checkpoint.js";
export { WEAPON_COUNT } from "./profiles.js";
export { isShot, isCheckpointShot } from "./shot-checkpoint.js";

export const MAX_SHOTS = 2048;

export interface Shot {
  weapon: number;
  owner: string;
  kind: ShotKind;
  /** Ground position and velocity, in exact multiples of 1/256 map pixel. */
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** Visual height and vertical velocity in the source sprite's native units. */
  z: number;
  dz: number;
  age: number;
  range: number;
  power: number;
  radiusX: number;
  radiusY: number;
  frame: number;
  always: boolean;
  special: Effect;
}
export interface ShotEnvironment {
  random(): number;
  wall(x: number, y: number): boolean;
  hit(shot: Shot, x: number, y: number): boolean;
  /** Any character in the centered 3x3 tile neighborhood. */
  nearActor(x: number, y: number): boolean;
}
export type Burst = "explosion" | "fire" | "poison" | "confuse";
type Random = () => number;

const sine = [
  0, 6, 12, 18, 25, 31, 37, 43, 49, 56, 62, 68, 74, 80, 86, 92, 97, 103, 109,
  115, 120, 126, 131, 136, 142, 147, 152, 157, 162, 167, 171, 176, 181, 185,
  189, 193, 197, 201, 205, 209, 212, 216, 219, 222, 225, 228, 231, 234, 236,
  238, 241, 243, 244, 246, 248, 249, 251, 252, 253, 254, 254, 255, 255, 255,
  256,
];
function sin(angle: number): number {
  const phase = angle & 255;
  const index = phase & 63;
  const magnitude = sine[phase & 64 ? 64 - index : index]!;
  return phase & 128 ? -magnitude : magnitude;
}
function vector(angle: number, speed: number): [number, number] {
  return [
    Math.trunc((speed * sin(angle + 64)) / 256) / 256,
    Math.trunc((speed * Math.trunc((3 * sin(angle)) / 4)) / 256) / 256,
  ];
}
// Hand anchor + firing frame + muzzle + vertical projectile offset in PICS.C.
const muzzle = [
  [5, -4],
  [11, -3],
  [15, 3],
  [0, 8],
  [-6, 8],
  [-12, 6],
  [-15, -1],
  [-9, -7],
] as const;
function make(
  weapon: number,
  owner: string,
  x: number,
  y: number,
  kind: ShotKind,
): Shot {
  return {
    weapon,
    owner,
    x,
    y,
    kind,
    dx: 0,
    dy: 0,
    z: 0,
    dz: 0,
    age: 0,
    range: 0,
    power: 0,
    radiusX: 0,
    radiusY: 0,
    frame: 0,
    always: false,
    special: "none",
  };
}
function propel(
  s: Shot,
  angle: number,
  speed: number,
  range: number,
  power: number,
  radius = 0,
): Shot {
  [s.dx, s.dy] = vector(angle, speed);
  s.range = range;
  s.power = power;
  s.radiusX = s.radiusY = radius;
  return s;
}
function shift(s: Shot, stepsX: number, stepsY: number): Shot {
  s.x += stepsX * s.dx;
  s.y += stepsY * s.dy;
  return s;
}
function gas(
  weapon: number,
  owner: string,
  x: number,
  y: number,
  angle: number,
  speed: number,
  range: number,
  special: "poison" | "confuse",
) {
  const s = propel(
    make(weapon, owner, x, y, "gas"),
    angle,
    speed,
    range,
    0,
    10,
  );
  s.special = special;
  s.z = special === "confuse" ? 1 : 0;
  return shift(s, 6, 6);
}

function muzzleShots(
  launch: MuzzleShot,
  base: Shot,
  angle: number,
  dir: number,
  random: Random,
): Shot[] {
  const spread =
    launch.spread === "random" ? [(random() & 7) - 4] : (launch.spread ?? [0]);
  return spread.map((offset) => {
    const s = propel(
      { ...base },
      angle + offset,
      launch.speed,
      launch.range,
      launch.power,
      launch.radius,
    );
    s.z = 10;
    if (launch.frameFacing) s.frame = dir;
    if (launch.advance === "flame") {
      const [vx, vy] = vector(angle, 256);
      s.x += 4 * vx;
      s.y += 7 * vy;
    } else if (launch.advance === "petrifier") shift(s, 4, 7);
    if (launch.special) s.special = launch.special;
    return s;
  });
}

/** Fires from the actor's ground pivot. Results are newest first, as in the DOS mobile list. */
export function fireWeapon(
  weapon: number,
  owner: string,
  x: number,
  y: number,
  dir: number,
  random: Random,
) {
  if (
    !Number.isInteger(weapon) ||
    weapon < 0 ||
    weapon >= WEAPON_COUNT ||
    !Number.isInteger(dir) ||
    dir < 0 ||
    dir > 7
  )
    throw new RangeError("Invalid C-Dogs weapon or facing");
  const angle = (dir * 32 + 192) & 255;
  const [mx, my] = muzzle[dir]!;
  const { launch, lock, cost } = profiles[weapon]!;
  const shots: Shot[] = [];
  switch (launch.type) {
    case "contact":
      break;
    case "lob": {
      const s = propel(
        make(weapon, owner, x, y, launch.kind),
        angle,
        384,
        100,
        0,
      );
      s.dz = 24;
      shots.push(s);
      break;
    }
    case "placed": {
      const s = make(weapon, owner, x, y, launch.kind);
      s.range = launch.range;
      shots.push(s);
      break;
    }
    case "gas":
      shots.push(gas(weapon, owner, x + mx, y + my, angle, 384, 35, "poison"));
      break;
    case "muzzle":
      return {
        lock,
        cost,
        shots: muzzleShots(
          launch,
          make(weapon, owner, x + mx, y + my, launch.kind),
          angle,
          dir,
          random,
        ),
      };
  }

  return { lock, cost, shots };
}

/** Objects spawned by a broken barrel or a detonating projectile, in next-update order. */
export function burst(
  kind: Burst,
  owner: string,
  x: number,
  y: number,
  random: Random,
  weapon = 2,
): Shot[] {
  const result: Shot[] = [];
  if (kind === "explosion") {
    for (let ring = 0; ring < 3; ring++)
      for (let i = 0; i < 8; i++) {
        const s = propel(
          make(weapon, owner, x, y, "fireball"),
          i * 32 + (ring === 1 ? 16 : 0),
          256,
          63,
          5,
          7,
        );
        s.radiusY = 5;
        shift(s, 2 - ring, 2 - ring);
        const speed = [1, 0.75, 0.5][ring]!;
        s.dx = Math.trunc(s.dx * 256 * speed) / 256;
        s.dy = Math.trunc(s.dy * 256 * speed) / 256;
        s.dz = [0, 8, 11][ring]!;
        s.age = -8 * ring;
        result.push(s);
      }
  } else if (kind === "fire") {
    for (let i = 0; i < 16; i++) {
      const s = make(weapon, owner, x, y, "firePatch");
      s.special = "flame";
      s.radiusX = s.radiusY = 5;
      s.power = 2;
      s.range = (30 + (random() % 8)) * 4;
      s.dx = (16 * (random() % 32) - 256) / 256;
      s.dy = (12 * (random() % 32) - 192) / 256;
      s.dz = 4 + (random() % 4);
      result.push(s);
    }
  } else {
    for (let i = 0; i < 8; i++) {
      // DOS C evaluates these call arguments right to left. The speed
      // expression in Gas is (256 + rand()) & 255.
      const range = (48 - (random() % 8)) * 4 - 1;
      const speed = (256 + random()) & 255;
      result.push(gas(weapon, owner, x, y, random() & 255, speed, range, kind));
    }
  }
  for (const s of result) s.always = true;
  return result.reverse();
}
function detonate(s: Shot, random: Random): Shot[] {
  const rule = Number.isInteger(s.weapon)
    ? profiles[s.weapon]?.burst
    : undefined;
  if (rule !== "shrapnel")
    return burst(rule ?? "explosion", s.owner, s.x, s.y, random, s.weapon);
  return Array.from({ length: 16 }, (_, i) => {
    const p = propel(
      make(6, s.owner, s.x, s.y, "bullet"),
      (15 - i) * 16,
      640,
      50,
      40,
    );
    p.z = 10;
    p.always = true;
    return p;
  });
}

const fuses = new Map<ShotKind, "atRange" | "pastRange">([
  ["dynamite", "atRange"],
  ["triggeredMine", "atRange"],
  ["grenade", "pastRange"],
  ["molotov", "pastRange"],
]);

function advancePosition(s: Shot, x: number, y: number): true {
  s.x = x;
  s.y = y;
  return true;
}

type WallProbe = (x: number, y: number) => boolean;

function moveLob(s: Shot, x: number, y: number, wall: WallProbe): boolean {
  s.z += s.dz;
  if (s.kind === "molotov") {
    if (s.z <= 0 || wall(x, y)) return false;
    s.dz--;
    return advancePosition(s, x, y);
  }
  if (s.z <= 0) {
    s.z = 0;
    s.dz = Math.trunc(-s.dz / 2);
  } else s.dz--;
  if (!wall(x, y)) {
    s.x = x;
    s.y = y;
  } else if (!wall(s.x, y)) {
    s.y = y;
    s.dx = -s.dx;
  } else if (!wall(x, s.y)) {
    s.x = x;
    s.dy = -s.dy;
  } else {
    s.dx = -s.dx;
    s.dy = -s.dy;
  }
  return true;
}

function moveCloud(
  s: Shot,
  { x, y }: { x: number; y: number },
  env: ShotEnvironment,
  wall: WallProbe,
  hit: () => boolean,
): boolean {
  if ((s.age & 3) === 0) s.frame = env.random() & 3;
  if (s.kind === "flame") {
    if (hit()) {
      s.age = s.range;
      return advancePosition(s, x, y);
    }
    if (wall(x, y)) return false;
  } else {
    if (s.kind === "firePatch") {
      s.z += Math.trunc(s.dz / 2);
      if (s.z <= 0) s.z = 0;
      else s.dz--;
    }
    s.dx -= (Math.sign(s.dx) * 4) / 256;
    s.dy -= (Math.sign(s.dy) * 3) / 256;
    hit();
    if (wall(x, y)) return true;
  }
  return advancePosition(s, x, y);
}

function update(
  s: Shot,
  env: ShotEnvironment,
  spawn: (shots: Shot[]) => void,
): boolean {
  s.age++;
  const x = s.x + s.dx,
    y = s.y + s.dy;
  // DOS checks collision at the integer part while retaining full position in the object.
  const wall = (px: number, py: number) =>
    env.wall(Math.floor(px), Math.floor(py));
  const hit = () => env.hit(s, Math.floor(x), Math.floor(y));
  const fuse = fuses.get(s.kind);
  if (fuse) {
    const expired = fuse === "atRange" ? !(s.age < s.range) : s.age > s.range;
    if (expired) {
      spawn(detonate(s, env.random));
      return false;
    }
    if (fuse === "atRange") return true;
  } else if (s.kind !== "mine" && s.kind !== "armedMine" && s.age > s.range) {
    return false;
  }
  switch (s.kind) {
    case "mine":
      if (s.age >= s.range) s.kind = "armedMine";
      return true;
    case "armedMine": {
      if ((s.age & 3) === 0 && env.nearActor(s.x, s.y)) {
        s.kind = "triggeredMine";
        s.age = 0;
        s.range = 5;
      }
      return true;
    }
    case "grenade":
    case "molotov":
      if (moveLob(s, x, y, wall)) return true;
      spawn(detonate(s, env.random));
      return false;
    case "gas":
    case "firePatch":
    case "flame":
      return moveCloud(s, { x, y }, env, wall, hit);
    case "fireball":
      if (s.age < 0) return true;
      s.z += s.dz;
      s.dz--;
      hit();
      if (wall(x, y)) return false;
      return advancePosition(s, x, y);
    case "spark":
      return false;
    default: {
      const brown = s.kind === "brown";
      if (hit() || wall(x, y)) {
        s.kind = "spark";
        s.age = 0;
        s.range = 0;
      } else advancePosition(s, x, y);
      if (brown) {
        s.dx += ((env.random() % 3) - 1) / 2;
        s.dy += ((env.random() % 3) - 1) / 2;
      }
      return true;
    }
  }
}

/** Step one original mobile-object update. Spawned bursts first move on the following update. */
export function advanceShots(
  shots: readonly Shot[],
  env: ShotEnvironment,
): Shot[] {
  const spawned: Shot[] = [];
  const surviving: Shot[] = [];
  let sweep = false;
  for (const current of shots) {
    const s = { ...current };
    if (update(s, env, (batch) => spawned.unshift(...batch))) surviving.push(s);
    else sweep = true;
  }
  const result = spawned.concat(
    sweep ? surviving.filter((s) => s.range !== 0) : surviving,
  );
  return result.slice(0, MAX_SHOTS);
}
