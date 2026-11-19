/** Physical connections follow part IDs through edits, simulation and rewind. */
export type LinkKind = "wire" | "belt" | "rope";

export interface MachineLink {
  kind: LinkKind;
  a: number;
  b: number;
}

interface LinkablePart {
  id: number;
  kind: string;
}

interface Point {
  x: number;
  y: number;
}

export const MAX_LINKS = 96;

const kinds: readonly LinkKind[] = ["wire", "belt", "rope"];
export const isLinkKind = (value: unknown): value is LinkKind =>
  value === "wire" || value === "belt" || value === "rope";

/** Capacity is local to a part. An electrical appliance takes a single plug;
 * a switch can feed two appliances, as can the original switched outlet. */
const sockets: Readonly<Record<LinkKind, ReadonlyMap<string, number>>> = {
  wire: new Map([
    ["switch", 2],
    ["outlet", 2],
    ["solar", 2],
    ["generator", 2],
    ["motor", 1],
    ["gate", 1],
    ["bulb", 1],
    ["lamp", 1],
    ["fan", 1],
    ["magnet", 1],
    ["plunger", 2],
  ]),
  belt: new Map([
    ["motor", 1],
    ["gear", 2],
    ["belt", 1],
    ["driveBelt", 2],
    ["monkey", 1],
    ["jack", 1],
    ["mouseWheel", 1],
    ["generator", 1],
    ["windmill", 1],
    ["fan", 1],
  ]),
  rope: new Map([
    ["rope", 2],
    ["pulley", 2],
    ["eyelet", 2],
    ["seesaw", 2],
    ["balloon", 1],
    ["heart", 1],
    ["crate", 1],
    ["bell", 1],
    ["basket", 1],
    ["monkey", 1],
    ["cage", 1],
    ["glove", 1],
    ["scissors", 1],
    ["bellows", 1],
    ["switch", 1],
    ["outlet", 1],
    ["plunger", 1],
    ["popper", 1],
    ["lamp", 1],
    ["jack", 1],
  ]),
};

export function socketsFor(partKind: string): readonly LinkKind[] {
  return kinds.filter((kind) => sockets[kind].has(partKind));
}

export function canonicalLink(
  kind: LinkKind,
  a: number,
  b: number,
): MachineLink {
  return a < b ? { kind, a, b } : { kind, a: b, b: a };
}

export const compareLinks = (left: MachineLink, right: MachineLink): number =>
  kinds.indexOf(left.kind) - kinds.indexOf(right.kind) ||
  left.a - right.a ||
  left.b - right.b;

export function canLink(
  parts: readonly LinkablePart[],
  links: readonly MachineLink[],
  link: MachineLink,
): boolean {
  if (
    !isLinkKind(link.kind) ||
    !Number.isSafeInteger(link.a) ||
    !Number.isSafeInteger(link.b) ||
    link.a < 1 ||
    link.b < 1 ||
    link.a === link.b ||
    links.length >= MAX_LINKS
  )
    return false;
  const first = parts.find((part) => part.id === link.a);
  const second = parts.find((part) => part.id === link.b);
  if (!first || !second) return false;
  let firstUsed = 0;
  let secondUsed = 0;
  for (const edge of links) {
    if (edge.kind !== link.kind) continue;
    const touchesFirst = edge.a === link.a || edge.b === link.a;
    const touchesSecond = edge.a === link.b || edge.b === link.b;
    if (touchesFirst && touchesSecond) return false;
    if (touchesFirst) firstUsed++;
    if (touchesSecond) secondUsed++;
  }
  return (
    firstUsed < (sockets[link.kind].get(first.kind) ?? 0) &&
    secondUsed < (sockets[link.kind].get(second.kind) ?? 0)
  );
}

/** A canonical checkpoint has no reversed pairs or duplicate/overfilled sockets. */
export function validLinks(
  parts: readonly LinkablePart[],
  raw: unknown,
): raw is MachineLink[] {
  if (!Array.isArray(raw) || raw.length > MAX_LINKS) return false;
  const accepted: MachineLink[] = [];
  for (const candidate of raw) {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate) ||
      Object.keys(candidate).length !== 3
    )
      return false;
    const { kind, a, b } = candidate as Partial<MachineLink>;
    if (
      !isLinkKind(kind) ||
      typeof a !== "number" ||
      typeof b !== "number" ||
      a >= b
    )
      return false;
    const link = { kind, a, b };
    const previous = accepted.at(-1);
    if (
      (previous && compareLinks(previous, link) >= 0) ||
      !canLink(parts, accepted, link)
    )
      return false;
    accepted.push(link);
  }
  return true;
}

export function connectedNeighbors(
  links: readonly MachineLink[],
  kind: LinkKind,
  seed: number,
): number[] {
  const result: number[] = [];
  for (const link of links) {
    if (link.kind !== kind) continue;
    if (link.a === seed) result.push(link.b);
    else if (link.b === seed) result.push(link.a);
  }
  return result.sort((a, b) => a - b);
}

/** The engine explicitly converts between channels at motors and generators.
 * Traversing a wire alone cannot turn an unrelated drive shaft or pull a cord. */
export function linkedParts(
  links: readonly MachineLink[],
  kind: LinkKind,
  seed: number,
): number[] {
  const seen = new Set([seed]);
  for (const id of seen) {
    for (const neighbor of connectedNeighbors(links, kind, id))
      seen.add(neighbor);
  }
  return [...seen].sort((a, b) => a - b);
}

/** Centers come from the most recent simulated view. The other end determines
 * which side of a rocker or guide the rope meets as the connected body moves. */
export function socketPosition(
  part: LinkablePart & Point & { flip?: boolean },
  kind: LinkKind,
  center: Point = part,
  other?: Point,
): Point {
  const face = part.flip ? -1 : 1;
  const side = other ? (other.x < center.x ? -1 : 1) : face;
  switch (kind) {
    case "wire":
      return { x: center.x - face * 12, y: center.y + 6 };
    case "belt":
      return {
        x: center.x + (part.kind === "belt" ? face * 36 : 0),
        y: center.y,
      };
    case "rope":
      switch (part.kind) {
        case "seesaw":
          return { x: center.x + side * 38, y: center.y - 3 };
        case "pulley":
          return { x: center.x + side * 9, y: center.y };
        case "eyelet":
          return { ...center };
        case "rope":
          return {
            x: center.x,
            y: center.y + (other && other.y < center.y ? -39 : 39),
          };
        case "balloon":
        case "heart":
          return { x: center.x, y: center.y + 16 };
        default:
          return { x: center.x, y: center.y - 8 };
      }
  }
}
