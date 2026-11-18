import type { Brain } from "../ai/index.js";
import type { Shot } from "../ordnance/index.js";
export type { Shot };

export const SIM_HZ = 70;
export const TILE_WIDTH = 16;
export const TILE_HEIGHT = 12;
export const EXTRACTION_TICKS = 350;
export type Mode = "campaign" | "dogfight";
export type Role = "player" | "guard" | "heavy" | "scout";
export type KeyColor = "yellow" | "green" | "blue" | "red";
export type ItemKind = "core" | "reactor" | "medkit" | "hostage";
export type ObjectiveKind =
  "collect" | "destroy" | "rescue" | "dogfight" | "investigate" | "kill";
export interface Control {
  dx: number;
  dy: number;
  fire: boolean;
  special: boolean;
}
export const REST: Readonly<Control> = {
  dx: 0,
  dy: 0,
  fire: false,
  special: false,
};
export interface Point {
  x: number;
  y: number;
}
export interface Skill {
  move: number;
  track: number;
  shoot: number;
  delay: number;
  flags: number;
}
export interface Actor extends Point {
  id: string;
  seat: string | null;
  role: Role;
  dir: number;
  hp: number;
  maxHp: number;
  inventory: number[];
  weapon: number;
  lock: number;
  slideX: number;
  slideY: number;
  specialHeld: boolean;
  usedSpecial: boolean;
  walking: boolean;
  lastShot: number;
  deathTick: number;
  score: number;
  kills: number;
  friendlies: number;
  speed: number;
  skill: Skill;
  brain: Brain;
  objectiveIndex: number | null;
  characterIndex: number;
  flamed: number;
  poisoned: number;
  petrified: number;
  confused: number;
}
export interface Item extends Point {
  id: string;
  kind: ItemKind;
  hp: number;
  objectiveIndex: number | null;
  sprite: number;
  escort: string | null;
  objectFlags: number;
  solid: boolean;
}
export interface Door extends Point {
  key: KeyColor | null;
  horizontal: boolean;
  timer: number;
}
export interface Key extends Point {
  color: KeyColor;
}
export interface Prop extends Point {
  kind: string;
  objectIndex: number;
  hp: number;
  impassable: boolean;
  w: number;
  h: number;
  objectFlags: number;
}
export interface Objective {
  kind: ObjectiveKind;
  description: string;
  required: number;
  count: number;
  done: number;
  flags: number;
}
export interface MissionState {
  mode: Mode;
  campaign: number;
  mission: number;
  seed: number;
  rng: number;
  tick: number;
  nextEnemy: number;
  goodGuysPresent: boolean;
  width: number;
  height: number;
  tiles: string[];
  decor: string[];
  props: Prop[];
  seen: string[];
  seenCount: number;
  surveyArea: number;
  actors: Actor[];
  shots: Shot[];
  items: Item[];
  doors: Door[];
  keys: Key[];
  keyring: KeyColor[];
  objectives: Objective[];
  objective: Objective;
  extraction: number;
  outcome: "playing" | "victory" | "defeat";
  winners: string[];
}
export interface MissionOptions {
  campaign?: number;
  loadouts?: Readonly<Record<string, readonly number[]>>;
}
