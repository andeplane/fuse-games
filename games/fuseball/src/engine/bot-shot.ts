import { apart } from "./collide.js";
import { SUB, abs, div } from "./math.js";
import {
  boxesAt,
  isCircle,
  type Circle,
  type Rect,
  type MapDef,
  type Pt,
} from "./maps.js";
import * as T from "./tuning.js";
import type { Slot, World } from "./world.js";

/** A line to a goal is clear when the ball has this much room either side of it, and ends this far inside the mouth. */
const BALL_ROOM = T.BALL_R - SUB;
const MOUTH = 12 * SUB;

/** One way from the ball to a goal along an axis, or the other way round the seam. */
const ways = (
  to: number,
  from: number,
  size: number,
  wraps: boolean,
): number[] => {
  const direct = to - from;
  return wraps
    ? [direct, direct > 0 ? direct - size : direct + size]
    : [direct];
};

/**
 * Whether the straight line from a point along `(dx, dy)` passes through a box `hw` by `hh` about `(cx, cy)`, the
 * centre given from the line's start: the stretch of the line inside the box, kept as two fractions and compared by
 * cross-multiplying, is not empty.
 */
function meets(
  dx: number,
  dy: number,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
): boolean {
  let inN = 0,
    inD = 1,
    outN = 1,
    outD = 1;
  const axis = (d: number, low: number, high: number): boolean => {
    if (d === 0) return low < 0 && high > 0;
    const den = abs(d),
      near = d > 0 ? low : -high,
      far = d > 0 ? high : -low;
    if (near * inD > inN * den) {
      inN = near;
      inD = den;
    }
    if (far * outD < outN * den) {
      outN = far;
      outD = den;
    }
    return true;
  };
  return (
    axis(dx, cx - hw, cx + hw) &&
    axis(dy, cy - hh, cy + hh) &&
    inN * outD < outN * inD
  );
}

/** The same box seen from `(bx, by)`: the short way round, and one field over each way on an axis that wraps. */
function meetsAny(
  map: MapDef,
  dx: number,
  dy: number,
  at: { dx: number; dy: number },
  hw: number,
  hh: number,
): boolean {
  for (const kx of map.wrapX ? [0, -1, 1] : [0])
    for (const ky of map.wrapY ? [0, -1, 1] : [0])
      if (
        meets(
          dx,
          dy,
          at.dx + kx * map.w * SUB,
          at.dy + ky * map.h * SUB,
          hw,
          hh,
        )
      )
        return true;
  return false;
}

/**
 * Whether a ball at `(bx, by)` sent straight along `(dx, dy)` would run into a solid or into the other colour's
 * goal on the way: a wall in front of a goal, a kerb, a pit that is not this rider's. The solid the ball is lying
 * on is not in the way — a ball rolls along a floor.
 */
function barred(
  world: World,
  map: MapDef,
  slot: Slot,
  bx: number,
  by: number,
  dx: number,
  dy: number,
): boolean {
  for (const box of boxesAt(map, world.clock)) {
    const at = apart(box.cx, box.cy, bx, by, map);
    if (
      abs(dy) <= abs(dx) &&
      abs(at.dx) <= box.hw &&
      at.dy > 0 &&
      at.dy - box.hh <= T.BALL_R + 2 * SUB
    )
      continue;
    if (meetsAny(map, dx, dy, at, box.hw + BALL_ROOM, box.hh + BALL_ROOM))
      return true;
  }
  return gifts(map, slot, bx, by, dx, dy);
}

/** Whether that line runs through the other colour's goal, or within a ball's width of it. */
export function gifts(
  map: MapDef,
  slot: Slot,
  bx: number,
  by: number,
  dx: number,
  dy: number,
): boolean {
  for (const goal of map.goals) {
    if (goal.team === slot || isCircle(goal)) continue;
    const hw = div(goal.w * SUB, 2),
      hh = div(goal.h * SUB, 2),
      at = apart(goal.x * SUB + hw, goal.y * SUB + hh, bx, by, map);
    if (meetsAny(map, dx, dy, at, hw + BALL_ROOM, hh + BALL_ROOM)) return true;
  }
  return false;
}

/**
 * From the ball to the goal in `slot`'s colour that is cheapest to reach. A goal in a wall sits on the seam back to
 * back with the other colour's, so it is only approached from inside the field, at its middle or near either end,
 * whichever the ball has a clear line to. A round goal hangs in open space and may be reached round the seam, but
 * never along a line that crosses the other colour's goal first. Upwards costs double: the ball falls by itself.
 * `over` says no line was clear: the ball has to go over whatever is in the way.
 */
export function aim(
  world: World,
  map: MapDef,
  slot: Slot,
  bx: number,
  by: number,
): { x: number; y: number; over: boolean } {
  let best = { x: 0, y: 0, over: false },
    cheapest = -1;
  const weigh = (x: number, y: number, penalty: number, over = false) => {
    const cost = abs(x) + (y < 0 ? -2 * y : y) + penalty;
    if (cheapest < 0 || cost < cheapest) {
      best = { x, y, over };
      cheapest = cost;
    }
  };
  const origin = { x: bx, y: by };
  for (const goal of map.goals) {
    if (goal.team !== slot) continue;
    if (isCircle(goal)) weighRoundGoal(map, goal, origin, weigh);
    else weighWallGoal(world, map, goal, origin, weigh);
  }
  return best;
}

type Weigh = (x: number, y: number, penalty: number, over?: boolean) => void;

function weighWallGoal(
  world: World,
  map: MapDef,
  goal: Rect & { team: Slot },
  { x: bx, y: by }: Pt,
  weigh: Weigh,
) {
  const cx = div((goal.x * 2 + goal.w) * SUB, 2) - bx;
  const cy = div((goal.y * 2 + goal.h) * SUB, 2) - by;
  // The mouth runs along the longer side. Its ends are checked a ball's width in.
  const tall = goal.h >= goal.w;
  const end = div((tall ? goal.h : goal.w) * SUB, 2) - MOUTH;
  for (const off of end > 0 ? [0, -end, end] : [0]) {
    const x = tall ? cx : cx + off;
    const y = tall ? cy + off : cy;
    const shut = barred(world, map, goal.team, bx, by, x, y);
    weigh(x, y, shut ? map.w * SUB : 0, shut);
  }
}

function crossesOtherGoal(
  map: MapDef,
  slot: Slot,
  originX: number,
  shotX: number,
) {
  return map.goals.some((other) => {
    if (other.team === slot || !isCircle(other)) return false;
    const at = other.x * SUB - originX;
    const reach = (other.r + T.BALL_RADIUS) * SUB;
    return [at, at - map.w * SUB, at + map.w * SUB].some((ox) =>
      shotX > 0 ? ox > -reach && ox < shotX : ox < reach && ox > shotX,
    );
  });
}

function weighRoundGoal(
  map: MapDef,
  goal: Circle & { team: Slot },
  ball: Pt,
  weigh: Weigh,
) {
  for (const x of ways(goal.x * SUB, ball.x, map.w * SUB, map.wrapX)) {
    const penalty = crossesOtherGoal(map, goal.team, ball.x, x)
      ? map.w * SUB
      : 0;
    for (const y of ways(goal.y * SUB, ball.y, map.h * SUB, map.wrapY))
      weigh(x, y, penalty);
  }
}
