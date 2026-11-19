import type { Tuning } from "./chart-shape.js";
import { ARROWS, type Reference, type Speed } from "./reference.js";

/** Where the feet are and how the search got there. */
export interface State {
  left: number;
  right: number;
  /** The foot that stepped last: 0 left, 1 right. */
  foot: number;
  /** The arrows of the last three single steps, newest first; -1 for none or a jump. */
  recent: readonly [number, number, number];
  /** How many steps in a row have repeated the arrow two steps before (a trill). */
  trill: number;
  /** How many steps in a row have repeated the arrow one step before (a jack). */
  jacks: number;
  /** The foot holding a freeze and the slot it lets go, or -1. */
  holding: number;
  holdEnd: number;
  uses: readonly [number, number, number, number];
  /** The last jump's two arrows as `4 * lower + higher`, or -1. */
  lastJump: number;
  cost: number;
  /** The arrows of the row that led here, and the state before it. */
  columns: readonly number[];
  holdColumn: number;
  previous: State | undefined;
}

/** Left and Right are either side of the pad; Down and Up are both in the middle. */
const ACROSS = [0, 1, 1, 2] as const;
// Keep this order for stable cost ties. The two middle arrows allow either foot assignment.
const JUMP_LANDINGS = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 2],
  [2, 1],
  [1, 3],
  [2, 3],
] as const;
const isCandle = (from: number, to: number) =>
  (from === 1 && to === 2) || (from === 2 && to === 1);

export interface StepScoring {
  tuning: Tuning;
  afterJumpIn: number;
  gapBeats: number;
  gapSeconds: number;
  direction: number;
  prior: Prior;
  chained: boolean;
  wanted: readonly number[] | undefined;
  sample: readonly number[];
}

/** How likely each arrow is after one arrow (`two`, by `4 * last + next`) and after two (`three`). */
interface Prior {
  two: Float64Array;
  three: Float64Array;
}

/** The slower speeds a speed borrows from when the reference has no table for it at this difficulty. */
const FALLBACK: Record<Speed, readonly Speed[]> = {
  "4th": ["4th"],
  "8th": ["8th", "4th"],
  "16th": ["16th", "8th", "4th"],
};

/**
 * What published charts step next, by how fast the steps come: sixteenths are mostly drills (there and back),
 * eighths sweep and turn, quarters repeat an arrow often. From the reference's bigram and trigram frequencies.
 */
export function priors(reference: Reference): Record<Speed, Prior> {
  const conditional = (kind: string, speed: Speed, size: number) => {
    const table = FALLBACK[speed]
      .map((from) => reference.tables[`${kind}_${from}`])
      .find((found) => found !== undefined);
    const out = new Float64Array(4 ** size).fill(0.25);
    if (!table) return out;
    for (let context = 0; context < 4 ** (size - 1); context++) {
      const share = (next: number): number => {
        let key = ARROWS[next]!;
        for (let rest = context, at = 0; at < size - 1; at++, rest >>= 2)
          key = ARROWS[rest & 3]! + key;
        // A pattern the reference never has is rare here, not impossible.
        return (table[key] ?? 0) + 0.0005;
      };
      const sum = share(0) + share(1) + share(2) + share(3);
      for (let next = 0; next < 4; next++)
        out[context * 4 + next] = share(next) / sum;
    }
    return out;
  };
  const prior = (speed: Speed): Prior => ({
    two: conditional("bigram", speed, 2),
    three: conditional("trigram", speed, 3),
  });
  return { "4th": prior("4th"), "8th": prior("8th"), "16th": prior("16th") };
}

const ECHO = 4;
const JACK = 0.2;

export function prepareJumpLandings(reference: Reference) {
  const jumpPairs = reference.tables.jump_pair ?? {};
  return JUMP_LANDINGS.map(([left, right]) => {
    const a = Math.min(left, right);
    const b = Math.max(left, right);
    return {
      left,
      right,
      columns: [a, b] as const,
      key: a * 4 + b,
      cost: -Math.log(6 * ((jumpPairs[ARROWS[a]! + ARROWS[b]!] ?? 0) + 0.005)),
    };
  });
}

function crossoverCost(
  left: number,
  right: number,
  score: StepScoring,
): number | undefined {
  const crossed = ACROSS[left]! - ACROSS[right]!;
  if (crossed <= 0) return 0;
  const { crossover } = score.tuning;
  if (crossover === undefined || crossed > 1) return undefined;
  return crossover + (score.gapSeconds < 0.15 ? 1 : 0);
}

/** Preserve the order of the penalties: floating-point ties affect the search. */
function transitionCost(
  cost: number,
  state: State,
  column: number,
  score: StepScoring,
): number {
  const { prior, chained, afterJumpIn, direction } = score;
  const [last, second] = state.recent;
  if (last >= 0) {
    // What published charts step after these arrows at this speed.
    const likely =
      chained && second >= 0
        ? prior.three[second * 16 + last * 4 + column]!
        : prior.two[last * 4 + column]!;
    cost -= Math.log(4 * likely);
    // The feet here alternate more strictly than a player's do, which makes the same arrow twice rarer than it
    // should be: this much puts it back.
    if (column === last) cost -= JACK;
  } else if (state.columns.length === 2) {
    // After a jump: one of its arrows again about as often as published charts do.
    const stays = state.columns.includes(column);
    cost -= Math.log((stays ? afterJumpIn : 1 - afterJumpIn) / 0.5);
  }
  // The melody: up moves right, down moves left.
  if (direction !== 0 && last >= 0) {
    const moved = Math.sign(column - last);
    cost += moved === direction ? -0.35 : moved === 0 ? 0 : 0.7;
  }
  return cost;
}

interface StepPosition {
  from: number;
  other: number;
  column: number;
  left: number;
  right: number;
}

/** A jack must have enough time and cannot repeat indefinitely. */
function forbiddenJack(
  state: State,
  column: number,
  score: StepScoring,
): boolean {
  return (
    column === state.recent[0] &&
    (score.gapBeats < score.tuning.jack || state.jacks >= 2)
  );
}

export function stepCost(
  state: State,
  move: StepPosition,
  score: StepScoring,
  usageDenominator: number,
): number | undefined {
  const { wanted, sample, tuning } = score;
  const { column, from, other, left, right } = move;
  if (column === other) return undefined;
  if (forbiddenJack(state, column, score)) return undefined;
  const penalty = crossoverCost(left, right, score);
  if (penalty === undefined) return undefined;
  let cost = penalty;
  if (isCandle(from, column)) cost += tuning.candle;
  const [last, second] = state.recent;
  // A drill may run on, but not for ever.
  if (column === second && column !== last && state.trill >= 6)
    cost += 0.6 * (state.trill - 5);
  cost = transitionCost(cost, state, column, score);
  // Even use of the four arrows.
  cost += 2.2 * (state.uses[column]! / usageDenominator - 0.25);
  if (wanted && wanted.length === 1 && wanted[0] === column) cost -= ECHO;
  // The draw that makes the cheapest arrow a sample of the likely ones and not always the likeliest.
  cost -= sample[column]!;
  return cost;
}

export type Landing = ReturnType<typeof prepareJumpLandings>[number] & {
  sample: number;
  echo: boolean;
};

export function jumpCost(
  landing: Landing,
  state: State,
  tuning: Tuning,
  usageDenominator: number,
): number {
  const { columns, key, left, right, echo, sample, cost: priorCost } = landing;
  const [a, b] = columns;
  // Apply costs in foot order to keep floating-point ties stable.
  let cost = priorCost;
  if (state.lastJump === key) cost += 0.45;
  if (state.left !== left) cost += 0.2;
  if (isCandle(state.left, left)) cost += tuning.candle;
  if (state.right !== right) cost += 0.2;
  if (isCandle(state.right, right)) cost += tuning.candle;
  cost += 2.2 * ((state.uses[a]! + state.uses[b]!) / usageDenominator - 0.5);
  if (echo) cost -= ECHO;
  cost -= sample;
  return cost;
}
