/** Experimental, untrained rhythm features from the lab's fine spectrum. Times remain unsnapped. */
import {
  BINS_PER_OCTAVE,
  detailBinAt,
  detailHz,
  FRAMES_PER_SECOND as FPS,
  type Spectra,
} from "./spectrum.js";

export interface RhythmRegion {
  start: number;
  end: number;
  lowHz: number;
  highHz: number;
}
export interface RhythmOptions extends RhythmRegion {
  mode: "melody" | "attacks";
  /** 0: strong changes only; 1: include quiet changes. */
  sensitivity: number;
  minGap: number;
}
export interface RhythmEvent {
  time: number;
  hz: number;
  kind: "attack" | "pitch";
  /** Relative evidence, not a calibrated probability. */
  strength: number;
}
export interface RhythmResult {
  options: RhythmOptions;
  fromFrame: number;
  /** Hz per 10 ms frame; 0 means no confident pitched peak. */
  pitch: Float32Array;
  /** Positive spectral change in dB, before peak picking. */
  novelty: Float32Array;
  events: RhythmEvent[];
}

interface Peak {
  bin: number;
  score: number;
  cost: number;
  previous: number;
}
const median = (values: number[]): number => {
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] ?? 0;
};

/**
 * Tracks a small set of competing fundamental-pitch salience ridges with continuity, then finds fresh attacks
 * and persistent semitone changes. A narrow user-selected band supplies the musical line to follow; this is not
 * instrument separation. In attacks mode the same vibrato-tolerant flux is measured over the entire chosen band.
 * Work is bounded by the selected frames × frequency bins; no audio, chart labels or model weights are modified.
 */
export function detectRhythm(
  spectra: Pick<Spectra, "frames" | "detail" | "detailBins">,
  options: RhythmOptions,
): RhythmResult {
  if (
    !Number.isInteger(spectra.frames) ||
    spectra.frames < 1 ||
    !Number.isInteger(spectra.detailBins) ||
    spectra.detailBins < 1 ||
    spectra.detail.length !== spectra.frames * spectra.detailBins ||
    ![
      options.start,
      options.end,
      options.lowHz,
      options.highHz,
      options.sensitivity,
      options.minGap,
    ].every(Number.isFinite) ||
    (options.mode !== "melody" && options.mode !== "attacks") ||
    options.start < 0 ||
    options.end <= options.start ||
    options.lowHz <= 0 ||
    options.highHz <= options.lowHz ||
    options.sensitivity < 0 ||
    options.sensitivity > 1 ||
    options.minGap < 0.03 ||
    options.minGap > 1
  )
    throw new Error(
      "Choose a valid time span, frequency band and detection settings.",
    );

  const from = Math.max(0, Math.floor(options.start * FPS) - 20);
  const to = Math.min(spectra.frames, Math.ceil(options.end * FPS) + 20);
  const count = Math.max(0, to - from);
  const low = Math.max(0, Math.ceil(detailBinAt(options.lowHz)));
  const high = Math.min(
    spectra.detailBins - 1,
    Math.floor(detailBinAt(options.highHz)),
  );
  const result: RhythmResult = {
    options: { ...options },
    fromFrame: from,
    pitch: new Float32Array(count),
    novelty: new Float32Array(count),
    events: [],
  };
  if (!count || high < low) return result;
  const db = (frame: number, bin: number): number => {
    const value =
      spectra.detail[
        Math.max(0, Math.min(spectra.frames - 1, frame)) * spectra.detailBins +
          Math.max(0, Math.min(spectra.detailBins - 1, bin))
      ]!;
    return Number.isFinite(value) ? value : -100;
  };
  const maxima = Array.from({ length: count }, (_, i) => {
    let peak = -100;
    for (let bin = low; bin <= high; bin++)
      peak = Math.max(peak, db(from + i, bin));
    return peak;
  });
  const sorted = [...maxima].sort((a, b) => a - b);
  const floor = Math.max(-85, sorted[Math.floor(count * 0.95)]! - 40);
  const paths: Peak[][] = [];
  // Harmonic summation (a simplified melody-salience front end, not full MELODIA). Harmonics can support a weak or
  // missing fundamental. Their decaying weights make octave subharmonics less attractive than the actual note.
  const salience = new Float32Array(spectra.detailBins);
  const trace = (end: number): void => {
    if (end < 0 || !paths[end]!.length) return;
    let at = paths[end]!.reduce(
      (best, peak, i, peaks) => (peak.cost > peaks[best]!.cost ? i : best),
      0,
    );
    for (let i = end; i >= 0 && at >= 0; i--) {
      const peak = paths[i]![at]!;
      result.pitch[i] = detailHz(peak.bin);
      at = peak.previous;
    }
  };
  for (let i = 0; i < count; i++) {
    const frame = from + i;
    const peaks: Peak[] = [];
    salience.fill(-100);
    let strongest = -100;
    for (
      let bin = Math.max(0, low - 3);
      bin <= Math.min(spectra.detailBins - 1, high + 3);
      bin++
    ) {
      let sum = 0;
      for (let harmonic = 1; harmonic <= 6; harmonic++) {
        const at = bin + BINS_PER_OCTAVE * Math.log2(harmonic);
        if (at >= spectra.detailBins - 1) break;
        const k = Math.floor(at),
          part = at - k;
        const value = db(frame, k) * (1 - part) + db(frame, k + 1) * part;
        if (value > floor)
          sum += 0.8 ** (harmonic - 1) * 10 ** ((value - maxima[i]!) / 20);
      }
      salience[bin] = sum > 0 ? 20 * Math.log10(sum) + maxima[i]! : -100;
      if (bin >= low && bin <= high)
        strongest = Math.max(strongest, salience[bin]!);
    }
    const at = (bin: number) =>
      salience[Math.max(0, Math.min(salience.length - 1, bin))]!;
    for (let bin = low; bin <= high; bin++) {
      const value = at(bin);
      if (
        value <= floor ||
        value < strongest - 18 ||
        value < at(bin - 1) ||
        value <= at(bin + 1)
      )
        continue;
      // Broad noise/transients do not become a pitch just because they have a loudest bin.
      const prominence = value - (at(bin - 3) + at(bin + 3)) / 2;
      if (prominence < 1.5) continue;
      const left = at(bin - 1),
        right = at(bin + 1);
      const curvature = left - 2 * value + right;
      const shift =
        curvature < -1e-6
          ? Math.max(-0.5, Math.min(0.5, (left - right) / (2 * curvature)))
          : 0;
      peaks.push({
        bin: bin + shift,
        score: (value - strongest) / 12,
        cost: 0,
        previous: -1,
      });
    }
    peaks.sort((a, b) => b.score - a.score);
    peaks.length = Math.min(8, peaks.length);
    const previous = paths[i - 1] ?? [];
    for (const peak of peaks) {
      peak.cost = peak.score;
      if (!previous.length) continue;
      let best = -Infinity;
      for (const [j, old] of previous.entries()) {
        const distance = Math.abs(peak.bin - old.bin);
        const cost = old.cost - 0.08 * Math.min(36, distance);
        if (cost > best) {
          best = cost;
          peak.previous = j;
        }
      }
      peak.cost += best;
    }
    if (peaks.length) {
      const best = Math.max(...peaks.map((p) => p.cost));
      for (const peak of peaks) peak.cost -= best;
    } else if (previous.length) trace(i - 1);
    paths.push(peaks);
  }
  trace(count - 1);
  // Five-frame median removes isolated ridge/octave jumps without smoothing away note attacks.
  const rawPitch = result.pitch.slice();
  for (let i = 2; i < count - 2; i++)
    result.pitch[i] = median(Array.from(rawPitch.slice(i - 2, i + 3)));

  for (let i = 2; i < count; i++) {
    const frame = from + i;
    const pitchBin = result.pitch[i]! > 0 ? detailBinAt(result.pitch[i]!) : -1;
    let sum = 0,
      weight = 0;
    const attackHigh =
      options.mode === "melody"
        ? Math.min(spectra.detailBins - 1, high + BINS_PER_OCTAVE * 2)
        : high;
    for (let bin = low; bin <= attackHigh; bin++) {
      const value = db(frame, bin);
      if (value <= floor || value < maxima[i]! - 24) continue;
      if (options.mode === "melody") {
        if (pitchBin < 0) continue;
        const harmonic = Math.round(detailHz(bin) / detailHz(pitchBin));
        if (
          harmonic < 1 ||
          harmonic > 4 ||
          Math.abs(bin - pitchBin - BINS_PER_OCTAVE * Math.log2(harmonic)) > 1.5
        )
          continue;
      }
      // SuperFlux-style reference: small frequency movement (vibrato) is not a fresh attack.
      const reference = Math.max(
        db(frame - 2, bin - 1),
        db(frame - 2, bin),
        db(frame - 2, bin + 1),
      );
      const w = 10 ** ((value - maxima[i]!) / 20);
      sum += Math.max(0, value - reference) * w;
      weight += w;
    }
    result.novelty[i] = weight ? sum / weight : 0;
  }
  const candidates: RhythmEvent[] = [];
  const attackTime = (index: number, hz: number): number => {
    if (!hz || options.mode !== "melody") return (from + index) / FPS;
    const pitchBin = detailBinAt(hz);
    const amplitude = (i: number): number => {
      let sum = 0;
      for (let h = 1; h <= 4; h++) {
        const bin = Math.round(pitchBin + BINS_PER_OCTAVE * Math.log2(h));
        if (bin < spectra.detailBins) sum += 10 ** (db(from + i, bin) / 20) / h;
      }
      return sum;
    };
    const first = Math.max(0, index - 8),
      last = Math.min(count - 1, index + 10);
    const envelope = Array.from({ length: last - first + 1 }, (_, j) =>
      amplitude(first + j),
    );
    const before = Math.min(...envelope.slice(0, index - first + 1));
    const peak = Math.max(...envelope.slice(index - first));
    if (peak - before < peak * 0.15) return (from + index) / FPS;
    // Log flux favours the very first tiny energy rise in a centred window, especially in bass bins. For a sharp
    // attack its half-amplitude crossing is closer to the actual boundary. This is a local heuristic, not phase
    // recovery; preserve the raw novelty curve for comparisons.
    const target = before + (peak - before) * 0.5;
    for (let j = Math.max(1, index - first - 2); j < envelope.length; j++) {
      if (envelope[j - 1]! < target && envelope[j]! >= target) {
        const fraction =
          (target - envelope[j - 1]!) / (envelope[j]! - envelope[j - 1]!);
        return (from + first + j - 1 + fraction) / FPS;
      }
    }
    return (from + index) / FPS;
  };
  const threshold = 1.5 + (1 - options.sensitivity) * 6;
  for (let i = 2; i < count - 2; i++) {
    const strength = result.novelty[i]!;
    const background = median(
      Array.from(
        result.novelty.slice(Math.max(0, i - 15), Math.min(count, i + 16)),
      ),
    );
    if (
      strength < background + threshold ||
      strength <= result.novelty[i - 1]! ||
      strength < result.novelty[i + 1]!
    )
      continue;
    candidates.push({
      time: attackTime(i, result.pitch[i]!),
      hz: result.pitch[i]!,
      kind: "attack",
      strength,
    });
  }
  if (options.mode === "melody") {
    let acceptedBin: number | undefined;
    for (let i = 0; i < count - 4; i++) {
      if (!result.pitch[i]) {
        acceptedBin = undefined;
        continue;
      }
      const next = detailBinAt(result.pitch[i]!);
      // Relative hysteresis, rather than absolute semitone rounding: detuned vibrato can cross a semitone's
      // rounding boundary repeatedly without playing a new note. Require about 75 cents from the accepted pitch.
      if (
        acceptedBin !== undefined &&
        Math.abs(next - acceptedBin) < BINS_PER_OCTAVE / 16
      )
        continue;
      const future = Array.from(result.pitch.slice(i, i + 4));
      const stable = future.every(
        (hz) => hz > 0 && Math.abs(detailBinAt(hz) - next) < 1,
      );
      if (!stable) continue;
      if (acceptedBin !== undefined)
        candidates.push({
          time: (from + i) / FPS,
          hz: result.pitch[i]!,
          kind: "pitch",
          strength: threshold,
        });
      acceptedBin = median(future.map(detailBinAt));
    }
  }
  // Attacks explain pitch changes when they coincide. Keep the strongest event in each minimum-gap neighbourhood.
  candidates.sort(
    (a, b) =>
      b.strength +
        (b.kind === "attack" ? 1 : 0) -
        (a.strength + (a.kind === "attack" ? 1 : 0)) || a.time - b.time,
  );
  const kept: RhythmEvent[] = [];
  for (const event of candidates) {
    if (
      event.time < options.start ||
      event.time > options.end ||
      kept.some((old) => Math.abs(old.time - event.time) < options.minGap)
    )
      continue;
    kept.push(event);
  }
  result.events = kept.sort((a, b) => a.time - b.time);
  return result;
}
