/**
 * Every balance number of the game, as one immutable data object. Engine code reads its numbers from a `Rules` and
 * holds none of its own, so a variant (a faster match, a test with a ten-tick limit) is a different object, never a
 * code change.
 *
 * One tick is meant to be one second of live play, so the durations below read as seconds, but nothing in the engine
 * knows that: a tick is just a step.
 */
import { deepFreeze } from "./freeze.js";
import type {
  BranchId,
  Resources,
  ShipClass,
  StructureCounts,
  StructureId,
} from "./world.js";

export interface StructureRule {
  /** The first copy's price. */
  readonly cost: Resources;
  /** Each further copy costs this many percent of the first copy's price more than the one before. */
  readonly costGrowthPercent: number;
  readonly buildTicks: number;
  readonly maxCount: number;
  /** What each copy adds to the planet's income every tick. */
  readonly income: Resources;
  /** What each copy adds to the planet's value. */
  readonly value: number;
}

export interface BranchRule {
  readonly maxLevel: number;
  /** Level 1's price. */
  readonly cost: Resources;
  /** Each further level costs this many percent of level 1's price more than the one before. */
  readonly costGrowthPercent: number;
  /** Level 1's duration. */
  readonly ticks: number;
  readonly ticksGrowthPercent: number;
  /** What each level adds to the planet's value. */
  readonly value: number;
}

export interface ShipRule {
  readonly cost: Resources;
  readonly buildTicks: number;
  /** The hulls research level the class needs. */
  readonly hulls: number;
  /** Map distance covered per tick; a fleet flies at its slowest ship's speed. */
  readonly speed: number;
  /** Combat stats. The combat slice reads them; nothing in this one does. */
  readonly attack: number;
  readonly armour: number;
  /** What each ship adds to its owner's value, at home or in a fleet. */
  readonly value: number;
}

export interface Rules {
  /** Bump when a number or a rule changes, so a recorded match names the rules it was played under. */
  readonly version: number;
  readonly match: {
    /** The match ends when this many ticks have been applied. */
    readonly tickLimit: number;
  };
  readonly limits: {
    /** Commands one player may send in one tick; the rest are rejected. */
    readonly commandsPerPlayerPerTick: number;
    /** No stock of a resource, on a planet or in a fund, grows past this. */
    readonly resourceCap: number;
  };
  readonly setup: {
    readonly minTeams: number;
    readonly maxTeams: number;
    readonly maxTeamSize: number;
    readonly maxSeats: number;
    readonly maxNeutrals: number;
  };
  readonly map: {
    /** The map is a square of this side; positions are whole numbers in it. */
    readonly size: number;
    /** Where each team's galaxy is centred, by team id. */
    readonly teamAnchors: readonly (readonly [number, number])[];
    /** Where each member sits relative to the anchor, by place in the team. */
    readonly memberOffsets: readonly (readonly [number, number])[];
    /** Neutral planets stay this far from the edge. */
    readonly margin: number;
    /** A neutral planet is placed at least this far from every other planet when a spot can be found. */
    readonly minSeparation: number;
    /** How many random spots are tried for one neutral planet before the last one is taken as it is. */
    readonly placementAttempts: number;
  };
  /** What a seat's planet starts with. */
  readonly start: {
    readonly resources: Resources;
    readonly asteroids: Resources;
    readonly structures: StructureCounts;
  };
  readonly neutral: {
    readonly resources: Resources;
    readonly asteroids: Resources;
    /** Each neutral planet gets up to this many extra asteroids of each resource, drawn from the seed. */
    readonly extraAsteroids: number;
    /** A neutral planet earns this share of the income a seat would. */
    readonly incomePercent: number;
  };
  readonly economy: {
    /** What every planet earns each tick before asteroids and structures. */
    readonly baseIncome: Resources;
    /** What one asteroid yields each tick (Planetarion's 250 a tick, scaled to a session). */
    readonly asteroidIncome: Resources;
    /** Each mining research level adds this many percent to the asteroids' yield. */
    readonly miningPercentPerLevel: number;
  };
  readonly asteroid: {
    /**
     * Initiating an asteroid of a resource you own n of costs `costNumerator × (n² + 3n + 2) / costDenominator`:
     * Planetarion's quadratic, where the numerator over the denominator is its 5/2.
     */
    readonly costNumerator: Resources;
    readonly costDenominator: number;
    readonly maxPerResource: number;
    /** What each asteroid adds to the planet's value. */
    readonly value: number;
  };
  readonly construction: {
    /** One structure in progress plus the ones queued behind it. */
    readonly slots: number;
  };
  readonly structures: Readonly<Record<StructureId, StructureRule>>;
  readonly research: {
    /** One level in progress plus the ones queued behind it. */
    readonly slots: number;
    /** The structure a planet needs before it can research. */
    readonly structure: StructureId;
    /** Each copy of that structure past the first shortens research by this many percent, */
    readonly speedPercent: number;
    /** up to this many percent. */
    readonly maxSpeedPercent: number;
    readonly branches: Readonly<Record<BranchId, BranchRule>>;
  };
  readonly production: {
    /** The structure a planet needs before it can produce ships. */
    readonly structure: StructureId;
    /** Orders in production at once. */
    readonly maxOrders: number;
    /** Ships in one order. */
    readonly maxBatch: number;
    readonly speedPercent: number;
    readonly maxSpeedPercent: number;
  };
  readonly ships: Readonly<Record<ShipClass, ShipRule>>;
  readonly fleet: {
    /** Fleets one planet may have out at once. */
    readonly maxFleets: number;
    /** Ticks every launch takes before distance counts. */
    readonly launchTicks: number;
    /** Each travel research level adds this many percent to a fleet's speed. */
    readonly travelPercentPerLevel: number;
    /** How long a defending fleet stays before it flies home. */
    readonly defendTicks: number;
  };
  readonly intel: {
    /** An observation's detail is `baseDetail` plus the observer's sensors minus the target's jamming, */
    readonly baseDetail: number;
    /** never below this (resources and asteroids are always seen) */
    readonly minDetail: number;
    /** and never above this. */
    readonly maxDetail: number;
    /** The detail from which structures and research are seen. */
    readonly structuresDetail: number;
    /** The detail from which ships at home are seen. */
    readonly shipsDetail: number;
  };
  readonly team: {
    /** The highest tax a commander may set. */
    readonly maxTaxPercent: number;
  };
  readonly score: {
    /** This many resources in stock, of any kind, are worth one point of value. */
    readonly resourceDivisor: number;
  };
}

const NO_INCOME: Resources = { metal: 0, crystal: 0, eonium: 0 };

/** The game as it is played by default: a forty-minute match at one tick a second. */
export const DEFAULT_RULES: Rules = deepFreeze<Rules>({
  version: 1,
  match: { tickLimit: 2400 },
  limits: { commandsPerPlayerPerTick: 16, resourceCap: 1_000_000_000 },
  setup: {
    minTeams: 2,
    maxTeams: 3,
    maxTeamSize: 3,
    maxSeats: 6,
    maxNeutrals: 12,
  },
  map: {
    size: 1000,
    teamAnchors: [
      [180, 500],
      [820, 500],
      [500, 150],
    ],
    memberOffsets: [
      [0, -90],
      [-70, 60],
      [70, 60],
    ],
    margin: 60,
    minSeparation: 110,
    placementAttempts: 40,
  },
  start: {
    resources: { metal: 800, crystal: 800, eonium: 400 },
    asteroids: { metal: 1, crystal: 1, eonium: 1 },
    structures: {
      metalRefinery: 0,
      crystalRefinery: 0,
      eoniumRefinery: 0,
      researchLab: 0,
      shipyard: 0,
    },
  },
  neutral: {
    resources: { metal: 400, crystal: 400, eonium: 200 },
    asteroids: { metal: 2, crystal: 2, eonium: 1 },
    extraAsteroids: 3,
    incomePercent: 50,
  },
  economy: {
    baseIncome: { metal: 10, crystal: 10, eonium: 6 },
    asteroidIncome: { metal: 4, crystal: 4, eonium: 4 },
    miningPercentPerLevel: 10,
  },
  asteroid: {
    costNumerator: { metal: 25, crystal: 25, eonium: 0 },
    costDenominator: 2,
    maxPerResource: 100,
    value: 150,
  },
  construction: { slots: 2 },
  structures: {
    metalRefinery: {
      cost: { metal: 300, crystal: 100, eonium: 0 },
      costGrowthPercent: 50,
      buildTicks: 30,
      maxCount: 10,
      income: { metal: 6, crystal: 0, eonium: 0 },
      value: 40,
    },
    crystalRefinery: {
      cost: { metal: 100, crystal: 300, eonium: 0 },
      costGrowthPercent: 50,
      buildTicks: 30,
      maxCount: 10,
      income: { metal: 0, crystal: 6, eonium: 0 },
      value: 40,
    },
    eoniumRefinery: {
      cost: { metal: 200, crystal: 200, eonium: 0 },
      costGrowthPercent: 50,
      buildTicks: 30,
      maxCount: 10,
      income: { metal: 0, crystal: 0, eonium: 5 },
      value: 40,
    },
    researchLab: {
      cost: { metal: 400, crystal: 400, eonium: 100 },
      costGrowthPercent: 100,
      buildTicks: 45,
      maxCount: 5,
      income: NO_INCOME,
      value: 90,
    },
    shipyard: {
      cost: { metal: 500, crystal: 300, eonium: 100 },
      costGrowthPercent: 100,
      buildTicks: 45,
      maxCount: 5,
      income: NO_INCOME,
      value: 90,
    },
  },
  research: {
    slots: 2,
    structure: "researchLab",
    speedPercent: 15,
    maxSpeedPercent: 60,
    branches: {
      travel: {
        maxLevel: 5,
        cost: { metal: 300, crystal: 300, eonium: 200 },
        costGrowthPercent: 60,
        ticks: 60,
        ticksGrowthPercent: 40,
        value: 80,
      },
      hulls: {
        maxLevel: 5,
        cost: { metal: 400, crystal: 400, eonium: 300 },
        costGrowthPercent: 60,
        ticks: 75,
        ticksGrowthPercent: 40,
        value: 110,
      },
      sensors: {
        maxLevel: 5,
        cost: { metal: 200, crystal: 300, eonium: 300 },
        costGrowthPercent: 60,
        ticks: 50,
        ticksGrowthPercent: 40,
        value: 80,
      },
      mining: {
        maxLevel: 5,
        cost: { metal: 300, crystal: 300, eonium: 100 },
        costGrowthPercent: 60,
        ticks: 60,
        ticksGrowthPercent: 40,
        value: 70,
      },
      jamming: {
        maxLevel: 5,
        cost: { metal: 200, crystal: 300, eonium: 300 },
        costGrowthPercent: 60,
        ticks: 50,
        ticksGrowthPercent: 40,
        value: 80,
      },
    },
  },
  production: {
    structure: "shipyard",
    maxOrders: 4,
    maxBatch: 1000,
    speedPercent: 15,
    maxSpeedPercent: 60,
  },
  ships: {
    fighter: {
      cost: { metal: 60, crystal: 20, eonium: 0 },
      buildTicks: 20,
      hulls: 0,
      speed: 24,
      attack: 6,
      armour: 4,
      value: 8,
    },
    corvette: {
      cost: { metal: 120, crystal: 60, eonium: 10 },
      buildTicks: 30,
      hulls: 1,
      speed: 20,
      attack: 14,
      armour: 10,
      value: 19,
    },
    frigate: {
      cost: { metal: 250, crystal: 150, eonium: 50 },
      buildTicks: 45,
      hulls: 2,
      speed: 16,
      attack: 32,
      armour: 26,
      value: 45,
    },
    destroyer: {
      cost: { metal: 500, crystal: 350, eonium: 150 },
      buildTicks: 60,
      hulls: 3,
      speed: 13,
      attack: 70,
      armour: 60,
      value: 100,
    },
    cruiser: {
      cost: { metal: 1000, crystal: 800, eonium: 400 },
      buildTicks: 80,
      hulls: 4,
      speed: 10,
      attack: 150,
      armour: 140,
      value: 220,
    },
    battleship: {
      cost: { metal: 2200, crystal: 1800, eonium: 1000 },
      buildTicks: 110,
      hulls: 5,
      speed: 8,
      attack: 340,
      armour: 330,
      value: 500,
    },
  },
  fleet: {
    maxFleets: 3,
    launchTicks: 10,
    travelPercentPerLevel: 10,
    defendTicks: 120,
  },
  intel: {
    baseDetail: 1,
    minDetail: 1,
    maxDetail: 3,
    structuresDetail: 2,
    shipsDetail: 3,
  },
  team: { maxTaxPercent: 30 },
  score: { resourceDivisor: 20 },
});
