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

/**
 * The ship classes: the probe, the six warships lightest first, and the asteroid-capture pod. What each one does is
 * its `ShipRule`; nothing in the engine knows a class by name.
 */
export const SHIP_CLASSES = [
  "probe",
  "fighter",
  "corvette",
  "frigate",
  "destroyer",
  "cruiser",
  "battleship",
  "pod",
] as const;
export type ShipClass = (typeof SHIP_CLASSES)[number];
export type ShipCounts = Record<ShipClass, number>;

/**
 * `attack` fights for a planet's asteroids, `defend` stands with a teammate, `observe` flies probes past a planet
 * for one report and `orbit` leaves them there to report every tick.
 */
export const MISSIONS = ["attack", "defend", "observe", "orbit"] as const;
export type Mission = (typeof MISSIONS)[number];

/**
 * Where each class of a fleet stands in battle: a cell of the 3×3 grid, `line × 3 + column`, with line 0 the front
 * and column 0 the left (`formation.ts`). A formation is replaced whole and never changed in place.
 */
export type Formation = Record<ShipClass, number>;

/** A score in its three public parts. */
export interface ScoreParts {
  economy: number;
  military: number;
  technology: number;
}

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
  /** How the home fleet stands in battle. A fleet takes a copy of it at launch. */
  formation: Readonly<Formation>;
  /** A sheltered home fleet takes no part in a battle at its planet, and cannot be hit in one. */
  sheltered: boolean;
  /** What the planet has earned by fighting; part of its military score. */
  xp: number;
  /** What the planet owns is worth now (`score.ts`). */
  value: number;
  /** What ranks the planet and decides the match: its value and what it earned by fighting. */
  score: number;
  /** The score in its public parts. Replaced whole each tick. */
  parts: Readonly<ScoreParts>;
}

/**
 * `outbound` and `returning` fleets are in flight; a `stationed` fleet is at its target defending or in orbit, and
 * a `fighting` one is attacking it.
 */
export type FleetPhase = "outbound" | "stationed" | "fighting" | "returning";

export interface Fleet {
  id: number;
  owner: number;
  mission: Mission;
  target: number;
  ships: ShipCounts;
  formation: Readonly<Formation>;
  phase: FleetPhase;
  /** Ticks left in the phase; a fighting fleet stays until its battle ends. */
  eta: number;
  /** How long the whole trip out takes; a recall flies back as far as the fleet had come. */
  travelTicks: number;
}

/**
 * The damage the squadrons of one fleet carry between rounds. A squadron is a class, a count and its pooled hit
 * points: `count × armour` less the damage here, which is always less than one ship's armour.
 */
export interface Wounds {
  /** The fleet's id, or `NONE` for the planet's home fleet. */
  fleet: number;
  damage: ShipCounts;
}

/** A battle in progress at a planet: every fleet attacking it against its home fleet and the fleets defending it. */
export interface Battle {
  planet: number;
  /** Rounds fought so far; one is fought each tick. */
  round: number;
  wounds: Wounds[];
  /** What the ships destroyed so far cost to build; the planet's owner salvages a share of it. */
  wreck: Resources;
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

/**
 * What one observation saw, and when. The fields past `asteroids` depend on the report's `detail` (`intel.ts`):
 * asteroids always, then structures, research and the ships at the planet as rough counts, then the exact counts,
 * the stock and how the home fleet is drawn up.
 */
export interface ScoutReport {
  target: number;
  /** The tick the observation was made on. */
  tick: number;
  by: number;
  detail: number;
  asteroids: Resources;
  structures: StructureCounts | null;
  research: ResearchLevels | null;
  /** The home fleet and the fleets stationed with it: rounded down to the rules' steps until the detail is exact. */
  ships: ShipCounts | null;
  resources: Resources | null;
  formation: Formation | null;
  sheltered: boolean | null;
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
  /** A fleet has no ship left: they were destroyed, or its last pods were spent on the asteroids they took. */
  | { type: "fleetLost"; player: number; fleet: number }
  /** `player`'s sensors noticed probes from `by`. */
  | { type: "probed"; player: number; by: number }
  | {
      type: "battleRound";
      planet: number;
      round: number;
      /** Every player with ships in the battle, and the planet's owner. */
      parties: number[];
      /** What each side lost this round and how many of its ships were frozen in it. */
      attackersLost: ShipCounts;
      defendersLost: ShipCounts;
      attackersFrozen: number;
      defendersFrozen: number;
    }
  | {
      type: "battleEnded";
      planet: number;
      rounds: number;
      parties: number[];
      /** Asteroids taken from the planet, in all. */
      captured: number;
      /** What the planet's owner recovered from the wreckage. */
      salvage: Resources;
    }
  | {
      type: "asteroidsCaptured";
      player: number;
      fleet: number;
      from: number;
      asteroids: Resources;
    }
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
  /** The battles in progress, in the order they began. */
  battles: Battle[];
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
  probe: 0,
  fighter: 0,
  corvette: 0,
  frigate: 0,
  destroyer: 0,
  cruiser: 0,
  battleship: 0,
  pod: 0,
});

/** The team's record, or undefined for `NONE` (a neutral planet has no team). */
export const teamOf = <T extends { readonly id: number }>(
  teams: readonly T[],
  team: number,
): T | undefined => (team === NONE ? undefined : teams[team]);
