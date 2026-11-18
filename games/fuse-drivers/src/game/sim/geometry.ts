import type { Point, Segment } from "./track.js";

export function closestOnSegment(p: Point, s: Segment): Point {
  const dx = s.b.x - s.a.x,
    dy = s.b.y - s.a.y;
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / len2),
        );
  return { x: s.a.x + t * dx, y: s.a.y + t * dy };
}
