/** Phrase-level voice selection. Never receives chart rows, user taps, or song-specific rules. */
import { createTiming } from "../engine/timing.js";
import { FRAMES_PER_SECOND as FPS, type Spectra } from "./spectrum.js";
import {
  detectRhythm,
  type RhythmOptions,
  type RhythmResult,
} from "./rhythm.js";

/** Attack / pitch-change agreement corrected for accidental overlap in a dense stream. */
export function melodicEvidence(
  result: RhythmResult,
  start: number,
  end: number,
): number {
  const attacks = result.events.filter((e) => e.time >= start && e.time < end);
  const changes = result.pitchChanges.filter(
    (e) => e.time >= start && e.time < end,
  );
  if (changes.length < 3 || !attacks.length || end <= start) return 0;
  // Four analysis frames cover the uncertainty in the two independently estimated features.
  const radius = 4 / FPS;
  let covered = 0,
    previous = start;
  for (const attack of attacks) {
    const lo = Math.max(start, attack.time - radius),
      hi = Math.min(end, attack.time + radius);
    covered += Math.max(0, hi - Math.max(previous, lo));
    previous = Math.max(previous, hi);
  }
  const chance = covered / (end - start);
  const observed =
    changes.filter((p) =>
      attacks.some((a) => Math.abs(a.time - p.time) <= radius),
    ).length / changes.length;
  return chance < 1 ? Math.max(0, (observed - chance) / (1 - chance)) : 0;
}

export function selectRhythmLayers(
  lead: RhythmResult,
  bass: RhythmResult,
): RhythmResult {
  const options = lead.options,
    timing = createTiming(options.timing);
  const result: RhythmResult = {
    ...lead,
    options: { ...options, layer: "auto", lowHz: 40 },
    pitch: new Float32Array(lead.pitch.length),
    novelty: new Float32Array(lead.novelty.length),
    events: [],
    pitchChanges: [],
    layers: [],
  };
  const first = Math.floor(timing.beatAt(options.start) / 4) * 4;
  const last = timing.beatAt(options.end);
  for (let beat = first; beat <= last; beat += 4) {
    const start = Math.max(options.start, timing.timeAt(beat));
    const end = Math.min(options.end, timing.timeAt(beat + 4));
    if (end <= start) continue;
    const contextStart = Math.max(options.start, timing.timeAt(beat - 2));
    const contextEnd = Math.min(options.end, timing.timeAt(beat + 6));
    const confidence = melodicEvidence(lead, contextStart, contextEnd);
    const bassConfidence = melodicEvidence(bass, contextStart, contextEnd);
    const inPhrase = (event: { time: number }) =>
      event.time >= start &&
      (event.time < end || (end === options.end && event.time === end));
    // Prefer an articulated melodic phrase; otherwise follow the independent bass attacks.
    // A bass-less recording falls back to lead, rather than manufacturing a pulse.
    const bassPresent = bass.events.some(inPhrase);
    const layer =
      (confidence >= 0.15 && confidence + 0.1 >= bassConfidence) || !bassPresent
        ? "lead"
        : "bass";
    const selected = layer === "lead" ? lead : bass;
    result.layers!.push({ start, end, layer, confidence });
    result.events.push(...selected.events.filter(inPhrase));
    result.pitchChanges.push(...selected.pitchChanges.filter(inPhrase));
    const lo = Math.max(0, Math.ceil(start * FPS) - result.fromFrame);
    const hi = Math.min(
      result.pitch.length,
      Math.ceil(end * FPS) - result.fromFrame,
    );
    result.pitch.set(selected.pitch.subarray(lo, hi), lo);
    result.novelty.set(selected.novelty.subarray(lo, hi), lo);
  }
  // A voice change must not introduce a pair closer than the selected musical spacing.
  const kept: typeof result.events = [];
  for (const event of result.events) {
    const old = kept.at(-1);
    if (
      old &&
      timing.beatAt(event.time) - timing.beatAt(old.time) < options.minGapBeats
    )
      continue;
    kept.push(event);
  }
  result.events = kept;
  return result;
}

export function detectRhythmLayers(
  spectra: Pick<Spectra, "frames" | "detail" | "detailBins">,
  options: RhythmOptions,
): RhythmResult {
  if (options.layer !== "auto") return detectRhythm(spectra, options);
  if (
    ![options.start, options.end].every(Number.isFinite) ||
    options.start < 0 ||
    options.end <= options.start
  )
    throw Error(
      "Choose a valid time span, frequency band and detection settings.",
    );
  // Choose voices from the same full-song context in the lab and offline generator.
  // Cropping first changes chance overlap at phrase edges and can select a different instrument.
  const analysis = {
    ...options,
    start: 0,
    end: Math.max(1 / FPS, (spectra.frames - 1) / FPS),
  };
  const lead = detectRhythm(spectra, {
    ...analysis,
    mode: "melody",
    lowHz: 400,
    highHz: 4000,
  });
  const bass = detectRhythm(spectra, {
    ...analysis,
    mode: "melody",
    lowHz: 40,
    highHz: 250,
  });
  const result = selectRhythmLayers(lead, bass);
  const from = Math.max(0, Math.floor(options.start * FPS) - result.fromFrame);
  const to = Math.min(
    result.pitch.length,
    Math.ceil(options.end * FPS) - result.fromFrame + 1,
  );
  const inSpan = (event: { time: number }) =>
    event.time >= options.start && event.time <= options.end;
  return {
    ...result,
    options: { ...result.options, start: options.start, end: options.end },
    fromFrame: result.fromFrame + from,
    pitch: result.pitch.slice(from, to),
    novelty: result.novelty.slice(from, to),
    events: result.events.filter(inSpan),
    pitchChanges: result.pitchChanges.filter(inSpan),
    layers: result.layers
      ?.filter((p) => p.end > options.start && p.start < options.end)
      .map((p) => ({
        ...p,
        start: Math.max(p.start, options.start),
        end: Math.min(p.end, options.end),
      })),
  };
}
