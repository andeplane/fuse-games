import type { Machine } from "./machine.js";
import { FREE_WORKSHOP, type Part } from "./machine-parts.js";
import { linkedParts } from "./machine-links.js";

export const sign = (p: Part) => (p.flip ? -1 : 1);
export const near = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  dx: number,
  dy: number,
) => Math.abs(a.x - b.x) <= dx && Math.abs(a.y - b.y) <= dy;
export const has = (m: Machine, id: number) => m.active.includes(id);
export function fire(m: Machine, id: number) {
  if (!has(m, id)) m.active.push(id);
}
export const air = (p: Part, target: { x: number; y: number }) => {
  const reach = (target.x - p.x) * sign(p);
  return reach >= 0 && reach <= 175 && Math.abs(target.y - p.y) <= 40;
};
export function switchedOn(m: Machine, p: Part): boolean {
  const plugged = m.links.some(
    (l) => l.kind === "wire" && (l.a === p.id || l.b === p.id),
  );
  return plugged ? has(m, p.id) : m.puzzle !== FREE_WORKSHOP;
}
export function isBlowing(m: Machine, p: Part): boolean {
  if (m.mode === "build") return false;
  return p.kind === "fan"
    ? switchedOn(m, p)
    : p.kind === "bellows" && has(m, p.id);
}
export function conveyorSpeed(m: Machine, p: Part): number {
  if (m.mode === "build" || p.kind !== "belt") return 0;
  const shaft = linkedParts(m.links, "belt", p.id);
  const motor = m.parts.find((q) => q.kind === "motor" && shaft.includes(q.id));
  if (motor) return has(m, motor.id) ? -sign(motor) * 8 : 0;
  if (shaft.length > 1)
    return m.parts.some(
      (q) => q.id !== p.id && shaft.includes(q.id) && has(m, q.id),
    )
      ? sign(p) * 4
      : 0;
  return m.puzzle === FREE_WORKSHOP ? 0 : sign(p) * 4;
}
