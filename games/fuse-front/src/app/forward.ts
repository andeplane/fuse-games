import {
  createCorrectionFrames,
  createCorrectionSmoother,
  type CorrectionSmoother,
  createLeadChain,
} from "fuse-netcode";
import {
  NO_WINNER,
  STEPS_PER_TICK,
  botCommands,
  step,
  viewOf,
  type CombatEvent,
  type Command,
  type GameMap,
  type World,
  type WorldView,
} from "../engine/index.js";
import { mapOf, ridden, type Room } from "../online/game.js";

/**
 * Draw at the clock, not a tick behind. The battlefield used to be drawn between the two newest folded worlds, always
 * right and 50–100 ms late. Instead the newest folded world is played forward, by the fraction of a log tick the
 * clock has run past it, with the orders this device has logged but the room has not folded yet and the bots sending
 * what the fold will have them send, and that is drawn: a click or a push of the stick shows on the next animation
 * frame. Every other rider's hero carries on with the order it has. A step returns a new world, so the room's is
 * never touched and nothing here reaches it.
 *
 * The run never crosses what the room decides: a hero's death, a building's fall, a flag changing hands and the
 * result are shown when the room has folded them, never on a guess. The HUD, the feed, the radar and every sound
 * still read the folded world and its events; only the battlefield is drawn ahead.
 */
export interface Lead {
  /** The world to draw, and the one a step before it to draw from (`Renderer.draw`'s `older`). */
  world: WorldView;
  before: WorldView | undefined;
  /** How far from `before` to `world`, 0 to 1. */
  t: number;
}

const DECIDES: ReadonlySet<CombatEvent["type"]> = new Set([
  "heroDeath",
  "destroyed",
  "capture",
  "won",
]);

/**
 * A forward run costs a step of the whole battlefield, and a frame needs the same few steps as the frame before it
 * until the room folds another tick, a rollback replaces it or this device logs an order. So the steps are kept:
 * `key` names the folded world and the orders played on it, and a frame only takes the steps no earlier frame took.
 * The views are kept with them, so the renderer sees the same objects from frame to frame.
 */
export function createForward(): (
  room: Room,
  ahead: number,
  revision: number,
  pending: readonly Command[],
) => Lead | undefined {
  const sample = createLeadChain<World>();
  const views = new WeakMap<World, WorldView>();
  const view = (map: GameMap, world: World): WorldView => {
    let made = views.get(world);
    if (!made) views.set(world, (made = viewOf(map, world)));
    return made;
  };
  return (room, ahead, revision, pending) => {
    const folded = room.world;
    // Before the countdown ends the fold steps nothing, and neither does this.
    if (!folded || room.stage !== "running" || room.tick + 1 < room.startAt)
      return undefined;
    const map = mapOf(room),
      key = `${revision}:${room.matchId}:${folded.step}:${JSON.stringify(pending)}`;
    const lead = sample({
      key,
      identity: folded,
      start: () => folded,
      tolerance: 0.001,
      steps: () => Math.max(0, ahead) * STEPS_PER_TICK,
      advance(from, _base, index) {
        // As the fold does: a tick's commands go to its first step, a bot's from the world as the tick begins.
        const commands =
          index % STEPS_PER_TICK === 0
            ? from.players.flatMap(({ seat }) =>
                !ridden(room, seat)
                  ? botCommands(map, from, seat, room.play.bots[seat]!)
                  : index === 0
                    ? pending.filter((command) => command.seat === seat)
                    : [],
              )
            : [];
        const next = step(map, from, commands);
        if (
          next.winner !== NO_WINNER ||
          next.events.some((event) => DECIDES.has(event.type))
        )
          return;
        return next;
      },
    });
    if (lead.next)
      return {
        world: view(map, lead.next),
        before: view(map, lead.current),
        t: lead.part,
      };
    return {
      world: view(map, lead.current),
      before: lead.previous ? view(map, lead.previous) : undefined,
      t: 1,
    };
  };
}
/** Corrections decay with this time constant; a jump larger than `TELEPORT` sub-pixels (a respawn, a DASH, a BLINK) is shown as it is. */
export const DECAY_MS = 45;

export interface Smoother {
  /**
   * `lead` with corrections to the other heroes hidden. `revision` is the runtime's frame revision (a rollback
   * replaced history); `self` is this device's seat, or −1, and its hero is never smoothed. `folded` is the newest
   * folded step and `orders` what each hero, by seat, was told to do as of it (`ordersOf`): a hero whose order
   * changed with a new fold is one the forward run guessed wrong.
   */
  apply(
    lead: Lead,
    key: string,
    revision: number,
    nowMs: number,
    self: number,
    folded: number,
    orders: ReadonlyMap<number, string>,
  ): Lead;
}

/** What each hero of the folded world is doing, by seat: where it walks, what it steers and what it shoots. */
export const ordersOf = (world: World): Map<number, string> =>
  new Map(
    world.heroes.map((hero) => [
      hero.seat,
      `${hero.goal}:${hero.steerX}:${hero.steerY}:${hero.focusOf}:${hero.focus}:${hero.sweep}`,
    ]),
  );

/**
 * Hides what the forward run got wrong about the other heroes. A rider's order the room folds late rolls the world
 * back, and one folded in time still turns their hero from where the run had it going; either way it would snap to
 * where it really went, so the screen keeps it where it was drawn and lets the
 * difference decay. Units are many and slow, and move on the rules alone, so they are drawn as they are.
 */
export function createSmoother(
  teleport: number,
  smoother: CorrectionSmoother = createCorrectionSmoother({
    decayMs: DECAY_MS,
    teleport,
  }),
): Smoother {
  const begin = createCorrectionFrames(smoother);
  let told: ReadonlyMap<number, string> = new Map();
  return {
    apply(lead, key, nextRevision, nowMs, self, folded, orders) {
      const { rolled, stepped } = begin({
        scope: key,
        revision: nextRevision,
        tick: folded,
        nowMs,
      });
      const toldBefore = told;
      told = orders;
      const { world, before, t } = lead,
        was = new Map(before?.heroes.map((hero) => [hero.seat, hero]));
      const shifts = new Map<number, { x: number; y: number }>();
      for (const hero of world.heroes) {
        if (hero.seat === self || hero.respawn > 0) continue;
        // Where the renderer will draw it: between the two worlds, as `draw` does.
        const from = was.get(hero.seat) ?? hero,
          point = {
            x: from.x + (hero.x - from.x) * t,
            y: from.y + (hero.y - from.y) * t,
          },
          drawn = smoother.place(
            `hero:${hero.seat}`,
            point,
            rolled ||
              (stepped &&
                toldBefore.has(hero.seat) &&
                toldBefore.get(hero.seat) !== orders.get(hero.seat)),
          ),
          shift = {
            x: Math.round(drawn.x - point.x),
            y: Math.round(drawn.y - point.y),
          };
        if (shift.x || shift.y) shifts.set(hero.seat, shift);
      }
      if (shifts.size === 0) return lead;
      const moved = (view: WorldView): WorldView => ({
        ...view,
        heroes: view.heroes.map((hero) => {
          const shift = shifts.get(hero.seat);
          return shift
            ? { ...hero, x: hero.x + shift.x, y: hero.y + shift.y }
            : hero;
        }),
      });
      return { world: moved(world), before: before && moved(before), t };
    },
  };
}
