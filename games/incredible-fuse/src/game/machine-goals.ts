import type { Body, Part, PartKind, Puzzle } from "./machine-parts.js";

export interface GoalRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type MachineObjective =
  | { kind: "quota"; region: GoalRegion; candidates: number[]; count: number }
  | {
      kind: "preserve";
      region?: undefined;
      bounds: GoalRegion;
      subjects: number[];
      untilTick: number;
    }
  | {
      kind: "select";
      region?: undefined;
      required: number[];
      forbidden: number[];
    };

interface GoalState {
  tick: number;
  bodies: readonly Body[];
  active: readonly number[];
}

function inside(region: GoalRegion, body: Body): boolean {
  return (
    body.x >= region.x &&
    body.x <= region.x + region.width &&
    body.y >= region.y &&
    body.y <= region.y + region.height
  );
}

/** Decisions use the same fixed-tick centers and latched triggers as the machine.
 * A selector trips immediately even if a desired part activated on that tick. */
export function evaluateObjective(
  goal: MachineObjective,
  state: GoalState,
): "running" | "solved" | "failed" {
  switch (goal.kind) {
    case "quota": {
      const arrivals = state.bodies.filter(
        (body) =>
          goal.candidates.includes(body.id) && inside(goal.region, body),
      );
      return arrivals.length >= goal.count ? "solved" : "running";
    }
    case "preserve": {
      for (const id of goal.subjects) {
        const body = state.bodies.find((body) => body.id === id);
        if (!body || !inside(goal.bounds, body)) return "failed";
      }
      return state.tick >= goal.untilTick ? "solved" : "running";
    }
    case "select":
      if (goal.forbidden.some((id) => state.active.includes(id)))
        return "failed";
      return goal.required.every((id) => state.active.includes(id))
        ? "solved"
        : "running";
  }
}

function fixture(id: number, kind: PartKind, x: number, y: number): Part {
  return { id, kind, x, y, flip: false, fixed: true };
}

export const GOAL_PUZZLES: readonly Puzzle[] = [
  {
    title: "Double booking",
    goal: "Get both baseballs inside the marked receiving bay at the same time.",
    parts: [
      fixture(1, "baseball", 160, 60),
      fixture(2, "baseball", 278, 78),
      fixture(3, "shelf", 270, 316),
    ],
    stock: { ramp: 1 },
    targets: [],
    objective: {
      kind: "quota",
      region: { x: 220, y: 240, width: 104, height: 76 },
      candidates: [1, 2],
      count: 2,
    },
  },
  {
    title: "Fragile freight",
    goal: "Keep both bowling balls on the workbench for three seconds.",
    parts: [
      fixture(1, "bowling", 210, 64),
      fixture(2, "bowling", 420, 110),
      fixture(3, "timber", 210, 260),
    ],
    stock: { shelf: 1 },
    targets: [],
    objective: {
      kind: "preserve",
      bounds: { x: 0, y: 0, width: 640, height: 400 },
      subjects: [1, 2],
      untilTick: 89,
    },
  },
  {
    title: "Quiet carriage",
    goal: "Ring the middle and right bells. Keep the left bell quiet.",
    parts: [
      fixture(1, "ball", 160, 60),
      fixture(2, "baseball", 430, 100),
      fixture(3, "bell", 160, 288),
      fixture(4, "bell", 310, 288),
      fixture(5, "bell", 430, 288),
    ],
    stock: { ramp: 1 },
    targets: [4, 5],
    objective: { kind: "select", required: [4, 5], forbidden: [3] },
  },
];
