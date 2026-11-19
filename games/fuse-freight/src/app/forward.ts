import {
  createHeldInputCorrectionFrames,
  createCorrectionSmoother,
  type CorrectionSmoother,
  forwardWorld,
  memoizeLeadInput,
  type ForwardWorldOptions,
} from "fuse-netcode";
import {
  STEPS_PER_TICK,
  copyWorld,
  roundDone,
  stepWorld,
  toView,
  type Train,
  type World,
  type WorldView,
} from "../engine/index.js";
import type { Room } from "../online/game.js";
import { blend } from "../render/interpolate.js";
import { effectKey } from "../render/scene.js";

/**
 * Draw at the clock, not a tick behind. The runtime's newest folded world is the latest the room knows; instead of
 * presenting it a tick late to interpolate towards it, the screen plays it forward on a copy, by the fraction of a
 * log tick the clock has run past it, with the bits each driver holds (this device's own live, logged or not), and
 * draws that. A turn shows on the next animation frame instead of 50–100 ms later, and what is drawn is what the
 * fold will produce unless another driver's controls change first. The copy is thrown away: nothing here reaches
 * the room.
 *
 * The forward run never crosses an outcome: a delivery, a cut, the end of the countdown and the whistle are shown
 * when the room has folded them, never on a guess.
 */
export interface ForwardInputs {
  /** What `train` is taken to hold for the tick being played: a human's last logged bits, a bot's answer, 0 when away. */
  held(world: World, train: Train): number;
}

/** Whether `now` shows an outcome `world` does not: a phase, a score, wagons lost or banked, the round's end. */
const decided = (world: World, now: World): boolean =>
  now.phase !== world.phase ||
  roundDone(now) ||
  now.trains.some((train, index) => {
    const was = world.trains[index];
    return (
      !was ||
      was.score !== train.score ||
      was.lost !== train.lost ||
      was.stolen !== train.stolen ||
      train.cargo.length < was.cargo.length
    );
  });

const forwardSteps: ForwardWorldOptions<
  World,
  ReadonlyMap<string, number>,
  ForwardInputs
> = {
  copy: copyWorld,
  step: stepWorld,
  decided,
  beginTick(copy, inputs) {
    const held = new Map(
      copy.trains.map((train) => [train.id, inputs.held(copy, train)]),
    );
    return { steps: STEPS_PER_TICK, heldAt: () => held };
  },
};

/** The newest world played forward `ahead` log ticks (0–2, fractional), as a view to draw. */
export function forward(
  world: World,
  ahead: number,
  inputs: ForwardInputs,
): WorldView {
  const result = forwardWorld(world, ahead, inputs, forwardSteps);
  const view = toView(result.copy);
  return result.next ? blend(view, toView(result.next), result.part) : view;
}

export type BotInput = (world: World, train: Train) => number;

/**
 * The bits the forward run plays for each train: a bot answers as the fold would, a seated human holds what it last
 * logged, and this device's own driver holds what its player holds right now.
 */
export function forwardInputs(
  room: Room,
  me: string,
  live: number,
  bot: BotInput,
): ForwardInputs {
  return {
    held(world, train) {
      const seat = room.seats.get(train.id);
      if (seat?.bot) return bot(world, train);
      if (!seat?.connected) return 0;
      if (train.id === me) return live;
      return room.held[train.id] ?? 0;
    },
  };
}

/**
 * The bot's answer for a world is the same every frame until the next tick is folded or a rollback replaces it, and
 * planning it is the most expensive thing the forward run does: ask it once per train, step and frame revision.
 */
export function memoBot(bot: BotInput): (revision: number) => BotInput {
  return memoizeLeadInput(
    bot,
    (revision, world, train) =>
      `${revision}:${world.seed}:${world.step}:${train.id}`,
    64,
  );
}
/** An effect within this many steps and pixels of one already shown, of the same kind and seat, is the same effect. */
export const TWIN_STEPS = 6,
  TWIN_PX = 20;

/**
 * Keeps an effect from going off twice. The scene draws an effect the first time it sees it, keyed by what, who,
 * when and where. A forward run can show one the next run takes back (a rollback, another driver's controls
 * changing), and the room then folds the same event a step or a few pixels away: the same spark, drawn twice.
 * Within a round, an effect that close to one already handed to the scene is therefore left out of the picture.
 */
export function createCueLatch(): (view: WorldView) => WorldView {
  type Shown = WorldView["fx"][number];
  let seed = -1,
    shown: Shown[] = [],
    kept = new Set<string>(),
    dropped = new Set<string>();
  return (view) => {
    if (view.seed !== seed) {
      seed = view.seed;
      shown = [];
      kept = new Set();
      dropped = new Set();
    }
    if (!view.fx.length) return view;
    let same = true;
    const fresh: Shown[] = [];
    const fx = view.fx.filter((each) => {
      const key = effectKey(each);
      if (kept.has(key)) return true;
      const twin =
        dropped.has(key) ||
        shown.some(
          (other) =>
            other.kind === each.kind &&
            other.slot === each.slot &&
            Math.abs(other.at - each.at) <= TWIN_STEPS &&
            Math.hypot(other.x - each.x, other.y - each.y) <= TWIN_PX,
        );
      if (twin) {
        dropped.add(key);
        same = false;
        return false;
      }
      kept.add(key);
      fresh.push(each);
      return true;
    });
    // Only an effect from an earlier frame has twins: two sparks that are new together are two sparks.
    shown.push(...fresh);
    // Effects live a second: what was shown long ago can neither return nor have a twin.
    if (shown.length > 200) {
      shown = shown.filter((each) => view.step - each.at <= 120);
      kept = new Set(shown.map(effectKey));
      dropped = new Set([...dropped].slice(-200));
    }
    return same ? view : { ...view, fx };
  };
}

/** Corrections decay with this time constant; a jump larger than `TELEPORT` pixels is shown as it is. */
export const DECAY_MS = 45,
  TELEPORT = 90;

export interface Smoother {
  /**
   * `view` with corrections hidden. `revision` is the runtime's frame revision (a rollback replaced history) and
   * `folded` the newest folded step; `held` is what each seat had logged as of that step; `me` is this device's
   * own train, which is never smoothed.
   */
  apply(
    view: WorldView,
    revision: number,
    folded: number,
    held: Readonly<Record<string, number>>,
    nowMs: number,
    me: string,
  ): WorldView;
}

/**
 * Hides what the forward run got wrong. The other trains are drawn where the room's newest inputs put them; when a
 * rollback moves them, or a new tick shows another driver changed what they hold, the screen keeps the locomotive
 * and its wagons where they were and lets the difference decay.
 */
export function createSmoother(
  smoother: CorrectionSmoother = createCorrectionSmoother({
    decayMs: DECAY_MS,
    teleport: TELEPORT,
  }),
): Smoother {
  const begin = createHeldInputCorrectionFrames<string>(smoother, {});
  return {
    apply(view, nextRevision, nextFolded, held, nowMs, me) {
      const round = `${view.seed}:${view.phase}`;
      // A new round or a new phase starts again: nothing carries over.
      const { rolled, changed } = begin(
        { scope: round, revision: nextRevision, tick: nextFolded, nowMs },
        held,
      );
      if (view.phase !== "play") return view;
      return {
        ...view,
        trains: view.trains.map((train) => {
          if (train.id === me) return train;
          const drawn = smoother.place(
              `train:${train.id}`,
              train,
              rolled || changed(train.id),
            ),
            dx = drawn.x - train.x,
            dy = drawn.y - train.y;
          if (dx === 0 && dy === 0) return train;
          // The wagons ride the same offset: the train is corrected as one body.
          return {
            ...train,
            x: drawn.x,
            y: drawn.y,
            wagons: train.wagons.map((wagon) => ({
              ...wagon,
              x: wagon.x + dx,
              y: wagon.y + dy,
            })),
          };
        }),
      };
    },
  };
}
