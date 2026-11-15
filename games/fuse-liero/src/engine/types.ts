/** Original Fuse Liero rules. All evolving simulation data travels in this plain state. */
export const RULES = "fuse-liero-2";
export const CAPACITY = 5;
export const WIDTH = 1536;
export const HEIGHT = 864;
export const CELL = 4;
export const COLS = WIDTH / CELL;
export const ROWS = HEIGHT / CELL;
export const STEPS_PER_TICK = 3;
export const COUNTDOWN_STEPS = 120;
export const ROUND_STEPS = 60 * 180;
export const FRAG_TARGET = 7;
export const LEFT = 1;
export const RIGHT = 2;
export const UP = 4;
export const DOWN = 8;
export const JUMP = 16;
export const FIRE = 32;
export const ROPE = 64;
export const NEXT = 128;
export const INPUT_MASK = 255;
export const isInput = (raw: unknown): raw is number =>
  Number.isInteger(raw) &&
  (raw as number) >= 0 &&
  (raw as number) <= INPUT_MASK;
export interface Settings {
  display: boolean;
  wins: number;
}
export const DEFAULT_SETTINGS: Settings = { display: false, wins: 2 };
export function parseSettings(raw: unknown): Settings | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const record = raw as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    typeof record.display !== "boolean" ||
    ![1, 2, 3, 5].includes(record.wins as number)
  )
    return;
  return { display: record.display, wins: record.wins as number };
}
export type Weapon = 0 | 1 | 2;
export const WEAPONS = [
  { name: "ROCKET", cooldown: 42, damage: 58, radius: 29, speed: 5.8 },
  { name: "GRENADE", cooldown: 56, damage: 74, radius: 38, speed: 4.2 },
  { name: "SCATTERGUN", cooldown: 30, damage: 15, radius: 7, speed: 7.5 },
] as const;
export interface Rope {
  x: number;
  y: number;
  length: number;
}
export interface Worm {
  id: string;
  slot: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 32 clockwise directions: right=0, down=8, left=16, up=24. */
  aim: number;
  health: number;
  frags: number;
  deaths: number;
  weapon: Weapon;
  cooldown: number;
  respawn: number;
  grace: number;
  input: number;
  rope: Rope | null;
}
export interface Projectile {
  id: number;
  owner: string;
  weapon: Weapon;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}
export interface Effect {
  id: number;
  x: number;
  y: number;
  radius: number;
  life: number;
  kind: "blast" | "hit" | "spawn";
}
export interface World {
  seed: number;
  rng: number;
  step: number;
  phase: "countdown" | "play" | "done";
  winner: string | null;
  terrain: string[];
  worms: Worm[];
  projectiles: Projectile[];
  effects: Effect[];
  nextId: number;
}
export type WorldView = World;
/** Frozen integer direction table avoids platform-specific transcendental results in simulation. */
const DIRECTIONS = [
  [256, 0],
  [251, 50],
  [237, 98],
  [213, 142],
  [181, 181],
  [142, 213],
  [98, 237],
  [50, 251],
  [0, 256],
  [-50, 251],
  [-98, 237],
  [-142, 213],
  [-181, 181],
  [-213, 142],
  [-237, 98],
  [-251, 50],
  [-256, 0],
  [-251, -50],
  [-237, -98],
  [-213, -142],
  [-181, -181],
  [-142, -213],
  [-98, -237],
  [-50, -251],
  [0, -256],
  [50, -251],
  [98, -237],
  [142, -213],
  [181, -181],
  [213, -142],
  [237, -98],
  [251, -50],
] as const;
export const direction = (aim: number): { x: number; y: number } => {
  const pair = DIRECTIONS[((aim % 32) + 32) % 32]!;
  return { x: pair[0] / 256, y: pair[1] / 256 };
};
export const quantize = (n: number): number => Math.round(n * 256) / 256;
export const clamp = (n: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, n));
export function seedOf(text: string): number {
  let seed = 2166136261;
  for (let i = 0; i < text.length; i++)
    seed = Math.imul(seed ^ text.charCodeAt(i), 16777619) >>> 0;
  return seed || 1;
}
export function random(state: { rng: number }): number {
  state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0;
  return state.rng / 4294967296;
}
export const wormId = (raw: unknown): raw is string =>
  typeof raw === "string" &&
  /^[\w:.-]{1,64}$/.test(raw) &&
  !(raw in Object.prototype);
