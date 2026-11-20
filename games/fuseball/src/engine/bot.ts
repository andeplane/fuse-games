import { aim, gifts } from "./bot-shot.js";
import { apart, inShape } from "./collide.js";
import { drift } from "./gadgets.js";
import { BTN, DOWN, LEFT, RIGHT } from "./input.js";
import { SUB, abs, div, isqrt } from "./math.js";
import {
  arenaOf,
  barrierBoxesOf,
  boxesAt,
  isCircle,
  type Box,
  type MapDef,
} from "./maps.js";
import * as T from "./tuning.js";
import { stepWorld } from "./step.js";
import { copyWorld, type Rider, type Slot, type World } from "./world.js";

/**
 * The computer's rider. It reads the world the way a player reads the screen and answers with the bits it holds for
 * the next log tick: nothing here moves anything, so it has no physics a player lacks. It keeps no memory and rolls
 * no dice — its answer is a function of the world alone — so every device folding a bot seat gets the same bits, and
 * a rollback replays them. It is part of the rules: changing it must bump `RULES`.
 *
 * The plan is one a beginner would recognise: see where the ball is going, get to the far side of it from the goal
 * in its own colour, then fly through it towards that goal. On the wrong side it goes round the ball instead of
 * through it, since knocking the ball the other way is how own goals happen; and a ball already on its way into its
 * goal is left alone. Every so often it takes a breather, which is what makes it beatable.
 *
 * Nothing here knows an arena by name. With several goals in its colour it takes the one cheapest to reach, the
 * short way round a seam included; a line to a goal that a wall, a kerb or the other colour's goal stands on is no
 * line, and then the ball is lobbed or lifted over. It finds its own way round solids the same way, by their
 * corners, and takes the long way round a seam when that is the shorter trip. Near the ball it looks before it
 * touches: what it means to hold is played forward with the real rules (`outcome`), and a touch that would come back
 * off a wall into the other colour's goal is swapped for one that would not. What it cannot see (more than a few
 * seconds on, or what the other rider does next) still costs it a point now and then.
 */
const UNIT = 1024;
/** How far ahead it reads the ball's flight, in micro-steps, and how coarsely it looks for a meeting point. */
const SIGHT = 180,
  STRIDE = 6;
/**
 * Within this of the ball it weighs what its touch would do: it plays `PREVIEW` micro-steps of what it means to hold,
 * then reads the ball's flight `FORESIGHT` micro-steps on.
 */
const WARY = 64 * SUB,
  PREVIEW = 12,
  FORESIGHT = 420;
/** The speed it reckons it can close on the ball at, in sub-units a step: a little under a run. */
const PACE = 6500;
/** How far behind the ball it lines up, and how wide it swings to get round it. */
const STANDOFF = 20 * SUB,
  ROUND = 30 * SUB;
/** Inside this it is behind the ball closely enough to go for it. */
const LINED_UP = 14 * SUB;
/** The stick is centred when the target is this close sideways. */
const DEAD = 3 * SUB;
/** It flaps when the target is this far above, and dives when it is this far below. */
const CLIMB = 4 * SUB,
  SINK = 26 * SUB,
  DIVE = 70 * SUB;
/** How much room it leaves between itself and a platform it is going round. */
const CLEAR = 5 * SUB;
/** How many points along the straight line to its target it checks for a solid in the way. */
const LOOKS = 16;
/** A slide is worth it from this far along the floor, and ends this close. */
const SLIDE_FROM = 110 * SUB,
  SLIDE_UNTIL = 40 * SUB;
/** A ball slower than this, in sub-units a step, is sitting: next to it on the floor the move is a lift. */
const SITTING = 600;
/** A rider slower than this is standing still: a lift from here goes straight up. */
const STILL = 64;
/** A goal within `NUDGE_RANGE` and not above is nudged at: from `NUDGE_FROM` behind the ball, no faster than `NUDGE`. */
const NUDGE_RANGE = 300 * SUB,
  NUDGE_FROM = 60 * SUB,
  NUDGE = 3200;
/** The ball is at its feet inside this, and it is standing in the ball inside `BURIED`. */
const TOUCHING = T.RIDER_R + T.BALL_R + SUB;
const BURIED = div(T.RIDER_R + T.BALL_R, 2);
/** The other rider this close to a sitting ball is pinning it. */
const PIN = 30 * SUB;
/** Running at least this fast, a lift takes the ball along. */
const CARRY = 4000;
/** A solid this close in front of it on the ground is one to hop. */
const HOP = 4 * SUB;
/** A lob's direction, in `UNIT`s: three along and four up. */
const LOB_X = div(UNIT * 3, 5),
  LOB_Y = div(UNIT * 4, 5);
/** How far along a lob it looks for the other colour's goal, in sub-units per `UNIT` of direction: 260 pixels. */
const LOB_REACH = div(260 * SUB, UNIT);
/** Its attention comes in spells this many micro-steps long; in `REST_OF` of every `SPELLS` it does nothing. */
const SPELL = 84,
  SPELLS = 9,
  REST_OF = 1;

/** Where the ball is heading by itself: the meeting point it offers this rider, and the goal it ends in, if any. */
interface Flight {
  x: number;
  y: number;
  /** The colour of the goal it falls into within `SIGHT`, or −1. */
  into: -1 | Slot;
}

/**
 * A ball flown forward from `(x, y)` at `(vx, vy)` with nobody touching it: gravity and the solids, as `step.ts`
 * moves it, for `steps` micro-steps or until it falls into a goal. With a `rider`, the point returned is the first
 * one that rider could reach in time; without, where the ball ends up.
 */
function flight(
  world: World,
  map: MapDef,
  from: { x: number; y: number; vx: number; vy: number },
  steps: number,
  rider?: Rider,
): Flight {
  const ball = { x: from.x, y: from.y, vx: from.vx, vy: from.vy },
    barriers = world.barriers.map((barrier) => ({ ...barrier }));
  let meet: { x: number; y: number } | undefined;
  for (let step = 1; step <= steps; step++) {
    drift(ball, map, barriers, world.clock + step, false);
    const goal = map.goals.find((each) => inShape(ball.x, ball.y, each, map));
    if (goal) return { ...(meet ?? ball), into: goal.team };
    if (rider && !meet && step % STRIDE === 0) {
      const gap = apart(ball.x, ball.y, rider.x, rider.y, map),
        far = abs(gap.dx) + abs(gap.dy) - STANDOFF;
      if (far <= PACE * step) meet = { x: ball.x, y: ball.y };
    }
  }
  return { ...(meet ?? ball), into: -1 };
}

/**
 * Where the ball ends up if this rider holds `bits` for the next `PREVIEW` micro-steps: the world is copied and
 * stepped with the real rules (everyone else holding what they hold now), then the ball is flown on by itself.
 * The answer is the colour of the goal it falls into, or −1. This is how it sees that a touch would come back off a
 * wall and into the other colour's goal before it makes it.
 */
function outcome(
  world: World,
  rider: Rider,
  bits: number,
  map: MapDef,
): -1 | Slot {
  const ahead = copyWorld(world),
    inputs = new Map(
      ahead.riders.map((each) => [
        each.id,
        each.index === rider.index ? bits : each.prev,
      ]),
    );
  for (let step = 0; step < PREVIEW; step++) {
    stepWorld(ahead, inputs);
    if (ahead.phase !== "play") return ahead.lastScorer;
  }
  return flight(ahead, map, ahead.ball, FORESIGHT).into;
}

/**
 * The way to a spot `to` away, round whatever solid stands on the straight line there: the first one the line meets
 * is passed by its corner that makes the shortest trip, among the corners a rider fits at. `ball` is where the ball
 * it is after will be.
 */
function route(
  world: World,
  rider: Rider,
  map: MapDef,
  to: { dx: number; dy: number },
  ball: { x: number; y: number },
  depth = 0,
): { dx: number; dy: number; clear: boolean; trip: number } {
  const boxes = boxesAt(map, world.clock),
    snug = T.RIDER_R - SUB,
    body = T.RIDER_R + CLEAR;
  const solidAt = (x: number, y: number) =>
    boxes.find((box) => {
      const at = apart(x, y, box.cx, box.cy, map);
      return abs(at.dx) < box.hw + snug && abs(at.dy) < box.hh + snug;
    });
  const fits = (x: number, y: number) =>
    (map.wrapX || (x >= T.RIDER_R && x <= map.w * SUB - T.RIDER_R)) &&
    (map.wrapY || (y >= T.RIDER_R && y <= map.h * SUB - T.RIDER_R)) &&
    !solidAt(x, y);
  // A spot hard against a solid (a ball lying on the floor) is as near as it gets: that solid is not in the way.
  // Unless the ball is on its far face: a ball on a ledge is not reached through the ledge from below.
  let resting = solidAt(rider.x + to.dx, rider.y + to.dy);
  if (resting) {
    const mine = apart(rider.x, rider.y, resting.cx, resting.cy, map),
      its = apart(ball.x, ball.y, resting.cx, resting.cy, map);
    if (
      (mine.dy >= resting.hh && its.dy <= -resting.hh) ||
      (mine.dy <= -resting.hh && its.dy >= resting.hh)
    )
      resting = undefined;
  }
  /** The first solid on the straight line from the rider along `(dx, dy)`, but for `skip`. */
  const blocks = (dx: number, dy: number, skip?: Box) => {
    for (let i = 1; i < LOOKS; i++) {
      const box = solidAt(
        rider.x + div(dx * i, LOOKS),
        rider.y + div(dy * i, LOOKS),
      );
      if (box && box !== skip) return box;
    }
    return undefined;
  };
  const box = blocks(to.dx, to.dy, resting),
    straight = abs(to.dx) + abs(to.dy);
  if (!box) return { ...to, clear: true, trip: straight };
  const at = apart(box.cx, box.cy, rider.x, rider.y, map);
  // With no corner to go round by, it presses on, and the trip counts as longer than any other way.
  let best = {
      ...to,
      clear: false,
      trip: straight + map.w * SUB + map.h * SUB,
    },
    open = false,
    behind = false;
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      const dx = at.dx + sx * (box.hw + body),
        dy = at.dy + sy * (box.hh + body);
      // A corner it already stands at leads nowhere.
      if (abs(dx) <= CLEAR && abs(dy) <= CLEAR) continue;
      if (!fits(rider.x + dx, rider.y + dy)) continue;
      // A corner behind something else (a kerb hanging beside the roof's end) is a longer trip than it looks.
      const shut = blocks(dx, dy, box) !== undefined,
        trip =
          abs(dx) +
          abs(dy) +
          abs(to.dx - dx) +
          abs(to.dy - dy) +
          (shut ? map.w * SUB : 0);
      if (!open || trip < best.trip) {
        best = { dx, dy, clear: false, trip };
        open = true;
        behind = shut;
      }
    }
  if (behind && depth < 2) {
    // The corner to make for is itself behind something: that is gone round first.
    const via = route(world, rider, map, best, ball, depth + 1);
    return { dx: via.dx, dy: via.dy, clear: false, trip: best.trip };
  }
  return best;
}

/**
 * The way to a spot: the short way when nothing stands on it. When something does and the arena wraps, the long
 * way round a seam is taken instead if that makes the shorter trip, going round whatever stands on it: a roof between
 * it and a ball just the other side of the seam is not flown into for ever.
 */
function path(
  world: World,
  rider: Rider,
  map: MapDef,
  to: { dx: number; dy: number },
  ball: { x: number; y: number },
): { dx: number; dy: number } {
  const short = route(world, rider, map, to, ball);
  if (short.clear || !(map.wrapX || map.wrapY)) return short;
  const otherX = to.dx > 0 ? to.dx - map.w * SUB : to.dx + map.w * SUB,
    otherY = to.dy > 0 ? to.dy - map.h * SUB : to.dy + map.h * SUB;
  let best = short;
  for (const dx of map.wrapX ? [to.dx, otherX] : [to.dx])
    for (const dy of map.wrapY ? [to.dy, otherY] : [to.dy]) {
      if (dx === to.dx && dy === to.dy) continue;
      const round = route(world, rider, map, { dx, dy }, ball);
      if (round.trip < best.trip) best = round;
    }
  return best;
}

export function botInput(world: World, rider: Rider): number {
  if (world.phase !== "play" || rider.zapped || !world.ball.live) return 0;
  const map = arenaOf(world),
    bits = keeps(world, rider, map)
      ? guard(world, rider, map)
      : plan(world, rider, map);
  // Near the ball it looks before it touches: what it means to hold is played forward, and when that ends in the
  // other colour's goal it holds the first thing that does not. With no such thing, it carries on as it meant to.
  const gap = apart(world.ball.x, world.ball.y, rider.x, rider.y, map);
  if (gap.dx * gap.dx + gap.dy * gap.dy > WARY * WARY) return bits;
  const gives = (held: number): boolean => {
    const into = outcome(world, rider, held, map);
    return into !== -1 && into !== rider.slot;
  };
  if (!gives(bits)) return bits;
  const away = gap.dx > 0 ? LEFT : RIGHT,
    toward = gap.dx > 0 ? RIGHT : LEFT,
    press = rider.prev & BTN ? 0 : BTN;
  for (const held of [
    0,
    away,
    away | press,
    toward,
    toward | press,
    press,
    DOWN,
    away | DOWN,
  ])
    if (held !== bits && !gives(held)) return held;
  return bits;
}

/**
 * A ball lying on a shut trapdoor over this rider's goal is one lift from a point: thrown straight up, it comes down
 * hard enough to knock the door open and drops through. The answer is the spot to lift it from, on the floor beside
 * the door and seen from the rider, or undefined when there is no such ball.
 */
function trapdoor(
  world: World,
  rider: Rider,
  map: MapDef,
): { dx: number; dy: number } | undefined {
  const ball = world.ball;
  if (abs(ball.vx) >= SITTING || abs(ball.vy) >= SITTING) return undefined;
  const boxes = barrierBoxesOf(map);
  for (let i = 0; i < map.barriers.length; i++) {
    const gate = map.barriers[i]!,
      box = boxes[i]!;
    if (gate.kind !== "gate" || world.barriers[i]!.timer > 0) continue;
    const on = apart(ball.x, ball.y, box.cx, box.cy, map);
    if (abs(on.dx) >= box.hw || on.dy >= 0 || -on.dy > box.hh + T.BALL_R + SUB)
      continue;
    const mine = map.goals.some(
      (goal) =>
        goal.team === rider.slot &&
        !isCircle(goal) &&
        goal.x < gate.x + gate.w &&
        goal.x + goal.w > gate.x &&
        goal.y <= gate.y + gate.h + T.BALL_RADIUS &&
        goal.y + goal.h > gate.y,
    );
    if (!mine) continue;
    // On this rider's side of the door, unless the ball is out of a lift's reach from there.
    const me = apart(rider.x, rider.y, box.cx, box.cy, map),
      edge = box.hw + T.RIDER_R + 2 * SUB,
      near = me.dx < 0 ? -1 : 1,
      side = abs(on.dx - near * edge) < T.LIFT_X - 4 * SUB ? near : -near;
    return { dx: side * edge - me.dx, dy: -box.hh - T.RIDER_R - me.dy };
  }
  return undefined;
}

/** How far it is from the ball, as it counts a trip: along plus up or down. */
const farFrom = (world: World, rider: Rider, map: MapDef): number => {
  const gap = apart(world.ball.x, world.ball.y, rider.x, rider.y, map);
  return abs(gap.dx) + abs(gap.dy);
};

/**
 * Whether this rider is its side's keeper for now: with two or three riders on a side, the one furthest from the
 * ball minds the goal the other side scores in while the rest go for the ball. Riders who are zapped are not
 * counted, and a tie goes to the later rider, so every device picks the same one. A player on the side is counted
 * like a bot: when they are the one furthest back, the bots leave the goal to them and go forward.
 */
function keeps(world: World, rider: Rider, map: MapDef): boolean {
  const mine = farFrom(world, rider, map);
  let mates = 0;
  for (const mate of world.riders) {
    if (mate.slot !== rider.slot || mate.index === rider.index || mate.zapped)
      continue;
    mates++;
    const theirs = farFrom(world, mate, map);
    if (theirs > mine || (theirs === mine && mate.index > rider.index))
      return false;
  }
  return mates > 0;
}

/**
 * The keeper: it stands `POST` in front of the other colour's goal nearest the ball, on the ball's side of it, and
 * when the ball comes within `DANGER` of that goal it goes for the ball like anybody else.
 */
const POST = 44 * SUB,
  DANGER = 120 * SUB,
  AT_POST = 8 * SUB;
function guard(world: World, rider: Rider, map: MapDef): number {
  const ball = world.ball;
  let post: { dx: number; dy: number } | undefined,
    nearest = -1;
  for (const goal of map.goals) {
    if (goal.team === rider.slot) continue;
    const gx = isCircle(goal)
        ? goal.x * SUB
        : div((goal.x * 2 + goal.w) * SUB, 2),
      gy = isCircle(goal) ? goal.y * SUB : div((goal.y * 2 + goal.h) * SUB, 2),
      out = apart(ball.x, ball.y, gx, gy, map),
      far = isqrt(out.dx * out.dx + out.dy * out.dy);
    if (nearest >= 0 && far >= nearest) continue;
    nearest = far;
    const step = far > 0 ? div(POST * UNIT, far) : 0,
      to = apart(
        gx + div(out.dx * step, UNIT),
        gy + div(out.dy * step, UNIT),
        rider.x,
        rider.y,
        map,
      );
    post = to;
  }
  if (!post || nearest < DANGER) return plan(world, rider, map);
  if (abs(post.dx) < AT_POST && abs(post.dy) < AT_POST) return 0;
  const { dx, dy } = path(world, rider, map, post, ball);
  return fly(world, rider, map, dx, dy);
}

/** The keeper stops sliding and never dives. */
function fly(world: World, rider: Rider, map: MapDef, dx: number, dy: number) {
  const way = horizontalInput(dx);
  const press = (rider.prev & BTN) === 0 ? BTN : 0;
  if (rider.slide > 0) return way;
  if (rider.grounded)
    return groundTravel(world, rider, map, { dy, way, press });
  return airTravel(rider, { dy, way, press });
}

function horizontalInput(dx: number) {
  if (dx > DEAD) return RIGHT;
  return dx < -DEAD ? LEFT : 0;
}

interface TravelInput {
  dy: number;
  way: number;
  press: number;
}

function hopsKerb(world: World, rider: Rider, map: MapDef, way: number) {
  const stick = way & RIGHT ? 1 : way & LEFT ? -1 : 0;
  if (stick === 0) return false;
  return boxesAt(map, world.clock).some((box) => {
    const at = apart(box.cx, box.cy, rider.x, rider.y, map);
    return (
      at.dx * stick > 0 &&
      abs(at.dx) < box.hw + T.RIDER_R + HOP &&
      abs(at.dy) < box.hh + T.RIDER_R - SUB
    );
  });
}

function groundTravel(
  world: World,
  rider: Rider,
  map: MapDef,
  { dy, way, press }: TravelInput,
  slide = 0,
) {
  if (dy < -CLIMB || hopsKerb(world, rider, map, way)) return way | press;
  // The spot is below this ledge: walk off it.
  if (dy > SINK) return way || (rider.facing > 0 ? RIGHT : LEFT);
  return way | slide;
}

function airTravel(rider: Rider, { dy, way, press }: TravelInput) {
  if (dy < -CLIMB) {
    const rising =
      rider.vy < 0 ? div(rider.vy * rider.vy, 2 * T.GRAVITY_RISE) : 0;
    return way | (rising < -dy ? press : 0);
  }
  return dy > SINK ? way | DOWN : way;
}

/** What it means to do, before it has looked at what that would do to the ball. */
function plan(world: World, rider: Rider, map: MapDef): number {
  // A breather now and then, at different moments for each side, so two bots never mirror each other for long.
  const spell = div(world.step, SPELL);
  if ((spell * 5 + rider.index * 4 + div(spell, SPELLS)) % SPELLS < REST_OF)
    return 0;
  const ahead = flight(world, map, world.ball, SIGHT, rider);
  const on = apart(world.ball.x, world.ball.y, rider.x, rider.y, map);
  const gapSquared = on.dx * on.dx + on.dy * on.dy;
  if (
    gapSquared >= TOUCHING * TOUCHING &&
    scoresUnaided(world, rider, map, ahead)
  )
    return 0;
  // Standing in the ball (it is jammed under it in a corner) helps nobody: step off it, away from the wall.
  if (gapSquared < BURIED * BURIED)
    return on.dx > 0 || (on.dx === 0 && rider.x * 2 > map.w * SUB)
      ? LEFT
      : RIGHT;
  const bx = ahead.x,
    by = ahead.y;
  const shot = shotLine(world, rider, map, bx, by);
  const target = shotApproach(shot);
  // A ball lying on the shut trapdoor over its goal is not shot at: it is lifted from the floor beside the door.
  const door = trapdoor(world, rider, map),
    fresh = (rider.prev & BTN) === 0;
  if (
    door &&
    rider.grounded &&
    abs(door.dx) <= 2 * DEAD &&
    abs(door.dy) < CLEAR
  )
    // In place. A lift from a run carries the ball off sideways, so it stands still first.
    return abs(rider.vx) < STILL && fresh ? BTN : 0;
  const { dx, dy } = path(
    world,
    rider,
    map,
    door ?? apart(bx + target.x, by + target.y, rider.x, rider.y, map),
    { x: bx, y: by },
  );

  const travel = { dx, dy, fresh, door: Boolean(door), shot };
  return approachInput(world, rider, map, travel);
}

/** Leave a ball on course for this side's goal alone. */
function scoresUnaided(world: World, rider: Rider, map: MapDef, ahead: Flight) {
  if (ahead.into === rider.slot) return true;
  // A ball lifted off a trapdoor can take longer to land than the usual forecast.
  return (
    ahead.into === -1 &&
    map.barriers.some((barrier) => barrier.kind === "gate") &&
    flight(world, map, world.ball, FORESIGHT).into === rider.slot
  );
}

/** Direction toward the goal and the rider's position relative to that line. */
function shotLine(
  world: World,
  rider: Rider,
  map: MapDef,
  bx: number,
  by: number,
) {
  const goal = aim(world, map, rider.slot, bx, by),
    reach = isqrt(goal.x * goal.x + goal.y * goal.y);
  // With nothing clear to aim along, the shot is a lob: up and towards the goal's side, over what is in the way.
  const side = goal.x !== 0 ? (goal.x > 0 ? 1 : -1) : rider.slot === 0 ? 1 : -1;
  // Unless a lob from here would drop the ball into the other colour's goal: then it is sent along the level.
  const flat =
    goal.over &&
    gifts(
      map,
      rider.slot,
      bx,
      by,
      side * LOB_X * LOB_REACH,
      -LOB_Y * LOB_REACH,
    );
  const ux = flat
      ? side * UNIT
      : goal.over
        ? side * LOB_X
        : reach
          ? div(goal.x * UNIT, reach)
          : 0,
    uy = flat
      ? 0
      : goal.over
        ? -LOB_Y
        : reach
          ? div(goal.y * UNIT, reach)
          : UNIT;
  // Where this rider is, seen from the ball: `along` the way to the goal (positive is the wrong side) and `across`.
  const from = apart(rider.x, rider.y, bx, by, map),
    along = div(from.dx * ux + from.dy * uy, UNIT),
    across = div(from.dx * uy - from.dy * ux, UNIT);

  return { ux, uy, along, across, reach };
}

function shotApproach({ ux, uy, along, across }: ReturnType<typeof shotLine>) {
  // The spot to fly to, as an offset from the ball.
  let ox: number, oy: number;
  if (along < 0 && abs(across) < LINED_UP) {
    // Behind it and lined up: through the ball, a touch low so the kick lifts it.
    ox = 0;
    oy = SUB * 3;
  } else {
    ox = -div(ux * STANDOFF, UNIT);
    oy = -div(uy * STANDOFF, UNIT);
    if (along > -LINED_UP) {
      // Level with the ball or past it: swing round on the side it is already on, over the top when in doubt.
      const over = across !== 0 ? (across > 0 ? 1 : -1) : uy > 0 ? 1 : -1;
      ox += over * div(uy * ROUND, UNIT);
      oy -= over * div(ux * ROUND, UNIT);
    }
  }
  return { x: ox, y: oy };
}

interface Approach {
  dx: number;
  dy: number;
  fresh: boolean;
  door: boolean;
  shot: ReturnType<typeof shotLine>;
}

function slowForNudge(
  world: World,
  rider: Rider,
  map: MapDef,
  travel: Approach,
) {
  const { reach, uy } = travel.shot;
  // A goal that is near and not above wants a nudge, not a shot that comes back off the far wall: lined up and
  // closing fast, it lets go of the stick, or pulls it back, until it is down to a walk.
  const gap = apart(world.ball.x, world.ball.y, rider.x, rider.y, map),
    far = isqrt(gap.dx * gap.dx + gap.dy * gap.dy);
  if (
    !travel.door &&
    far > 0 &&
    far < NUDGE_FROM &&
    reach < NUDGE_RANGE &&
    uy * 4 > -UNIT
  ) {
    const closing = div(
      (rider.vx - world.ball.vx) * gap.dx + (rider.vy - world.ball.vy) * gap.dy,
      far,
    );
    if (closing > NUDGE) {
      const way = closing > 2 * NUDGE ? (gap.dx > 0 ? LEFT : RIGHT) : 0;
      // Dropping onto it too fast: a flap takes the edge off.
      if (!rider.grounded && gap.dy > 0 && rider.vy > NUDGE)
        return { way: way | (travel.fresh ? BTN : 0), lift: true };
      return { way, lift: false };
    }
  }
  return undefined;
}

function approachInput(
  world: World,
  rider: Rider,
  map: MapDef,
  travel: Approach,
) {
  const { dx, dy, fresh } = travel;
  const nudge = slowForNudge(world, rider, map, travel);
  const way = nudge?.way ?? horizontalInput(dx);
  if (nudge?.lift) return way;
  if (rider.slide > 0)
    // Keep sliding while there is floor to cover; letting go ends it with a hop.
    return abs(dx) > SLIDE_UNTIL && abs(dy) < SINK ? DOWN | BTN | way : way;
  if (rider.grounded) return groundApproach(world, rider, map, travel, way);
  const press = fresh ? BTN : 0;
  if (dy > DIVE && fresh && rider.vy < T.QUICK_DROP) return way | DOWN | BTN;
  return airTravel(rider, { dy, way, press });
}

function groundApproach(
  world: World,
  rider: Rider,
  map: MapDef,
  travel: Approach,
  way: number,
) {
  const {
    dx,
    dy,
    door,
    fresh,
    shot: { along },
  } = travel;
  // Next to the ball a jump is a lift, which is only wanted from behind it.
  const near = apart(rider.x, rider.y, world.ball.x, world.ball.y, map),
    lifts = abs(near.dx) < T.LIFT_X && abs(near.dy) < T.LIFT_Y,
    sitting = abs(world.ball.vx) < SITTING && abs(world.ball.vy) < SITTING;
  if (lifts && sitting && !door) {
    const lift = contestedLift(world, rider, map, travel, way);
    if (lift !== undefined) return lift;
  }
  // A jump next to the ball is a lift: wanted from behind it, and never on the way to a trapdoor.
  const press = fresh && (!lifts || (along < 0 && !door)) ? BTN : 0;
  const slide = abs(dx) > SLIDE_FROM && fresh ? DOWN | BTN : 0;
  return groundTravel(world, rider, map, { dy, way, press }, slide);
}

/** A sitting ball can be lifted over an opponent or carried past one. */
function contestedLift(
  world: World,
  rider: Rider,
  map: MapDef,
  travel: Approach,
  way: number,
) {
  const {
    fresh,
    shot: { ux, uy, along },
  } = travel;
  const pinned = world.riders.some((other) => {
    if (other.slot === rider.slot || other.zapped) return false;
    const gap = apart(other.x, other.y, world.ball.x, world.ball.y, map);
    return abs(gap.dx) + abs(gap.dy) < PIN;
  });
  if (along < 0) {
    // Bots take turns lifting a pinned ball.
    const turn = (div(world.step, 2 * T.STEPS_PER_TICK) + rider.slot) % 2 === 0;
    return uy < 0 || (pinned && turn) ? way | (fresh ? BTN : 0) : undefined;
  }
  if (!pinned) return undefined;
  // Run toward the goal before lifting the ball on the wrong side.
  const goalward = ux > 0 || (ux === 0 && rider.slot === 0) ? 1 : -1;
  return (
    (goalward > 0 ? RIGHT : LEFT) |
    (fresh && rider.vx * goalward > CARRY ? BTN : 0)
  );
}
