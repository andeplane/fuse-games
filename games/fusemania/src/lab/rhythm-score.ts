/** Evaluation only: authored charts never enter the audio detector. */
export interface TimingScore {
  reference: number;
  detected: number;
  matched: number;
  precision: number;
  recall: number;
  f1: number;
  meanErrorMs: number | null;
  meanSignedErrorMs: number | null;
}

/** Sorted one-to-one, maximum-cardinality matching in a fixed tolerance. Simultaneous panels count once. */
export function scoreRhythm(
  reference: readonly number[],
  detected: readonly number[],
  tolerance: number,
): TimingScore {
  if (
    !Number.isFinite(tolerance) ||
    tolerance < 0 ||
    ![...reference, ...detected].every(Number.isFinite)
  )
    throw new Error("Invalid timing comparison");
  const a = [...new Set(reference)].sort((x, y) => x - y);
  const b = [...new Set(detected)].sort((x, y) => x - y);
  let i = 0,
    j = 0,
    matched = 0,
    absolute = 0,
    signed = 0;
  while (i < a.length && j < b.length) {
    const delta = b[j]! - a[i]!;
    if (delta < -tolerance - 1e-9) j++;
    else if (delta > tolerance + 1e-9) i++;
    else {
      matched++;
      absolute += Math.abs(delta);
      signed += delta;
      i++;
      j++;
    }
  }
  const precision = b.length ? matched / b.length : 0;
  const recall = a.length ? matched / a.length : 0;
  return {
    reference: a.length,
    detected: b.length,
    matched,
    precision,
    recall,
    f1:
      precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    meanErrorMs: matched ? (absolute / matched) * 1000 : null,
    meanSignedErrorMs: matched ? (signed / matched) * 1000 : null,
  };
}
