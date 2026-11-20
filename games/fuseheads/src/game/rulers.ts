import {
  COLUMNS,
  FLOOR_ROW,
  TILE_HEIGHT,
  TILE_WIDTH,
  tileAt,
  type FuseLevel,
} from "../levels/index.js";
import type { Enemy, Player, World } from "./simulation.js";

type Shot = {
  kind: "rat" | "fire";
  slot: 0 | 1;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
};

/** The paired projectile slots and guidance timer are shared by the two boss projectiles in Deluxe. */
export interface RulerState {
  action: number;
  travel: number;
  pass: number;
  flash: number;
  guard: number;
  guidance: number;
  shots: Shot[];
}

type Definition = NonNullable<FuseLevel["boss"]>;
const field = (spec: Definition, i: number) => spec.fields[i] ?? 0;
const live = (p: Player) => p.lives > 0 && p.respawn === "active";
const fixed = (n: unknown, low: number, high: number): n is number =>
  typeof n === "number" &&
  n >= low &&
  n <= high &&
  Number.isSafeInteger(n * 16);
const integer = (n: unknown, low: number, high: number): n is number =>
  fixed(n, low, high) && Number.isInteger(n);
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) =>
  keys.length === Object.keys(v).length &&
  keys.every((k) => Object.hasOwn(v, k));

export function validRulerState(v: unknown): v is RulerState {
  if (
    !record(v) ||
    !exact(v, [
      "action",
      "travel",
      "pass",
      "flash",
      "guard",
      "guidance",
      "shots",
    ]) ||
    !integer(v.action, 0, 65535) ||
    !integer(v.travel, 0, 65535) ||
    !integer(v.pass, 0, 65535) ||
    !integer(v.flash, 0, 18) ||
    !integer(v.guard, 0, 30) ||
    !integer(v.guidance, 0, 8) ||
    !Array.isArray(v.shots) ||
    v.shots.length > 2
  )
    return false;
  const slots = new Set<number>();
  for (const shot of v.shots) {
    if (
      !record(shot) ||
      !exact(shot, ["kind", "slot", "x", "y", "vx", "vy", "age"]) ||
      (shot.kind !== "fire" && shot.kind !== "rat") ||
      !integer(shot.slot, 0, 1) ||
      slots.has(shot.slot) ||
      !integer(shot.age, 0, 250) ||
      !fixed(shot.x, -160, 800) ||
      !fixed(shot.y, -128, 544) ||
      !fixed(shot.vx, -32, 32) ||
      !fixed(shot.vy, -32, 32)
    )
      return false;
    slots.add(shot.slot);
  }
  return true;
}

export function createRuler(level: FuseLevel): Enemy | undefined {
  const spec = level.boss;
  if (!spec) return;
  return {
    id: -1,
    type: spec.spriteId,
    x: spec.x + 48,
    y: spec.y + 96,
    vx: 0,
    vy: 0,
    facing: -1,
    grounded: false,
    hp: spec.hp,
    anger: 0,
    stun: 0,
    kicked: false,
    phase: 0,
    variation: 0,
    ruler: {
      action: 0,
      travel: 0,
      pass: 0,
      flash: 0,
      guard: 0,
      guidance: 0,
      shots: [],
    },
  };
}

/** Shrew probes five samples 15 pixels apart; the wider T.Wrecks samples every 17 pixels. */
function footRadius(type: number) {
  return type === 3500 ? 34 : 30;
}

export function bonkRuler(
  e: Enemy,
  column: number,
  row: number,
  blast: boolean,
): void {
  const state = e.ruler;
  if (!state || !e.hp || state.guard || state.flash || !e.grounded) return;
  if (
    !blast &&
    (Math.abs(e.y - row * TILE_HEIGHT) > 2 ||
      Math.abs(e.x - (column + 0.5) * TILE_WIDTH) >
        TILE_WIDTH / 2 + footRadius(e.type))
  )
    return;
  e.hp--;
  state.guard = 24;
  e.grounded = false;
  e.vy = -8;
}

function solid(level: FuseLevel, col: number, row: number) {
  return tileAt(level, col, row) > 1;
}

function fall(
  body: Pick<Enemy, "x" | "y" | "vy">,
  level: FuseLevel,
  radius: number,
) {
  body.vy = Math.min(15, body.vy + level.physics.gravity / 16);
  const next = body.y + body.vy;
  if (body.vy >= 0) {
    for (
      let row = Math.ceil(body.y / TILE_HEIGHT);
      row <= Math.floor(next / TILE_HEIGHT);
      row++
    ) {
      for (
        let col = Math.floor((body.x - radius) / TILE_WIDTH);
        col <= Math.floor((body.x + radius) / TILE_WIDTH);
        col++
      ) {
        if (!solid(level, col, row)) continue;
        body.vy = 0;
        body.y = row * TILE_HEIGHT;
        return true;
      }
    }
  }
  body.y = next;
  return false;
}

function nearest(world: World, x: number, y: number) {
  let best: Player | undefined,
    distance = Infinity;
  for (const p of world.players) {
    const d = Math.abs(p.x - x) + Math.abs(p.y - y);
    if (live(p) && d < distance) {
      best = p;
      distance = d;
    }
  }
  return best;
}

function nextRandom(world: World, max: number) {
  world.rng = (Math.imul(world.rng, 1664525) + 1013904223) >>> 0;
  return world.rng % max;
}

function spawnShot(
  state: RulerState,
  kind: Shot["kind"],
  slot: 0 | 1,
  x: number,
  y: number,
  vx: number,
) {
  if (!state.shots.some((s) => s.slot === slot))
    state.shots.push({ kind, slot, x, y, vx, vy: 0, age: 0 });
}

/** FireControl compares a shared counter against 8, then steers each axis in sixteenths of a pixel. */
function moveShots(
  world: World,
  level: FuseLevel,
  state: RulerState,
  hit: (p: Player) => void,
) {
  state.shots = state.shots.filter((s) => {
    const target = nearest(world, s.x, s.y);
    s.age++;
    if (s.kind === "fire") {
      if (!target) return false;
      s.x += s.vx;
      s.y += s.vy;
      if (++state.guidance > 8) {
        state.guidance = 0;
        const change = (s.slot === 0 ? 24 : 36) / 16,
          cap = (s.slot === 0 ? 90 : 135) / 16;
        // Check the old speed before adding, just as FireControl does. It can overshoot by one increment.
        const steer = (speed: number, dir: number) =>
          dir * speed < cap ? speed + dir * change : speed;
        s.vx = steer(s.vx, target.x >= s.x ? 1 : -1);
        s.vy = steer(s.vy, target.y - 24 >= s.y ? 1 : -1);
      }
    } else {
      s.x += s.vx;
      fall(s, level, 8);
    }
    for (const p of world.players) {
      if (live(p) && Math.abs(p.x - s.x) < 19 && Math.abs(p.y - 24 - s.y) < 25)
        hit(p);
    }
    return s.age <= 250 && s.x >= -32 && s.x <= 672 && s.y >= -32 && s.y <= 480;
  });
}

function shrew(
  world: World,
  level: FuseLevel,
  spec: Definition,
  e: Enemy,
  state: RulerState,
) {
  const target = nearest(world, e.x, e.y);
  const speed = field(spec, 6) / 16;
  if (e.grounded && target) {
    e.facing = target.x >= e.x ? 1 : -1;
    e.vx = e.facing * speed;
    if (++state.action > field(spec, 9)) {
      state.action = 0;
      if (target.y < e.y - 12) e.vy = -level.physics.jump / 16;
      // BOSS word 11 enables RatStorm in the later Shrew encounters.
      if (field(spec, 11) === 1) {
        const velocity = field(spec, 13) / 16;
        spawnShot(state, "rat", 0, e.x - 48, e.y - 48, -velocity);
        spawnShot(state, "rat", 1, e.x + 48, e.y - 48, velocity);
      }
    }
  }
  e.x = Math.max(28, Math.min(612, e.x + e.vx));
  e.grounded = fall(e, level, 30);
}

function crossingRows(level: FuseLevel, side: number) {
  const rows: number[] = [];
  for (let r = 1; r <= FLOOR_ROW; r++) {
    if (solid(level, side, r) && !solid(level, side, r - 1)) rows.push(r);
  }
  return rows;
}

function wrecks(
  level: FuseLevel,
  spec: Definition,
  e: Enemy,
  state: RulerState,
) {
  if (state.pass === 0 || (e.facing === 1 ? e.x > 740 : e.x < -100)) {
    // StartTWrecks alternates directions; PickTWrecksStartPosition chooses from the platforms at each edge.
    e.facing = state.pass % 2 === 0 ? 1 : -1;
    const rows = crossingRows(level, e.facing === 1 ? 0 : COLUMNS - 1);
    e.y =
      (rows[Math.floor(state.pass / 2) % Math.max(1, rows.length)] ??
        FLOOR_ROW) * TILE_HEIGHT;
    e.x = e.facing === 1 ? -98 : 738;
    e.vy = 0;
    state.pass = state.pass === 65535 ? 2 : state.pass + 1;
  }
  e.vx = (e.facing * (field(spec, 6) + 4 * (spec.hp - e.hp))) / 8;
  e.x += e.vx;
  // The body walks in from outside the visible board, level with the selected edge.
  if (e.x < 0 || e.x > 640) return;
  e.grounded = fall(e, level, 34);
}

function teleport(world: World, level: FuseLevel, e: Enemy) {
  const spots = level.tiles.flatMap((tile, cell) => {
    const col = cell % COLUMNS,
      row = Math.floor(cell / COLUMNS);
    if (
      tile <= 1 ||
      col < 2 ||
      col > 17 ||
      row < 6 ||
      row >= FLOOR_ROW ||
      solid(level, col, row - 1)
    )
      return [];
    const x = col * TILE_WIDTH + 16,
      y = row * TILE_HEIGHT;
    return world.players.some(
      (p) =>
        live(p) && Math.abs(x - p.x) < 60 && Math.abs(y - 48 - (p.y - 24)) < 73,
    )
      ? []
      : [{ x, y }];
  });
  const spot = spots.length
    ? spots[nextRandom(world, spots.length)]!
    : { x: 320, y: 96 };
  e.x = spot.x;
  e.y = spot.y;
  e.vx = 0;
  e.vy = 0;
}

function devil(
  world: World,
  level: FuseLevel,
  spec: Definition,
  e: Enemy,
  state: RulerState,
) {
  if (state.flash) {
    if (--state.flash === 9) teleport(world, level, e);
    return;
  }
  const target = nearest(world, e.x, e.y);
  if (e.grounded && target) {
    state.action++;
    state.travel++;
    const fireDelay = field(spec, 5);
    if (field(spec, 11) && state.action === fireDelay + 1)
      spawnShot(state, "fire", 0, e.x, e.y - 48, 0);
    if (field(spec, 12) && state.action === fireDelay + 4)
      spawnShot(state, "fire", 1, e.x, e.y - 48, 0);
    if (state.action >= fireDelay + 4) state.action = 0;
    if (state.travel > 2 * field(spec, 7)) {
      state.travel = 0;
      state.flash = 18;
      return;
    }
    if (world.tick % (field(spec, 9) + 1) === 0) {
      e.facing = target.x >= e.x ? 1 : -1;
      e.vx = (e.facing * field(spec, 6)) / 16;
      e.vy = -level.physics.jump / 16;
    }
  }
  e.x = Math.max(32, Math.min(608, e.x + e.vx));
  e.grounded = fall(e, level, 30);
  if (e.grounded) e.vx = 0;
}

export function stepRuler(
  world: World,
  level: FuseLevel,
  e: Enemy,
  hit: (p: Player) => void,
): void {
  const state = e.ruler,
    spec = level.boss;
  if (!state || !spec || e.hp <= 0) return;
  if (state.guard) state.guard--;
  if (spec.type === 1) shrew(world, level, spec, e, state);
  if (spec.type === 2) wrecks(level, spec, e, state);
  if (spec.type === 3) devil(world, level, spec, e, state);
  if (!state.flash && !state.guard) {
    const halfWidth = spec.type === 2 ? 75 : 33,
      height = spec.type === 2 ? 50 : 80;
    for (const p of world.players) {
      if (
        live(p) &&
        Math.abs(e.x - p.x) < halfWidth + 10 &&
        e.y - height < p.y - 6 &&
        e.y > p.y - 42
      )
        hit(p);
    }
  }
  moveShots(world, level, state, hit);
}
