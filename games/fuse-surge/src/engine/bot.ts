import { DUCK, JUMP } from "./input.js";
import { div, mix } from "./math.js";
import { airSpeed } from "./step.js";
import * as T from "./tuning.js";
import {
  EVERY_LANE,
  HIGH,
  LOW,
  TALL,
  footholdX,
  speedAt,
  type Kind,
  type Rider,
  type Surge,
  type World,
} from "./world.js";

/**
 * A bot's controls for the tick about to run: ordinary held bits, read off the world like a player reads the deck.
 * It has no memory and moves no generator, so every device that folds a tick asks the same question and gets the
 * same answer. `planInput` is the sound plan; a bot follows it except for the surges it fumbles, which are chosen by
 * mixing the match's seed with the surge, so a fumble is the same on every device and lasts the surge's whole run.
 */
export type BotLevel = 0 | 1 | 2;
export const BOT_LEVELS: readonly BotLevel[] = [0, 1, 2];
export const isBotLevel = (value: unknown): value is BotLevel =>
  value === 0 || value === 1 || value === 2;

/** A bot is asked once a tick: it jumps this many steps ahead of a low surge so it is over it in time. */
const JUMP_LEAD = 14;
const DUCK_LEAD = 8;
/**
 * A tall surge takes two jumps: the first this many steps ahead, held until its rise slows to `TALL_TURN`, then let
 * go for a tick and pressed again, so the second lifts off near the top of the first and is over the surge in time.
 */
const TALL_LEAD = 44;
const TALL_TURN = 800;
/** In the air before a low surge: steps to spare past its pass, and how close it is when coming down is no longer an option. */
const SPARE = 8,
  COMMIT = 20;
/** A winner's last hop starts with more of the break left than this, so it has landed when the next round counts in. */
const LAST_HOP = 110;
/** Fumbles per thousand surges at the standard pace's starting speed, by level; faster surges are fumbled more. */
const FUMBLES = [130, 70, 34] as const;
const MOST_FUMBLES = 600;

/** The height a surge will strike at when it reaches the riders: a flip still to come counts. */
const strikeKind = (surge: Surge): Kind =>
  surge.flip ? (surge.kind === LOW ? HIGH : LOW) : surge.kind;

/** The nearest surge this rider still has to deal with: a bolt in another lane is nothing to it. */
function threat(world: World, slot: number): Surge | undefined {
  const rider = world.riders[slot]!;
  const bit = 1 << slot;
  return world.surges.find(
    (surge) =>
      !(surge.done & bit) &&
      (surge.lane === EVERY_LANE || surge.lane === slot) &&
      surge.x - rider.x >= -T.REACH,
  );
}

/**
 * Steps until `surge` reaches `rider`, counting the rider's own walk to its foothold: toward the surge after winning
 * a foothold back, which closes the gap faster than the surge alone.
 */
function etaOf(
  world: World,
  rider: Rider,
  surge: Surge,
  speed: number,
): number {
  const gap = surge.x - rider.x - T.REACH;
  if (gap <= 0) return 0;
  const walk = footholdX(rider.hits, world.rules.hits) - rider.x;
  if (walk === 0) return div(gap, speed);
  const steps = div((walk > 0 ? walk : -walk) + T.WALK_SPEED - 1, T.WALK_SPEED);
  const closing = walk > 0 ? speed + T.WALK_SPEED : speed - T.WALK_SPEED;
  if (gap <= closing * steps) return div(gap, closing);
  return steps + div(gap - closing * steps, speed);
}

/** Whether a rider already in the air stays above a low surge for its whole pass by simply holding jump. */
function carries(
  y: number,
  vy: number,
  from: number,
  until: number,
  glide: boolean,
): boolean {
  for (let step = 1; step <= until; step++) {
    vy = airSpeed(vy, true, false, glide);
    y += vy;
    if (y <= 0) return false;
    if (step >= from && y <= T.LOW_TOP + T.U) return false;
  }
  return true;
}

/**
 * The sound answer for `slot`: jump the low ones, duck the high ones, dive out of the air when it has to, and take a
 * tall one with a double jump.
 */
export function planInput(world: World, slot: number): number {
  const rider = world.riders[slot];
  if (!rider || rider.out) return 0;
  if (world.phase !== "play") {
    // A round's winner hops on the spot through the break, and is back on the deck before it ends.
    const won = world.phase === "break" && world.lastWinners & (1 << slot);
    return won && world.phaseSteps > LAST_HOP && world.phaseSteps % 72 >= 36
      ? JUMP
      : 0;
  }
  const next = threat(world, slot);
  if (!next) return 0;
  const speed = speedAt(world.clock, world.rules);
  const eta = etaOf(world, rider, next, speed);
  const air = rider.y !== 0 || rider.vy !== 0;
  const kind = strikeKind(next);
  if (kind === HIGH) {
    if (air) return DUCK;
    return eta <= DUCK_LEAD ? DUCK : 0;
  }
  if (kind === TALL) {
    if (!air) return eta <= TALL_LEAD ? JUMP : 0;
    // In the air with the surge still far off: come down first, the jumps are for later.
    if (eta > TALL_LEAD) return 0;
    // The second jump is up: hold it over the surge.
    if (rider.jumps > 0) return JUMP;
    if (rider.vy > TALL_TURN) return JUMP;
    return rider.jumpHeld ? 0 : JUMP;
  }
  if (!air) return eta <= JUMP_LEAD ? JUMP : 0;
  // Stay up if that carries it over, with a little to spare so the answer does not flip from one tick to the next;
  // and once the surge is this close there is no time to land and jump again, so staying up is all there is.
  const pass = div(2 * T.REACH, speed) + 2 + SPARE;
  return eta < COMMIT ||
    carries(rider.y, rider.vy, eta, eta + pass, world.rules.glide)
    ? JUMP
    : DUCK;
}

/** What a bot of `level` holds: the plan, or for a surge it fumbles, the wrong move or none at all. */
export function botInput(world: World, slot: number, level: BotLevel): number {
  const plan = planInput(world, slot);
  if (world.phase !== "play") return plan;
  const rider = world.riders[slot];
  const next = rider && !rider.out ? threat(world, slot) : undefined;
  if (!next || !rider) return plan;
  const speed = speedAt(world.clock, world.rules);
  const rate = div(FUMBLES[level] * speed, T.SPEED_BASE[1]);
  const roll = mix(world.seed, world.round, next.id, slot) % 1000;
  if (roll >= (rate > MOST_FUMBLES ? MOST_FUMBLES : rate)) return plan;
  // Half the fumbles freeze; the other half read the surge upside down.
  if (roll % 2 === 0) return 0;
  const gap = next.x - rider.x - T.REACH;
  if (gap > JUMP_LEAD * speed) return 0;
  return strikeKind(next) === LOW ? DUCK : JUMP;
}
