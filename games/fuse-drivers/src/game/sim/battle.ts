import { getOffroadCourse } from "../offroad/course.js";
import { config } from "./config.js";
import type { TruckInput } from "./input.js";
import type { Point } from "./track.js";
import type { Truck } from "./truck.js";

export type BattleItem = "firebomb" | "shield";
export const BATTLE = {
  fuseTicks: 18,
  flameTicks: 12,
  blastRadius: 620,
  crateRadius: 520,
  respawnTicks: 70,
  shieldTicks: 70,
  recoveryTicks: 28,
} as const;

export interface BattleCrate extends Point {
  kind: BattleItem;
  readyAt: number;
}
export interface BattleBomb extends Point {
  owner: number;
  detonateAt: number;
  expiresAt: number;
}
export interface BattleSlot {
  held: BattleItem | null;
  shieldUntil: number;
  hitUntil: number;
  itemDown: boolean;
}
export interface BattleState {
  crates: BattleCrate[];
  bombs: BattleBomb[];
  slots: BattleSlot[];
}

/** One crate on each third of the native racing line, common to every device. */
export function createBattle(track: string, count: number): BattleState {
  const course = getOffroadCourse(track);
  const line = course.waypoints.filter(
    (p) => course.terrain.sample(p.x, p.y)?.blocked === false,
  );
  const crates = [0.15, 0.5, 0.8].map((fraction, i): BattleCrate => ({
    ...line[Math.floor(line.length * fraction)]!,
    kind: i === 1 ? "firebomb" : "shield",
    readyAt: 0,
  }));
  return {
    crates,
    bombs: [],
    slots: Array.from({ length: count }, () => ({
      held: "firebomb",
      shieldUntil: 0,
      hitUntil: 0,
      itemDown: false,
    })),
  };
}

const distance2 = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const near = (a: Point, b: Point, radius: number) =>
  distance2(a, b) <= radius ** 2;

function cpuTrigger(
  slot: BattleSlot,
  truck: Truck,
  trucks: readonly Truck[],
  bombs: readonly BattleBomb[],
  tick: number,
): boolean {
  // Stagger CPU presses and give everyone time to leave the grid.
  if (tick < 75 || tick % 8 !== truck.slot) return false;
  if (slot.held === "shield")
    return bombs.some(
      (bomb) => bomb.owner !== truck.slot && near(bomb, truck.motion, 1600),
    );
  return trucks.some(
    (other) =>
      other.slot !== truck.slot && near(other.motion, truck.motion, 1800),
  );
}

/** Apply actions at pre-movement coordinates. The caller owns this tick's shallow truck array. */
export function stepBattle(
  state: BattleState,
  trucks: Truck[],
  inputs: readonly TruckInput[],
  tick: number,
  itemPresses?: readonly boolean[],
): BattleState {
  const slots = state.slots.map((slot) => ({ ...slot }));
  const bombs = state.bombs.filter((bomb) => tick < bomb.expiresAt);
  for (const truck of trucks) {
    const slot = slots[truck.slot]!;
    const down = truck.cpu
      ? cpuTrigger(slot, truck, trucks, state.bombs, tick)
      : !!inputs[truck.slot]?.item;
    const pressed =
      (down && !slot.itemDown) || (!truck.cpu && itemPresses?.[truck.slot]);
    slot.itemDown = down;
    if (!pressed || !slot.held || truck.finishedTick) continue;
    if (slot.held === "firebomb") {
      if (bombs.some((b) => b.owner === truck.slot)) continue;
      bombs.push({
        owner: truck.slot,
        x: truck.motion.x,
        y: truck.motion.y,
        detonateAt: tick + BATTLE.fuseTicks,
        expiresAt: tick + BATTLE.fuseTicks + BATTLE.flameTicks,
      });
    } else {
      slot.shieldUntil = tick + BATTLE.shieldTicks;
    }
    slot.held = null;
  }
  for (const truck of trucks) {
    const slot = slots[truck.slot]!;
    if (truck.finishedTick || tick < slot.shieldUntil || tick < slot.hitUntil)
      continue;
    if (
      bombs.some(
        (b) =>
          b.owner !== truck.slot &&
          tick >= b.detonateAt &&
          near(b, truck.motion, BATTLE.blastRadius),
      )
    ) {
      // Remove momentum and engine power once; the normal pedal and grip rules recover the truck.
      trucks[truck.slot] = {
        ...truck,
        motion: {
          ...truck.motion,
          speed: truck.motion.speed >>> 2,
          throttle: 0,
          nitroTicks: 0,
        },
      };
      slot.hitUntil = tick + BATTLE.recoveryTicks;
    }
  }
  const crates = state.crates.map((crate) => {
    if (tick < crate.readyAt) return crate;
    let best = BATTLE.crateRadius ** 2 + 1,
      winner: BattleSlot | undefined;
    for (const truck of trucks) {
      const slot = slots[truck.slot]!;
      const distance = distance2(truck.motion, crate);
      if (slot.held === null && !truck.finishedTick && distance < best) {
        best = distance;
        winner = slot;
      }
    }
    if (!winner) return crate;
    winner.held = crate.kind;
    return {
      ...crate,
      kind:
        crate.kind === "shield" ? ("firebomb" as const) : ("shield" as const),
      readyAt: tick + BATTLE.respawnTicks,
    };
  });
  return { slots, bombs, crates };
}

const item = (value: unknown): value is BattleItem =>
  value === "firebomb" || value === "shield";
const bounded = (value: unknown, max: number): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  !Object.is(value, -0) &&
  value <= max;

/** Crate positions are implicit in their course and order. Timers use authoritative race updates. */
export function encodeBattle(state: BattleState) {
  return [
    state.slots.map((s) => [s.held, s.shieldUntil, s.hitUntil, s.itemDown]),
    state.crates.map((c) => [c.kind, c.readyAt]),
    state.bombs.map((b) => [b.owner, b.x, b.y, b.detonateAt]),
  ];
}

export function decodeBattle(
  raw: unknown,
  track: string,
  count: number,
  tick: number,
): BattleState | undefined {
  if (!Array.isArray(raw) || raw.length !== 3) return;
  const [rawSlots, rawCrates, rawBombs] = raw;
  if (
    !Array.isArray(rawSlots) ||
    rawSlots.length !== count ||
    !Array.isArray(rawCrates) ||
    rawCrates.length !== 3 ||
    !Array.isArray(rawBombs) ||
    rawBombs.length > count
  )
    return;
  const state = createBattle(track, count);
  // No action or pickup can precede the first green simulation frame.
  const countdown = tick < config.countdownTicks;
  const timer = (value: unknown, duration: number): value is number =>
    value === 0 ||
    (bounded(value, tick + duration) &&
      value >= config.countdownTicks + duration);
  for (const [i, s] of rawSlots.entries()) {
    if (
      !Array.isArray(s) ||
      s.length !== 4 ||
      !(s[0] === null || item(s[0])) ||
      !timer(s[1], BATTLE.shieldTicks) ||
      !timer(s[2], BATTLE.recoveryTicks) ||
      typeof s[3] !== "boolean" ||
      (countdown && (s[0] !== "firebomb" || s[3]))
    )
      return;
    state.slots[i] = {
      held: s[0],
      shieldUntil: s[1],
      hitUntil: s[2],
      itemDown: s[3],
    };
  }
  for (const [i, c] of rawCrates.entries()) {
    if (
      !Array.isArray(c) ||
      c.length !== 2 ||
      !item(c[0]) ||
      !timer(c[1], BATTLE.respawnTicks) ||
      (c[1] === 0 && c[0] !== state.crates[i]!.kind)
    )
      return;
    Object.assign(state.crates[i]!, { kind: c[0], readyAt: c[1] });
  }
  for (const b of rawBombs) {
    if (!Array.isArray(b) || b.length !== 4) return;
    const [owner, x, y, detonateAt] = b;
    if (
      !bounded(owner, count - 1) ||
      state.bombs.some((bomb) => bomb.owner === owner) ||
      !bounded(x, 65535) ||
      !bounded(y, 65535) ||
      !bounded(detonateAt, tick + BATTLE.fuseTicks) ||
      detonateAt < config.countdownTicks + BATTLE.fuseTicks ||
      detonateAt + BATTLE.flameTicks <= tick
    )
      return;
    state.bombs.push({
      owner,
      x,
      y,
      detonateAt,
      expiresAt: detonateAt + BATTLE.flameTicks,
    });
  }
  return state;
}
