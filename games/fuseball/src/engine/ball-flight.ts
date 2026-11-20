import { landLedges, resolveSolids, type Body, type Touch } from "./collide.js";
import { abs, clamp, div } from "./math.js";
import { ledgeBoxesOf, type Box, type MapDef } from "./maps.js";
import * as T from "./tuning.js";

/** Advance the ball after any mover carry, returning the impact before gadgets or riders touch it. */
export function advanceBall(
  ball: Body,
  map: MapDef,
  boxes: readonly Box[],
  snapAtRest = true,
): number {
  ball.vy += T.BALL_GRAVITY;
  ball.vx = clamp(ball.vx, -T.BALL_MAX, T.BALL_MAX);
  ball.vy = clamp(ball.vy, -T.BALL_MAX, T.BALL_MAX);
  ball.x += ball.vx;
  ball.y += ball.vy;
  const landed: Touch = { hit: false, ground: false, impact: 0 };
  landLedges(
    ball,
    T.BALL_R,
    ledgeBoxesOf(map),
    map,
    T.BALL_BOUNCE_NUM,
    T.BALL_BOUNCE_DEN,
    T.LEDGE_SLOP,
    landed,
  );
  const touch = resolveSolids(
    ball,
    T.BALL_R,
    boxes,
    map,
    T.BALL_BOUNCE_NUM,
    T.BALL_BOUNCE_DEN,
  );
  if (!touch.hit && !landed.hit) return 0;
  ball.vx -= div(ball.vx, T.BALL_SCRUB);
  ball.vy -= div(ball.vy, T.BALL_SCRUB);
  if (snapAtRest) {
    if (abs(ball.vx) < T.BALL_SCRUB) ball.vx = 0;
    if (abs(ball.vy) < T.BALL_SCRUB) ball.vy = 0;
  }
  return Math.max(touch.impact, landed.impact);
}
