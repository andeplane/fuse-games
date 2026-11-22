/**
 * Fuse Galaxy's engine: a deterministic, headless strategy game. Everything a client, a bot or a learning agent
 * needs is exported here; `docs/design/fuse-galaxy.md` describes how the pieces fit.
 */
export { applyTick } from "./apply-tick.js";
export {
  captureCap,
  fightRound,
  hasCombatants,
  type Force,
  type RoundOutcome,
} from "./combat.js";
export {
  commandProblem,
  parseCommand,
  type Command,
  type CommandContext,
  type CommandType,
  type ParsedCommand,
  type Submission,
  type UntrustedSubmission,
} from "./commands.js";
export {
  affordableCount,
  asteroidCost,
  canAfford,
  distance,
  income,
  pendingLevel,
  productionTicks,
  researchCost,
  researchTicks,
  shipCost,
  shipTotal,
  structureCopies,
  structureCost,
  taxOn,
  totalOf,
  travelTicks,
} from "./economy.js";
export {
  createEnv,
  parseMatchLog,
  replay,
  type Env,
  type EnvOptions,
  type LogEntry,
  type MatchLog,
  type Policy,
  type StepResult,
} from "./env.js";
export {
  CELLS,
  COLUMNS,
  LINES,
  columnOf,
  formationName,
  lineOf,
  namedFormation,
  type Arrangement,
} from "./formation.js";
export { hashWorld } from "./hash.js";
export {
  detailOf,
  roughCount,
  warningTicks,
  type IncomingFleet,
} from "./intel.js";
export {
  commandProblemFor,
  legalCommands,
  minimalCommand,
  type CommandOption,
} from "./legal.js";
export {
  DEFAULT_RULES,
  type BranchRule,
  type Rules,
  type ShipRule,
  type StructureRule,
} from "./rules.js";
export {
  planetValue,
  scoreParts,
  shipsValue,
  stockValue,
  teamScore,
} from "./score.js";
export {
  SETUP_2V2,
  SETUP_2V2V2,
  SETUP_3V3,
  createWorld,
  parseSetup,
  setupProblem,
  type MatchSetup,
} from "./setup.js";
export {
  contextOf,
  viewFor,
  type BattleForce,
  type BattleView,
  type PlayerScoreLine,
  type PlayerView,
  type PublicPlanet,
  type ScoreLine,
  type Scoreboard,
  type TeamScoreLine,
} from "./view.js";
export {
  BRANCH_IDS,
  MISSIONS,
  NONE,
  RESOURCE_IDS,
  SHIP_CLASSES,
  STRUCTURE_IDS,
  noResources,
  noShips,
  teamOf,
  type Battle,
  type BranchId,
  type ConstructionJob,
  type DeepReadonly,
  type Fleet,
  type FleetPhase,
  type Formation,
  type GameEvent,
  type Knowledge,
  type MatchResult,
  type Mission,
  type Planet,
  type PlanetKind,
  type ProductionOrder,
  type ResearchJob,
  type ResearchLevels,
  type ResourceId,
  type Resources,
  type ScoreParts,
  type ScoutReport,
  type ShipClass,
  type ShipCounts,
  type StructureCounts,
  type StructureId,
  type Team,
  type World,
  type WorldDraft,
  type Wounds,
} from "./world.js";
