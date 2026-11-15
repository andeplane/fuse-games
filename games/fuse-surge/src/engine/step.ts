import { DUCK, JUMP } from "./input.js";
import { approach, div, xorshift } from "./math.js";
import * as T from "./tuning.js";
import {
  EVERY_LANE,
  HIGH,
  LOW,
  TALL,
  curveAt,
  footholdX,
  gapAt,
  limitOf,
  sendsTall,
  speedAt,
  startRound,
  type Kind,
  type Rider,
  type World,
} from "./world.js";

/**
 * One step of a match, 1/120 s: riders move by what they hold, surges advance, strike or are dodged, the next
 * surge is drawn from the world's own generator, and the round's end is settled. Everything is integer arithmetic
 * on the world it is given, so every device that folds the same inputs holds the same world.
 */

const airborne = (rider: Rider): boolean => rider.y !== 0 || rider.vy !== 0;

/** Moves a rider by its speed; true when that put it on the deck, where it stops and has its air jump back. */
function land(rider: Rider): boolean {
  rider.y += rider.vy;
  // No jump reaches this height: only a checkpoint that put a rider there could, and it stays a world that decodes.
  if (rider.y > T.MAX_Y) rider.y = T.MAX_Y;
  if (rider.y > 0) return false;
  rider.y = 0;
  rider.vy = 0;
  rider.jumps = 0;
  return true;
}

/** Plain gravity on a rider with the deck under it. */
function fallOnDeck(rider: Rider): boolean {
  rider.vy -= T.GRAVITY;
  if (rider.vy < -T.MAX_FALL_V) rider.vy = -T.MAX_FALL_V;
  return land(rider);
}

/**
 * A rider's vertical speed after one step in the air. Letting go of jump cuts a fast rise short; a duck without jump
 * is a dive, which stops the rise and falls hard; and with the glide rule, holding jump while falling falls softly.
 * While jump is held it wins, so a duck let go a moment late never swallows a jump.
 */
export function airSpeed(
  vy: number,
  jump: boolean,
  duck: boolean,
  glide: boolean,
): number {
  if (duck && !jump) {
    const fall = (vy > 0 ? 0 : vy) - T.DIVE_GRAVITY;
    return fall < -T.MAX_FALL_V ? -T.MAX_FALL_V : fall;
  }
  if (!jump && vy > T.JUMP_CUT) vy = T.JUMP_CUT;
  if (glide && jump && vy <= 0) {
    const soft = vy - T.GLIDE_GRAVITY;
    return soft < -T.GLIDE_FALL_V ? -T.GLIDE_FALL_V : soft;
  }
  const fall = vy - T.GRAVITY;
  return fall < -T.MAX_FALL_V ? -T.MAX_FALL_V : fall;
}

/** A rider knocked out tumbles to the edge and drops into the pit, where it rests. */
function tumble(rider: Rider): void {
  rider.x = approach(rider.x, T.OUT_X, T.KNOCK_SPEED);
  if (rider.x >= T.EDGE_X) {
    if (airborne(rider)) fallOnDeck(rider);
    return;
  }
  if (rider.y <= -T.FALL_DEPTH) return;
  rider.vy -= T.GRAVITY;
  if (rider.vy < -T.MAX_FALL_V) rider.vy = -T.MAX_FALL_V;
  rider.y += rider.vy;
  if (rider.y <= -T.FALL_DEPTH) {
    rider.y = -T.FALL_DEPTH;
    rider.vy = 0;
  }
}

function moveRider(world: World, rider: Rider, bits: number): void {
  const jump = (bits & JUMP) !== 0,
    duck = (bits & DUCK) !== 0;
  const pressed = jump && !rider.jumpHeld;
  rider.jumpHeld = jump;
  if (rider.out) return tumble(rider);
  const goal = footholdX(rider.hits, world.rules.hits);
  if (rider.reel > 0) {
    // Thrown back: nothing it holds counts until it has reached its new foothold.
    rider.x = approach(rider.x, goal, T.KNOCK_SPEED);
    if (rider.reel > 1 || rider.x === goal) rider.reel--;
    if (rider.reel === 0) rider.grace = T.GRACE_STEPS;
    if (airborne(rider)) fallOnDeck(rider);
    return;
  }
  if (rider.grace > 0) rider.grace--;
  rider.x = approach(rider.x, goal, T.WALK_SPEED);
  if (pressed && world.rules.double && airborne(rider) && rider.jumps === 0) {
    // A second jump, in the air. It takes the press, so nothing is left waiting for the deck.
    rider.jumps = 1;
    rider.buffer = 0;
    rider.vy = T.DOUBLE_V;
  } else if (pressed) rider.buffer = T.JUMP_BUFFER;
  else if (rider.buffer > 0) rider.buffer--;
  if (!airborne(rider)) {
    if (rider.buffer === 0) {
      rider.duck = duck;
      return;
    }
    rider.buffer = 0;
    rider.duck = false;
    rider.vy = T.JUMP_V;
  }
  rider.vy = airSpeed(rider.vy, jump, duck, world.rules.glide);
  if (land(rider)) rider.duck = duck;
}

/**
 * Whether a rider's pose lets a surge of `kind` pass. A low one passes under feet above it. A high one floats: it
 * passes over a ducked head and under feet above its top. A tall one stands from the deck up, and passes only under
 * feet above its top.
 */
export const clears = (rider: Rider, kind: Kind): boolean =>
  kind === LOW
    ? rider.y > T.LOW_TOP
    : kind === TALL
      ? rider.y > T.TALL_TOP
      : rider.y + (rider.duck ? T.DUCK_H : T.STAND_H) < T.HIGH_BOTTOM ||
        rider.y > T.HIGH_TOP;

function strike(world: World, rider: Rider): boolean {
  rider.hits++;
  if (rider.taken < T.MOST_TAKEN) rider.taken++;
  rider.streak = 0;
  rider.duck = false;
  rider.buffer = 0;
  // Thrown into a little hop off the deck; a rider struck in the air never rises faster than that hop.
  if (!airborne(rider) || rider.vy > T.POP_V) rider.vy = T.POP_V;
  rider.grace = 0;
  world.hitCounter = (world.hitCounter + 1) % T.COUNTER;
  if (rider.hits >= world.rules.hits) {
    rider.out = true;
    rider.reel = 0;
    return true;
  }
  rider.reel = T.REEL_STEPS;
  return false;
}

function dodged(world: World, rider: Rider): void {
  if (rider.dodges < T.MOST_DODGES) rider.dodges++;
  if (rider.streak < T.STREAK_FOR_STEP) rider.streak++;
  if (
    world.rules.recover &&
    rider.streak >= T.STREAK_FOR_STEP &&
    rider.hits > 0
  ) {
    rider.hits--;
    rider.streak = 0;
  }
}

/**
 * Settles every surge against every rider it has reached; returns the riders knocked out this step, a bit each. A
 * bolt is settled only against the rider whose lane it runs down: to everyone else it is not there.
 */
function sweep(world: World): number {
  let fallen = 0;
  for (const surge of world.surges)
    for (const [slot, rider] of world.riders.entries()) {
      const bit = 1 << slot;
      if (rider.out || surge.done & bit) continue;
      if (surge.lane !== EVERY_LANE && surge.lane !== slot) continue;
      const gap = surge.x - rider.x;
      if (gap > T.REACH) continue;
      if (gap < -T.REACH) {
        surge.done |= bit;
        dodged(world, rider);
      } else if (rider.reel > 0 || rider.grace > 0) {
        // It passes a rider that cannot be struck: no hit, and no dodge to its name either.
        surge.done |= bit;
      } else if (!clears(rider, surge.kind)) {
        surge.done |= bit;
        surge.hit |= bit;
        if (strike(world, rider)) fallen |= bit;
      }
    }
  return fallen;
}

/** A chance in a hundred that starts when the curve reaches `from` and grows to `most`. */
const chance = (curve: number, from: number, most: number): number => {
  if (curve < from) return 0;
  const grown = 8 + div(curve - from, T.CHANCE_STEP);
  return grown > most ? most : grown;
};

function spawn(world: World): void {
  if (world.nextSpawn > 0) {
    world.nextSpawn--;
    return;
  }
  const { rules } = world,
    { pace } = rules;
  const curve = curveAt(world.clock, rules);
  const draw = (): number => (world.rng = xorshift(world.rng));
  const send = (kind: Kind, flip: boolean, lane: number): void => {
    world.surges.push({
      id: world.nextId,
      kind,
      flip,
      lane,
      x: T.SPAWN_X,
      done: 0,
      hit: 0,
    });
    world.nextId = world.nextId >= 0x7fff_ffff ? 1 : world.nextId + 1;
  };
  /** The least clear deck after this spawn, and whether the next one follows as a tight pair. */
  let rest = 0,
    pair = false;
  if (world.tallNext) {
    // Decided at the spawn before, which left the deck clear ahead of it.
    world.tallNext = false;
    world.run = 0;
    send(TALL, false, EVERY_LANE);
    rest = T.TALL_REST;
  } else if (
    rules.boss &&
    draw() % 100 < chance(curve, T.BOSS_FROM, T.BOSS_CHANCE_MAX)
  ) {
    // The Warden's volley: a bolt down some of the lanes that still have a rider, low or high each on its own.
    let sent = 0;
    const standing: number[] = [];
    for (const [slot, rider] of world.riders.entries()) {
      if (rider.out) continue;
      standing.push(slot);
      const roll = draw();
      if (roll % 100 >= T.BOLT_CHANCE) continue;
      send((roll >>> 8) & 1 ? HIGH : LOW, false, slot);
      sent++;
    }
    if (!sent && standing.length) {
      const roll = draw();
      send(
        (roll >>> 8) & 1 ? HIGH : LOW,
        false,
        standing[(roll >>> 9) % standing.length]!,
      );
    }
  } else {
    let kind: Kind = draw() & 1 ? HIGH : LOW;
    if (world.run >= T.MAX_RUN && kind === world.runKind)
      kind = kind === LOW ? HIGH : LOW;
    world.run = kind === world.runKind ? world.run + 1 : 1;
    world.runKind = kind;
    const flip = draw() % 100 < chance(curve, T.FLIP_FROM, T.FLIP_CHANCE_MAX);
    pair = draw() % 100 < chance(curve, T.PAIR_FROM, T.PAIR_CHANCE_MAX);
    // A flipping surge shows the other height until the gate; `kind` is what it strikes as.
    send(flip ? (kind === LOW ? HIGH : LOW) : kind, flip, EVERY_LANE);
  }
  // A tall surge is chosen one spawn early and never as the second of a pair: the deck is clear before it.
  if (
    sendsTall(rules) &&
    !pair &&
    draw() % 100 < chance(curve, T.TALL_FROM, T.TALL_CHANCE_MAX)
  ) {
    world.tallNext = true;
    rest = T.TALL_REST;
  }
  // A pair comes as close as surges ever do; otherwise the gap is jittered a quarter either way, down to its floor.
  const gap = div(gapAt(world.clock, rules) * (192 + (draw() % 129)), 256);
  const next = pair
    ? T.PAIR_GAP[pace]
    : gap < T.GAP_MIN[pace]
      ? T.GAP_MIN[pace]
      : gap;
  world.nextSpawn = next < rest ? rest : next;
}

function moveSurges(world: World): void {
  const speed = speedAt(world.clock, world.rules);
  let kept = 0;
  for (const surge of world.surges) {
    surge.x -= speed;
    if (surge.flip && surge.x <= T.GATE_X) {
      surge.kind = surge.kind === LOW ? HIGH : LOW;
      surge.flip = false;
    }
    if (surge.x > T.EXIT_X) world.surges[kept++] = surge;
  }
  world.surges.length = kept;
}

/** Ends the round if it is decided: one rider left, the last ones gone together, or the clock run out. */
function settle(world: World, fallen: number): void {
  let standing = 0;
  for (const [slot, rider] of world.riders.entries())
    if (!rider.out) standing |= 1 << slot;
  const count = world.riders.filter((rider) => !rider.out).length;
  if (count === 1) end(world, standing, "last");
  else if (count === 0) end(world, fallen, "wipe");
  else if (world.clock >= limitOf(world.rules)) end(world, standing, "time");
}

function end(world: World, winners: number, reason: "last" | "time" | "wipe") {
  for (const [slot, rider] of world.riders.entries())
    if (winners & (1 << slot)) rider.wins++;
  world.lastWinners = winners;
  world.lastReason = reason;
  world.phase = "break";
  world.phaseSteps = T.BREAK_STEPS;
}

/** After the break: the match is over once someone has the wins, otherwise the next round counts down. */
function afterBreak(world: World): void {
  let best = 0;
  for (const rider of world.riders) if (rider.wins > best) best = rider.wins;
  if (best < world.rules.target) return startRound(world, world.round + 1);
  world.phase = "over";
  world.winners = 0;
  for (const [slot, rider] of world.riders.entries())
    if (rider.wins === best) world.winners |= 1 << slot;
}

/** Advances `world` one step with each slot's held bits; a finished match no longer moves. */
export function stepWorld(world: World, inputs: readonly number[]): void {
  if (world.phase === "over") return;
  world.step++;
  for (const [slot, rider] of world.riders.entries())
    moveRider(world, rider, inputs[slot] ?? 0);
  moveSurges(world);
  if (world.phase === "play") {
    const fallen = sweep(world);
    spawn(world);
    world.clock++;
    settle(world, fallen);
    return;
  }
  // The countdown and the break: riders may hop about, and what is left of the surges drifts off harmlessly.
  world.phaseSteps--;
  if (world.phaseSteps > 0) return;
  world.phaseSteps = 0;
  if (world.phase === "ready") world.phase = "play";
  else afterBreak(world);
}

/** The slots that won the match, a bit each; 0 until it is over. */
export const winnersOf = (world: World): number =>
  world.phase === "over" ? world.winners : 0;
