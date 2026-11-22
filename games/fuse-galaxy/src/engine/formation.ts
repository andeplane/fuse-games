/**
 * Formations: where each class of a fleet stands on the 3×3 battle grid, and what that means in a round.
 *
 * The whole rule, which `combat.ts` applies:
 *
 * 1. Every squadron stands in one of nine cells: the front, middle or rear line of the left, centre or right
 *    column. Its depth is how many occupied cells of its own side stand in front of it in its column, so an empty
 *    front line leaves whatever is behind it at depth 0.
 * 2. A squadron can fire at an enemy squadron when its own depth plus the target's is less than its class's range:
 *    range 1 fires from the front at the front only, range 3 fires from the rear at the front or from the front at
 *    the rear.
 * 3. A squadron whose column holds no enemy at all has turned the flank: the target's depth does not count, so an
 *    uncovered column exposes everything behind the line.
 */
import { isWhole } from "./guards.js";
import { div } from "./math.js";
import type { Rules } from "./rules.js";
import { SHIP_CLASSES, type Formation, type ShipClass } from "./world.js";

export const LINES = 3;
export const COLUMNS = 3;
export const CELLS = LINES * COLUMNS;

/** 0 for the front line, 1 for the middle, 2 for the rear. */
export const lineOf = (cell: number): number => div(cell, COLUMNS);

/** 0 for the left column, 1 for the centre, 2 for the right. */
export const columnOf = (cell: number): number => cell % COLUMNS;

/** A named formation of the rules, or a cell for each class to be moved; a class left out stays where it is. */
export type Arrangement = string | Readonly<Partial<Record<ShipClass, number>>>;

/** A formation the rules name, or undefined. Only the rules' own names count, never an inherited property. */
export const namedFormation = (
  name: string,
  rules: Rules,
): Readonly<Formation> | undefined =>
  Object.keys(rules.combat.formations).includes(name)
    ? rules.combat.formations[name]
    : undefined;

/** Why ships cannot be drawn up this way, or undefined when they can. */
export function arrangementProblem(
  arrangement: Arrangement,
  rules: Rules,
): string | undefined {
  if (typeof arrangement === "string")
    return namedFormation(arrangement, rules) ? undefined : "unknown formation";
  for (const shipClass of SHIP_CLASSES) {
    const cell = arrangement[shipClass] ?? 0;
    if (!isWhole(cell) || cell < 0 || cell >= CELLS)
      return `a formation's cells are whole numbers from 0 to ${CELLS - 1}`;
  }
  return undefined;
}

/** The formation after an arrangement that `arrangementProblem` allowed. */
export function arranged(
  current: Readonly<Formation>,
  arrangement: Arrangement,
  rules: Rules,
): Readonly<Formation> {
  if (typeof arrangement === "string")
    return namedFormation(arrangement, rules)!;
  const next = { ...current };
  for (const shipClass of SHIP_CLASSES)
    next[shipClass] = arrangement[shipClass] ?? current[shipClass];
  return next;
}

/** The name the rules give a formation, or undefined for one a player arranged cell by cell. */
export const formationName = (
  formation: Readonly<Formation>,
  rules: Rules,
): string | undefined =>
  Object.keys(rules.combat.formations).find((name) =>
    SHIP_CLASSES.every(
      (shipClass) =>
        rules.combat.formations[name]![shipClass] === formation[shipClass],
    ),
  );
