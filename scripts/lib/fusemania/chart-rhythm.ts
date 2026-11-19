import {
  clamp,
  PHRASE_BARS,
  rhythmGrid,
  type ChartProfile,
  type Song,
} from "./chart-shape.js";

type Grid = ReturnType<typeof rhythmGrid>;

const DIRECTIONS = [-1, 1] as const;

interface BarTarget {
  index: number;
  energy: number;
  seconds: number;
  weight: number;
}

/** Blend the song's energy with the average of the four bars in its phrase. */
function barEnergy(song: Song, bar: number, grid: Grid): number {
  const start = bar - grid.phraseOffset(bar);
  let sum = 0;
  let count = 0;
  for (
    let other = Math.max(0, start);
    other < Math.min(song.bars, start + PHRASE_BARS);
    other++
  ) {
    sum += song.energy[other]!;
    count++;
  }
  return 0.7 * (sum / Math.max(1, count)) + 0.3 * (song.energy[bar] ?? 0);
}

function planBars(song: Song, profile: ChartProfile, grid: Grid): BarTarget[] {
  const { perBar, seconds, slots } = song;
  const { range } = profile.tuning;
  const { densityCurve } = profile.reference;
  const first = Math.floor(song.first / perBar);
  const last = Math.floor(song.last / perBar);
  const count = last - first + 1;
  const targets: BarTarget[] = [];
  for (let bar = first; bar <= last; bar++) {
    const tenth = Math.min(9, Math.floor((10 * (bar - first)) / count));
    const energy = barEnergy(song, bar, grid);
    const weight =
      (range[0] + (range[1] - range[0]) * energy) * (densityCurve[tenth] ?? 1);
    targets.push({
      index: bar,
      energy,
      seconds:
        seconds[Math.min(slots, (bar + 1) * perBar)]! -
        seconds[Math.min(slots, bar * perBar)]!,
      weight,
    });
  }
  return targets;
}

function phraseSalience(
  slot: number,
  song: Song,
  grid: Grid,
  salience: Float32Array,
): number {
  const { perBar } = song;
  const bar = Math.floor(slot / perBar);
  const within = slot % perBar;
  const start = bar - grid.phraseOffset(bar);
  let sum = 0;
  let count = 0;
  for (let other = Math.max(0, start); other < start + PHRASE_BARS; other++) {
    const at = other * perBar + within;
    if (at >= song.slots) break;
    sum += salience[at]!;
    count++;
  }
  return sum / Math.max(1, count);
}

/** Score admissible slots once; each density trial reuses the same musical priorities. */
function slotPriorities(
  song: Song,
  profile: ChartProfile,
  grid: Grid,
  bars: BarTarget[],
): Float64Array {
  const { difficulty, tuning } = profile;
  const ranked = bars.map((bar) => bar.energy).sort((a, b) => b - a);
  const gate =
    tuning.sixteenths >= 1
      ? -1
      : (ranked[Math.floor(tuning.sixteenths * ranked.length)] ?? 2);
  const salience = Float32Array.from(song.low, (low, slot) =>
    Math.max(
      low,
      song.mid[slot]!,
      song.tone[slot]!,
      tuning.hats * song.high[slot]!,
    ),
  );
  const priorities = new Float64Array(song.slots);
  for (const bar of bars) {
    const fast = bar.energy > gate;
    const from = Math.max(song.first + 1, bar.index * song.perBar);
    const to = Math.min(song.last, (bar.index + 1) * song.perBar);
    for (let slot = from; slot < to; slot++) {
      const level = grid.levelOf(slot);
      if (level === "X" || (level === "S" && !fast)) continue;
      const mean = phraseSalience(slot, song, grid, salience);
      // A strong repeating onset lets a faint onset carry the same rhythm.
      if (salience[slot]! < (mean >= 0.6 ? 0.5 : 1) * tuning.floor) continue;
      const weakBeat =
        difficulty === "Easy" &&
        ((slot % song.perBar) / song.slotsPerBeat) % 2 === 1;
      const weight = tuning.levels[level] * (weakBeat ? 0.72 : 1);
      priorities[slot] = (0.45 * salience[slot]! + 0.55 * mean) * weight;
    }
  }
  return priorities;
}

function hasCloseRow(
  slot: number,
  song: Song,
  chosen: ReadonlySet<number>,
  minimumGap: number,
): boolean {
  const { seconds } = song;
  for (const direction of DIRECTIONS) {
    for (
      let near = slot + direction;
      near >= 0 && near < song.slots;
      near += direction
    ) {
      const gap = direction * (seconds[near]! - seconds[slot]!);
      if (gap >= minimumGap) break;
      if (chosen.has(near)) return true;
    }
  }
  return false;
}

/** Slide the four-beat window across the proposed step, reusing the previous row count. */
function exceedsDensity(
  slot: number,
  chosen: ReadonlySet<number>,
  perBar: number,
  limits: readonly number[],
): boolean {
  const first = slot - perBar + 1;
  let rows = 1;
  for (let at = Math.max(0, first); at <= slot; at++)
    rows += Number(chosen.has(at));
  for (let start = first; start <= slot; start++) {
    if (rows > limits[Math.max(0, start)]!) return true;
    rows += Number(chosen.has(start + perBar)) - Number(chosen.has(start));
  }
  return false;
}

function burstLength(
  slot: number,
  song: Song,
  grid: Grid,
  chosen: ReadonlySet<number>,
): number {
  let length = 1;
  for (const direction of DIRECTIONS) {
    for (
      let at = slot, next = slot + direction;
      next >= 0 && next < song.slots;
      next += direction
    ) {
      const gap = grid.beatGap(at, next);
      if (gap >= 0.4) break;
      if (chosen.has(next)) {
        length++;
        at = next;
      } else if (gap >= 0.3) break;
    }
  }
  return length;
}

interface Candidate {
  slot: number;
  rank: number;
}

interface ChartRhythm {
  song: Song;
  grid: Grid;
  profile: ChartProfile;
  priorities: Float64Array;
  limits: number[];
}

function bestCandidate(
  candidates: readonly Candidate[],
  score: (candidate: Candidate) => number,
): number {
  let index = 0;
  let best = score(candidates[0]!);
  for (let at = 1; at < candidates.length; at++) {
    const value = score(candidates[at]!);
    if (value > best) {
      best = value;
      index = at;
    }
  }
  return index;
}

function fillBar(
  bar: number,
  target: number,
  plan: ChartRhythm,
  chosen: Set<number>,
): void {
  const {
    song,
    grid,
    priorities,
    limits,
    profile: { tuning },
  } = plan;
  const { perBar, slotsPerBeat } = song;
  const from = bar * perBar;
  const to = Math.min(song.slots, from + perBar);
  const candidates: Candidate[] = [];
  let count = 0;
  for (let slot = from; slot < to; slot++) {
    if (chosen.has(slot)) count++;
    else if (priorities[slot]! > 0) {
      // A step two bars back nudges the ranking toward a repeating rhythm.
      const repeat = chosen.has(slot - 2 * perBar) ? 1.4 : 1;
      candidates.push({ slot, rank: priorities[slot]! * repeat });
    }
  }
  candidates.sort((a, b) => b.rank - a.rank || a.slot - b.slot);
  const score = ({ slot, rank }: Candidate): number =>
    grid.levelOf(slot) === "E" &&
    (chosen.has(slot - slotsPerBeat) || chosen.has(slot + slotsPerBeat))
      ? rank * tuning.runs
      : rank;
  while (count < target && candidates.length > 0) {
    const index = bestCandidate(candidates, score);
    const { slot } = candidates.splice(index, 1)[0]!;
    if (hasCloseRow(slot, song, chosen, tuning.gap)) continue;
    if (exceedsDensity(slot, chosen, perBar, limits)) continue;
    if (burstLength(slot, song, grid, chosen) > tuning.burst) continue;
    chosen.add(slot);
    count++;
  }
}

/** On a straight grid, a sixteenth needs the step it leads into. */
function removeIsolatedSixteenths(
  plan: ChartRhythm,
  base: ReadonlySet<number>,
  chosen: Set<number>,
): void {
  const { song, grid } = plan;
  if (song.slotsPerBeat !== 4) return;
  for (const slot of [...chosen].sort((a, b) => a - b)) {
    if (grid.levelOf(slot) !== "S" || base.has(slot)) continue;
    let next = slot + 1;
    while (
      next < song.slots &&
      grid.beatGap(slot, next) < 0.4 &&
      !chosen.has(next)
    )
      next++;
    if (grid.beatGap(slot, next) >= 0.4 || next >= song.slots)
      chosen.delete(slot);
  }
}

function fillChart(
  plan: ChartRhythm,
  bars: BarTarget[],
  base: ReadonlySet<number>,
  scaledRows: number,
  norm: number,
): Set<number> {
  const { first, last } = plan.song;
  const chosen = new Set(
    [...base].filter((slot) => slot >= first && slot <= last),
  );
  chosen.add(first);
  chosen.add(last);
  // What rounding a bar's rows leaves over goes to the next bar.
  let carry = 0;
  for (const bar of bars) {
    const exact = ((scaledRows * bar.weight) / norm) * bar.seconds + carry;
    const target = Math.round(exact);
    carry = clamp(exact - target, -0.5, 0.5);
    fillBar(bar.index, target, plan, chosen);
  }
  removeIsolatedSixteenths(plan, base, chosen);
  return chosen;
}

/** Build the stepped rhythm using the published density and the song's onsets. */
export function chooseRhythm(
  song: Song,
  profile: ChartProfile,
  base: ReadonlySet<number>,
): number[] {
  const { tuning, jumpShare } = profile;
  const grid = rhythmGrid(song);
  const bars = planBars(song, profile, grid);
  const span = song.seconds[song.last]! - song.seconds[song.first]!;
  const bpm =
    (60 * (song.last - song.first)) / song.slotsPerBeat / Math.max(1, span);
  const rowsPerSecond =
    (tuning.nps * clamp(Math.sqrt(bpm / 135), 0.85, 1.15)) / (1 + jumpShare);
  const norm =
    bars.reduce((sum, bar) => sum + bar.weight * bar.seconds, 0) /
    Math.max(1e-9, span);
  const limits = Array.from(song.seconds, (from, slot) => {
    const window =
      song.seconds[Math.min(song.slots, slot + song.perBar)]! - from;
    return Math.max(2, Math.floor(tuning.cap * window));
  });
  const plan = {
    song,
    grid,
    profile,
    priorities: slotPriorities(song, profile, grid, bars),
    limits,
  };
  // Where the music leaves fewer places to step than the aim, raise the aim and try again.
  let scale = 1;
  let chosen = fillChart(plan, bars, base, rowsPerSecond, norm);
  for (let round = 0; round < 3; round++) {
    const actual = (chosen.size - 1) / Math.max(1, span);
    if (Math.abs(actual / rowsPerSecond - 1) < 0.03) break;
    scale = clamp((scale * rowsPerSecond) / actual, 0.4, 2.5);
    chosen = fillChart(plan, bars, base, scale * rowsPerSecond, norm);
  }
  return [...chosen].sort((a, b) => a - b);
}
