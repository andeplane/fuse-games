/**
 * Analysis to charts: Easy, Medium, Hard and Challenge for one song, deterministically.
 *
 * Two stages, both driven by what the music does on the grid:
 *
 * 1. Rhythm (`pickRows`): which slots carry a step. Every slot has a salience (an onset in some band); each
 *    difficulty takes the most salient slots of each bar that its level allows (beats only on Easy, off-beat
 *    eighths from Medium, sixteenth-level slots from Hard), up to a density that follows the bar's energy, and never
 *    a slot with no onset. A harder chart starts from the easier one's rows, so the four agree with each other.
 *    Accents become jumps and sustained notes become freezes.
 * 2. Steps (`placeSteps`): which arrow each row is. A beam search over the two feet's positions: feet alternate,
 *    neither crosses the other below Hard, a rising melody moves right and a falling one left, and a bar whose
 *    rhythm repeats an earlier bar of the phrase sometimes gets that bar's arrows (or their mirror image).
 *
 * How much of everything comes from `reference.ts`, the statistics of published charts: how many notes a second,
 * how many jumps and freezes and where, and which arrow tends to follow which at each speed. Those are frequencies,
 * so the search samples them (`gumbel`) and does not copy any chart; `compare.ts` measures how close the result is.
 *
 * Everything random is drawn from a hash of the song id, the difficulty and the place in the song.
 */
import { beatSeconds, decodeSeries, type Analysis } from "./analysis.js";
import { markHolds, markJumps } from "./chart-articulation.js";
import { chooseRhythm } from "./chart-rhythm.js";
import {
  chartProfile,
  clamp,
  hash,
  noise,
  type Chart,
  type ChartProfile,
  type Difficulty,
  type Note,
  type Row,
  type Song,
} from "./chart-shape.js";
import { placeSteps } from "./chart-steps.js";

export type { Chart, Difficulty, Note } from "./chart-shape.js";

export const DIFFICULTIES: readonly Difficulty[] = [
  "Easy",
  "Medium",
  "Hard",
  "Challenge",
];

function readSong(analysis: Analysis): Song {
  const slotsPerBeat = analysis.slotsPerBeat,
    perBar = 4 * slotsPerBeat;
  const scale = (text: string, unit: number): Float32Array =>
    Float32Array.from(decodeSeries(text), (value) => value / unit);
  const low = scale(analysis.low, 30),
    mid = scale(analysis.mid, 30),
    high = scale(analysis.high, 30),
    tone = scale(analysis.tone, 30);
  const slots = low.length,
    bars = Math.floor(slots / perBar);
  const seconds = new Float64Array(slots + 1);
  for (let slot = 0; slot <= slots; slot++)
    seconds[slot] = beatSeconds(analysis, slot / slotsPerBeat);
  // Energy: each bar with its neighbours, then spread between the song's quiet and loud bars.
  const raw = scale(analysis.energy, 61);
  const smooth = raw.map(
    (value, bar) =>
      (2 * value + (raw[bar - 1] ?? value) + (raw[bar + 1] ?? value)) / 4,
  );
  const sorted = Float32Array.from(smooth).sort();
  const quiet = sorted[Math.floor(sorted.length * 0.1)] ?? 0,
    loud = sorted[Math.floor(sorted.length * 0.9)] ?? 1;
  // A song that is loud throughout is busy throughout: the scale never spans less than seven decibels.
  const span = Math.max(loud - quiet, 0.3);
  const strength = (slot: number): number =>
    Math.max(low[slot]!, mid[slot]!, high[slot]!, tone[slot]!);
  // And how much is going on: the share of the bar's slots that sound, again between the song's sparse and busy bars.
  const busy = new Float32Array(smooth.length);
  for (let bar = 0; bar < bars; bar++) {
    let sum = 0;
    for (let slot = bar * perBar; slot < (bar + 1) * perBar; slot++)
      sum += Math.min(1, strength(slot));
    busy[bar] = sum / perBar;
  }
  const busySorted = Float32Array.from(busy.subarray(0, bars)).sort();
  const sparse = busySorted[Math.floor(bars * 0.1)] ?? 0,
    dense = busySorted[Math.floor(bars * 0.9)] ?? 1;
  const energy = smooth.map(
    (value, bar) =>
      0.5 * clamp((value - (loud - span)) / span, 0, 1) +
      0.5 *
        clamp(
          ((busy[bar] ?? 0) - sparse) / Math.max(dense - sparse, 0.05),
          0,
          1,
        ),
  );
  // Steps start on the first bar line two seconds in whose bar has a beat to step to: two of its beats sound.
  let first = slots;
  for (let bar = 0; bar < bars; bar++) {
    if (seconds[bar * perBar]! < 2) continue;
    let sounding = 0;
    for (let beat = 0; beat < 4; beat++)
      if (strength(bar * perBar + beat * slotsPerBeat) >= 0.4) sounding++;
    if (sounding >= 2) {
      first = bar * perBar;
      break;
    }
  }
  // And end on the last strong hit on a beat or an eighth that the file still has room to ring after.
  let last = first;
  for (let slot = slots - 1; slot > first; slot--) {
    const level = analysis.levels[slot % slotsPerBeat]!;
    if (
      (level === "Q" || level === "E") &&
      strength(slot) >= 0.7 &&
      seconds[slot]! < analysis.duration - 0.4
    ) {
      last = slot;
      break;
    }
  }
  return {
    analysis,
    slotsPerBeat,
    perBar,
    slots,
    bars,
    low,
    mid,
    high,
    tone,
    pitch: decodeSeries(analysis.pitch),
    level: scale(analysis.level, 50),
    energy,
    seconds,
    first,
    last,
  };
}

/** A supplied rhythm replaces automatic selection; both paths add jumps and freezes. */
function pickRows(
  song: Song,
  profile: ChartProfile,
  base: ReadonlySet<number>,
  placement?: readonly number[],
): Row[] {
  const slots = placement
    ? [...new Set(placement)]
        .filter((slot) => slot >= song.first && slot <= song.last)
        .sort((a, b) => a - b)
    : chooseRhythm(song, profile, base);
  if (slots.length === 0) return [];
  const rows: Row[] = slots.map((slot) => ({ slot, jump: false }));
  const jumps = markJumps(song, profile, slots, rows);
  markHolds(song, profile, rows, jumps);
  return rows.filter((row) => row.dropped !== true);
}

/** A few mines for flavour on Hard and Challenge: in rests, on an arrow no foot is resting on. */
function addMines(
  song: Song,
  notes: Note[],
  most: number,
  apart: number,
): void {
  const seed = hash(`${song.analysis.id}/mines`);
  const { slotsPerBeat } = song;
  const rowSlots = [...new Set(notes.map((note) => note.slot))].sort(
    (a, b) => a - b,
  );
  const holds = notes.filter((note) => note.kind === "hold");
  let placed = 0,
    lastMine = -Infinity;
  const half = slotsPerBeat % 2 === 0 ? slotsPerBeat / 2 : slotsPerBeat;
  for (let at = 0; at + 1 < rowSlots.length && placed < most; at++) {
    const from = rowSlots[at]!,
      to = rowSlots[at + 1]!;
    if (to - from < slotsPerBeat) continue;
    if (from - lastMine < apart * slotsPerBeat) continue;
    if (holds.some((hold) => hold.slot <= to && hold.endSlot! >= from))
      continue;
    // In the middle of the rest, on a beat or an eighth.
    const slot = from + half * Math.round((to - from) / (2 * half));
    if (slot <= from || slot >= to) continue;
    // Not on the arrows of the rows either side: where the feet are, and where they are going.
    const busy = new Set(
      notes
        .filter((note) => note.slot === from || note.slot === to)
        .map((note) => note.column),
    );
    const free = [0, 1, 2, 3].filter((column) => !busy.has(column));
    if (free.length === 0) continue;
    notes.push({
      slot,
      column: free[Math.floor(noise(seed, slot) * free.length)]!,
      kind: "mine",
    });
    lastMine = slot;
    placed++;
  }
  notes.sort((a, b) => a.slot - b.slot || a.column - b.column);
}

export interface ChartStats {
  /** Arrows to step on: taps and freeze heads, a jump counting two. */
  notes: number;
  /** Rows (a jump is one) per second from the first to the last. */
  average: number;
  /** The most rows per second over any four beats. */
  peak: number;
  jumps: number;
  holds: number;
  mines: number;
  /** Seconds into the audio of the first and last row. */
  first: number;
  last: number;
}

export function chartStats(analysis: Analysis, chart: Chart): ChartStats {
  const { slotsPerBeat } = analysis;
  const steps = chart.notes.filter((note) => note.kind !== "mine");
  const rows = [...new Set(steps.map((note) => note.slot))].sort(
    (a, b) => a - b,
  );
  const seconds = (slot: number): number =>
    beatSeconds(analysis, slot / slotsPerBeat);
  let peak = 0;
  for (let from = 0, to = 0; from < rows.length; from++) {
    while (to < rows.length && rows[to]! < rows[from]! + 4 * slotsPerBeat) to++;
    peak = Math.max(
      peak,
      (to - from) /
        (seconds(rows[from]! + 4 * slotsPerBeat) - seconds(rows[from]!)),
    );
  }
  const first = rows.length > 0 ? seconds(rows[0]!) : 0,
    last = rows.length > 0 ? seconds(rows[rows.length - 1]!) : 0;
  return {
    notes: steps.length,
    average: rows.length > 1 ? (rows.length - 1) / (last - first) : 0,
    peak,
    jumps: steps.length - rows.length,
    holds: steps.filter((note) => note.kind === "hold").length,
    mines: chart.notes.length - steps.length,
    first,
    last,
  };
}

/**
 * The four charts of a song, easiest first. `placement` (beats, per difficulty) swaps in another rhythm, such as a learned
 * model's (`scripts/chartnet`, for its evaluation); the arrows, jumps, freezes and mines are still this generator's.
 */
export function generateCharts(
  analysis: Analysis,
  placement?: Partial<Record<Difficulty, readonly number[]>>,
): Chart[] {
  const song = readSong(analysis);
  const charts: Chart[] = [];
  let base = new Set<number>();
  for (const difficulty of DIFFICULTIES) {
    const profile = chartProfile(difficulty);
    const beats = placement?.[difficulty];
    const rows = pickRows(
      song,
      profile,
      base,
      beats?.map((beat) => Math.round(beat * song.slotsPerBeat)),
    );
    base = new Set(rows.map((row) => row.slot));
    const notes = placeSteps(song, profile, rows);
    const { mines } = profile.tuning;
    if (mines.most > 0) addMines(song, notes, mines.most, mines.apart);
    const chart: Chart = { difficulty, meter: 0, notes };
    const stats = chartStats(analysis, chart);
    chart.meter = profile.tuning.meter(stats.average, stats.peak);
    charts.push(chart);
  }
  return charts;
}
