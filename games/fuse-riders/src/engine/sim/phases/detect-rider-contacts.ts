import type { Movement, TickContext } from "../context.js";
import type { PlayerId } from "../../state.js";
import {
  EPSILON,
  firstContactTime,
  pointSegmentDistanceSquared,
  square,
} from "../../geometry.js";
import { RIDER_CONTACT_RADIUS } from "../../tuning.js";
import { hasDefensiveGrace, isHazardImmune } from "../../effects.js";
import { markCause } from "../marks.js";
import { nearestDelta } from "../field.js";

interface RiderPair {
  readonly a: Movement;
  readonly b: Movement;
  /** Whether the two bodies have touched by `time` in the step. */
  readonly touches: (time: number) => boolean;
}

/**
 * Riders against riders, every pair once. The relative step is swept, so both are compared at the same instant of the
 * tick, and each is marked `rider` under the other's name unless something makes it immune.
 *
 * A rider exists only until it dies (#188). One that met a trail, scenery, a shell, a blast, the boundary or a core earlier in
 * the step is swept only up to that moment, and contacts are settled earliest first, so a rider killed by another
 * rider cannot go on to reach a third later in the step. A shielded rider survives every mark this tick, so it keeps
 * its whole step. Contact before a death still counts: a rider's segment is cut at its death, never removed.
 */
export function detectRiderContacts(ctx: TickContext): void {
  const {
    state,
    open,
    movements,
    causes,
    causeOwners,
    riderContactTimes,
    trailContactTimes,
    obstacleContactTimes,
    hazardContactTimes,
  } = ctx;
  const movementList = [...movements.values()];
  const limit = square(2 * RIDER_CONTACT_RADIUS) + EPSILON;

  const pairs: RiderPair[] = [];
  for (let first = 0; first < movementList.length; first += 1) {
    for (let second = first + 1; second < movementList.length; second += 1) {
      const a = movementList[first]!;
      const b = movementList[second]!;
      // Portal grace is defensive: neither rider is harmed by any contact between them.
      if (
        hasDefensiveGrace(a.player, state.tick) ||
        hasDefensiveGrace(b.player, state.tick)
      )
        continue;
      // Sweep the relative position: both endpoints use the same instant in the tick.
      // Comparing the two paths directly also compares positions reached at different
      // times, killing riders that safely follow or pass behind one another (#186).
      // Across an open edge two riders are as close as the short way round says they are.
      const apartX = nearestDelta(open, a.oldX - b.oldX, state.width),
        apartY = nearestDelta(open, a.oldY - b.oldY, state.height);
      const closingX = a.x - a.oldX - (b.x - b.oldX),
        closingY = a.y - a.oldY - (b.y - b.oldY);
      pairs.push({
        a,
        b,
        touches: (time) =>
          pointSegmentDistanceSquared(
            0,
            0,
            apartX,
            apartY,
            apartX + closingX * time,
            apartY + closingY * time,
          ) <= limit,
      });
    }
  }
  if (pairs.length === 0) return;

  // How far into the step each rider still exists.
  const ends = new Map<PlayerId, number>();
  for (const movement of movementList) {
    const id = movement.player.id;
    ends.set(
      id,
      movement.player.shielded
        ? 1
        : Math.min(
            1,
            trailContactTimes.get(id) ?? 1,
            obstacleContactTimes.get(id) ?? 1,
            hazardContactTimes.get(id) ?? 1,
          ),
    );
  }
  const harmed = (movement: Movement): boolean =>
    !isHazardImmune(movement.player, state.tick);

  // Settle contacts earliest first: each one can end a rider, which shortens every pair it is in.
  // Ties go to the earlier pair in seat order. Ends only shrink, so this stops within one pass per pair.
  const contacts = new Map<number, number>();
  for (;;) {
    let next: { index: number; time: number } | undefined;
    for (let index = 0; index < pairs.length; index += 1) {
      if (contacts.has(index)) continue;
      const { a, b, touches } = pairs[index]!;
      const window = Math.min(ends.get(a.player.id)!, ends.get(b.player.id)!);
      if (!touches(window)) continue;
      const time = firstContactTime(touches, window);
      if (!next || time < next.time) next = { index, time };
    }
    if (!next) break;
    contacts.set(next.index, next.time);
    const { a, b } = pairs[next.index]!;
    for (const movement of [a, b]) {
      if (!harmed(movement) || movement.player.shielded) continue;
      const id = movement.player.id;
      ends.set(id, Math.min(ends.get(id)!, next.time));
    }
  }

  // Marks go down in pair order, as they always have, so the owners behind a cause keep their order.
  for (let index = 0; index < pairs.length; index += 1) {
    const time = contacts.get(index);
    if (time === undefined) continue;
    const { a, b } = pairs[index]!;
    for (const victim of [a, b]) {
      if (!harmed(victim)) continue;
      riderContactTimes.set(
        victim.player.id,
        Math.min(riderContactTimes.get(victim.player.id) ?? 1, time),
      );
    }
    for (const [victim, other] of [
      [a, b],
      [b, a],
    ] as const) {
      if (!harmed(victim)) continue;
      markCause(
        causes,
        causeOwners,
        victim.player.id,
        "rider",
        other.player.id,
      );
    }
  }
}
