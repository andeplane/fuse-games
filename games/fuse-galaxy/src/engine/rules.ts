/**
 * Every balance number of the game, as one immutable data object. Engine code reads its numbers from a `Rules` and
 * holds none of its own, so a variant (a faster match, a test with a ten-tick limit) is a different object, never a
 * code change.
 *
 * One tick is meant to be one second of live play, so the durations below read as seconds, but nothing in the engine
 * knows that: a tick is just a step.
 */
import { deepFreeze } from "./freeze.js";
import {
  SHIP_CLASSES,
  noShips,
  type BranchId,
  type Formation,
  type Resources,
  type ShipClass,
  type ShipCounts,
  type StructureCounts,
  type StructureId,
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
  /** Hit points of one ship. */
  readonly armour: number;
  /** What one shot does. A shot destroys at most one ship, so what it does past the target's armour is wasted. */
  readonly attack: number;
  /** Shots each ship fires in a round; none for a class that does not fight back. */
  readonly shots: number;
  /** How far the class reaches across the lines of a battle (`formation.ts`): 1 is front line to front line. */
  readonly range: number;
  /** When the class fires in a round: lower numbers first, and what they destroy does not fire back. */
  readonly initiative: number;
  /** The classes it fires at, the preferred first. It cannot fire at a class left out. */
  readonly targets: readonly ShipClass[];
  /** A `freeze` shot destroys nothing: the ships it would have destroyed do not fire this round. */
  readonly effect: "damage" | "freeze";
  /** A probe flies the observing missions and no other, and takes no part in a battle. */
  readonly probe: boolean;
  /** Asteroids one surviving ship of the class captures at the end of a battle it attacked in, and is spent on. */
  readonly captures: number;
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
    /**
     * Where each team's galaxy is centred, by team id: one layout for each number of teams the rules allow, the
     * fewest first.
     */
    readonly teamAnchors: readonly (readonly (readonly [number, number])[])[];
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
    readonly ships: ShipCounts;
  };
  readonly neutral: {
    readonly resources: Resources;
    readonly asteroids: Resources;
    /** A neutral planet's home fleet: a modest defence. */
    readonly ships: ShipCounts;
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
    /** An attack musters for this long instead of `launchTicks`, */
    readonly attackLaunchTicks: number;
    /** and its flight takes this many percent of what the same fleet's flight to a friend would. */
    readonly attackTravelPercent: number;
  };
  readonly combat: {
    /** A battle is over after this many rounds at the latest; one round is fought each tick. */
    readonly rounds: number;
    /** A fleet recalled from a battle, or a home fleet sheltered during one, leaves this share of each class behind. */
    readonly retreatLossPercent: number;
    /** The planet's owner recovers this share of what every ship destroyed in a battle there cost. */
    readonly salvagePercent: number;
    /** The named formations a player can choose. */
    readonly formations: Readonly<Record<string, Formation>>;
    /** The formation every planet starts with. */
    readonly defaultFormation: string;
  };
  readonly capture: {
    /** Attackers take at most this share of a planet's asteroids in one battle, */
    readonly maxPercent: number;
    /** in full when the planet's score is at least this share of the largest attacker's, and in proportion below it; */
    readonly fullRatioPercent: number;
    /** never less than this many when a pod survives and the planet has them. */
    readonly minimum: number;
    /** A seat whose score is below this share of the attacker's cannot be attacked at all: the bash limit. */
    readonly bashLimitPercent: number;
  };
  readonly xp: {
    /** An attacker earns this share of the value it destroys, */
    readonly attackPercent: number;
    /** scaled by the planet's score against its own, within these bounds: more for hitting a bigger target. */
    readonly minRatioPercent: number;
    readonly maxRatioPercent: number;
    /** A defender earns this share of the value it destroys. */
    readonly defendPercent: number;
    /** What each captured asteroid earns the attacker who took it. */
    readonly perAsteroid: number;
  };
  readonly intel: {
    /** An observation's detail is `baseDetail` plus the observer's sensors minus the target's jamming, */
    readonly baseDetail: number;
    /** never below this (asteroids are always seen) */
    readonly minDetail: number;
    /** and never above this. */
    readonly maxDetail: number;
    /** The detail from which structures, research and rough ship counts are seen. */
    readonly roughDetail: number;
    /** The detail from which exact ship counts, the stock and the formation are seen. */
    readonly exactDetail: number;
    /** A rough count is the largest of these steps the true count reaches, ascending from 1. */
    readonly roughSteps: readonly number[];
    /** A planet is told it was probed unless the prober's sensors beat its jamming by this much. */
    readonly noticeMargin: number;
    /** How long probes stay in orbit before they fly home. */
    readonly orbitTicks: number;
    /** Probes a planet shoots down each tick out of an orbit it has noticed. */
    readonly orbitLossPerTick: number;
    /** A planet sees an attack on it this many ticks before it lands, */
    readonly warningTicks: number;
    /** plus this many for each of its sensors levels, */
    readonly warningTicksPerSensors: number;
    /** less this many for each of the attacker's jamming levels, */
    readonly warningTicksPerJamming: number;
    /** and never fewer than this many. */
    readonly minWarningTicks: number;
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

/** The cells of the battle grid: the line, then the column. */
const FRONT_LEFT = 0,
  FRONT_CENTRE = 1,
  FRONT_RIGHT = 2,
  MIDDLE_LEFT = 3,
  MIDDLE_CENTRE = 4,
  MIDDLE_RIGHT = 5,
  REAR_CENTRE = 7;

const NO_SHIPS: ShipCounts = noShips();

/** A formation from the cells of the classes that are not in the rear centre. */
const formation = (cells: Partial<Formation>): Formation => {
  const whole = noShips();
  for (const shipClass of SHIP_CLASSES)
    whole[shipClass] = cells[shipClass] ?? REAR_CENTRE;
  return whole;
};

/** A class that fires at nothing. */
const UNARMED = {
  attack: 0,
  shots: 0,
  range: 0,
  initiative: 0,
  targets: [],
  effect: "damage",
} as const;

/** The game as it is played by default: a forty-minute match at one tick a second. */
export const DEFAULT_RULES: Rules = deepFreeze<Rules>({
  version: 2,
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
      [
        [180, 500],
        [820, 500],
      ],
      [
        [500, 170],
        [214, 665],
        [786, 665],
      ],
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
    ships: { ...NO_SHIPS, probe: 2 },
  },
  neutral: {
    resources: { metal: 400, crystal: 400, eonium: 200 },
    asteroids: { metal: 2, crystal: 2, eonium: 1 },
    ships: { ...NO_SHIPS, fighter: 30, corvette: 8 },
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
  /*
   * Three ways to build a fleet, each beaten by another. A swarm of fighters is cheap hulls with one small gun
   * each: a heavy gun still destroys only one of them a shot. Corvettes and destroyers are the line: many small
   * guns that clear a swarm, on hulls a fighter needs many hits to break. Cruisers are artillery: one heavy shot
   * that fires first and from the rear, and takes a line ship with it, on a hull the swarm tears open. Battleships
   * are the line and the heavy gun in one hull at a price, frigates freeze what they hit instead of destroying it,
   * and pods take asteroids and fight nothing.
   *
   * Armour is several times a small gun's damage, so fleets of the same worth fight most of a battle's rounds and
   * a fleet facing its counter still lasts a few.
   */
  ships: {
    probe: {
      cost: { metal: 30, crystal: 30, eonium: 0 },
      buildTicks: 10,
      hulls: 0,
      speed: 40,
      armour: 8,
      ...UNARMED,
      probe: true,
      captures: 0,
      value: 6,
    },
    fighter: {
      cost: { metal: 60, crystal: 20, eonium: 0 },
      buildTicks: 20,
      hulls: 0,
      speed: 24,
      armour: 40,
      attack: 10,
      shots: 1,
      range: 1,
      initiative: 3,
      targets: [
        "cruiser",
        "frigate",
        "pod",
        "battleship",
        "destroyer",
        "corvette",
        "fighter",
      ],
      effect: "damage",
      probe: false,
      captures: 0,
      value: 8,
    },
    corvette: {
      cost: { metal: 120, crystal: 60, eonium: 10 },
      buildTicks: 30,
      hulls: 1,
      speed: 20,
      armour: 120,
      attack: 8,
      shots: 3,
      range: 1,
      initiative: 3,
      targets: ["fighter", "pod", "corvette", "frigate"],
      effect: "damage",
      probe: false,
      captures: 0,
      value: 19,
    },
    frigate: {
      cost: { metal: 250, crystal: 150, eonium: 50 },
      buildTicks: 45,
      hulls: 2,
      speed: 16,
      armour: 240,
      attack: 150,
      shots: 1,
      range: 2,
      initiative: 1,
      targets: ["battleship", "cruiser", "destroyer", "frigate", "corvette"],
      effect: "freeze",
      probe: false,
      captures: 0,
      value: 45,
    },
    destroyer: {
      cost: { metal: 500, crystal: 350, eonium: 150 },
      buildTicks: 60,
      hulls: 3,
      speed: 13,
      armour: 1000,
      attack: 12,
      shots: 5,
      range: 1,
      initiative: 4,
      targets: [
        "fighter",
        "corvette",
        "pod",
        "frigate",
        "destroyer",
        "cruiser",
        "battleship",
      ],
      effect: "damage",
      probe: false,
      captures: 0,
      value: 100,
    },
    cruiser: {
      cost: { metal: 1000, crystal: 800, eonium: 400 },
      buildTicks: 80,
      hulls: 4,
      speed: 10,
      armour: 800,
      attack: 400,
      shots: 1,
      range: 3,
      initiative: 2,
      targets: [
        "battleship",
        "destroyer",
        "cruiser",
        "frigate",
        "pod",
        "corvette",
        "fighter",
      ],
      effect: "damage",
      probe: false,
      captures: 0,
      value: 220,
    },
    battleship: {
      cost: { metal: 2200, crystal: 1800, eonium: 1000 },
      buildTicks: 110,
      hulls: 5,
      speed: 8,
      armour: 4400,
      attack: 200,
      shots: 3,
      range: 2,
      initiative: 5,
      targets: [
        "battleship",
        "cruiser",
        "destroyer",
        "frigate",
        "pod",
        "corvette",
        "fighter",
      ],
      effect: "damage",
      probe: false,
      captures: 0,
      value: 500,
    },
    pod: {
      cost: { metal: 300, crystal: 300, eonium: 100 },
      buildTicks: 40,
      hulls: 1,
      speed: 12,
      armour: 320,
      ...UNARMED,
      probe: false,
      captures: 1,
      value: 70,
    },
  },
  fleet: {
    maxFleets: 3,
    launchTicks: 10,
    travelPercentPerLevel: 10,
    defendTicks: 120,
    attackLaunchTicks: 45,
    attackTravelPercent: 200,
  },
  combat: {
    rounds: 10,
    retreatLossPercent: 15,
    salvagePercent: 30,
    formations: {
      // Something in every column, the line in front, artillery and pods behind it.
      line: formation({
        fighter: FRONT_LEFT,
        destroyer: FRONT_CENTRE,
        corvette: FRONT_RIGHT,
        frigate: MIDDLE_LEFT,
        battleship: MIDDLE_CENTRE,
        cruiser: REAR_CENTRE,
        pod: MIDDLE_RIGHT,
      }),
      // Every gun forward: nothing is screened but the pods.
      wall: formation({
        fighter: FRONT_LEFT,
        frigate: FRONT_LEFT,
        destroyer: FRONT_CENTRE,
        battleship: FRONT_CENTRE,
        corvette: FRONT_RIGHT,
        cruiser: FRONT_RIGHT,
        pod: MIDDLE_CENTRE,
      }),
      // One deep column: the most screening, and both flanks open.
      column: formation({
        fighter: FRONT_CENTRE,
        corvette: FRONT_CENTRE,
        destroyer: FRONT_CENTRE,
        frigate: MIDDLE_CENTRE,
        battleship: MIDDLE_CENTRE,
        cruiser: REAR_CENTRE,
        pod: REAR_CENTRE,
      }),
      // The light ships wide on both flanks to get round the enemy's line, the heavy ones in the centre.
      wings: formation({
        fighter: FRONT_LEFT,
        corvette: FRONT_RIGHT,
        destroyer: FRONT_CENTRE,
        battleship: FRONT_CENTRE,
        frigate: MIDDLE_CENTRE,
        cruiser: MIDDLE_CENTRE,
        pod: REAR_CENTRE,
      }),
    },
    defaultFormation: "line",
  },
  capture: {
    maxPercent: 25,
    fullRatioPercent: 60,
    minimum: 1,
    bashLimitPercent: 25,
  },
  xp: {
    attackPercent: 50,
    minRatioPercent: 50,
    maxRatioPercent: 200,
    defendPercent: 100,
    perAsteroid: 100,
  },
  intel: {
    baseDetail: 1,
    minDetail: 1,
    maxDetail: 3,
    roughDetail: 2,
    exactDetail: 3,
    roughSteps: [1, 3, 10, 30, 100, 300, 1000, 3000, 10000],
    noticeMargin: 1,
    orbitTicks: 120,
    orbitLossPerTick: 1,
    warningTicks: 60,
    warningTicksPerSensors: 10,
    warningTicksPerJamming: 8,
    minWarningTicks: 30,
  },
  team: { maxTaxPercent: 30 },
  score: { resourceDivisor: 20 },
});
