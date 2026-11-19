import type { Machine, MachineCommand, WorkshopBlueprint } from "./machine.js";
import { evaluateObjective } from "./machine-goals.js";
import { isLinkKind, validLinks, type MachineLink } from "./machine-links.js";
import { atmosphere, bodyKind, isDynamic, UNIT } from "./machine-motion.js";
import {
  FREE_WORKSHOP,
  getPuzzle,
  HEIGHT,
  WIDTH,
  isPartKind,
  partSize,
  canRotate,
  type Part,
  type PartKind,
  type Body,
} from "./machine-parts.js";

export const MAX_UNDO = 8;
export const MAX_PARTS = 128;
export const MAX_PART_ID = 0x7fffffff;
export const within = (
  value: unknown,
  low: number,
  high: number,
): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= low &&
  value <= high;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const position = (raw: Record<string, unknown>) =>
  within(raw.x, 0, WIDTH) && within(raw.y, 0, HEIGHT);
function validLinkCommand(
  raw: Record<string, unknown>,
  fields: number,
): boolean {
  return (
    fields === 4 &&
    isLinkKind(raw.kind) &&
    within(raw.a, 1, MAX_PART_ID) &&
    within(raw.b, 1, MAX_PART_ID) &&
    raw.a !== raw.b
  );
}

export function validCommand(raw: unknown): raw is MachineCommand {
  if (!record(raw)) return false;
  const fields = Object.keys(raw).length;
  switch (raw.type) {
    case "undo":
    case "run":
    case "rewind":
      return fields === 1;
    case "remove":
    case "flip":
    case "rotate":
      return fields === 2 && within(raw.id, 1, MAX_PART_ID);
    case "connect":
    case "disconnect":
      return validLinkCommand(raw, fields);
    case "place":
    case "move":
      return (
        fields === 4 &&
        position(raw) &&
        (raw.type === "place"
          ? isPartKind(raw.kind)
          : within(raw.id, 1, MAX_PART_ID))
      );
    default:
      return false;
  }
}

export const nextAfter = (parts: Part[]) =>
  1 + parts.reduce((largest, p) => Math.max(largest, p.id), 0);
export function fits(
  { width, height }: { width: number; height: number },
  x: number,
  y: number,
): boolean {
  return (
    x >= width / 2 &&
    y >= height / 2 &&
    x <= WIDTH - width / 2 &&
    y <= HEIGHT - height / 2
  );
}
export const CLOCK_DENOMINATOR = 5041 * 8 * 20;

const lattice = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value * UNIT) &&
  value >= min &&
  value <= max;
const PART_KEYS = new Set([
  "id",
  "kind",
  "x",
  "y",
  "flip",
  "fixed",
  "width",
  "height",
  "rotation",
  "mobile",
]);

function optionalFields(
  part: Record<string, unknown>,
  kind: PartKind,
): boolean {
  if (part.width !== undefined && !within(part.width, 1, 320)) return false;
  if (part.height !== undefined && !within(part.height, 1, 320)) return false;
  if (
    part.rotation !== undefined &&
    (!(part.rotation === 0 || part.rotation === 1) || !canRotate(kind))
  )
    return false;
  return part.mobile === undefined || typeof part.mobile === "boolean";
}

function validParts(raw: unknown): raw is Part[] {
  if (!Array.isArray(raw) || raw.length > MAX_PARTS) return false;
  const ids = new Set<number>();
  for (const p of raw) {
    if (
      !record(p) ||
      !within(p.id, 1, MAX_PART_ID) ||
      ids.has(p.id) ||
      !isPartKind(p.kind) ||
      !lattice(p.x, -160, WIDTH + 160) ||
      !lattice(p.y, -160, HEIGHT + 160) ||
      typeof p.flip !== "boolean" ||
      typeof p.fixed !== "boolean" ||
      !optionalFields(p, p.kind) ||
      Object.keys(p).some((key) => !PART_KEYS.has(key))
    )
      return false;
    ids.add(p.id);
  }
  return true;
}
export function validWorkshopBlueprint(raw: unknown): raw is WorkshopBlueprint {
  return (
    record(raw) &&
    Object.keys(raw).length === 4 &&
    within(raw.air, 0, 255) &&
    within(raw.gravity, 0, 512) &&
    validParts(raw.parts) &&
    validLinks(raw.parts, raw.links)
  );
}
function matchesLayout(
  parts: Part[],
  puzzle: number,
  imported: boolean,
): boolean {
  if (imported) return puzzle === FREE_WORKSHOP;
  const spec = getPuzzle(puzzle),
    fixed = parts.filter((p) => p.fixed);
  if (
    fixed.length !== spec.parts.length ||
    !spec.parts.every((p) =>
      fixed.some(
        (q) =>
          p.id === q.id &&
          p.kind === q.kind &&
          p.x === q.x &&
          p.y === q.y &&
          p.flip === q.flip &&
          p.rotation === q.rotation,
      ),
    )
  )
    return false;
  const counts = new Map<PartKind, number>();
  for (const p of parts) {
    if (
      p.width !== undefined ||
      p.height !== undefined ||
      p.mobile !== undefined
    )
      return false;
    if (p.fixed) continue;
    if (
      !fits(partSize(p), p.x, p.y) ||
      !Number.isInteger(p.x / 2) ||
      !Number.isInteger(p.y / 2)
    )
      return false;
    const count = (counts.get(p.kind) ?? 0) + 1;
    if (count > (spec.stock[p.kind] ?? 0)) return false;
    counts.set(p.kind, count);
  }
  return true;
}
type Header = Pick<
  Machine,
  "puzzle" | "imported" | "mode" | "tick" | "phase" | "air" | "gravity"
>;

const MODES = new Set<unknown>(["build", "running", "failed", "solved"]);

function validHeader(
  raw: Record<string, unknown>,
): raw is Record<string, unknown> & Header {
  return (
    Object.keys(raw).length === 15 &&
    within(raw.puzzle, 0, FREE_WORKSHOP) &&
    typeof raw.imported === "boolean" &&
    MODES.has(raw.mode) &&
    within(raw.tick, 0, MAX_PART_ID) &&
    within(raw.phase, 0, CLOCK_DENOMINATOR - 1) &&
    within(raw.air, 0, 255) &&
    within(raw.gravity, 0, 512) &&
    (raw.imported || (raw.air === 67 && raw.gravity === 272))
  );
}

const bounded = (value: unknown, max: number): value is unknown[] =>
  Array.isArray(value) && value.length <= max;

function validBroken(raw: unknown, links: MachineLink[]): raw is number[] {
  return (
    bounded(raw, links.length) &&
    raw.every(
      (i) => within(i, 0, links.length - 1) && links[i]!.kind === "rope",
    ) &&
    new Set(raw).size === raw.length
  );
}

function validActive(
  raw: unknown,
  parts: ReadonlyMap<number, Part>,
): raw is number[] {
  return (
    bounded(raw, parts.size) &&
    raw.every((id) => within(id, 1, MAX_PART_ID) && parts.has(id)) &&
    new Set(raw).size === raw.length
  );
}

function validBody(b: unknown): b is Body {
  return (
    record(b) &&
    Object.keys(b).length === 5 &&
    within(b.id, 1, MAX_PART_ID) &&
    lattice(b.x, -1024, WIDTH + 1024) &&
    lattice(b.y, -1024, HEIGHT + 1024) &&
    lattice(b.vx, -24, 24) &&
    lattice(b.vy, -24, 24)
  );
}

function validBodies(
  raw: unknown,
  header: Header,
  parts: ReadonlyMap<number, Part>,
  active: number[],
): raw is Body[] {
  if (!bounded(raw, parts.size)) return false;
  if (header.mode === "build") return raw.length === 0;
  const bodyIds = new Set<number>();
  for (const b of raw) {
    if (!validBody(b) || bodyIds.has(b.id)) return false;
    const part = parts.get(b.id);
    if (
      !part ||
      !(isDynamic(part) || (part.kind === "popper" && active.includes(part.id)))
    )
      return false;
    const maximum =
      atmosphere(bodyKind(part), header.air, header.gravity).terminal / UNIT;
    if (Math.abs(b.vx) > maximum || Math.abs(b.vy) > maximum) return false;
    bodyIds.add(b.id);
  }
  for (const part of parts.values())
    if (isDynamic(part) && !bodyIds.has(part.id)) return false;
  return true;
}

function validSolved(
  header: Header,
  active: number[],
  bodies: Body[],
): boolean {
  if (header.mode !== "solved") return true;
  if (header.puzzle === FREE_WORKSHOP) return false;
  const spec = getPuzzle(header.puzzle);
  return spec.objective
    ? evaluateObjective(spec.objective, {
        tick: header.tick,
        active,
        bodies,
      }) === "solved"
    : spec.targets.every((id) => active.includes(id));
}

function validUndo(
  raw: Record<string, unknown> & Header,
  parts: Part[],
  nextId: number,
): boolean {
  if (
    !bounded(raw.undo, MAX_UNDO) ||
    !Array.isArray(raw.undoLinks) ||
    raw.undoLinks.length !== raw.undo.length
  )
    return false;
  const undoLinks = raw.undoLinks;
  const fixed = parts.filter((p) => p.fixed);
  return raw.undo.every((entry, i) => {
    if (!validParts(entry) || entry.some((p) => p.fixed || p.id >= nextId))
      return false;
    const layout = [...fixed, ...entry];
    return (
      validParts(layout) &&
      matchesLayout(layout, raw.puzzle, raw.imported) &&
      validLinks(layout, undoLinks[i])
    );
  });
}

function validBuildActivity(
  raw: Header,
  broken: number[],
  active: number[],
): boolean {
  return (
    raw.mode !== "build" ||
    (raw.tick === 0 &&
      raw.phase === 0 &&
      broken.length === 0 &&
      active.length === 0)
  );
}

export function validMachine(raw: unknown): raw is Machine {
  if (!record(raw) || !validHeader(raw) || !validParts(raw.parts)) return false;
  const { parts, puzzle, imported } = raw;
  if (
    !within(raw.nextPartId, nextAfter(parts), MAX_PART_ID + 1) ||
    !matchesLayout(parts, puzzle, imported) ||
    !validLinks(parts, raw.links)
  )
    return false;
  const ids = new Map(parts.map((part) => [part.id, part]));
  if (!validBroken(raw.broken, raw.links) || !validActive(raw.active, ids))
    return false;
  if (!validBuildActivity(raw, raw.broken, raw.active)) return false;
  return (
    validBodies(raw.bodies, raw, ids, raw.active) &&
    validSolved(raw, raw.active, raw.bodies) &&
    validUndo(raw, parts, raw.nextPartId)
  );
}
