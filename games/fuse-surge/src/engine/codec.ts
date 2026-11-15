import * as T from "./tuning.js";
import {
  EVERY_LANE,
  PHASES,
  REASONS,
  TALL,
  isHits,
  isPace,
  isPlayerCount,
  isSeconds,
  isTarget,
  limitOf,
  sendsTall,
  type Kind,
  type Rider,
  type Rules,
  type Surge,
  type World,
} from "./world.js";

/**
 * The world as checkpoint fields: flat tuples of integers (and the rider ids) that MessagePack carries, and a
 * decoder that checks every one against the bounds and the consistency the simulation keeps. `decodeWorld` returns
 * a whole new world or nothing; it never changes what it was given and never returns a half-checked one.
 */
const VERSION = 2;
const RIDER_FIELDS = 16,
  SURGE_FIELDS = 7,
  RULE_FIELDS = 9,
  /** The world's own fields; one more for each rider after them. */
  HEAD_FIELDS = 19;
/** Steps to the next surge never exceed the widest gap with its jitter. */
const MOST_GAP = 256;

const int = (value: unknown, low: number, high: number): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  !Object.is(value, -0) &&
  value >= low &&
  value <= high;
const flag = (value: unknown): value is 0 | 1 => value === 0 || value === 1;
const tuple = (value: unknown, length: number): value is unknown[] =>
  Array.isArray(value) && value.length === length;
const uint32 = (value: unknown): value is number => int(value, 1, 0xffff_ffff);
/** A rider's id: the member or bot id the room seats, as an opaque short string. */
export const riderId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 64;

const encodeRider = (r: Rider): unknown[] => [
  r.id,
  r.x,
  r.y,
  r.vy,
  r.duck ? 1 : 0,
  r.jumpHeld ? 1 : 0,
  r.buffer,
  r.jumps,
  r.hits,
  r.out ? 1 : 0,
  r.reel,
  r.grace,
  r.streak,
  r.wins,
  r.dodges,
  r.taken,
];
const encodeSurge = (s: Surge): unknown[] => [
  s.id,
  s.kind,
  s.flip ? 1 : 0,
  s.lane,
  s.x,
  s.done,
  s.hit,
];

export function encodeWorld(world: World): unknown[] {
  const { rules } = world;
  return [
    VERSION,
    world.seed,
    world.step,
    PHASES.indexOf(world.phase),
    world.phaseSteps,
    world.round,
    world.clock,
    [
      rules.hits,
      rules.seconds,
      rules.pace,
      rules.target,
      rules.recover ? 1 : 0,
      rules.double ? 1 : 0,
      rules.tall ? 1 : 0,
      rules.boss ? 1 : 0,
      rules.glide ? 1 : 0,
    ],
    world.rng,
    world.nextSpawn,
    world.nextId,
    world.runKind,
    world.run,
    world.tallNext ? 1 : 0,
    world.lastWinners,
    REASONS.indexOf(world.lastReason),
    world.winners,
    world.hitCounter,
    world.surges.map(encodeSurge),
    ...world.riders.map(encodeRider),
  ];
}

function decodeRules(raw: unknown): Rules | undefined {
  if (!tuple(raw, RULE_FIELDS)) return;
  const [hits, seconds, pace, target, recover, double, tall, boss, glide] = raw;
  if (
    !isHits(hits) ||
    !isSeconds(seconds) ||
    !isPace(pace) ||
    !isTarget(target) ||
    !flag(recover) ||
    !flag(double) ||
    !flag(tall) ||
    !flag(boss) ||
    !flag(glide)
  )
    return;
  return {
    hits,
    seconds,
    pace,
    target,
    recover: recover === 1,
    double: double === 1,
    tall: tall === 1,
    boss: boss === 1,
    glide: glide === 1,
  };
}

function decodeRider(raw: unknown, rules: Rules): Rider | undefined {
  if (!tuple(raw, RIDER_FIELDS)) return;
  const [
    id,
    x,
    y,
    vy,
    duck,
    jumpHeld,
    buffer,
    jumps,
    hits,
    out,
    reel,
    grace,
    streak,
    wins,
    dodges,
    taken,
  ] = raw;
  if (
    !riderId(id) ||
    !int(x, T.OUT_X, T.START_X) ||
    !int(y, -T.FALL_DEPTH, T.MAX_Y) ||
    !int(vy, -T.MAX_FALL_V, T.JUMP_V) ||
    !flag(duck) ||
    !flag(jumpHeld) ||
    !int(buffer, 0, T.JUMP_BUFFER) ||
    !flag(jumps) ||
    !int(hits, 0, rules.hits) ||
    !flag(out) ||
    !int(reel, 0, T.REEL_STEPS) ||
    !int(grace, 0, T.GRACE_STEPS) ||
    !int(streak, 0, T.STREAK_FOR_STEP) ||
    !int(wins, 0, rules.target) ||
    !int(dodges, 0, T.MOST_DODGES) ||
    !int(taken, 0, T.MOST_TAKEN)
  )
    return;
  // A rider is out exactly when it has taken the round's hits; only then is it past the edge or below the deck,
  // and it is done ducking and reeling.
  const gone = out === 1;
  if (gone !== hits >= rules.hits) return;
  if (!gone && (x < T.LAST_X || y < 0)) return;
  if (gone && (duck === 1 || reel > 0 || grace > 0)) return;
  if (y < 0 && x >= T.EDGE_X) return;
  if (duck === 1 && (y !== 0 || vy !== 0)) return;
  if (reel > 0 && grace > 0) return;
  // An air jump is spent only in the air, and only where the rule allows one.
  if (jumps === 1 && (!rules.double || (y === 0 && vy === 0))) return;
  return {
    id,
    x,
    y,
    vy,
    duck: duck === 1,
    jumpHeld: jumpHeld === 1,
    buffer,
    jumps,
    hits,
    out: gone,
    reel,
    grace,
    streak,
    wins,
    dodges,
    taken,
  };
}

function decodeSurge(
  raw: unknown,
  riders: number,
  rules: Rules,
): Surge | undefined {
  if (!tuple(raw, SURGE_FIELDS)) return;
  const [id, kind, flip, lane, x, done, hit] = raw;
  if (!int(lane, EVERY_LANE, riders - 1)) return;
  // A surge across the deck is settled rider by rider; a bolt only with the rider whose lane it runs down.
  const masks = lane === EVERY_LANE ? (1 << riders) - 1 : 1 << lane;
  if (
    !int(id, 1, 0x7fff_ffff) ||
    !int(kind, 0, TALL) ||
    !flag(flip) ||
    !int(x, T.EXIT_X + 1, T.SPAWN_X) ||
    !int(done, 0, masks) ||
    !int(hit, 0, masks) ||
    (done & ~masks) !== 0 ||
    (hit & ~done) !== 0 ||
    // A surge flips at the gate, so none past it still has a flip to make.
    (flip === 1 && x <= T.GATE_X) ||
    // A tall surge spans the deck, never flips, and comes only where it can be cleared; bolts are the Warden's.
    (kind === TALL &&
      (lane !== EVERY_LANE || flip === 1 || !sendsTall(rules))) ||
    (lane !== EVERY_LANE && (flip === 1 || !rules.boss))
  )
    return;
  return { id, kind: kind as Kind, flip: flip === 1, lane, x, done, hit };
}

function decodeSurges(
  raw: unknown,
  riders: number,
  rules: Rules,
): Surge[] | undefined {
  if (!Array.isArray(raw) || raw.length > T.MAX_SURGES) return;
  const surges: Surge[] = [];
  for (const item of raw) {
    const surge = decodeSurge(item, riders, rules);
    if (!surge) return;
    // In the order they were sent out: each one is behind the one before it, except a volley's bolts, which run
    // abreast in lane order.
    const last = surges[surges.length - 1];
    if (
      last &&
      (last.x > surge.x ||
        (last.x === surge.x &&
          (last.lane === EVERY_LANE || surge.lane <= last.lane)))
    )
      return;
    if (surges.some((known) => known.id === surge.id)) return;
    surges.push(surge);
  }
  return surges;
}

export function decodeWorld(raw: unknown): World | undefined {
  if (!Array.isArray(raw)) return;
  const count = raw.length - HEAD_FIELDS;
  if (!isPlayerCount(count)) return;
  const [
    version,
    seed,
    step,
    phaseIndex,
    phaseSteps,
    round,
    clock,
    rawRules,
    rng,
    nextSpawn,
    nextId,
    runKind,
    run,
    tallNext,
    lastWinners,
    reasonIndex,
    winners,
    hitCounter,
    rawSurges,
  ] = raw as unknown[];
  const rules = decodeRules(rawRules);
  const masks = (1 << count) - 1;
  if (
    version !== VERSION ||
    !rules ||
    !uint32(seed) ||
    !int(step, 0, 0xffff_ffff) ||
    !int(phaseIndex, 0, PHASES.length - 1) ||
    !int(round, 1, T.MAX_ROUNDS) ||
    !int(clock, 0, limitOf(rules)) ||
    !uint32(rng) ||
    !int(nextSpawn, 0, MOST_GAP) ||
    !int(nextId, 1, 0x7fff_ffff) ||
    !flag(runKind) ||
    !int(run, 0, T.MAX_RUN) ||
    !flag(tallNext) ||
    (tallNext === 1 && !sendsTall(rules)) ||
    !int(lastWinners, 0, masks) ||
    !int(reasonIndex, 0, REASONS.length - 1) ||
    !int(winners, 0, masks) ||
    !int(hitCounter, 0, T.COUNTER - 1)
  )
    return;
  const phase = PHASES[phaseIndex]!,
    lastReason = REASONS[reasonIndex]!;
  const timed = phase === "ready" || phase === "break";
  if (
    !int(
      phaseSteps,
      timed ? 1 : 0,
      phase === "ready" ? T.READY_STEPS : phase === "break" ? T.BREAK_STEPS : 0,
    )
  )
    return;
  const surges = decodeSurges(rawSurges, count, rules);
  if (!surges) return;
  const riders: Rider[] = [];
  for (const item of (raw as unknown[]).slice(HEAD_FIELDS)) {
    const rider = decodeRider(item, rules);
    if (!rider || riders.some((known) => known.id === rider.id)) return;
    riders.push(rider);
  }
  const best = Math.max(...riders.map((rider) => rider.wins));
  const standing = riders.filter((rider) => !rider.out).length;
  const settled = phase === "break" || phase === "over";
  let leaders = 0;
  for (const [slot, rider] of riders.entries())
    if (rider.wins === best) leaders |= 1 << slot;
  if (
    // A countdown has played nothing yet; a round being played still has two riders and time on its clock.
    (phase === "ready" &&
      (clock !== 0 || surges.length || standing !== count || tallNext === 1)) ||
    (phase === "play" && (standing < 2 || clock >= limitOf(rules))) ||
    // Only the round that just ended can have reached the target; a finished match names exactly its leaders.
    (!settled && best >= rules.target) ||
    (phase === "over") !== (winners !== 0) ||
    (phase === "over" && (best < rules.target || winners !== leaders)) ||
    // Every round that ended named a reason and at least one winner.
    (lastReason === "none") !== (lastWinners === 0) ||
    (lastReason === "none") !== (round === 1 && !settled)
  )
    return;
  return {
    seed,
    step,
    phase,
    phaseSteps,
    round,
    clock,
    rules,
    rng,
    nextSpawn,
    nextId,
    runKind: runKind as Kind,
    run,
    tallNext: tallNext === 1,
    riders,
    surges,
    lastWinners,
    lastReason,
    winners,
    hitCounter,
  };
}
