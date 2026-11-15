import {
  CAPACITY,
  COLS,
  ROWS,
  WIDTH,
  HEIGHT,
  COUNTDOWN_STEPS,
  ROUND_STEPS,
  isInput,
  wormId,
  type World,
  type Worm,
  type Projectile,
  type Effect,
  type Rope,
} from "./types.js";
import { toView } from "./world.js";

const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: string[]): boolean =>
  Object.keys(value).length === expected.length &&
  expected.every((key) => Object.hasOwn(value, key));
const int = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= min &&
  value <= max;
const fixed = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max &&
  Number.isInteger(value * 256);
function rope(raw: unknown): raw is Rope | null {
  return (
    raw === null ||
    (plain(raw) &&
      keys(raw, ["x", "y", "length"]) &&
      fixed(raw.x, 0, WIDTH) &&
      fixed(raw.y, 0, HEIGHT) &&
      fixed(raw.length, 20, 210))
  );
}
function worm(raw: unknown): raw is Worm {
  return (
    plain(raw) &&
    keys(raw, [
      "id",
      "slot",
      "x",
      "y",
      "vx",
      "vy",
      "aim",
      "health",
      "frags",
      "deaths",
      "weapon",
      "cooldown",
      "respawn",
      "grace",
      "input",
      "rope",
    ]) &&
    wormId(raw.id) &&
    int(raw.slot, 0, CAPACITY - 1) &&
    fixed(raw.x, 6, WIDTH - 6) &&
    fixed(raw.y, 6, HEIGHT - 6) &&
    fixed(raw.vx, -7, 7) &&
    fixed(raw.vy, -9, 9) &&
    int(raw.aim, 0, 31) &&
    int(raw.health, 0, 100) &&
    int(raw.frags, 0, 20) &&
    int(raw.deaths, 0, 150) &&
    int(raw.weapon, 0, 2) &&
    int(raw.cooldown, 0, 56) &&
    int(raw.respawn, 0, 90) &&
    int(raw.grace, 0, 90) &&
    isInput(raw.input) &&
    rope(raw.rope) &&
    (raw.health === 0) === raw.respawn > 0 &&
    (raw.health !== 0 || raw.rope === null)
  );
}
function projectile(raw: unknown): raw is Projectile {
  return (
    plain(raw) &&
    keys(raw, ["id", "owner", "weapon", "x", "y", "vx", "vy", "life"]) &&
    int(raw.id, 1, 100000) &&
    wormId(raw.owner) &&
    int(raw.weapon, 0, 2) &&
    fixed(raw.x, -16, WIDTH + 16) &&
    fixed(raw.y, -16, HEIGHT + 16) &&
    fixed(raw.vx, -12, 12) &&
    fixed(raw.vy, -12, 12) &&
    int(raw.life, 1, 150)
  );
}
function effect(raw: unknown): raw is Effect {
  return (
    plain(raw) &&
    keys(raw, ["id", "x", "y", "radius", "life", "kind"]) &&
    int(raw.id, 1, 100000) &&
    fixed(raw.x, -16, WIDTH + 16) &&
    fixed(raw.y, -16, HEIGHT + 16) &&
    int(raw.radius, 1, 38) &&
    int(raw.life, 1, 22) &&
    ["blast", "hit", "spawn"].includes(raw.kind as string)
  );
}
/** Encoded terrain is 81KiB of row strings; no mutable buffers leak out. */
export function encodeWorld(world: World): unknown {
  return toView(world);
}
/** Reject first, allocate only after validation: corrupt peer snapshots cannot partly mutate healthy state. */
export function decodeWorld(raw: unknown): World | undefined {
  if (
    !plain(raw) ||
    !keys(raw, [
      "seed",
      "rng",
      "step",
      "phase",
      "winner",
      "terrain",
      "worms",
      "projectiles",
      "effects",
      "nextId",
    ]) ||
    !int(raw.seed, 0, 0xffffffff) ||
    !int(raw.rng, 0, 0xffffffff) ||
    !int(raw.step, 0, COUNTDOWN_STEPS + ROUND_STEPS) ||
    !["countdown", "play", "done"].includes(raw.phase as string) ||
    !int(raw.nextId, 1, 100000) ||
    !Array.isArray(raw.terrain) ||
    raw.terrain.length !== ROWS ||
    !raw.terrain.every(
      (row: unknown) =>
        typeof row === "string" && row.length === COLS && /^[012]+$/.test(row),
    ) ||
    !Array.isArray(raw.worms) ||
    raw.worms.length < 1 ||
    raw.worms.length > CAPACITY ||
    !raw.worms.every(worm) ||
    !Array.isArray(raw.projectiles) ||
    raw.projectiles.length > 128 ||
    !raw.projectiles.every(projectile) ||
    !Array.isArray(raw.effects) ||
    raw.effects.length > 64 ||
    !raw.effects.every(effect)
  )
    return;
  const worms = raw.worms as Worm[],
    shots = raw.projectiles as Projectile[],
    fx = raw.effects as Effect[],
    nextId = raw.nextId;
  const ids = new Set(worms.map((w) => w.id));
  if (
    ids.size !== worms.length ||
    new Set(worms.map((w) => w.slot)).size !== worms.length ||
    worms.some((w, i) => i > 0 && w.slot <= worms[i - 1]!.slot) ||
    (raw.phase === "done"
      ? !wormId(raw.winner) || !ids.has(raw.winner)
      : raw.winner !== null) ||
    (raw.phase === "countdown") !== raw.step <= COUNTDOWN_STEPS ||
    (raw.step === COUNTDOWN_STEPS + ROUND_STEPS && raw.phase !== "done") ||
    shots.some((p) => !ids.has(p.owner) || p.id >= nextId) ||
    fx.some((e) => e.id >= nextId) ||
    new Set([...shots, ...fx].map((item) => item.id)).size !==
      shots.length + fx.length
  )
    return;
  // Indestructible boundary cells must survive every valid explosion.
  const terrain = raw.terrain as string[];
  if (
    terrain.some((row, y) =>
      y < 2 || y >= ROWS - 2
        ? row !== "2".repeat(COLS)
        : !row.startsWith("22") || !row.endsWith("22"),
    )
  )
    return;
  return toView(raw as unknown as World);
}
