import type { Machine } from "./machine.js";
import {
  PARTS,
  HEIGHT,
  WIDTH,
  partSize,
  type Body,
  type Part,
  type PartKind,
} from "./machine-parts.js";
import {
  UNIT,
  atmosphere,
  bodyKind,
  isDynamic,
  materialOf,
  clampVelocity,
  quant,
  type Material,
} from "./machine-motion.js";
import {
  air,
  fire,
  has,
  isBlowing,
  near,
  sign,
  switchedOn,
} from "./machine-power.js";
import {
  contactPart,
  type BodyStep,
  type PartContact,
} from "./machine-contact.js";

function animalVelocity(m: Machine, b: Body, p: Part, kind: PartKind): number {
  const seek = m.parts.find((q) =>
    kind === "cat" ? q.kind === "mouse" || q.kind === "fish" : q.kind === "cat",
  );
  const target = seek && (m.bodies.find((body) => body.id === seek.id) ?? seek);
  let direction = sign(p);
  if (target && near(target, b, 170, 65))
    direction =
      (Math.sign(target.x - b.x) || direction) * (kind === "mouse" ? -1 : 1);
  return direction * (kind === "cat" ? 1.2 : 1.6);
}

function magnetPulls(m: Machine, b: Body, q: Part): boolean {
  return q.kind === "magnet" && switchedOn(m, q) && near(q, b, 110, 110);
}

function triggerNearbyPart(m: Machine, b: Body, q: Part): void {
  if (q.kind === "glove" && has(m, q.id) && near(q, b, 47, 25))
    b.vx = sign(q) * 9;
  if (q.kind === "rocket" && near(q, b, 30, 35)) fire(m, q.id);
}

function accelerations(m: Machine, b: Body, p: Part, material: Material) {
  const kind = bodyKind(p);
  const field = atmosphere(kind, m.air, m.gravity);
  let ax = 0;
  let ay = field.acceleration / UNIT;
  const magnetic = kind === "ball" || kind === "bowling";
  for (const q of m.parts) {
    if (q.id === b.id) continue;
    if (isBlowing(m, q) && air(q, b))
      ax += (sign(q) * 0.65) / Math.sqrt(material.mass);
    if (magnetic && magnetPulls(m, b, q)) {
      const distance = Math.max(1, Math.hypot(q.x - b.x, q.y - b.y));
      ax += ((q.x - b.x) / distance) * 1.1;
      ay += ((q.y - b.y) / distance) * 1.1;
    }
    triggerNearbyPart(m, b, q);
  }
  if (kind === "rocket" && has(m, p.id)) ay = -1;
  const limit = (value: number) => clampVelocity(value, field.terminal / UNIT);
  b.vx = limit(b.vx + ax);
  b.vy = limit(b.vy + ay);
  return { gravity: ay, limit };
}

function motion(
  m: Machine,
  b: Body,
  p: Part,
  surfaces: readonly PartContact[],
) {
  const kind = bodyKind(p);
  const material = materialOf(kind);
  const { width, height } = p.kind === "popper" ? PARTS[kind] : partSize(p);
  const animal = kind === "mouse" || kind === "cat";
  if (animal) b.vx = animalVelocity(m, b, p, kind);
  const { gravity, limit } = accelerations(m, b, p, material);
  const step: BodyStep = {
    oldX: b.x,
    oldY: b.y,
    body: b,
    rx: width / 2,
    ry: height / 2,
    material,
    animal,
    gravity,
    limit,
  };
  // Vertical sweeps retain the DOS contact tick; moving sideways subdivides travel near incline edges.
  const steps = Math.max(1, Math.ceil(Math.abs(b.vx) / 5));
  for (let i = 0; i < steps; i++) {
    step.oldX = b.x;
    step.oldY = b.y;
    b.x += b.vx / steps;
    b.y += b.vy / steps;
    for (const contact of surfaces) {
      if (contact.part.id !== p.id && contactPart(m, step, contact)) return;
    }
  }
  b.x = quant(b.x);
  b.y = quant(b.y);
  b.vx = limit(b.vx);
  b.vy = limit(b.vy);
}

/** Part sizes are fixed for the tick, including while a seesaw or gate changes state. */
export function moveBodies(m: Machine, parts: ReadonlyMap<number, Part>): void {
  const surfaces = m.parts
    .filter((part) => !isDynamic(part))
    .map((part) => {
      const { width, height } = partSize(part);
      return { part, w: width / 2, h: height / 2 };
    });
  for (const body of m.bodies) {
    // Objects which have left the workshop stop integrating; rewind puts them back.
    if (!outsideBench(body, 320))
      motion(m, body, parts.get(body.id)!, surfaces);
  }
}

export const outsideBench = (b: Body, margin: number): boolean =>
  b.x < -margin ||
  b.x > WIDTH + margin ||
  b.y < -margin ||
  b.y > HEIGHT + margin;

export function transfer(m: Machine, a: Body, b: Body, pa: Part, pb: Part) {
  const ka = bodyKind(pa),
    kb = bodyKind(pb),
    ma = materialOf(ka),
    mb = materialOf(kb);
  const distance = Math.hypot(a.x - b.x, a.y - b.y);
  const radius =
    (Math.min(PARTS[ka].width, PARTS[ka].height) +
      Math.min(PARTS[kb].width, PARTS[kb].height)) /
    2;
  if (distance >= radius) return;
  const nx = distance ? (b.x - a.x) / distance : 1,
    ny = distance ? (b.y - a.y) / distance : 0;
  const speed = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny,
    total = ma.mass + mb.mass,
    depth = radius - distance;
  a.x = quant(a.x - (depth * nx * mb.mass) / total);
  a.y = quant(a.y - (depth * ny * mb.mass) / total);
  b.x = quant(b.x + (depth * nx * ma.mass) / total);
  b.y = quant(b.y + (depth * ny * ma.mass) / total);
  if (speed <= 0) return;
  const impulse = (speed * (1 + Math.min(ma.bounce, mb.bounce) / 256)) / total;
  const aMax = atmosphere(ka, m.air, m.gravity).terminal / UNIT;
  const bMax = atmosphere(kb, m.air, m.gravity).terminal / UNIT;
  a.vx = clampVelocity(a.vx - impulse * mb.mass * nx, aMax);
  a.vy = clampVelocity(a.vy - impulse * mb.mass * ny, aMax);
  b.vx = clampVelocity(b.vx + impulse * ma.mass * nx, bMax);
  b.vy = clampVelocity(b.vy + impulse * ma.mass * ny, bMax);
}
