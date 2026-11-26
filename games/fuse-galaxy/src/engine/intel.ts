/**
 * What a planet can find out about the others: probes that report on a planet, and the warning a planet gets of an
 * attack on its way. Both come down to one comparison, the watcher's sensors research against the other side's
 * jamming, which gives a detail level:
 *
 * 1. the least: a probe counts asteroids, a warning says who is coming and when
 * 2. rough: structures, research and the ship classes present, each count rounded down to a step of the rules
 * 3. exact: every count, the stock, and how the ships are drawn up
 */
import { defendersAt } from "./combat.js";
import { clamp, max } from "./math.js";
import type { Rules } from "./rules.js";
import {
  SHIP_CLASSES,
  noShips,
  type DeepReadonly,
  type Fleet,
  type Formation,
  type Planet,
  type ScoutReport,
  type ShipCounts,
  type World,
  type WorldDraft,
} from "./world.js";

/** How much sensors see through jamming. */
export const detailOf = (
  sensors: number,
  jamming: number,
  rules: Rules,
): number =>
  clamp(
    rules.intel.baseDetail + sensors - jamming,
    rules.intel.minDetail,
    rules.intel.maxDetail,
  );

/** A count as a rough report gives it: the largest of the rules' steps it reaches, or 0. */
export function roughCount(count: number, rules: Rules): number {
  let rough = 0;
  for (const step of rules.intel.roughSteps) if (count >= step) rough = step;
  return rough;
}

/** Ship counts at a level of detail: nothing, rough or exact. */
function shipsAt(
  ships: Readonly<ShipCounts>,
  detail: number,
  rules: Rules,
): ShipCounts | null {
  if (detail < rules.intel.roughDetail) return null;
  const seen = noShips();
  for (const shipClass of SHIP_CLASSES)
    seen[shipClass] =
      detail >= rules.intel.exactDetail
        ? ships[shipClass]
        : roughCount(ships[shipClass], rules);
  return seen;
}

/** Whether a planet notices probes: it does unless the prober's sensors beat its jamming by the rules' margin. */
export const notices = (
  target: DeepReadonly<Planet>,
  observer: DeepReadonly<Planet>,
  rules: Rules,
): boolean =>
  target.research.jamming + rules.intel.noticeMargin >
  observer.research.sensors;

/** Records what a fleet of probes sees of the planet it has reached, replacing its owner's last report on it. */
export function observe(world: WorldDraft, fleet: Fleet, rules: Rules): void {
  const observer = world.planets[fleet.owner]!;
  const target = world.planets[fleet.target]!;
  const detail = detailOf(
    observer.research.sensors,
    target.research.jamming,
    rules,
  );
  const rough = detail >= rules.intel.roughDetail;
  const exact = detail >= rules.intel.exactDetail;
  // The ships at the planet are its home fleet and whoever is stationed there to defend it.
  const present = { ...target.ships };
  for (const defender of defendersAt(world.fleets, target.id))
    for (const shipClass of SHIP_CLASSES)
      present[shipClass] += defender.ships[shipClass];
  const report: ScoutReport = {
    target: target.id,
    tick: world.tick,
    by: observer.id,
    detail,
    asteroids: { ...target.asteroids },
    structures: rough ? { ...target.structures } : null,
    research: rough ? { ...target.research } : null,
    ships: shipsAt(present, detail, rules),
    resources: exact ? { ...target.resources } : null,
    formation: exact ? { ...target.formation } : null,
    sheltered: exact ? target.sheltered : null,
  };
  world.knowledge[observer.id] = {
    reports: [
      ...world.knowledge[observer.id]!.reports.filter(
        (known) => known.target !== target.id,
      ),
      report,
    ].sort((a, b) => a.target - b.target),
  };
}

/** An attack on its way that its target has seen coming. */
export interface IncomingFleet {
  readonly fleet: number;
  readonly owner: number;
  readonly target: number;
  /** Ticks until it lands. */
  readonly eta: number;
  readonly detail: number;
  /** Null at the least detail, rough counts at the next and exact counts at the highest. */
  readonly ships: Readonly<ShipCounts> | null;
  /** Known at the highest detail only. */
  readonly formation: Readonly<Formation> | null;
}

/** How many ticks before it lands a planet sees an attack from this attacker. */
export const warningTicks = (
  target: DeepReadonly<Planet>,
  attacker: DeepReadonly<Planet>,
  rules: Rules,
): number =>
  max(
    rules.intel.minWarningTicks,
    rules.intel.warningTicks +
      target.research.sensors * rules.intel.warningTicksPerSensors -
      attacker.research.jamming * rules.intel.warningTicksPerJamming,
  );

/**
 * The attacks on these planets that their sensors have picked up, in fleet order. A planet sees only what is aimed
 * at it, from the distance and in the detail its own sensors give against the attacker's jamming.
 */
export function incomingFor(
  world: World,
  planets: readonly number[],
  rules: Rules,
): IncomingFleet[] {
  const incoming: IncomingFleet[] = [];
  for (const fleet of world.fleets) {
    if (fleet.mission !== "attack" || fleet.phase !== "outbound") continue;
    if (!planets.includes(fleet.target)) continue;
    const target = world.planets[fleet.target]!;
    const attacker = world.planets[fleet.owner]!;
    if (fleet.eta > warningTicks(target, attacker, rules)) continue;
    const detail = detailOf(
      target.research.sensors,
      attacker.research.jamming,
      rules,
    );
    incoming.push({
      fleet: fleet.id,
      owner: fleet.owner,
      target: fleet.target,
      eta: fleet.eta,
      detail,
      ships: shipsAt(fleet.ships, detail, rules),
      formation: detail >= rules.intel.exactDetail ? fleet.formation : null,
    });
  }
  return incoming;
}
