/**
 * Presentation camera (12A). Cosmetic only: the simulation never reads it.
 * A larger map is shown whole at a smaller zoom. "Follow keepers" frames
 * the living keepers instead, between that whole-arena zoom and 1.
 */
export interface CameraFrame {
  /** Centre, world units. */
  x: number;
  y: number;
  /** View units per world unit: 1 shows 1600 × 900 world units. */
  zoom: number;
}
export const VIEW_WIDTH = 1600,
  VIEW_HEIGHT = 900;
export type ViewSize = { width: number; height: number };
const DEFAULT_VIEW: ViewSize = { width: VIEW_WIDTH, height: VIEW_HEIGHT };
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
/** The zoom that shows the whole arena. */
export const fitZoom = (size: ViewSize, viewport = DEFAULT_VIEW) =>
  Math.min(viewport.width / size.width, viewport.height / size.height);
export const wholeArena = (
  size: ViewSize,
  viewport = DEFAULT_VIEW,
): CameraFrame => ({
  x: size.width / 2,
  y: size.height / 2,
  zoom: fitZoom(size, viewport),
});
/**
 * Frame the points (keeper centres) with a margin: zoom in until they fill
 * the view, never past 1 and never out past the whole arena, and keep the
 * view inside the arena.
 */
export function followKeepers(
  size: ViewSize,
  points: readonly { x: number; y: number }[],
  margin = { x: 260, y: 200 },
  viewport = DEFAULT_VIEW,
): CameraFrame {
  const fit = fitZoom(size, viewport);
  if (!points.length) return wholeArena(size, viewport);
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  for (const p of points) {
    left = Math.min(left, p.x);
    right = Math.max(right, p.x);
    top = Math.min(top, p.y);
    bottom = Math.max(bottom, p.y);
  }
  const zoom = clamp(
    Math.min(
      viewport.width / (right - left + 2 * margin.x),
      viewport.height / (bottom - top + 2 * margin.y),
    ),
    fit,
    Math.max(fit, 1),
  );
  const halfWidth = Math.min(size.width, viewport.width / zoom) / 2,
    halfHeight = Math.min(size.height, viewport.height / zoom) / 2;
  return {
    x: clamp((left + right) / 2, halfWidth, size.width - halfWidth),
    y: clamp((top + bottom) / 2, halfHeight, size.height - halfHeight),
    zoom,
  };
}
/** Move `from` a share `k` (0–1) of the way to `to`. */
export function easeFrame(
  from: CameraFrame,
  to: CameraFrame,
  k: number,
): CameraFrame {
  return {
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k,
    zoom: from.zoom + (to.zoom - from.zoom) * k,
  };
}
/** A canvas point given as fractions (0–1) of its box, in world units. */
export function canvasToWorld(
  frame: CameraFrame,
  u: number,
  v: number,
  viewport = DEFAULT_VIEW,
): { x: number; y: number } {
  return {
    x: frame.x + ((u - 0.5) * viewport.width) / frame.zoom,
    y: frame.y + ((v - 0.5) * viewport.height) / frame.zoom,
  };
}
