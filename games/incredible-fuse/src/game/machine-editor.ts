import type { Machine, MachineCommand } from "./machine.js";
import { isDynamic } from "./machine-motion.js";
import { canLink, canonicalLink, compareLinks } from "./machine-links.js";
import {
  PARTS,
  canRotate,
  getPuzzle,
  partSize,
  type Body,
  type Part,
  type PartKind,
} from "./machine-parts.js";
import {
  fits,
  MAX_PARTS,
  MAX_PART_ID,
  MAX_UNDO,
  validCommand,
} from "./machine-validation.js";

export function available(m: Machine, kind: PartKind): number {
  return Math.max(
    0,
    (getPuzzle(m.puzzle).stock[kind] ?? 0) -
      m.parts.filter((p) => !p.fixed && p.kind === kind).length,
  );
}
const editable = (m: Machine) => m.parts.filter((p) => !p.fixed);
type PlacementCommand = Extract<MachineCommand, { type: "place" | "move" }>;
const snap = (value: number) => Math.round(value / 2) * 2;
function stockIssue(m: Machine, kind: PartKind): string | undefined {
  if (m.parts.length >= MAX_PARTS) return "The bench holds up to 128 parts.";
  if (m.nextPartId > MAX_PART_ID)
    return "Start a new workshop to add more parts.";
  if (available(m, kind) <= 0) return "No more of this part in the tray.";
}

/** The editor previews the same placement decision the authoritative reducer applies. */
export function placementIssue(
  m: Machine,
  c: PlacementCommand,
): string | undefined {
  if (m.mode !== "build") return "Rewind the machine before editing.";
  if (!validCommand(c)) return "Choose a point inside the workbench.";
  const piece =
    c.type === "move" ? m.parts.find((p) => p.id === c.id) : undefined;
  if (c.type === "move" && !piece) return "This part has been removed.";
  if (piece?.fixed) return "This part is fixed to the bench.";
  if (c.type === "place") {
    const stock = stockIssue(m, c.kind);
    if (stock) return stock;
  }
  const x = snap(c.x),
    y = snap(c.y);
  const size = c.type === "place" ? PARTS[c.kind] : partSize(piece!);
  if (!fits(size, x, y)) return "Keep the whole part inside the bench.";
  if (piece?.x === x && piece.y === y)
    return "Choose a new position for this part.";
  if (
    m.parts.some(
      (p) =>
        p.id !== piece?.id && Math.abs(p.x - x) < 5 && Math.abs(p.y - y) < 5,
    )
  )
    return "Another part is centered here. Place it beside that part.";
}
function remember(m: Machine) {
  m.undo.push(editable(m).map((part) => ({ ...part })));
  m.undoLinks.push(m.links.map((l) => ({ ...l })));
  if (m.undo.length > MAX_UNDO) {
    m.undo.shift();
    m.undoLinks.shift();
  }
}
function initialBody(p: Part): Body {
  return { id: p.id, x: p.x, y: p.y, vx: 0, vy: 0 };
}
function rewind(m: Machine): boolean {
  if (m.mode === "build") return false;
  m.mode = "build";
  m.tick = 0;
  m.phase = 0;
  m.bodies = [];
  m.active = [];
  m.broken = [];
  return true;
}

function changeLink(
  m: Machine,
  c: Extract<MachineCommand, { type: "connect" | "disconnect" }>,
): boolean {
  const link = canonicalLink(c.kind, c.a, c.b);
  const index = m.links.findIndex((l) => compareLinks(l, link) === 0);
  if (c.type === "connect" ? !canLink(m.parts, m.links, link) : index < 0)
    return false;
  remember(m);
  if (c.type === "connect") m.links = [...m.links, link].sort(compareLinks);
  else m.links.splice(index, 1);
  return true;
}

function positionPart(m: Machine, c: PlacementCommand): boolean {
  if (placementIssue(m, c)) return false;
  const x = snap(c.x),
    y = snap(c.y);
  remember(m);
  if (c.type === "move") {
    const piece = m.parts.find((p) => p.id === c.id)!;
    piece.x = x;
    piece.y = y;
  } else
    m.parts.push({
      id: m.nextPartId++,
      kind: c.kind,
      x,
      y,
      flip: false,
      fixed: false,
    });
  return true;
}

function changePart(
  m: Machine,
  c: Extract<MachineCommand, { type: "remove" | "rotate" | "flip" }>,
): boolean {
  const piece = m.parts.find((p) => p.id === c.id && !p.fixed);
  if (!piece) return false;
  if (
    c.type === "rotate" &&
    (!canRotate(piece.kind) ||
      !fits(
        partSize({ ...piece, rotation: piece.rotation ? 0 : 1 }),
        piece.x,
        piece.y,
      ))
  )
    return false;
  remember(m);
  if (c.type === "remove") {
    m.parts = m.parts.filter((p) => p.id !== piece.id);
    m.links = m.links.filter((l) => l.a !== piece.id && l.b !== piece.id);
  } else if (c.type === "rotate") piece.rotation = piece.rotation ? 0 : 1;
  else piece.flip = !piece.flip;
  return true;
}

export function applyMachine(m: Machine, c: MachineCommand): boolean {
  if (!validCommand(c)) return false;
  if (c.type === "rewind") return rewind(m);
  if (m.mode !== "build") return false;
  switch (c.type) {
    case "run":
      m.mode = "running";
      m.bodies = m.parts.filter(isDynamic).map(initialBody);
      return true;
    case "undo": {
      const last = m.undo.pop();
      if (!last) return false;
      m.parts = [...m.parts.filter((p) => p.fixed), ...last];
      m.links = m.undoLinks.pop()!;
      return true;
    }
    case "connect":
    case "disconnect":
      return changeLink(m, c);
    case "place":
    case "move":
      return positionPart(m, c);
    case "remove":
    case "rotate":
    case "flip":
      return changePart(m, c);
  }
}
