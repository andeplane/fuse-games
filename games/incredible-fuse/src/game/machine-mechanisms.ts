import { air, fire, has, isBlowing, near, sign } from "./machine-power.js";
import type { Machine } from "./machine.js";
import {
  FREE_WORKSHOP,
  partSize,
  type Part,
  type PartKind,
} from "./machine-parts.js";
import { connectedNeighbors, type LinkKind } from "./machine-links.js";

const driver = new Set<PartKind>([
  "windmill",
  "mouseWheel",
  "motor",
  "monkey",
  "gear",
  "generator",
  "driveBelt",
  "belt",
]);
export const cord = new Set<PartKind>(["rope", "pulley", "eyelet"]);
const pulled = new Set<PartKind>([
  "bell",
  "switch",
  "outlet",
  "plunger",
  "bellows",
  "popper",
  "glove",
  "jack",
  "monkey",
  "scissors",
]);
const electric = new Set<PartKind>([
  "switch",
  "outlet",
  "plunger",
  "solar",
  "generator",
]);
const powered = new Set<PartKind>([
  "bulb",
  "motor",
  "lamp",
  "gate",
  "fan",
  "magnet",
]);
export const touch = new Set<PartKind>([
  ...pulled,
  "lamp",
  "spark",
  "domino",
  "fish",
  "rocket",
]);
function coupled(a: Part, b: Part, margin: number): boolean {
  const sa = partSize(a),
    sb = partSize(b);
  return near(
    a,
    b,
    (sa.width + sb.width) / 2 + margin,
    (sa.height + sb.height) / 2 + margin,
  );
}
function drivenBy(
  m: Machine,
  part: Part,
  activeAtStart: ReadonlyMap<number, Part>,
  kind: LinkKind,
  sources: Set<PartKind>,
): boolean {
  return connectedNeighbors(m.links, kind, part.id).some((id) => {
    const source = activeAtStart.get(id);
    return source !== undefined && sources.has(source.kind);
  });
}

function cordPulls(
  m: Machine,
  part: Part,
  activeAtStart: ReadonlyMap<number, Part>,
): boolean {
  if (!pulled.has(part.kind) && !cord.has(part.kind) && part.kind !== "seesaw")
    return false;
  return connectedNeighbors(m.links, "rope", part.id).some(
    (id) =>
      activeAtStart.has(id) &&
      !m.broken.some((index) => {
        const link = m.links[index]!;
        return (
          (link.a === part.id && link.b === id) ||
          (link.b === part.id && link.a === id)
        );
      }),
  );
}

function activatesDirectly(
  m: Machine,
  part: Part,
  activeAtStart: ReadonlyMap<number, Part>,
  mice: ReadonlySet<number>,
): boolean {
  if (
    powered.has(part.kind) &&
    drivenBy(m, part, activeAtStart, "wire", electric)
  )
    return true;
  if (
    part.kind !== "motor" &&
    driver.has(part.kind) &&
    drivenBy(m, part, activeAtStart, "belt", driver)
  )
    return true;
  if (cordPulls(m, part, activeAtStart)) return true;
  if (part.kind === "windmill")
    return m.parts.some((a) => isBlowing(m, a) && air(a, part));
  return (
    part.kind === "mouseWheel" &&
    m.bodies.some((b) => mice.has(b.id) && near(part, b, 65, 50))
  );
}

function drivesAdjacentGear(
  source: Part,
  part: Part,
  implicit: boolean,
): boolean {
  return (
    driver.has(source.kind) &&
    driver.has(part.kind) &&
    part.kind !== "motor" &&
    (implicit || (source.kind === "gear" && part.kind === "gear")) &&
    coupled(source, part, implicit ? 12 : 1)
  );
}

function connectedByProximity(
  source: Part,
  part: Part,
  implicit: boolean,
  cutters: readonly Part[],
) {
  if (drivesAdjacentGear(source, part, implicit)) return true;
  if (!implicit || (!cord.has(source.kind) && !cord.has(part.kind)))
    return false;
  if (
    (!cord.has(part.kind) && !pulled.has(part.kind)) ||
    !coupled(source, part, 14)
  )
    return false;
  const movingCord = cord.has(part.kind) ? part : source;
  return !cutters.some((scissors) => coupled(scissors, movingCord, 8));
}

function inBeam(along: number, source: Part, part: Part): boolean {
  return along >= 0 && along <= 180 && Math.abs(source.y - part.y) <= 24;
}

const lampTargets = new Set<PartKind>(["solar", "lens"]);
const candleTargets = new Set<PartKind>(["rocket", "spark"]);

function radiatesTo(source: Part, part: Part): boolean {
  const along = (part.x - source.x) * sign(source);
  switch (source.kind) {
    case "domino":
      return (
        (part.kind === "domino" || pulled.has(part.kind)) &&
        along > 0 &&
        along <= 56 &&
        Math.abs(source.y - part.y) < 26
      );
    case "spark":
      return near(source, part, 65, 65) && touch.has(part.kind);
    case "lamp":
      return lampTargets.has(part.kind) && inBeam(along, source, part);
    case "lens":
      return part.kind === "candle" && inBeam(along, source, part);
    case "candle":
      return near(source, part, 70, 55) && candleTargets.has(part.kind);
    default:
      return false;
  }
}

function ejectTennisBalls(m: Machine) {
  const existingBodies = new Set(m.bodies.map((body) => body.id));
  for (const part of m.parts) {
    if (
      part.kind !== "popper" ||
      !has(m, part.id) ||
      existingBodies.has(part.id)
    )
      continue;
    m.bodies.push({
      id: part.id,
      x: part.x + sign(part) * 22,
      y: part.y - 16,
      vx: sign(part) * 6,
      vy: -8,
    });
    existingBodies.add(part.id);
  }
}

/** Propagates one link per tick. Fans are read live so newly powered airflow is immediate. */
export function mechanisms(m: Machine) {
  const on = m.parts.filter((p) => has(m, p.id));
  const activeAtStart = new Map(on.map((p) => [p.id, p]));
  const cutters = on.filter((p) => p.kind === "scissors");
  const mice = new Set(
    m.parts.filter((p) => p.kind === "mouse").map((p) => p.id),
  );
  const implicit = m.puzzle !== FREE_WORKSHOP;
  for (const part of m.parts) {
    if (has(m, part.id)) continue;
    if (
      activatesDirectly(m, part, activeAtStart, mice) ||
      on.some(
        (source) =>
          connectedByProximity(source, part, implicit, cutters) ||
          radiatesTo(source, part),
      )
    )
      fire(m, part.id);
  }
  ejectTennisBalls(m);
}
