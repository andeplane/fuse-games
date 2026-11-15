/** Full detected line for Challenge: fine SSC quantisation, with no density/stream suppression. */
import type { Timing } from "../engine/timing.js";
import type { RhythmEvent } from "./rhythm.js";

export const RHYTHM_TICKS_PER_BEAT = 48;
export function completeRhythmEvents(
  events: readonly RhythmEvent[],
  timing: Timing,
  start: number,
  end: number,
): RhythmEvent[] {
  const grid = new Map<number, RhythmEvent>();
  const firstTick = Math.ceil(
    timing.beatAt(start) * RHYTHM_TICKS_PER_BEAT - 1e-9,
  );
  const lastTick = Math.floor(
    timing.beatAt(end) * RHYTHM_TICKS_PER_BEAT + 1e-9,
  );
  if (firstTick > lastTick) return [];
  for (const event of events) {
    if (event.time < start || event.time > end) continue;
    const center = Math.round(
      timing.beatAt(event.time) * RHYTHM_TICKS_PER_BEAT,
    );
    const ticks = [center - 1, center, center + 1].map((tick) =>
      Math.max(firstTick, Math.min(lastTick, tick)),
    );
    // At a stop, beatAt is constant but timeAt(stopBeat) means BEFORE the pause.
    // Choose in audio time so the first post-stop onset goes to the next tick.
    const tick = ticks.reduce((best, next) =>
      Math.abs(timing.timeAt(next / RHYTHM_TICKS_PER_BEAT) - event.time) <
      Math.abs(timing.timeAt(best / RHYTHM_TICKS_PER_BEAT) - event.time)
        ? next
        : best,
    );
    const beat = tick / RHYTHM_TICKS_PER_BEAT;
    const time = timing.timeAt(beat);
    const tickSeconds =
      60 / timing.bpmAt(timing.beatAt(event.time)) / RHYTHM_TICKS_PER_BEAT;
    // Interior stop events cannot be represented by ordinary SSC rows; never move them across the pause.
    if (Math.abs(time - event.time) > tickSeconds + 1e-9) continue;
    if (time < start || time > end) continue;
    const previous = grid.get(beat);
    if (!previous || event.strength > previous.strength)
      grid.set(beat, { ...event, time });
  }
  return [...grid.values()].sort((a, b) => a.time - b.time);
}
