/**
 * The chart lab's listening band: a box on the frequency axis that starts out covering all of it. It splits the song
 * in three parts, below the band, the band and above it, and each can be muted, so one instrument's register can be
 * heard against the charts. Pure geometry here, in
 * axis pixels; the page converts to and from hertz and drives the audio filters.
 */

/** A span along the frequency axis, in pixels, `from` below `to`. */
export interface Span {
  readonly from: number;
  readonly to: number;
}

/** What a press on the axis takes hold of: an edge of the box, or the whole box. */
export type Grab = "low" | "high" | "move";

/** The narrowest box, in pixels: still easy to take hold of. */
export const MIN_WIDTH = 8;

/**
 * What a press at `x` grabs: an edge within `reach` pixels of it, else the box when the press is inside it, else the
 * nearer edge (a press beside the box pulls that edge out to it).
 */
export function grabAt(span: Span, x: number, reach = 6): Grab {
  const low = Math.abs(x - span.from);
  const high = Math.abs(x - span.to);
  const inside = x > span.from && x < span.to;
  if (inside && low > reach && high > reach) return "move";
  return low <= high ? "low" : "high";
}

/**
 * The box after dragging from `x0` to `x`, kept inside `[min, max]`. An edge follows the pointer but stops
 * `MIN_WIDTH` short of the other edge; the whole box moves without changing width.
 */
export function dragSpan(
  start: Span,
  grab: Grab,
  x0: number,
  x: number,
  min: number,
  max: number,
): Span {
  const clamp = (value: number) => Math.max(min, Math.min(max, value));
  if (grab === "low")
    return {
      from: Math.max(min, Math.min(clamp(x), start.to - MIN_WIDTH)),
      to: start.to,
    };
  if (grab === "high")
    return {
      from: start.from,
      to: Math.min(max, Math.max(clamp(x), start.from + MIN_WIDTH)),
    };
  const width = start.to - start.from;
  const from = Math.max(min, Math.min(max - width, start.from + (x - x0)));
  return { from, to: from + width };
}

/** Whether the box covers the whole axis `[min, max]` (to the pixel): nothing is turned down then. */
export function coversAll(span: Span, min: number, max: number): boolean {
  return span.from <= min + 1 && span.to >= max - 1;
}

/** Which of the three parts of the spectrum are heard: below the band, the band itself, above it. */
export interface Hear {
  readonly below: boolean;
  readonly band: boolean;
  readonly above: boolean;
}

/** The part of the spectrum a point on the axis lies in, for a band drawn at `span`. */
export function partAt(span: Span, x: number): keyof Hear {
  return x < span.from ? "below" : x > span.to ? "above" : "band";
}

/** The gain of each path of the playback graph: the untouched song, and the three parts the band splits it into. */
export interface PartsMix {
  readonly dry: number;
  readonly below: number;
  readonly band: number;
  readonly above: number;
}

/**
 * The mix for a listening band. Without a band, or with all three parts heard, the song plays untouched. Otherwise
 * each part is on or off; a part that is off is silent.
 */
export function partsMix(on: boolean, hear: Hear): PartsMix {
  if (!on || (hear.below && hear.band && hear.above))
    return { dry: 1, below: 0, band: 0, above: 0 };
  return {
    dry: 0,
    below: hear.below ? 1 : 0,
    band: hear.band ? 1 : 0,
    above: hear.above ? 1 : 0,
  };
}
