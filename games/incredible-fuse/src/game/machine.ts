import {
  FREE_WORKSHOP,
  getPuzzle,
  type Part,
  type Body,
  type PartKind,
} from "./machine-parts.js";
export * from "./machine-parts.js";
import { atmosphere, bodyKind, bodyMass, UNIT } from "./machine-motion.js";
import { moveBodies, outsideBench, transfer } from "./machine-body.js";
import { mechanisms } from "./machine-mechanisms.js";
import { fire, has } from "./machine-power.js";
export { bodyKind } from "./machine-motion.js";
export { conveyorSpeed, isBlowing } from "./machine-power.js";
import { stepCords } from "./machine-cords.js";
import { evaluateObjective } from "./machine-goals.js";
import type { LinkKind, MachineLink } from "./machine-links.js";
export * from "./machine-links.js";
export { applyMachine, available, placementIssue } from "./machine-editor.js";
import {
  CLOCK_DENOMINATOR,
  nextAfter,
  validWorkshopBlueprint,
  within,
} from "./machine-validation.js";
export {
  validCommand,
  validMachine,
  validWorkshopBlueprint,
} from "./machine-validation.js";
const MAX_STEPS = 600;

export interface WorkshopBlueprint {
  air: number;
  gravity: number;
  parts: Part[];
  links: MachineLink[];
}

export interface Machine {
  puzzle: number;
  mode: "build" | "running" | "failed" | "solved";
  tick: number;
  /** Remainder of the DOS PIT clock relative to the 20 Hz room log. */
  phase: number;
  air: number;
  gravity: number;
  parts: Part[];
  imported: boolean;
  /** A removed or undone placement never lends its identity to a later part. */
  nextPartId: number;
  bodies: Body[];
  active: number[];
  links: MachineLink[];
  broken: number[];
  /** Only movable placements are saved. The fixed layout belongs to the puzzle. */
  undo: Part[][];
  undoLinks: MachineLink[][];
}
export type MachineCommand =
  | { type: "place"; kind: PartKind; x: number; y: number }
  | { type: "move"; id: number; x: number; y: number }
  | { type: "flip" | "rotate" | "remove"; id: number }
  | { type: "connect" | "disconnect"; kind: LinkKind; a: number; b: number }
  | { type: "run" | "rewind" | "undo" };
const copyParts = (parts: Part[]) => parts.map((p) => ({ ...p }));
export function createMachine(puzzleIndex: number): Machine {
  if (!within(puzzleIndex, 0, FREE_WORKSHOP))
    throw new RangeError("Unknown workshop puzzle");
  const spec = getPuzzle(puzzleIndex);
  return {
    puzzle: puzzleIndex,
    mode: "build",
    tick: 0,
    phase: 0,
    air: 67,
    gravity: 272,
    imported: false,
    parts: copyParts(spec.parts),
    nextPartId: nextAfter(spec.parts),
    bodies: [],
    active: [],
    links: (spec.links ?? []).map((link) => ({ ...link })),
    broken: [],
    undo: [],
    undoLinks: [],
  };
}
export function stepPhysics(m: Machine): void {
  if (m.mode !== "running") return;
  m.tick = Math.min(0x7fffffff, m.tick + 1);
  mechanisms(m);
  const partOf = new Map(m.parts.map((p) => [p.id, p]));
  moveBodies(m, partOf);
  for (let i = 0; i < m.bodies.length; i++)
    for (let j = i + 1; j < m.bodies.length; j++) {
      const a = m.bodies[i]!,
        b = m.bodies[j]!;
      transfer(m, a, b, partOf.get(a.id)!, partOf.get(b.id)!);
    }
  if (m.links.some((l) => l.kind === "rope")) {
    stepCords({
      parts: partOf,
      bodies: new Map(m.bodies.map((b) => [b.id, b])),
      links: m.links,
      broken: m.broken,
      active: m.active,
      mass: bodyMass,
      maximum: (p) => atmosphere(bodyKind(p), m.air, m.gravity).terminal / UNIT,
      activate: (id) => fire(m, id),
    });
  }
  updatePuzzleOutcome(m);
}

function updatePuzzleOutcome(m: Machine) {
  if (m.puzzle === FREE_WORKSHOP) return;
  const spec = getPuzzle(m.puzzle);
  if (spec.objective) m.mode = evaluateObjective(spec.objective, m);
  else if (spec.targets.every((id) => has(m, id))) m.mode = "solved";
  if (
    m.mode === "running" &&
    (m.tick >= MAX_STEPS ||
      (m.tick > 12 &&
        m.bodies.length > 0 &&
        m.bodies.every((b) => outsideBench(b, 80))))
  )
    m.mode = "failed";
}
/** Physics time including the unspent part of the current room step. */
export function machineTimeMs(tick: number, phase = 0): number {
  return ((tick + phase / CLOCK_DENOMINATOR) * (5041 * 8 * 1000)) / 1193182;
}
export function createWorkshop(blueprint: WorkshopBlueprint): Machine {
  if (!validWorkshopBlueprint(blueprint))
    throw new RangeError("Invalid workshop blueprint");
  return {
    ...createMachine(FREE_WORKSHOP),
    imported: true,
    air: blueprint.air,
    gravity: blueprint.gravity,
    parts: copyParts(blueprint.parts),
    nextPartId: nextAfter(blueprint.parts),
    links: blueprint.links.map((l) => ({ ...l })),
  };
}
/** One 20 Hz log tick; the original IRQ divisor schedules about 29.59 physics steps per second. */
export function stepMachine(m: Machine): void {
  if (m.mode !== "running") return;
  m.phase += 1193182;
  while (m.phase >= CLOCK_DENOMINATOR) {
    m.phase -= CLOCK_DENOMINATOR;
    stepPhysics(m);
  }
}
