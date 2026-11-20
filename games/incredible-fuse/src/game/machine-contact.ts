import type { Machine } from "./machine.js";
import { type Body, type Part, type PartKind } from "./machine-parts.js";
import { UNIT, quant, type Material } from "./machine-motion.js";
import { cord, touch } from "./machine-mechanisms.js";
import { conveyorSpeed, fire, has, near, sign } from "./machine-power.js";

const inert = new Set<PartKind>([
  "rope",
  "eyelet",
  "pulley",
  "driveBelt",
  "lens",
  "solar",
  "bulb",
  "candle",
  "rocket",
  "magnet",
  "fan",
  "windmill",
  "motor",
  "generator",
  "gear",
  "mouseWheel",
  "lamp",
  "glove",
  "bellows",
  "scissors",
  "popper",
  "bell",
  "cage",
  "fish",
  "monkey",
  "spark",
]);
export interface BodyStep {
  body: Body;
  oldX: number;
  oldY: number;
  rx: number;
  ry: number;
  animal: boolean;
  gravity: number;
  material: Material;
  limit(value: number): number;
}

export interface PartContact {
  part: Part;
  w: number;
  h: number;
}

function passHorizontalPipe(
  m: Machine,
  step: BodyStep,
  contact: PartContact,
): void {
  const { body: b, oldX, rx } = step;
  const { part: q, w, h } = contact;
  const entersLeft = b.vx > 0 && oldX <= q.x - w && b.x + rx >= q.x - w;
  const entersRight = b.vx < 0 && oldX >= q.x + w && b.x - rx <= q.x + w;
  if ((entersLeft || entersRight) && Math.abs(b.y - q.y) <= h) {
    fire(m, q.id);
    b.x = q.x + (entersLeft ? 1 : -1) * (w + rx + 1);
    b.y = q.y;
    b.vy = 0;
  }
}

function slotThroughPipe(
  m: Machine,
  step: BodyStep,
  contact: PartContact,
): void {
  const { body: b, rx, ry } = step;
  const { part: q, w, h } = contact;
  const { oldY } = step;
  if (q.kind === "pipe" && w > h) {
    passHorizontalPipe(m, step, contact);
    return;
  }
  if (
    b.vy < 0 ||
    oldY > q.y - h ||
    b.y + ry < q.y - h ||
    Math.abs(b.x - q.x) > w
  )
    return;
  fire(m, q.id);
  const turn = q.kind === "elbow";
  b.x = q.x + (turn ? sign(q) * (w + rx + 1) : 0);
  b.y = q.y + h + ry + 1;
  b.vx = turn ? sign(q) * 6 : 0;
  b.vy = turn ? 1 : Math.max(2, b.vy);
}

function capture(m: Machine, b: Body, q: Part): true {
  fire(m, q.id);
  b.x = q.x;
  b.y = q.y;
  b.vx = b.vy = 0;
  return true;
}

function tipSeesaw(m: Machine, b: Body, q: Part, w: number) {
  if (q.kind !== "seesaw" || has(m, q.id)) return;
  fire(m, q.id);
  for (const other of m.bodies)
    if (
      other !== b &&
      near(other, q, w, 36) &&
      (other.x - q.x) * (b.x - q.x) < 0
    )
      other.vy = -11;
}

function landOnFlat(
  m: Machine,
  step: BodyStep,
  contact: PartContact,
  flat: boolean,
) {
  const { body: b, gravity, material } = step;
  const { part: q } = contact;
  const { oldY } = step;
  const settle = flat && oldY === b.y && b.vy <= gravity;
  b.vy = settle
    ? 0
    : -Math.max(0, Math.floor((b.vy * UNIT * material.bounce) / 256) - 64) /
      UNIT;
  if (q.kind === "belt") {
    const speed = conveyorSpeed(m, q);
    if (speed !== 0) fire(m, q.id);
    b.vx = speed;
    return;
  }
  b.vx = quant(b.vx * 0.98);
  if (flat) b.x = Math.floor(b.x) + (b.vx < 0 ? 0 : 511 / UNIT);
}

function land(
  m: Machine,
  step: BodyStep,
  contact: PartContact,
  surface: { top: number; slope: number; inclined: boolean; flat: boolean },
) {
  const { body: b, ry, limit } = step;
  const { part: q, w } = contact;
  const { top, slope, inclined, flat } = surface;
  b.y = top - ry + (flat ? 511 / UNIT : 0);
  if (q.kind === "spring" || q.kind === "jack") {
    fire(m, q.id);
    b.vy = -Math.max(9, Math.abs(b.vy) * 1.25);
    return;
  }
  if (inclined) {
    b.vx = limit(b.vx + ((b.vy - b.vx * slope) * slope) / (1 + slope * slope));
    b.vy = limit(b.vx * slope);
    tipSeesaw(m, b, q, w);
    return;
  }
  landOnFlat(m, step, contact, flat);
}

function deflect(step: BodyStep, contact: PartContact): void {
  const { body: b, rx, ry, material } = step;
  const { part: q, w, h } = contact;
  const { oldX, oldY } = step;
  if (Math.abs(b.y - q.y) >= h + ry - 1) return;
  if (oldX + rx <= q.x - w + 0.5 && b.x + rx >= q.x - w) {
    b.x = q.x - w - rx;
    b.vx = (-Math.abs(b.vx) * material.bounce) / 256;
  } else if (oldX - rx >= q.x + w - 0.5 && b.x - rx <= q.x + w) {
    b.x = q.x + w + rx;
    b.vx = (Math.abs(b.vx) * material.bounce) / 256;
  } else if (oldY - ry >= q.y + h - 0.5 && b.y - ry <= q.y + h) {
    b.y = q.y + h + ry;
    b.vy = (Math.abs(b.vy) * material.bounce) / 256;
  }
}

const flatSurfaces = new Set<PartKind>(["wall", "timber", "shelf"]);

function crossedTop(
  step: BodyStep,
  contact: PartContact,
  surface: { top: number; oldTop: number; halfWidth: number; flat: boolean },
): boolean {
  const { body: b, oldY, ry } = step;
  const { top, oldTop, halfWidth, flat } = surface;
  const crossed = flat ? Math.floor(b.y + ry) > top : b.y + ry >= top;
  return (
    Math.abs(b.x - contact.part.x) <= halfWidth &&
    b.vy >= -0.02 &&
    oldY + ry <= oldTop + 1.5 &&
    crossed
  );
}

function solidContact(m: Machine, step: BodyStep, contact: PartContact) {
  const { body: b, rx, oldX } = step;
  const { part: q, w, h } = contact;
  if (
    inert.has(q.kind) ||
    ((q.kind === "gate" || q.kind === "domino") && has(m, q.id))
  )
    return;
  const inclined = q.kind === "ramp" || q.kind === "seesaw";
  const slope = inclined
    ? (sign(q) * (q.kind === "seesaw" && has(m, q.id) ? -1 : 1) * (2 * h - 6)) /
      (2 * w)
    : 0;
  const top = inclined ? q.y + (b.x - q.x) * slope - 2 : q.y - h;
  const oldTop = inclined ? q.y + (oldX - q.x) * slope - 2 : top;
  const flat = flatSurfaces.has(q.kind);
  const halfWidth = w + (inclined ? 0 : rx / 2);
  if (crossedTop(step, contact, { top, oldTop, halfWidth, flat })) {
    land(m, step, contact, { top, slope, inclined, flat });
  } else if (!inclined) {
    deflect(step, contact);
  }
}

/** True when a cage or basket ends the body's sweep without further quantisation. */
export function contactPart(
  m: Machine,
  step: BodyStep,
  contact: PartContact,
): boolean {
  const { body: b, rx, ry, animal } = step;
  const { part: q, w, h } = contact;
  const { oldY } = step;
  if (!near(b, q, w + rx + 1, h + ry + 1)) return false;
  if (touch.has(q.kind) || cord.has(q.kind)) fire(m, q.id);
  if (q.kind === "cage" && animal) return capture(m, b, q);
  if (q.kind === "basket") {
    if (
      b.vy >= 0 &&
      Math.abs(b.x - q.x) <= w &&
      oldY <= q.y &&
      b.y + ry >= q.y - h
    )
      return capture(m, b, q);
    return false;
  }
  if (q.kind === "elbow" || q.kind === "pipe")
    slotThroughPipe(m, step, contact);
  else solidContact(m, step, contact);
  return false;
}
