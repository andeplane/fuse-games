import { getLevel, tileAt } from "../levels/index.js";
import {
  bonkRuler,
  createRuler,
  stepRuler,
  type RulerState,
} from "./rulers.js";
import {
  blastBat,
  createHazards,
  stepHazards,
  type Hazards,
} from "./hazards.js";

export const SIM_HZ = 30;
export const INPUT_LEFT = 1;
export const INPUT_RIGHT = 2;
export const INPUT_JUMP = 4;
export type Pack = "original" | "bonus";
type Level = NonNullable<ReturnType<typeof getLevel>>;
type Facing = -1 | 1;
const TILE_WIDTH = 32;
const TILE_HEIGHT = 16;
const COLUMNS = 20;
const WIDTH = 640;
const HEIGHT = 480;
const PLAYER_HEIGHT = 48;
const PLAYER_RADIUS = 12;
const ENEMY_HEIGHT = 32;
const ENEMY_RADIUS = 12;
const SIXTEENTH = 1 / 16;
const MAX_SCORE = 99_999_999;
export interface CampaignCarry {
  readonly players: readonly Pick<Player, "slot" | "lives" | "score">[];
  readonly tnt: number;
}

/** Pixel coordinates on the 640 × 480 board, anchored at the middle of the feet.
 * All movement uses binary-exact sixteenths of a pixel per reference update. */
interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: Facing;
  grounded: boolean;
}
export interface Player extends Body {
  slot: number;
  lives: number;
  score: number;
  invincible: number;
  held: number;
  respawn: "active" | "rising" | "waiting" | "climbing";
  respawnTicks: number;
  power: number;
  powerTicks: number;
}
export interface Enemy extends Body {
  ruler?: RulerState;
  id: number;
  type: number;
  stun: number;
  anger: number;
  hp: number;
  kicked: boolean;
  phase: number;
  variation: number;
}
export interface World {
  pack: Pack;
  levelIndex: number;
  rng: number;
  hazards: Hazards;
  tick: number;
  outcome: "playing" | "cleared" | "lost";
  players: Player[];
  enemies: Enemy[];
  nextPest: number;
  nextSpawnAt: number;
  tnt: number;
  bumps: { column: number; row: number; until: number }[];
  broken: number[];
  moved: number[];
  revealed: number[];
  pickups: { column: number; row: number; type: number }[];
}

const levelFor = (world: Pick<World, "pack" | "levelIndex">): Level =>
  getLevel(world.levelIndex + 1, world.pack)!;

function spawnPlayer(
  level: Level,
  slot: number,
  old?: Pick<Player, "lives" | "score">,
): Player {
  const spawn = level.spawns[slot]!;
  return {
    slot,
    x: spawn.x + 24,
    y: spawn.y + PLAYER_HEIGHT,
    vx: 0,
    vy: 0,
    facing: slot === 0 ? 1 : -1,
    grounded: false,
    lives: old?.lives ?? 3,
    score: old?.score ?? 0,
    held: 0,
    invincible: 0,
    respawn: "active",
    respawnTicks: 0,
    power: 0,
    powerTicks: 0,
  };
}

export function createWorld(
  levelIndex: number,
  slots: readonly number[],
  seed: number,
  previous?: CampaignCarry,
  pack: Pack = "original",
): World {
  const level = levelFor({ pack, levelIndex });
  const ruler = createRuler(level);
  return {
    pack,
    levelIndex,
    tick: 0,
    rng: seed >>> 0,
    outcome: "playing",
    hazards: createHazards(),
    players: [...slots]
      .sort((a, b) => a - b)
      .map((slot) =>
        spawnPlayer(
          level,
          slot,
          previous?.players.find((p) => p.slot === slot),
        ),
      ),
    enemies: ruler ? [ruler] : [],
    nextPest: 0,
    nextSpawnAt: level.pests[0]?.spacing ?? 0,
    tnt: previous ? Math.min(3, previous.tnt + (level.stage === 6 ? 1 : 0)) : 3,
    bumps: [],
    broken: [],
    moved: [],
    revealed: [],
    pickups: [],
  };
}

function tile(world: World, level: Level, col: number, row: number) {
  if (col < 0 || col >= COLUMNS || row < 0 || row >= 30) return 0;
  const index = row * COLUMNS + col;
  if (world.moved.includes(index)) return 8;
  const code = tileAt(level, col, row);
  if (world.broken.includes(index)) return 0;
  const above = code === 1 ? tileAt(level, col, row - 1) : 0;
  if (code === 50 || code === 51 || above === 50 || above === 51)
    return world.tnt === 0 ? 0 : code === 1 ? above : code;
  return code;
}
export { tile as simulationTileAt };
function solid(code: number) {
  return code > 1;
}
function floorTile(world: World, level: Level, x: number, y: number) {
  return tile(
    world,
    level,
    Math.floor(x / TILE_WIDTH),
    Math.floor(y / TILE_HEIGHT),
  );
}
function supported(world: World, level: Level, b: Body, radius: number) {
  return (
    solid(floorTile(world, level, b.x - radius, b.y)) ||
    solid(floorTile(world, level, b.x + radius - SIXTEENTH, b.y))
  );
}
function random(w: World) {
  w.rng = (Math.imul(w.rng, 1664525) + 1013904223) >>> 0;
  return w.rng;
}

/** A second blow awakens a stunned pest. An escape or recovery makes its next pass faster. */
function enrage(enemy: Enemy, level: Level) {
  const spec = level.pests[enemy.id];
  if (!spec || enemy.type === 27) return;
  const speed = Math.abs(spec.speed),
    growth = Math.abs(spec.temper);
  if (growth && speed + (enemy.anger + 1) * growth <= 2 * (speed + growth - 1))
    enemy.anger++;
}
function toggleStun(enemy: Enemy, level: Level, column?: number) {
  if (enemy.kicked) return;
  if (enemy.stun > 0) {
    enemy.stun = 0;
    enrage(enemy, level);
  } else {
    enemy.stun = 501;
    enemy.vy = -level.physics.springJump * SIXTEENTH;
    const delta = column === undefined ? 0 : enemy.x - 16 - column * TILE_WIDTH;
    enemy.vx = delta > 8 ? 4 : delta < -8 ? -4 : 0;
    enemy.grounded = false;
  }
}
function bonk(world: World, level: Level, column: number, row: number) {
  const code = tile(world, level, column, row);
  if (code === 2) return;
  const until = world.tick + 7;
  const bump = world.bumps.find((b) => b.column === column && b.row === row);
  if (bump) bump.until = until;
  else world.bumps.push({ column, row, until });
  const blast = code === 50 || code === 51;
  if (blast) {
    world.tnt--;
    blastBat(world.hazards);
  }
  if (code === 9 || code === 26) {
    world.broken.push(row * COLUMNS + column);
  }
  if (code === 8) shiftBlock(world, level, column, row, -1);
  for (const enemy of world.enemies) {
    if (enemy.ruler) {
      bonkRuler(enemy, column, row, blast);
      continue;
    }
    if (
      !enemy.grounded ||
      (!blast &&
        (Math.abs(enemy.y - row * TILE_HEIGHT) > 2 ||
          Math.abs(enemy.x - (column + 0.5) * TILE_WIDTH) > TILE_WIDTH))
    )
      continue;
    toggleStun(enemy, level, blast ? undefined : column);
  }
  const index = row * COLUMNS + column;
  if (code >= 11 && code <= 23 && !world.revealed.includes(index)) {
    world.revealed.push(index);
    if (
      code <= 16 ||
      code === 23 ||
      world.players.filter((p) => p.lives > 0).length === 2
    )
      world.pickups.push({
        column,
        row,
        type: code === 23 ? 17 : code >= 17 ? code - 6 : code,
      });
  }
}
function shiftBlock(
  world: World,
  level: Level,
  col: number,
  row: number,
  dy: number,
) {
  const target = row + dy;
  if (target < 0 || target > 25 || solid(tile(world, level, col, target)))
    return;
  const index = row * COLUMNS + col;
  world.moved = world.moved.filter((cell) => cell !== index);
  if (!world.broken.includes(index)) world.broken.push(index);
  world.moved.push(target * COLUMNS + col);
}

/** A swept side edge resolves solid walls, then the seam opens onto the opposite side. */
function walk(
  world: World,
  level: Level,
  b: Body,
  radius: number,
  height: number,
) {
  if (!b.vx) return false;
  const direction = Math.sign(b.vx);
  const edge = direction * (radius - SIXTEENTH);
  const start = Math.floor((b.x + edge) / TILE_WIDTH);
  const end = Math.floor((b.x + b.vx + edge) / TILE_WIDTH);
  if (start !== end) {
    const top = Math.floor((b.y - height + 2) / TILE_HEIGHT);
    const bottom = Math.floor((b.y - 2) / TILE_HEIGHT);
    for (let row = top; row <= bottom; row++) {
      if (!solid(tile(world, level, end, row))) continue;
      b.x =
        direction > 0
          ? end * TILE_WIDTH - radius
          : (end + 1) * TILE_WIDTH + radius;
      b.vx = 0;
      return true;
    }
  }
  b.x += b.vx;
  return false;
}
function floorMotion(world: World, level: Level, b: Body, radius: number) {
  if (b.vy >= 0 && supported(world, level, b, radius)) {
    b.y = Math.floor(b.y / TILE_HEIGHT) * TILE_HEIGHT;
    b.vy = 0;
    b.grounded = true;
  } else {
    b.grounded = false;
    if (b.vy < 15) b.vy += level.physics.gravity * SIXTEENTH;
  }
}
function overhead(world: World, level: Level, player: Player, oldHead: number) {
  if (player.vy >= 0) return;
  const head = player.y - PLAYER_HEIGHT;
  const row = Math.floor(head / TILE_HEIGHT);
  if (Math.floor(oldHead / TILE_HEIGHT) === row) return;
  const candidates = [
    player.x,
    player.x - PLAYER_RADIUS,
    player.x + PLAYER_RADIUS - SIXTEENTH,
  ];
  for (const x of candidates) {
    const col = Math.floor(x / TILE_WIDTH);
    if (!solid(tile(world, level, col, row))) continue;
    player.y = (row + 1) * TILE_HEIGHT + PLAYER_HEIGHT;
    player.vy = 0;
    bonk(world, level, col, row);
    return;
  }
}
function addScore(player: Player, points: number) {
  const old = player.score;
  player.score = Math.min(MAX_SCORE, old + points);
  player.lives = Math.min(
    99,
    player.lives + Math.floor(player.score / 10000) - Math.floor(old / 10000),
  );
}
function damage(world: World, level: Level, player: Player) {
  if (player.respawn !== "active" || player.invincible || !player.lives) return;
  player.lives--;
  if (player.lives) {
    Object.assign(player, spawnPlayer(level, player.slot, player));
    player.y = 490 + PLAYER_HEIGHT;
    player.vy = -180 * SIXTEENTH;
    player.respawn = "rising";
  } else {
    player.vx = 0;
    player.vy = 0;
  }
  if (world.players.every((p) => p.lives === 0)) world.outcome = "lost";
}
function movePlayer(world: World, level: Level, p: Player, keys: number) {
  if (!p.lives) return;
  if (p.invincible) p.invincible--;
  const jump = Boolean(keys & INPUT_JUMP && !(p.held & INPUT_JUMP));
  p.held = keys;
  if (p.respawn !== "active") {
    p.respawnTicks++;
    if (p.respawn === "rising") {
      p.y = Math.max(416 + PLAYER_HEIGHT, p.y + p.vy);
      if (p.y === 416 + PLAYER_HEIGHT) {
        p.vy = 0;
        p.respawn = "waiting";
        p.respawnTicks = 0;
      }
    } else if (p.respawn === "waiting" && (jump || p.respawnTicks > 900)) {
      p.respawn = "climbing";
      p.respawnTicks = 0;
    } else if (p.respawn === "climbing") {
      p.y -= 3;
      if (p.respawnTicks === 16) {
        p.respawn = "active";
        p.respawnTicks = 0;
      }
    }
    return;
  }
  if (p.powerTicks && !--p.powerTicks) p.power = 0;
  const oldHead = p.y - PLAYER_HEIGHT;
  const wall = walk(world, level, p, PLAYER_RADIUS, PLAYER_HEIGHT);
  const impact = p.vy;
  p.y += p.vy;
  overhead(world, level, p, oldHead);
  floorMotion(world, level, p, PLAYER_RADIUS);
  const { acceleration, maxSpeed, friction } = level.physics;
  const direction = keys & INPUT_LEFT ? -1 : keys & INPUT_RIGHT ? 1 : 0;
  if (direction) {
    p.facing = direction;
    if (direction * p.vx < (maxSpeed + (p.power === 11 ? 64 : 0)) * SIXTEENTH)
      p.vx += direction * (acceleration + (p.power === 11 ? 8 : 0)) * SIXTEENTH;
  } else if (!p.grounded || floorTile(world, level, p.x, p.y) !== 25)
    p.vx -= Math.sign(p.vx) * Math.min(Math.abs(p.vx), friction * SIXTEENTH);
  const under = p.grounded ? floorTile(world, level, p.x, p.y) : 0;
  if (
    p.grounded &&
    ((under === 8 && impact > 9) || under === 9 || under === 26)
  ) {
    const col = Math.floor(p.x / TILE_WIDTH),
      row = Math.floor(p.y / TILE_HEIGHT);
    if (under === 8) shiftBlock(world, level, col, row, 1);
    else if (!world.broken.includes(row * COLUMNS + col))
      world.broken.push(row * COLUMNS + col);
  }
  if (under === 4)
    p.vx = Math.sign(p.vx) * Math.min(Math.abs(p.vx), 6 * SIXTEENTH);
  if (jump && under !== 7 && (p.grounded || wall)) {
    p.vy = -level.physics.jump * SIXTEENTH;
    p.y -= 1;
    p.grounded = false;
  }
  if (under === 5 || under === 6) {
    p.vy =
      -(
        level.physics.springJump * 2 +
        (under === 5
          ? jump
            ? -30
            : -50
          : jump
            ? Math.floor(level.physics.jump / 8)
            : 0)
      ) * SIXTEENTH;
    p.grounded = false;
  }
  if (under === 24) damage(world, level, p);
  if (p.power === 13 && !p.grounded && p.vy < 15)
    p.vy += (level.physics.gravity > 10 ? 10 : 2) * SIXTEENTH;
  if (p.x < 0) p.x = WIDTH;
  else if (p.x > WIDTH) p.x = 0;
  if (p.y > HEIGHT + PLAYER_HEIGHT) damage(world, level, p);
}
function spawnPest(world: World, level: Level) {
  const id = world.nextPest,
    spec = level.pests[id];
  if (
    !spec ||
    world.tick <= world.nextSpawnAt ||
    world.enemies.filter((e) => !e.kicked).length >= 7
  )
    return;
  const facing: Facing = spec.speed < 0 ? -1 : 1;
  const origin = facing === 1 ? spec.left : spec.right;
  world.enemies.push({
    id,
    type: spec.type,
    x: origin.x + 16,
    y: origin.y + ENEMY_HEIGHT,
    vx: spec.speed * SIXTEENTH,
    vy: 0,
    grounded: false,
    facing,
    anger: 0,
    stun: 0,
    hp: 1,
    kicked: false,
    phase: 0,
    variation: 0,
  });
  world.nextPest++;
  world.nextSpawnAt = world.tick + (level.pests[world.nextPest]?.spacing ?? 0);
}
/** Species-specific brains from SpecialEnemy; phase and individual variation
 * live in the checkpoint so an input rollback cannot reroll an attack. */
function pestMotion(world: World, level: Level, e: Enemy, speed: number) {
  if (e.stun) {
    if (e.grounded) e.vx = 0;
    return;
  }
  const target = world.players.filter((p) => p.lives && p.respawn === "active");
  const prey = target[e.id % Math.max(1, target.length)];
  const tracks = prey && e.y >= prey.y && e.y <= 410;
  e.phase = (e.phase + 1) % 65536;
  if (e.type === 19 && tracks) {
    e.facing = prey.x < e.x ? -1 : 1;
    e.vx += e.facing * 0.5;
    e.vx = Math.max(-speed - 2, Math.min(speed + 2, e.vx));
    return;
  }
  if (!e.grounded && (e.type === 23 || e.type === 52 || e.type === 56)) return;
  if (e.type === 23) {
    e.vx = 0;
    if (e.phase >= 10) {
      e.vy = -level.physics.springJump * SIXTEENTH;
      e.vx = e.facing * speed;
      e.phase = 0;
      e.grounded = false;
    }
    return;
  }
  if (e.type === 27) {
    if (e.phase % 30 === 1) e.variation = random(world) % 16;
    const targetSpeed = speed + (20 + 2 * e.variation) * SIXTEENTH;
    const next =
      Math.abs(e.vx) + (Math.abs(e.vx) >= targetSpeed ? -0.25 : 0.25);
    e.vx = e.facing * Math.max(0, next);
    return;
  }
  if (e.type === 52 && tracks) e.facing = prey.x < e.x ? -1 : 1;
  if ((e.type === 52 || e.type === 56) && e.phase >= 105) {
    e.variation = e.type === 56 ? random(world) % 32 : 0;
    e.vy =
      -Math.floor((level.physics.springJump + e.variation) / 2) * SIXTEENTH;
    e.vx =
      e.facing * (e.type === 52 ? 2 * speed : speed + e.variation * SIXTEENTH);
    e.phase = 0;
    e.grounded = false;
    return;
  }
  e.vx = e.facing * speed;
}
function enemyStep(world: World, level: Level, enemy: Enemy) {
  if (enemy.ruler) {
    if (enemy.hp > 0)
      stepRuler(world, level, enemy, (p) => damage(world, level, p));
    return;
  }
  const spec = level.pests[enemy.id];
  if (enemy.kicked) {
    enemy.x += enemy.vx;
    enemy.y += enemy.vy;
    if (enemy.vy < 15) enemy.vy += level.physics.gravity * SIXTEENTH;
    return;
  }
  if (enemy.stun) {
    enemy.stun--;
    if (!enemy.stun) enrage(enemy, level);
  }
  const speed =
    (Math.abs(spec?.speed ?? 24) + enemy.anger * (spec?.temper ?? 5)) *
    SIXTEENTH;
  if (walk(world, level, enemy, ENEMY_RADIUS, ENEMY_HEIGHT))
    enemy.facing = enemy.facing === 1 ? -1 : 1;
  enemy.y += enemy.vy;
  floorMotion(world, level, enemy, ENEMY_RADIUS);
  pestMotion(world, level, enemy, speed);
  if (enemy.x - 16 < -24 || enemy.x - 16 > 639) {
    const left = enemy.x < 0;
    if (spec && enemy.y - ENEMY_HEIGHT > 302) {
      enrage(enemy, level);
      enemy.facing = left ? 1 : -1;
      const entry = left ? spec.left : spec.right;
      enemy.x = entry.x + 16;
      enemy.y = entry.y + ENEMY_HEIGHT;
      enemy.grounded = false;
      enemy.vy = 0;
    } else enemy.x = (left ? 639 : -20) + 16;
  }
  if (enemy.y > HEIGHT + ENEMY_HEIGHT) {
    enemy.hp = 0;
    return;
  }
  for (const p of world.players) {
    const xLimit = enemy.stun ? 34 : 35;
    if (
      !p.lives ||
      p.respawn !== "active" ||
      Math.abs(enemy.x - p.x) >= xLimit ||
      enemy.y - (enemy.stun ? 0 : 3) <=
        p.y - PLAYER_HEIGHT + (enemy.stun ? 10 : 15) ||
      enemy.y - ENEMY_HEIGHT + (enemy.stun ? 5 : 10) >= p.y - 5
    )
      continue;
    if (enemy.stun) {
      enemy.hp--;
      enemy.stun = 0;
      addScore(p, (spec?.points ?? 1000) + enemy.anger * 50);
      if (enemy.hp === 0) {
        enemy.kicked = true;
        enemy.grounded = false;
        enemy.vx = p.vx;
        enemy.vy = -level.physics.springJump * SIXTEENTH;
        break;
      }
      enemy.facing = enemy.x > p.x ? 1 : -1;
      p.invincible = Math.max(p.invincible, 25);
    } else damage(world, level, p);
  }
}

/** One reference update. The last held mask is part of each player so a rollback
 * preserves jump edges. The caller supplies one mask for each physical slot. */
export function stepWorld(
  world: World,
  inputs: readonly number[],
  level: Level = levelFor(world),
): void {
  if (world.outcome !== "playing") return;
  world.tick++;
  world.bumps = world.bumps.filter((b) => b.until > world.tick);
  for (const p of world.players)
    movePlayer(world, level, p, (inputs[p.slot] ?? 0) & 7);
  for (const lower of world.players) {
    if (!lower.lives || lower.vy >= 0 || lower.respawn !== "active") continue;
    for (const upper of world.players) {
      if (
        upper === lower ||
        !upper.lives ||
        upper.respawn !== "active" ||
        Math.abs(upper.x - lower.x) >= 24
      )
        continue;
      const top = lower.y - PLAYER_HEIGHT;
      if (upper.y >= top && upper.y < top - lower.vy) {
        upper.vy = lower.vy - level.physics.gravity * SIXTEENTH;
        upper.grounded = false;
      }
    }
  }
  for (const enemy of world.enemies) enemyStep(world, level, enemy);
  world.enemies = world.enemies.filter(
    (e) =>
      e.hp > 0 ||
      (e.kicked && e.y <= HEIGHT + 96 && e.x >= -100 && e.x <= WIDTH + 100),
  );
  spawnPest(world, level);
  stepHazards(
    world,
    level,
    (p) => damage(world, level, p),
    (col, row) => solid(tile(world, level, col, row)),
    () => random(world),
  );
  for (const pickup of [...world.pickups]) {
    const x = (pickup.column + 0.5) * TILE_WIDTH,
      y = pickup.row * TILE_HEIGHT;
    const p = world.players.find(
      (p) =>
        p.lives &&
        Math.abs(x - p.x) < 22 &&
        y > p.y - PLAYER_HEIGHT - 6 &&
        y <= p.y + 4,
    );
    if (p) {
      if (pickup.type === 11 || pickup.type === 13) {
        p.power = pickup.type;
        p.powerTicks = 800;
      } else if (pickup.type === 12)
        for (const e of world.enemies) {
          if (!e.kicked && !e.stun) toggleStun(e, level);
        }
      else if (pickup.type === 14) addScore(p, 5000);
      else if (pickup.type === 15) p.lives = Math.min(99, p.lives + 1);
      else if (pickup.type === 16) world.tnt = Math.min(3, world.tnt + 1);
      else if (pickup.type === 17) p.invincible = 302;
      world.pickups.splice(world.pickups.indexOf(pickup), 1);
    }
  }
  if (
    world.outcome === "playing" &&
    world.nextPest === level.pests.length &&
    !world.enemies.length
  )
    world.outcome = "cleared";
}

export { validWorld } from "./simulation-checkpoint.js";
