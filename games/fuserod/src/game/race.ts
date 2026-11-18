import type { SeatRecord } from "fuse-netcode";
import { advanceMotor, createMotor, type MotorState } from "../motor/index.js";
import {
  COUNTDOWN_TICKS,
  FINISH,
  MAX_RACE_TICKS,
  metres,
  released,
  roadCurve,
  type Direction,
  type DriveInput,
  type FuserodSettings,
} from "./basics.js";

export interface Racer {
  id: string;
  name: string;
  slot: number;
  bot: boolean;
  motor: MotorState;
  /** Signed thousandths of road half-width; the shoulder starts at ±1000. */
  x: number;
  input: DriveInput;
}
export interface Race {
  settings: FuserodSettings;
  startTick: number;
  elapsed: number;
  racers: Racer[];
  winnerId: string | null;
  ended: boolean;
}
export function createRace(
  roster: readonly SeatRecord[],
  settings: FuserodSettings,
  startTick: number,
  matchId: string,
): Race {
  let seed = 2166136261;
  for (const letter of matchId)
    seed = Math.imul(seed ^ letter.charCodeAt(0), 16777619);
  return {
    settings: { ...settings },
    startTick,
    elapsed: 0,
    ended: false,
    winnerId: null,
    racers: roster.map((seat, i) => ({
      id: seat.id,
      name: seat.name,
      slot: seat.slot,
      bot: seat.bot,
      x: Math.round(
        (i - (roster.length - 1) / 2) *
          (roster.length > 1 ? 1150 / (roster.length - 1) : 0),
      ),
      motor: createMotor((seed ^ seat.slot) >>> 0),
      input: released(),
    })),
  };
}
/** The local driver's wheel and pedals are the only inputs the opponent can use too. */
function botInput(race: Race, driver: Racer): DriveInput {
  const { motor } = driver;
  const grade = race.settings.opponent;
  const curve = roadCurve(race.settings.route, motor.position);
  const targetX = (driver.slot % 2 ? 280 : -280) + Math.trunc(curve / 3);
  const error = targetX - driver.x;
  const steer: Direction = error > 45 ? 1 : error < -45 ? -1 : 0;
  const maxGear = grade > 0 ? 4 : 3;
  const shift: Direction =
    motor.gear === 0 ||
    (motor.rpm >= [4200, 4550, 4800][grade]! && motor.gear < maxGear)
      ? 1
      : motor.gear > 1 && motor.rpm < 1800
        ? -1
        : 0;
  // A stronger rival reacts earlier to green and holds power deeper into bends.
  const launchDelay = [12, 6, 2][grade]! + driver.slot;
  return {
    throttle:
      race.elapsed >= COUNTDOWN_TICKS + launchDelay &&
      (motor.speed < 66 + grade * 13 || Math.abs(curve) < 290),
    brake: false,
    steer,
    shift,
  };
}
export function rank(race: Race): Racer[] {
  return [...race.racers].sort(
    (a, b) =>
      Number(b.id === race.winnerId) - Number(a.id === race.winnerId) ||
      b.motor.position - a.motor.position ||
      a.slot - b.slot,
  );
}
export function advanceRace(race: Race): void {
  race.elapsed++;
  if (race.elapsed <= COUNTDOWN_TICKS) return;
  const finish = FINISH[race.settings.route];
  let best: { id: string; remaining: number; travel: number } | undefined;
  for (const driver of race.racers) {
    if (driver.motor.broken) continue;
    const old = driver.motor;
    const input = driver.bot ? botInput(race, driver) : driver.input;
    const tune = driver.bot
      ? {
          power: race.settings.opponent,
          gearbox: race.settings.opponent,
          tires: race.settings.opponent,
        }
      : race.settings;
    driver.motor = advanceMotor(
      old,
      { ...input, shoulder: Math.abs(driver.x) > 1000 },
      tune,
    );
    driver.input.shift = 0;
    const travel = driver.motor.position - old.position;
    const wheel = driver.motor.wheel;
    const bend = roadCurve(race.settings.route, old.position);
    driver.x = Math.max(
      -1450,
      Math.min(
        1450,
        driver.x +
          Math.trunc((wheel * travel) / 25) -
          Math.trunc((bend * travel) / (520 + 50 * tune.tires)),
      ),
    );
    const remaining = finish - old.position;
    if (
      remaining > 0 &&
      travel >= remaining &&
      (!best || remaining * best.travel < best.remaining * travel)
    ) {
      // Compare crossing fractions using integers. An exact tie goes to the lower grid slot.
      best = { id: driver.id, remaining, travel };
    }
  }
  if (best) race.winnerId = best.id;
  race.ended =
    !!best ||
    race.elapsed >= COUNTDOWN_TICKS + MAX_RACE_TICKS ||
    race.racers.every((r) => r.motor.broken);
}
export function racerViews(race: Race) {
  const positions = rank(race);
  return race.racers.map((r) => ({
    id: r.id,
    name: r.name,
    slot: r.slot,
    bot: r.bot,
    distance: metres(r.motor.position),
    speed: r.motor.speed * 1.609344,
    lateral: r.x / 1000,
    curve: roadCurve(race.settings.route, r.motor.position) / 500,
    gear: r.motor.gear,
    rpm: r.motor.rpm,
    broken: r.motor.broken,
    place: positions.indexOf(r) + 1,
  }));
}
