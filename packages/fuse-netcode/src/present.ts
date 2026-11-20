import { TICK_MS } from "./clock.js";

/**
 * Presentation helpers for a game that draws at the clock instead of a tick behind it.
 *
 * `frameTiming()` hands a game its two newest frames and a time one log tick behind the clock; blending between them
 * is always right and always late, so a press shows 50–100 ms after it was made. A game that can step a copy of its
 * world may instead play the newest world forward to the clock with the controls everyone holds (this device's own
 * live), and draw that: a press shows on the next animation frame, and what is drawn is what the fold will produce
 * unless someone else's controls change first. These helpers are the parts of that every game needs: how far ahead
 * to play, how to keep the picture moving when the fold runs a few milliseconds late, and how to hide the jump when
 * a prediction turns out wrong. Nothing here touches the room: it is presentation only.
 */
interface TimedFrame {
  tick: number;
  logTick: number;
}

/**
 * How many log ticks the clock is past the newest frame, 0–1, from the runtime's frame timing. 1 means the clock has
 * run a whole tick past the newest folded world: the fold is due or late (`createLeadClock` carries on from there).
 */
export function ticksAhead(timing: {
  older?: TimedFrame;
  newer: TimedFrame;
  tick: number;
  lead: number;
}): number {
  const { older, newer } = timing;
  const behind =
    older && newer.tick > older.tick && timing.tick < newer.tick
      ? ((newer.tick - timing.tick) / (newer.tick - older.tick)) *
        (newer.logTick - older.logTick)
      : 0;
  return Math.max(0, Math.min(1, timing.lead - behind));
}

/** The furthest a picture plays past the newest folded world: one log tick, plus one more while the fold is late. */
export const MAX_TICKS_AHEAD = 2;

/**
 * Keeps the drawn clock moving when the fold is a few milliseconds late. The runtime folds a log tick on a 10 ms
 * timer, so for a moment after the clock passes a tick boundary its newest world is still the one before and
 * `ticksAhead` stops at 1: the picture would hold still for that frame, then jump. While it is pinned there, the wall
 * clock carries the count on from the last unpinned frame, up to `maxAhead`; once the next tick is folded the
 * runtime's own timing takes over again, from the same place in time.
 */
export function createLeadClock(
  maxAhead = MAX_TICKS_AHEAD,
  tickMs = TICK_MS,
): (ahead: number, newerLogTick: number, nowMs: number) => number {
  let tick = Number.NaN,
    origin = 0;
  return (ahead, newerLogTick, nowMs) => {
    if (newerLogTick !== tick || ahead < 1) {
      tick = newerLogTick;
      origin = nowMs - ahead * tickMs;
      return ahead;
    }
    return Math.max(ahead, Math.min(maxAhead, (nowMs - origin) / tickMs));
  };
}

export interface Point {
  x: number;
  y: number;
}
export interface CorrectionOptions {
  /** Time constant of the decay: an offset is nearly gone after three of these. */
  decayMs: number;
  /** A jump larger than this is a teleport (a reset, a respawn, a wrapped edge), shown as it is. */
  teleport: number;
}
/**
 * Hides corrections. When what a game predicted for a body turns out wrong (a rollback replaced history, or someone
 * else's controls changed), the body would snap to where the confirmed inputs put it. Instead the screen keeps it
 * where it was drawn and lets the difference decay. Never use it for the body its own player steers: that one must
 * follow the hands exactly.
 */
export interface CorrectionSmoother {
  /** Starts a drawn frame at wall time `nowMs`: decays every offset. Call once per frame, before `place`. */
  begin(nowMs: number): void;
  /**
   * Where to draw the body `key` this frame, given `point`, where the new picture has it. With `absorb`, the gap
   * between that and where the picture was expected to have it (its last place, moved on at its last speed) is added
   * to the body's offset; otherwise the offset it already has is applied as it decays.
   */
  place(key: string, point: Point, absorb: boolean): Point;
  /** Forgets every offset and every drawn place: the next frame is shown as it is. */
  reset(): void;
}

interface Tracked {
  offset: Point;
  /** Where the picture had the body last frame, before the offset, and the frame before that. */
  raw: Point;
  before?: Point;
  seen: boolean;
}

export function createCorrectionSmoother(
  options: CorrectionOptions,
): CorrectionSmoother {
  const bodies = new Map<string, Tracked>();
  let last = -1,
    dt = 0,
    beforeDt = 0;
  return {
    begin(nowMs) {
      beforeDt = dt;
      dt = last < 0 ? 0 : Math.max(0, nowMs - last);
      last = nowMs;
      const fade = Math.exp(-dt / options.decayMs);
      for (const [key, body] of bodies) {
        // A body that was not drawn last frame is gone: it must not be dragged from where it once was.
        if (!body.seen) {
          bodies.delete(key);
          continue;
        }
        body.seen = false;
        body.offset.x *= fade;
        body.offset.y *= fade;
        if (Math.abs(body.offset.x) < 0.05) body.offset.x = 0;
        if (Math.abs(body.offset.y) < 0.05) body.offset.y = 0;
      }
    },
    place(key, point, absorb) {
      const body = bodies.get(key);
      if (!body) {
        bodies.set(key, {
          offset: { x: 0, y: 0 },
          raw: { x: point.x, y: point.y },
          seen: true,
        });
        return { x: point.x, y: point.y };
      }
      const { raw, before } = body;
      // Without two earlier frames there is no speed to expect the body to carry on at: nothing to compare with.
      if (absorb && before && beforeDt > 0) {
        // `raw` was the picture `dt` ago and `before` a frame earlier still, `beforeDt` apart: the picture was
        // expected to carry on at that speed, and what it did instead is the error to hide.
        const scale = dt / beforeDt,
          dx = raw.x + (raw.x - before.x) * scale - point.x,
          dy = raw.y + (raw.y - before.y) * scale - point.y;
        if (Math.hypot(dx, dy) > options.teleport) body.offset = { x: 0, y: 0 };
        else {
          body.offset.x += dx;
          body.offset.y += dy;
        }
      }
      body.before = body.raw;
      body.raw = { x: point.x, y: point.y };
      body.seen = true;
      return { x: point.x + body.offset.x, y: point.y + body.offset.y };
    },
    reset() {
      bodies.clear();
      last = -1;
      dt = beforeDt = 0;
    },
  };
}

export interface CorrectionFrame {
  scope: string;
  revision: number;
  tick: number;
  nowMs: number;
}

/** Start a correction frame. A new scope clears positions while the log markers still track the last frame. */
export function createCorrectionFrames(smoother: CorrectionSmoother) {
  let scope = "";
  let revision: number | undefined;
  let tick = -1;
  return (frame: CorrectionFrame) => {
    if (frame.scope !== scope) {
      scope = frame.scope;
      smoother.reset();
    }
    smoother.begin(frame.nowMs);
    const rolled = revision !== undefined && frame.revision !== revision;
    const stepped = frame.tick !== tick;
    revision = frame.revision;
    tick = frame.tick;
    return { rolled, stepped };
  };
}

type HeldInputs<Key extends string | number> = Readonly<
  Partial<Record<Key, number>>
>;

/** A held input can explain a correction only when the folded tick changes. An absent input is neutral. */
export function createHeldInputCorrectionFrames<
  Key extends string | number,
  Inputs extends HeldInputs<Key> = HeldInputs<Key>,
>(
  smoother: CorrectionSmoother,
  empty: Inputs,
  snapshot: (held: Inputs) => Inputs = (held) => held,
) {
  const begin = createCorrectionFrames(smoother);
  let logged = empty;
  return (frame: CorrectionFrame, held: Inputs) => {
    const { rolled, stepped } = begin(frame);
    const before = logged;
    logged = snapshot(held);
    return {
      rolled,
      changed: (key: Key) => stepped && (before[key] ?? 0) !== (held[key] ?? 0),
    };
  };
}

/** Reuse deterministic bot inputs across presentation frames, bounded by each game's working set. */
export function memoizeLeadInput<Args extends unknown[]>(
  bot: (...args: Args) => number,
  keyFor: (revision: number, ...args: Args) => string,
  capacity: number,
): (revision: number) => (...args: Args) => number {
  const cache = new Map<string, number>();
  return (revision) =>
    (...args) => {
      const key = keyFor(revision, ...args);
      const known = cache.get(key);
      if (known !== undefined) return known;
      if (cache.size >= capacity) cache.clear();
      const bits = bot(...args);
      cache.set(key, bits);
      return bits;
    };
}

const CUE_COUNTER_RANGE = 0x10000;

/** A 16-bit effect counter's forward movement, with rollback and an unchanged count both yielding zero. */
export function gainedCueCount(was: number, now: number): number {
  const moved = (now - was + CUE_COUNTER_RANGE) % CUE_COUNTER_RANGE;
  return moved < CUE_COUNTER_RANGE / 2 ? moved : 0;
}

interface PresentationCue extends Point {
  kind: string;
  slot: number;
  at: number;
}

type CueFrame<Fx> = { seed: number; step: number; fx: readonly Fx[] };

/** Step and pixel tolerances used to identify a predicted effect after a correction. */
export const TWIN_STEPS = 6,
  TWIN_PX = 20;

/** Suppress a shifted duplicate of an effect already drawn. Reset the history when the round changes. */
export function createCueLatch<
  Fx extends PresentationCue,
  View extends CueFrame<Fx>,
>(
  effectKey: (effect: Fx) => string,
  replaceFx: (view: View, fx: Fx[]) => View,
): (view: View) => View {
  let seed = -1,
    shown: Fx[] = [],
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
    const fresh: Fx[] = [];
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
    // Effects live under a second: what was shown long ago can neither return nor have a twin.
    if (shown.length > 200) {
      shown = shown.filter((each) => view.step - each.at <= 120);
      kept = new Set(shown.map(effectKey));
      dropped = new Set([...dropped].slice(-200));
    }
    return same ? view : replaceFx(view, fx);
  };
}
