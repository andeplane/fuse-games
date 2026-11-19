import type { Analysis } from "./analysis.js";
import { referenceFor } from "./reference.js";

export type Difficulty = "Easy" | "Medium" | "Hard" | "Challenge";

export interface Note {
  /** Slots from beat 0: `slot / slotsPerBeat` is the beat. */
  slot: number;
  /** 0 Left, 1 Down, 2 Up, 3 Right. */
  column: number;
  kind: "tap" | "hold" | "mine";
  /** Holds: the slot of the tail. */
  endSlot?: number;
}

export interface Chart {
  difficulty: Difficulty;
  meter: number;
  /** In slot order, then column order. */
  notes: Note[];
}

export interface Tuning {
  /**
   * Notes per second over the whole chart, for a song at 135 beats a minute: the median of the published charts of
   * this difficulty. A slower song gets fewer and a faster one more (the square root of the tempo, within 15%).
   */
  nps: number;
  /** How a bar's share of that moves with its energy: times this in the quietest bars and in the busiest. */
  range: readonly [number, number];
  /** The most rows per second any four-beat window may hold. */
  cap: number;
  /** How much a slot of each level counts: beat, off-beat eighth, sixteenth level. 0 bars the level. */
  levels: { Q: number; E: number; S: number };
  /** The share of the bars, busiest first, that may use the sixteenth level: fast runs come in bursts. */
  sixteenths: number;
  /** How much an off-beat eighth gains from the off-beat a beat away being stepped: 1 for nothing. */
  runs: number;
  /** How much hi-hats count as something to step on. */
  hats: number;
  /** The least salience a slot needs to carry a step (1 is a strong onset). */
  floor: number;
  /** The most rows a sixteenth-speed run may have. */
  burst: number;
  /** The least time between two rows, in seconds, whatever the grid allows. */
  gap: number;
  /**
   * Jumps: how many a bar may have, the clear space needed either side, in beats, and the space needed on the
   * roomier side. How many there are comes from the reference.
   */
  jump: { perBar: number; clear: number; wide: number };
  /** Freezes: how many rows the other foot may take while one is held. How many and how long: the reference. */
  hold: { rowsInside: number; clears: number };
  /** Mines: how many at most, and how many beats apart. */
  mines: { most: number; apart: number };
  /** Whether a foot may cross the other, and what it costs on top of how rare the pattern is in the reference. */
  crossover: number | undefined;
  /** What a foot going straight from Up to Down (or back) costs, likewise. */
  candle: number;
  /** The shortest gap, in beats, at which the same arrow may come twice running. */
  jack: number;
  /** How often a bar that repeats an earlier bar's rhythm is given its arrows (or their mirror image) again. */
  echo: number;
  /** The meter from the chart's rows per second, over the whole chart and over its busiest four beats. */
  meter: (average: number, peak: number) => number;
}

/** The song as the generator reads it. */
export interface Song {
  analysis: Analysis;
  slotsPerBeat: number;
  perBar: number;
  slots: number;
  bars: number;
  /** Per slot, 1 is a strong onset. */
  low: Float32Array;
  mid: Float32Array;
  high: Float32Array;
  tone: Float32Array;
  /** Per slot: semitones, 0 for none. */
  pitch: Uint8Array;
  /** Per slot: sustained sound, 1 is the loud sections. */
  level: Float32Array;
  /** Per bar, 0 to 1: how loud the bar is among the song's bars. */
  energy: Float32Array;
  seconds: Float64Array;
  /** The first and last slot that may carry a step. */
  first: number;
  last: number;
}

/** One row of a chart before it has arrows. */
export interface Row {
  slot: number;
  jump: boolean;
  /** The tail's slot, when the row starts a freeze. */
  holdEnd?: number;
  /** Whether the row gave way to a freeze held alone. */
  dropped?: boolean;
}

const TUNING: Record<Difficulty, Tuning> = {
  Easy: {
    nps: 1.55,
    range: [0.7, 1.25],
    cap: 2.2,
    levels: { Q: 1, E: 0, S: 0 },
    sixteenths: 0,
    runs: 1,
    hats: 0.5,
    floor: 0.3,
    gap: 0.3,
    burst: 1,
    jump: { perBar: 1, clear: 1, wide: 2 },
    hold: { rowsInside: 0, clears: 2 },
    mines: { most: 0, apart: 0 },
    crossover: undefined,
    candle: 1,
    jack: 1,
    echo: 0.6,
    meter: (average) => 2 + clamp(Math.round((average - 1.2) / 0.15), 0, 2),
  },
  Medium: {
    nps: 2.37,
    range: [0.6, 1.35],
    cap: 3.6,
    levels: { Q: 1, E: 1.1, S: 0 },
    sixteenths: 0,
    runs: 1,
    hats: 0.7,
    floor: 0.3,
    gap: 0.16,
    burst: 1,
    jump: { perBar: 2, clear: 1, wide: 0 },
    hold: { rowsInside: 1, clears: 2 },
    mines: { most: 0, apart: 0 },
    crossover: undefined,
    candle: 0.6,
    jack: 0.5,
    echo: 0.4,
    meter: (average) => 5 + clamp(Math.round((average - 1.9) / 0.2), 0, 2),
  },
  Hard: {
    nps: 3.3,
    range: [0.5, 1.5],
    cap: 5.5,
    levels: { Q: 1, E: 1.05, S: 2.1 },
    sixteenths: 0.5,
    runs: 1.6,
    hats: 0.85,
    floor: 0.25,
    gap: 0.095,
    burst: 5,
    jump: { perBar: 2, clear: 0.5, wide: 0 },
    hold: { rowsInside: 3, clears: 0 },
    mines: { most: 4, apart: 16 },
    crossover: 0.8,
    candle: 0.2,
    jack: 0.5,
    echo: 0.3,
    meter: (average) => 8 + clamp(Math.round((average - 2.7) / 0.3), 0, 2),
  },
  Challenge: {
    nps: 4.8,
    range: [0.5, 1.5],
    cap: 8.5,
    levels: { Q: 1, E: 0.85, S: 2.3 },
    sixteenths: 0.6,
    runs: 1.6,
    hats: 1,
    floor: 0.2,
    gap: 0.07,
    burst: 17,
    jump: { perBar: 3, clear: 0.3, wide: 0 },
    hold: { rowsInside: 6, clears: 0 },
    mines: { most: 12, apart: 6 },
    crossover: 0.5,
    candle: 0.1,
    jack: 0.5,
    echo: 0.25,
    meter: (average, peak) =>
      10 + clamp(Math.round((0.6 * average + 0.4 * peak - 4.6) / 0.5), 0, 3),
  },
};

export function chartProfile(difficulty: Difficulty) {
  const reference = referenceFor(difficulty);
  return {
    difficulty,
    tuning: TUNING[difficulty],
    reference,
    jumpShare: reference.scalars.jump_share?.p50 ?? 0.07,
  };
}

export type ChartProfile = ReturnType<typeof chartProfile>;

export const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));

/** A 32-bit hash of a string (FNV-1a), the seed of everything random here. */
export function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/** A number in [0, 1) from a seed and up to three integers. */
export function noise(seed: number, a: number, b = 0, c = 0): number {
  let value = seed ^ Math.imul(a + 1, 0x9e3779b1);
  value =
    Math.imul(value ^ (value >>> 15), 0x85ebca6b) ^
    Math.imul(b + 1, 0xc2b2ae35);
  value =
    Math.imul(value ^ (value >>> 13), 0x27d4eb2f) ^
    Math.imul(c + 1, 0x165667b1);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

export const PHRASE_BARS = 4;

export function rhythmGrid(song: Song) {
  const { slotsPerBeat, analysis } = song;
  return {
    phraseOffset: (bar: number) =>
      (((bar - analysis.phrase) % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS,
    levelOf: (slot: number) =>
      analysis.levels[slot % slotsPerBeat] as "Q" | "E" | "S" | "X",
    beatGap: (a: number, b: number) => Math.abs(a - b) / slotsPerBeat,
  };
}
