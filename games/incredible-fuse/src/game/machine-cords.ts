import type { Body, Part } from "./machine-parts.js";
import type { MachineLink } from "./machine-links.js";

interface Point {
  x: number;
  y: number;
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const quant = (n: number) => Math.round(n * 512) / 512;
function distanceToLine(point: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const fraction = Math.max(
    0,
    Math.min(
      1,
      ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return distance(point, { x: a.x + fraction * dx, y: a.y + fraction * dy });
}
const guide = (part: Part) =>
  part.kind === "pulley" || part.kind === "eyelet" || part.kind === "rope";
interface CordFrame {
  parts: Map<number, Part>;
  bodies: Map<number, Body>;
  links: MachineLink[];
  broken: number[];
  active: number[];
  mass: (part: Part) => number;
  activate: (id: number) => void;
  maximum: (part: Part) => number;
}
/** A cut refers to the index in the immutable run layout's link array.
 * Rewind keeps the build intact and clears the cut list. */
export function stepCords(frame: CordFrame): void {
  const neighbors = new Map<number, number[]>();
  const position = (id: number) => frame.bodies.get(id) ?? frame.parts.get(id)!;
  const shears = frame.active
    .map((id) => frame.parts.get(id)!)
    .filter((p) => p.kind === "scissors");
  for (const [i, link] of frame.links.entries()) {
    if (link.kind !== "rope" || frame.broken.includes(i)) continue;
    if (
      shears.some(
        (p) =>
          distanceToLine(position(p.id), position(link.a), position(link.b)) <
          18,
      )
    ) {
      frame.broken.push(i);
      continue;
    }
    for (const [start, end] of [
      [link.a, link.b],
      [link.b, link.a],
    ] as const) {
      const adjacent = neighbors.get(start) ?? [];
      adjacent.push(end);
      neighbors.set(start, adjacent);
    }
  }
  // A pulley lets cord slide between legs, so constrain total path length.
  // Branches at a non-guide attachment are two separately tied lengths.
  for (const [first, next] of neighbors) {
    if (guide(frame.parts.get(first)!) && next.length === 2) continue;
    for (const second of next) {
      const path = [first, second];
      let previous = first,
        current = second;
      while (
        guide(frame.parts.get(current)!) &&
        neighbors.get(current)?.length === 2
      ) {
        const after = neighbors.get(current)!.find((id) => id !== previous)!;
        if (path.includes(after)) break;
        path.push(after);
        previous = current;
        current = after;
      }
      if (first >= current) continue;
      let length = 0,
        rest = 0;
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1]!,
          b = path[i]!;
        rest += distance(frame.parts.get(a)!, frame.parts.get(b)!);
        length += distance(position(a), position(b));
      }
      const excess = length - rest;
      if (excess <= 1 / 512) continue;
      const ends = [
        { id: first, next: second },
        { id: current, next: path.at(-2)! },
      ];
      const attachments = ends.flatMap(({ id, next }) => {
        const body = frame.bodies.get(id);
        if (!body) return [];
        const neighbor = position(next),
          segment = Math.max(1 / 512, distance(body, neighbor));
        const dx = (neighbor.x - body.x) / segment,
          dy = (neighbor.y - body.y) / segment;
        return [
          { body, dx, dy, inverse: 1 / frame.mass(frame.parts.get(id)!) },
        ];
      });
      if (!attachments.length) continue;
      const total = attachments.reduce((sum, a) => sum + a.inverse, 0);
      const outward = attachments.reduce(
        (sum, a) => sum - a.dx * a.body.vx - a.dy * a.body.vy,
        0,
      );
      for (const { body, dx, dy, inverse } of attachments) {
        const share = inverse / total,
          correction = excess * share;
        const max = frame.maximum(frame.parts.get(body.id)!);
        const velocity = (n: number) => quant(Math.max(-max, Math.min(max, n)));
        body.x = quant(body.x + dx * correction);
        body.y = quant(body.y + dy * correction);
        if (outward > 0) {
          body.vx = velocity(body.vx + outward * share * dx);
          body.vy = velocity(body.vy + outward * share * dy);
        }
      }
      for (const id of path) frame.activate(id);
    }
  }
}
