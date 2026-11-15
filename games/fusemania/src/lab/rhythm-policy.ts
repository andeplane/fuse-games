/** Audio evidence and difficulty selection shared by the lab and Decisions eval. */
import type { Timing } from "../engine/timing.js";
import type { RhythmEvent } from "./rhythm.js";
import type { LabChart } from "./charts.js";

export const LEVELS = ["Easy", "Medium", "Hard", "Challenge"] as const;
export type Level = (typeof LEVELS)[number];
export interface RhythmPolicy {
  targetNps: number;
  peakNps2s: number;
  subdivisions: number[];
  maxStreamBeats: number;
  recoveryBeats: number;
}
export type PolicyLadder = Record<Level, RhythmPolicy>;

/** Keep the highest four meters; align missing lower charts to the upper end of our ladder. */
export function mapReferences(charts: readonly LabChart[]) {
  return [...charts]
    .filter((c) => c.source !== "taps")
    .sort((a, b) => a.chart.meter - b.chart.meter || a.key.localeCompare(b.key))
    .slice(-4)
    .map((chart, i, selected) => ({
      level: LEVELS[LEVELS.length - selected.length + i]!,
      chart,
    }));
}

export function rhythmStats(
  events: readonly RhythmEvent[],
  timing: Timing,
  start: number,
  end: number,
) {
  const times = events
    .map((e) => e.time)
    .filter((t) => t >= start && t <= end)
    .sort((a, b) => a - b);
  const gaps = times
    .slice(1)
    .map((t, i) => timing.beatAt(t) - timing.beatAt(times[i]!));
  const rates: number[] = [];
  for (let t = start; t + 2 <= end + 1e-9; t += 2)
    rates.push(times.filter((x) => x >= t && x < t + 2).length / 2);
  if (!rates.length) rates.push(times.length / 2);
  let left = 0,
    peak = 0;
  for (let right = 0; right < times.length; right++) {
    while (times[right]! - times[left]! >= 2) left++;
    peak = Math.max(peak, (right - left + 1) / 2);
  }
  const sorted = [...rates].sort((a, b) => a - b);
  const q = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
  return {
    duration: end - start,
    bpm: timing.bpmAt(timing.beatAt(start)),
    eventNps: times.length / Math.max(1, end - start),
    rate2s: { median: q(0.5), p90: q(0.9), peak },
    attackShare: events.length
      ? events.filter((e) => e.kind === "attack").length / events.length
      : 0,
    gapBeatShare: Object.fromEntries(
      [1, 2, 3, 4, 6, 8].map((s) => [
        s,
        gaps.length
          ? gaps.filter((g) => Math.abs(g - 1 / s) < 0.025).length / gaps.length
          : 0,
      ]),
    ),
  };
}

export function validateLadder(value: unknown): PolicyLadder {
  if (!value || typeof value !== "object")
    throw Error("Missing difficulty policy");
  let previous: RhythmPolicy | undefined;
  for (const level of LEVELS) {
    const p = (value as Record<string, RhythmPolicy>)[level];
    if (
      !p ||
      ![p.targetNps, p.peakNps2s, p.maxStreamBeats, p.recoveryBeats].every(
        Number.isFinite,
      ) ||
      p.targetNps < 0.25 ||
      p.targetNps > 24 ||
      (previous &&
        (p.targetNps < previous.targetNps ||
          p.peakNps2s < previous.peakNps2s ||
          p.maxStreamBeats < previous.maxStreamBeats ||
          p.recoveryBeats > previous.recoveryBeats ||
          !previous.subdivisions.every((s) => p.subdivisions.includes(s)))) ||
      p.peakNps2s < p.targetNps ||
      p.peakNps2s > 32 ||
      p.maxStreamBeats < 1 ||
      p.maxStreamBeats > 128 ||
      p.recoveryBeats < 0 ||
      p.recoveryBeats > 32 ||
      !Array.isArray(p.subdivisions) ||
      !p.subdivisions.length ||
      !p.subdivisions.every((s) => [1, 2, 3, 4, 6, 8].includes(s))
    )
      throw Error(`Invalid ${level} policy`);
    previous = p;
  }
  return value as PolicyLadder;
}

/** Select candidates on a beat grid, then enforce row budget, peak rate and stream/recovery bounds. */
export function selectPolicyEvents(
  events: readonly RhythmEvent[],
  timing: Timing,
  start: number,
  end: number,
  policy: RhythmPolicy,
): RhythmEvent[] {
  const candidates = new Map<number, RhythmEvent>();
  for (const event of events) {
    const beat = timing.beatAt(event.time);
    const snapped = policy.subdivisions
      .map((s) => Math.round(beat * s) / s)
      .sort(
        (a, b) =>
          Math.abs(timing.timeAt(a) - event.time) -
          Math.abs(timing.timeAt(b) - event.time),
      )[0]!;
    const time = timing.timeAt(snapped);
    if (time < start || time > end || Math.abs(time - event.time) > 0.045)
      continue;
    const previous = candidates.get(time);
    if (!previous || previous.strength < event.strength)
      candidates.set(time, { ...event, time });
  }
  const budget = Math.max(0, Math.floor((end - start) * policy.targetNps));
  const ranked = [...candidates.values()].sort(
    (a, b) => b.strength - a.strength || a.time - b.time,
  );
  const kept: RhythmEvent[] = [];
  const cap = Math.max(1, Math.floor(2 * policy.peakNps2s));
  const blockOf = (time: number) => Math.floor((time - start) / 2);
  const blockCandidates = new Map<number, number>();
  const blockKept = new Map<number, number>();
  for (const event of ranked)
    blockCandidates.set(
      blockOf(event.time),
      (blockCandidates.get(blockOf(event.time)) ?? 0) + 1,
    );
  for (const event of ranked) {
    if (kept.length >= budget) break;
    const block = blockOf(event.time);
    // Share the budget across active phrases instead of spending it all on the loudest section.
    const quota = Math.min(
      cap,
      Math.max(
        1,
        Math.round(
          (budget * (blockCandidates.get(block) ?? 0)) /
            Math.max(1, ranked.length),
        ),
      ),
    );
    if ((blockKept.get(block) ?? 0) >= quota) continue;
    const nearby = [
      ...kept.filter((e) => Math.abs(e.time - event.time) < 2),
      event,
    ].sort((a, b) => a.time - b.time);
    let left = 0,
      fits = true;
    for (let right = 0; right < nearby.length; right++) {
      while (nearby[right]!.time - nearby[left]!.time >= 2) left++;
      if (right - left + 1 > cap) {
        fits = false;
        break;
      }
    }
    if (fits) {
      kept.push(event);
      blockKept.set(block, (blockKept.get(block) ?? 0) + 1);
    }
  }
  const out: RhythmEvent[] = [];
  let runStart = 0,
    previousBeat = -Infinity,
    recoverUntil = -Infinity,
    recoverTime = -Infinity,
    previousTime = -Infinity;
  for (const event of kept.sort((a, b) => a.time - b.time)) {
    const beat = timing.beatAt(event.time);
    const secondsPerBeat = 60 / timing.bpmAt(beat);
    // A stop is elapsed rest even while the beat clock stands still.
    if (event.time - previousTime > Math.max(0.2, secondsPerBeat * 0.5) + 1e-6)
      previousBeat = -Infinity;
    previousTime = event.time;
    if (beat < recoverUntil && event.time < recoverTime) continue;
    if (beat - previousBeat > 0.500001) runStart = beat;
    if (beat - runStart > policy.maxStreamBeats) {
      recoverUntil = beat + policy.recoveryBeats;
      recoverTime = event.time + policy.recoveryBeats * secondsPerBeat;
      previousBeat = -Infinity;
      continue;
    }
    out.push(event);
    previousBeat = beat;
  }
  return out;
}
