import {
  WIDTH,
  HEIGHT,
  CAPACITY,
  COUNTDOWN_STEPS,
  ROUND_STEPS,
  FRAG_TARGET,
  STEPS_PER_TICK,
  LEFT,
  RIGHT,
  UP,
  DOWN,
  JUMP,
  FIRE,
  ROPE,
  NEXT,
  INPUT_MASK,
  WEAPONS,
  clamp,
  quantize as q,
  direction,
  type World,
  type WorldView,
  type Worm,
  type Settings,
  type Weapon,
  type Projectile,
} from "./types.js";
import {
  createTerrain,
  spawnPoint,
  solid,
  blocked,
  destroyTerrain,
} from "./terrain.js";

export function createWorld(
  seed: number,
  seats: { id: string; slot: number }[],
  _settings: Settings,
): World {
  const world: World = {
    seed: seed >>> 0,
    rng: seed >>> 0,
    step: 0,
    phase: "countdown",
    winner: null,
    terrain: createTerrain(seed),
    worms: [],
    projectiles: [],
    effects: [],
    nextId: 1,
  };
  world.worms = [...seats]
    .sort((a, b) => a.slot - b.slot)
    .slice(0, CAPACITY)
    .map((seat) => ({
      ...seat,
      ...spawnPoint(world, seat.slot),
      vx: 0,
      vy: 0,
      aim: seat.slot % 2 === 0 ? 0 : 16,
      health: 100,
      frags: 0,
      deaths: 0,
      weapon: 0,
      cooldown: 0,
      respawn: 0,
      grace: 90,
      input: 0,
      rope: null,
    }));
  return world;
}
function effect(
  world: World,
  x: number,
  y: number,
  radius: number,
  kind: "blast" | "hit" | "spawn",
): void {
  if (world.effects.length >= 64) world.effects.shift();
  world.effects.push({
    id: world.nextId++,
    x: q(x),
    y: q(y),
    radius,
    life: kind === "blast" ? 22 : 14,
    kind,
  });
}
function damage(world: World, worm: Worm, amount: number, owner: string): void {
  if (worm.health <= 0 || worm.grace > 0) return;
  worm.health = Math.max(0, worm.health - Math.max(1, Math.round(amount)));
  if (worm.health === 0) {
    worm.deaths++;
    worm.respawn = 90;
    worm.rope = null;
    worm.vx = 0;
    worm.vy = 0;
    const killer = world.worms.find((w) => w.id === owner);
    if (killer && killer !== worm) killer.frags++;
    effect(world, worm.x, worm.y, 15, "hit");
  }
}
function explode(world: World, shot: Projectile): void {
  const weapon = WEAPONS[shot.weapon];
  destroyTerrain(world, shot.x, shot.y, weapon.radius);
  effect(world, shot.x, shot.y, weapon.radius, "blast");
  for (const worm of world.worms) {
    if (worm.health <= 0) continue;
    const dx = worm.x - shot.x,
      dy = worm.y - shot.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > weapon.radius + 7) continue;
    damage(
      world,
      worm,
      weapon.damage * (1 - (0.65 * distance) / (weapon.radius + 7)),
      shot.owner,
    );
    if (worm.health > 0 && worm.grace === 0) {
      const scale = 3 / Math.max(4, distance);
      worm.vx = q(clamp(worm.vx + dx * scale, -7, 7));
      worm.vy = q(clamp(worm.vy + dy * scale - 1, -9, 9));
    }
  }
}
function fire(world: World, worm: Worm): void {
  if (world.projectiles.length > 110) return;
  const weapon = WEAPONS[worm.weapon];
  const spread = worm.weapon === 2 ? [-2, -1, 0, 1, 2] : [0];
  for (const offset of spread) {
    const d = direction(worm.aim + offset);
    const muzzle = direction(worm.aim);
    world.projectiles.push({
      id: world.nextId++,
      owner: worm.id,
      weapon: worm.weapon,
      x: q(worm.x + muzzle.x * 9),
      y: q(worm.y + muzzle.y * 9),
      vx: q(d.x * weapon.speed + worm.vx * 0.25),
      vy: q(d.y * weapon.speed + worm.vy * 0.25),
      life: worm.weapon === 1 ? 105 : worm.weapon === 2 ? 26 : 150,
    });
  }
  worm.cooldown = weapon.cooldown;
  const d = direction(worm.aim);
  worm.vx = q(clamp(worm.vx - d.x * 0.7, -7, 7));
}
function attachRope(world: World, worm: Worm): void {
  const d = direction(worm.aim);
  for (let distance = 8; distance <= 210; distance += 2) {
    const x = q(worm.x + d.x * distance),
      y = q(worm.y + d.y * distance);
    if (solid(world, x, y)) {
      worm.rope = { x, y, length: Math.max(20, distance) };
      return;
    }
  }
}
function move(world: World, worm: Worm, bits: number): void {
  const pressed = bits & ~worm.input;
  if (worm.cooldown > 0) worm.cooldown--;
  if (worm.grace > 0) worm.grace--;
  // Every third step makes keyboard aiming precise, while held input remains cheap on the wire.
  if (world.step % 3 === 0)
    worm.aim =
      (worm.aim + (bits & DOWN ? 1 : 0) - (bits & UP ? 1 : 0) + 32) % 32;
  if (pressed & NEXT) worm.weapon = ((worm.weapon + 1) % 3) as Weapon;
  if (!(bits & ROPE)) worm.rope = null;
  else if (pressed & ROPE) attachRope(world, worm);
  if (worm.rope && !solid(world, worm.rope.x, worm.rope.y)) worm.rope = null;
  const grounded = blocked(world, worm.x, worm.y + 1);
  const horizontal = (bits & RIGHT ? 1 : 0) - (bits & LEFT ? 1 : 0);
  worm.vx = q(
    clamp(worm.vx + horizontal * (grounded ? 0.28 : 0.15), -2.5, 2.5) *
      (horizontal ? 1 : grounded ? 0.78 : 0.99),
  );
  if (pressed & JUMP && grounded) worm.vy = -4.8;
  worm.vy = q(clamp(worm.vy + 0.17, -9, 7));
  if (worm.rope) {
    const rope = worm.rope;
    if (bits & JUMP) rope.length = Math.max(20, rope.length - 0.6);
    const dx = rope.x - worm.x,
      dy = rope.y - worm.y,
      d = Math.sqrt(dx * dx + dy * dy);
    if (d > rope.length) {
      const pull = Math.min(1.1, (d - rope.length) * 0.08);
      worm.vx = q(clamp(worm.vx + (dx / d) * pull, -7, 7));
      worm.vy = q(clamp(worm.vy + (dy / d) * pull, -9, 7));
    }
    rope.length = q(rope.length);
  }
  // Substeps keep fast rope swings and knockback from crossing thin cave walls.
  const count = Math.max(
    1,
    Math.ceil(Math.max(Math.abs(worm.vx), Math.abs(worm.vy)) / 2),
  );
  for (let i = 0; i < count; i++) {
    const x = q(clamp(worm.x + worm.vx / count, 6, WIDTH - 6));
    if (!blocked(world, x, worm.y)) worm.x = x;
    else {
      // Walk up a single terrain cell rather than sticking on a pixel stair.
      if (horizontal && grounded && !blocked(world, x, worm.y - 4)) {
        worm.x = x;
        worm.y -= 4;
      } else worm.vx = 0;
    }
    const y = q(clamp(worm.y + worm.vy / count, 6, HEIGHT - 6));
    if (!blocked(world, worm.x, y)) worm.y = y;
    else worm.vy = 0;
  }
  if (bits & FIRE && worm.cooldown === 0) fire(world, worm);
  worm.input = bits;
}
function projectiles(world: World): void {
  const next: Projectile[] = [];
  for (const shot of world.projectiles) {
    shot.life--;
    if (shot.weapon === 1) shot.vy = q(clamp(shot.vy + 0.11, -12, 12));
    let hit = false;
    const count = Math.max(
      1,
      Math.ceil(Math.max(Math.abs(shot.vx), Math.abs(shot.vy))),
    );
    for (let i = 0; i < count && !hit; i++) {
      const x = q(shot.x + shot.vx / count),
        y = q(shot.y + shot.vy / count);
      if (solid(world, x, y)) {
        if (shot.weapon === 1 && shot.life > 0) {
          if (solid(world, x, shot.y)) shot.vx = q(-shot.vx * 0.65);
          if (solid(world, shot.x, y)) shot.vy = q(-shot.vy * 0.62);
          if (!solid(world, x, shot.y) && !solid(world, shot.x, y)) {
            shot.vx = q(-shot.vx * 0.65);
            shot.vy = q(-shot.vy * 0.62);
          }
          break;
        }
        shot.x = x;
        shot.y = y;
        hit = true;
        break;
      }
      shot.x = x;
      shot.y = y;
      hit = world.worms.some(
        (w) =>
          w.health > 0 &&
          w.grace === 0 &&
          // Muzzle starts beyond the body, so a reflected grenade can still hurt its owner.
          (w.x - x) ** 2 + (w.y - y) ** 2 < 36,
      );
    }
    if (hit || shot.life <= 0) explode(world, shot);
    else next.push(shot);
  }
  world.projectiles = next;
}
function finish(world: World): void {
  world.phase = "done";
  world.winner =
    [...world.worms].sort(
      (a, b) =>
        b.frags - a.frags ||
        a.deaths - b.deaths ||
        b.health - a.health ||
        a.slot - b.slot,
    )[0]?.id ?? null;
}
/** A fixed 60 Hz simulation step. The online room supplies all human and bot inputs. */
export function stepWorld(
  world: World,
  inputs: ReadonlyMap<string, number>,
): void {
  if (world.phase === "done") return;
  world.step++;
  world.effects = world.effects.filter((e) => --e.life > 0);
  if (world.step <= COUNTDOWN_STEPS) {
    world.phase = "countdown";
    return;
  }
  world.phase = "play";
  for (const worm of world.worms) {
    if (worm.health <= 0) {
      if (--worm.respawn <= 0) {
        Object.assign(worm, spawnPoint(world, worm.slot), {
          health: 100,
          respawn: 0,
          grace: 90,
          vx: 0,
          vy: 0,
          input: 0,
          rope: null,
        });
        effect(world, worm.x, worm.y, 12, "spawn");
      }
      continue;
    }
    move(world, worm, (inputs.get(worm.id) ?? 0) & INPUT_MASK);
  }
  projectiles(world);
  if (
    world.worms.some((w) => w.frags >= FRAG_TARGET) ||
    world.step >= COUNTDOWN_STEPS + ROUND_STEPS
  )
    finish(world);
}
export const roundDone = (world: World): boolean => world.phase === "done";
export function toView(world: World): WorldView {
  return {
    ...world,
    terrain: [...world.terrain],
    worms: world.worms.map((w) => ({
      ...w,
      rope: w.rope ? { ...w.rope } : null,
    })),
    projectiles: world.projectiles.map((p) => ({ ...p })),
    effects: world.effects.map((e) => ({ ...e })),
  };
}
/** Bots use the same held controls, aim speed, weapons and collision rules as humans. */
export function botInput(world: World, worm: Worm): number {
  if (worm.health <= 0 || world.phase !== "play") return 0;
  const target = world.worms
    .filter((w) => w !== worm && w.health > 0)
    .sort(
      (a, b) =>
        (a.x - worm.x) ** 2 +
          (a.y - worm.y) ** 2 -
          ((b.x - worm.x) ** 2 + (b.y - worm.y) ** 2) || a.slot - b.slot,
    )[0];
  if (!target) return 0;
  const dx = target.x - worm.x,
    dy = target.y - worm.y;
  let aim = 0,
    best = -Infinity;
  for (let i = 0; i < 32; i++) {
    const d = direction(i),
      dot = dx * d.x + dy * d.y;
    if (dot > best) {
      best = dot;
      aim = i;
    }
  }
  const delta = ((aim - worm.aim + 48) % 32) - 16;
  let bits = delta > 0 ? DOWN : delta < 0 ? UP : 0;
  if (Math.abs(dx) > 45) bits |= dx > 0 ? RIGHT : LEFT;
  if (Math.abs(delta) <= 2) bits |= FIRE;
  // The room asks bots once per log tick (three physics steps). Schedule in that
  // control clock so every slot reaches every phase regardless of its offset.
  const cycle = (Math.floor(world.step / STEPS_PER_TICK) + worm.slot * 11) % 60;
  if (
    cycle === 1 ||
    (cycle % 15 === 0 && blocked(world, worm.x + Math.sign(dx) * 8, worm.y))
  )
    bits |= JUMP;
  if (cycle >= 23 && cycle < 42 && target.y < worm.y - 30) bits |= ROPE | JUMP;
  // Change weapons regularly, deterministically, to dig through cover and avoid stalemates.
  if (cycle === 0) bits |= NEXT;
  return bits;
}
