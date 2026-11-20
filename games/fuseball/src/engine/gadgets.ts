import { advanceBall } from "./ball-flight.js";
import { apart, carried, resolveSolids, settle, type Body } from "./collide.js";
import { SUB, abs, clamp, div, isqrt, toward } from "./math.js";
import {
  barrierBoxesOf,
  boxesAt,
  gooZonesOf,
  streamZonesOf,
  type Box,
  type MapDef,
  type Pt,
  type Rect,
} from "./maps.js";
import * as T from "./tuning.js";

/**
 * The ball against an arena's gadgets: liquids (goo and jets), barriers (force fields and gates), bumpers and portals. They act on the ball
 * alone, so this is all of their rules. `step.ts` runs it on the world's ball every step; the bot runs it on a copy
 * to see where a ball is going, so what it predicts is what will happen.
 */

/**
 * One barrier's state. A field: `left` strikes until it breaks (0 is broken), and `timer` steps until the next
 * strike counts. A gate: `timer` steps it stays open (0 is shut); `left` is always 0.
 */
export interface BarrierState {
  left: number;
  timer: number;
}

/** Every barrier as a point starts: fields whole, gates shut. */
export const freshBarriers = (map: MapDef): BarrierState[] =>
  map.barriers.map((barrier) => ({
    left: barrier.kind === "field" ? barrier.hits : 0,
    timer: 0,
  }));

/** Whether a barrier stands in the ball's way as things are. */
export const barrierUp = (
  barrier: MapDef["barriers"][number],
  state: BarrierState,
): boolean => (barrier.kind === "field" ? state.left > 0 : state.timer === 0);

/** Whether the ball overlaps the box at all. */
function overlaps(ball: Body, box: Box, map: MapDef): boolean {
  const { dx, dy } = apart(ball.x, ball.y, box.cx, box.cy, map),
    ex = dx - clamp(dx, -box.hw, box.hw),
    ey = dy - clamp(dy, -box.hh, box.hh);
  return ex * ex + ey * ey < T.BALL_R * T.BALL_R;
}

/** Whether the ball's centre is inside one of the zones (sub-unit rects inside the field). */
const within = (ball: Body, zones: readonly Rect[]): boolean =>
  zones.some(
    (zone) =>
      ball.x >= zone.x &&
      ball.x < zone.x + zone.w &&
      ball.y >= zone.y &&
      ball.y < zone.y + zone.h,
  );

function meetField(
  ball: Body,
  box: Box,
  map: MapDef,
  state: BarrierState,
): number {
  if (state.timer > 0) state.timer--;
  if (state.left === 0) return 0;
  const touch = resolveSolids(ball, T.BALL_R, [box], map, 1, 1);
  if (!touch.hit) return 0;
  // Thrown back along the face it struck, never slower than the field's own kick.
  const { dx, dy } = apart(ball.x, ball.y, box.cx, box.cy, map),
    ex = dx - clamp(dx, -box.hw, box.hw),
    ey = dy - clamp(dy, -box.hh, box.hh);
  if (abs(ex) >= abs(ey)) {
    const side = ex >= 0 ? 1 : -1;
    if (ball.vx * side < T.FIELD_KICK) ball.vx = side * T.FIELD_KICK;
  } else {
    const side = ey > 0 ? 1 : -1;
    if (ball.vy * side < T.FIELD_KICK) ball.vy = side * T.FIELD_KICK;
  }
  // A strike wears it down, but not twice in one breath: a ball held against it is one strike, not many.
  if (state.timer === 0) {
    state.left--;
    state.timer = T.FIELD_COOL_STEPS;
  }
  return 1;
}

function meetGate(
  ball: Body,
  box: Box,
  map: MapDef,
  state: BarrierState,
): number {
  if (state.timer > 0) {
    // Open. It does not shut on the ball: the last step waits until the ball is out of the doorway.
    if (state.timer > 1 || !overlaps(ball, box, map)) state.timer--;
    return 0;
  }
  const touch = resolveSolids(
    ball,
    T.BALL_R,
    [box],
    map,
    T.BALL_BOUNCE_NUM,
    T.BALL_BOUNCE_DEN,
  );
  if (!touch.hit) return 0;
  ball.vx -= div(ball.vx, T.BALL_SCRUB);
  ball.vy -= div(ball.vy, T.BALL_SCRUB);
  // A shut door is tacky on top: a ball rolling onto it is held there, where a lift or a stamp can knock it in.
  if (
    touch.impact < T.GATE_KNOCK &&
    abs(apart(ball.x, ball.y, box.cx, box.cy, map).dx) < box.hw
  )
    ball.vx -= div(ball.vx, T.GATE_GRIP);
  if (abs(ball.vx) < T.BALL_SCRUB) ball.vx = 0;
  if (abs(ball.vy) < T.BALL_SCRUB) ball.vy = 0;
  // Knocked hard enough, it opens. A ball rolled onto it or lying on it does nothing.
  if (touch.impact >= T.GATE_KNOCK) state.timer = T.GATE_OPEN_STEPS;
  return Number(touch.impact >= T.BOUNCE_FX);
}

/** A ball moving into an end exits the other end with reduced speed. */
function enterPortal(
  ball: Body,
  from: Pt,
  to: Pt,
  radius: number,
  map: MapDef,
): boolean {
  const { dx, dy } = apart(ball.x, ball.y, from.x * SUB, from.y * SUB, map),
    r = radius * SUB;
  if (dx * dx + dy * dy >= r * r) return false;
  if (ball.vx * dx + ball.vy * dy >= 0) return false;
  ball.x = to.x * SUB;
  ball.y = to.y * SUB;
  ball.vx = div(ball.vx * T.PORTAL_KEEP_NUM, T.PORTAL_KEEP_DEN);
  ball.vy = div(ball.vy * T.PORTAL_KEEP_NUM, T.PORTAL_KEEP_DEN);
  return true;
}

/**
 * One step of the ball against the gadgets, after the solids have had it: it may be thrown back, bumped or carried
 * through a portal, and the barriers' state moves on. Returns how many of those were worth a sound.
 */
export function meetGadgets(
  map: MapDef,
  barriers: BarrierState[],
  ball: Body,
): number {
  let struck = 0;
  // The liquids first, since they only change its speed: goo takes a share of it, a jet pushes it up.
  if (within(ball, gooZonesOf(map))) {
    ball.vx -= div(ball.vx, T.GOO_DRAG);
    ball.vy -= div(ball.vy, T.GOO_DRAG);
  }
  if (within(ball, streamZonesOf(map))) {
    ball.vx -= div(ball.vx, T.STREAM_DRAG);
    ball.vy -= div(ball.vy, T.STREAM_DRAG);
    if (ball.vy > -T.STREAM_SPEED) ball.vy -= T.STREAM_PUSH;
  }
  const boxes = barrierBoxesOf(map);
  for (let i = 0; i < map.barriers.length; i++) {
    const barrier = map.barriers[i]!,
      state = barriers[i]!,
      box = boxes[i]!;
    struck +=
      barrier.kind === "field"
        ? meetField(ball, box, map, state)
        : meetGate(ball, box, map, state);
  }

  for (const bumper of map.bumpers) {
    const { dx, dy } = apart(
        ball.x,
        ball.y,
        bumper.x * SUB,
        bumper.y * SUB,
        map,
      ),
      d2 = dx * dx + dy * dy,
      reach = bumper.r * SUB + T.BALL_R;
    if (d2 >= reach * reach) continue;
    const out = toward(dx, dy, reach - isqrt(d2)),
      away = toward(dx, dy, T.BUMP);
    ball.x += out.x;
    ball.y += out.y;
    ball.vx = div(ball.vx, 2) + away.x;
    ball.vy = div(ball.vy, 2) + away.y;
    struck++;
  }

  // At most one portal per step, checking each pair's first end before its second.
  for (const { a, b, r } of map.portals)
    if (enterPortal(ball, a, b, r, map) || enterPortal(ball, b, a, r, map))
      return struck + 1;
  return struck;
}

/**
 * One micro-step of a ball nobody touches, as `step.ts` moves it on micro-step `step`: a mover's carry, gravity,
 * the ledges, the solids and the gadgets. `barriers` is the flight's own copy of the fields and gates, which it
 * wears down and opens as the real ones would be. The bot reads a ball's flight with it, and the level generator
 * drops balls with it to see where they come to rest. The bot's approximate forecast retains tiny velocities, as
 * its planner did before generation was introduced; validation uses the live engine's rest threshold. Snapping the
 * forecast changes its landing estimates. Returns how far a mover carried the ball, so a ball lying on one can be
 * told from one that is still going somewhere.
 */
export function drift(
  ball: Body,
  map: MapDef,
  barriers: BarrierState[],
  step: number,
  snapAtRest = true,
): { x: number; y: number } {
  const by = carried(ball, T.BALL_R, map, step, T.CARRY_SLOP);
  advanceBall(ball, map, boxesAt(map, step), snapAtRest);
  meetGadgets(map, barriers, ball);
  settle(ball, T.BALL_R, map);
  return by;
}
