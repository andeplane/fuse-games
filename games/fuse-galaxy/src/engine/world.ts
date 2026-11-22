/**
 * The state of one match. Everything here is a whole number, a fixed string or a list of those, so a world
 * serialises as JSON and hashes the same everywhere (`hash.ts`).
 *
 * One planet per player, and a planet's id is its player's id: the seats come first (0…), the bot-run neutral
 * planets after them. The interfaces are declared mutable because `applyTick` builds the next world on a private
 * copy; everything outside that step holds a `World`, which is read-only all the way down.
 */

/** "Nobody": no team, no commander, no vote, no winner. */
export const NONE = -1;

export const RESOURCE_IDS = ["metal", "crystal", "eonium"] as const;
export type ResourceId = (typeof RESOURCE_IDS)[number];
export type Resources = Record<ResourceId, number>;

export const STRUCTURE_IDS = [
  "metalRefinery",
  "crystalRefinery",
  "eoniumRefinery",
  "researchLab",
  "shipyard",
] as const;
export type StructureId = (typeof STRUCTURE_IDS)[number];
export type StructureCounts = Record<StructureId, number>;

export const BRANCH_IDS = [
  "travel",
  "hulls",
  "sensors",
  "mining",
  "jamming",
] as const;
export type BranchId = (typeof BRANCH_IDS)[number];
export type ResearchLevels = Record<BranchId, number>;

/** The six ship classes, lightest first. */
export const SHIP_CLASSES = [
  "fighter",
  "corvette",
  "frigate",
  "destroyer",
  "cruiser",
  "battleship",
] as const;
export type ShipClass = (typeof SHIP_CLASSES)[number];
export type ShipCounts = Record<ShipClass, number>;

export const MISSIONS = ["attack", "defend", "observe"] as const;
export type Mission = (typeof MISSIONS)[number];

export type PlanetKind = "seat" | "neutral";

/** A structure being built. Only the first job in a planet's list advances; the rest wait their turn. */
export interface ConstructionJob {
  structure: StructureId;
  remaining: number;
}

/** A research level being worked on: `level` is the level the branch reaches when it is done. */
export interface ResearchJob {
  branch: BranchId;
  level: number;
  remaining: number;
}

/** A batch of ships being produced. Every order advances each tick. */
export interface ProductionOrder {
  shipClass: ShipClass;
  count: number;
  remaining: number;
}

export interface Planet {
  id: number;
  kind: PlanetKind;
  /** The team (galaxy) the planet belongs to, or `NONE` for a neutral planet. */
  team: number;
  x: number;
  y: number;
  resources: Resources;
  /** How many asteroids of each resource the planet mines. */
  asteroids: Resources;
  structures: StructureCounts;
  research: ResearchLevels;
  construction: ConstructionJob[];
  researchQueue: ResearchJob[];
  production: ProductionOrder[];
  /** Ships at home. Ships in a fleet are in the fleet. */
  ships: ShipCounts;
  /** What the planet owns is worth now (`score.ts`). */
  value: number;
  /** What ranks the planet and decides the match. */
  score: number;
}

export type FleetPhase = "outbound" | "stationed" | "returning";

export interface Fleet {
  id: number;
  owner: number;
  mission: Mission;
  target: number;
  ships: ShipCounts;
  phase: FleetPhase;
  /** Ticks left in the phase. */
  eta: number;
  /** How long the whole trip out takes; a recall flies back as far as the fleet had come. */
  travelTicks: number;
}

export interface Team {
  id: number;
  members: number[];
  fund: Resources;
  taxPercent: number;
  commander: number;
  /** Each member's vote for commander, in `members` order; `NONE` until they vote. */
  votes: number[];
  /** The planet the commander has flagged for defence, or `NONE`. */
  defencePriority: number;
}

/** What one observation saw, and when. The fields past `asteroids` depend on the report's `detail`. */
export interface ScoutReport {
  target: number;
  /** The tick the observation was made on. */
  tick: number;
  by: number;
  detail: number;
  resources: Resources;
  asteroids: Resources;
  structures: StructureCounts | null;
  research: ResearchLevels | null;
  ships: ShipCounts | null;
}

/**
 * What a player has learned about planets that are not theirs: the latest report per target, by target id. A report
 * is never changed once made and a new one replaces the whole record, so a tick's copy of the world can share them.
 */
export interface Knowledge {
  readonly reports: readonly ScoutReport[];
}

/** What happened on the last tick. Transient: each tick replaces the list. */
export type GameEvent =
  | {
      type: "rejected";
      player: number;
      /** The command's type, or "malformed" when it could not be read. */
      command: string;
      reason: string;
    }
  | { type: "asteroidInitiated"; player: number; resource: ResourceId }
  | { type: "structureBuilt"; player: number; structure: StructureId }
  | { type: "researchDone"; player: number; branch: BranchId; level: number }
  | { type: "shipsBuilt"; player: number; shipClass: ShipClass; count: number }
  | {
      type: "fleetArrived";
      player: number;
      fleet: number;
      target: number;
      mission: Mission;
    }
  | { type: "fleetReturned"; player: number; fleet: number }
  | { type: "commanderChanged"; team: number; commander: number }
  | { type: "matchEnded"; winner: number };

export interface MatchResult {
  /** The tick the match ended on. */
  tick: number;
  /** The winning team, or `NONE` for a draw. */
  winner: number;
  /** Each team's final score, by team id. */
  teamScores: number[];
}

export interface WorldDraft {
  /** `Rules.version` the world was created under. */
  rulesVersion: number;
  seed: number;
  /** How many ticks have been applied. */
  tick: number;
  /** The mulberry32 state every later draw continues from. */
  rng: number;
  phase: "running" | "ended";
  result: MatchResult | null;
  planets: Planet[];
  fleets: Fleet[];
  nextFleetId: number;
  teams: Team[];
  /** One entry per planet, by id. */
  knowledge: Knowledge[];
  events: GameEvent[];
}

export type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

/** A world as everything outside `applyTick` holds it: nothing in it may be changed. */
export type World = DeepReadonly<WorldDraft>;

export const noResources = (): Resources => ({
  metal: 0,
  crystal: 0,
  eonium: 0,
});

export const noShips = (): ShipCounts => ({
  fighter: 0,
  corvette: 0,
  frigate: 0,
  destroyer: 0,
  cruiser: 0,
  battleship: 0,
});

/** The team's record, or undefined for `NONE` (a neutral planet has no team). */
export const teamOf = <T extends { readonly id: number }>(
  teams: readonly T[],
  team: number,
): T | undefined => (team === NONE ? undefined : teams[team]);
