import {
  raceTraffic,
  dodgeTraffic,
  hitTraffic,
  type TrafficState,
} from "./traffic.js";
import type { SeatRecord } from "fuse-netcode";
import {
  advanceMotor,
  createMotor,
  slowMotor,
  speedToStep,
  type MotorState,
  type MotorTune,
} from "../motor/index.js";
import {
  bracketAdvance,
  bracketDelay,
  finishAhead,
  policeStep,
  recoveredRivalControls,
  type PatrolState,
} from "../motor/opponent.js";
import {
  channelStep,
  courseContact,
  courseFeatures,
  rearEndContact,
} from "../course/index.js";
import {
  MAX_RACE_TICKS,
  finishUnits,
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
  /** Signed thousandths of road half-width. */
  x: number;
  bank: number;
  input: DriveInput;
  crashed: boolean;
  laneFault: boolean;
  falseStart: boolean;
  stagedFirst: boolean;
  /** 20Hz ticks after this driver's green, or zero before crossing. */
  finishTicks: number;
}
export interface Race {
  settings: FuserodSettings;
  startTick: number;
  treeTicks: number;
  elapsed: number;
  racers: Racer[];
  winnerId: string | null;
  ended: boolean;
  police: { phase: PatrolState; position: number };
  traffic: TrafficState;
}
export function seedForMatch(matchId: string): number {
  let seed = 2166136261;
  for (const letter of matchId)
    seed = Math.imul(seed ^ letter.charCodeAt(0), 16777619);
  return seed >>> 0;
}
function sanctionedGridX(index: number, count: number): number {
  if (count === 1) return 450;
  const right = index % 2 === 1;
  const sideCount = right ? Math.floor(count / 2) : Math.ceil(count / 2);
  const offset =
    sideCount === 1
      ? 575
      : 180 + Math.round((Math.floor(index / 2) * 395) / (sideCount - 1));
  return right ? offset : -offset;
}
function sanctioned(variant: FuserodSettings["variant"]): boolean {
  return variant === "grudge" || variant === "timed";
}
export function createRace(
  roster: readonly SeatRecord[],
  settings: FuserodSettings,
  startTick: number,
  matchId: string,
): Race {
  const seed = seedForMatch(matchId);
  const grid =
    settings.variant === "timed" ? roster.filter((r) => !r.bot) : roster;
  const patrol =
    settings.route === "canyon" &&
    !settings.king &&
    grid.filter((s) => !s.bot).length === 1 &&
    grid.some((s) => s.bot) &&
    (seed >>> 0) % 4 === 0;
  return {
    settings: { ...settings },
    startTick,
    treeTicks: treeDuration(settings.variant, seed),
    elapsed: 0,
    ended: false,
    winnerId: null,
    traffic: raceTraffic(settings.route, seed),
    police: {
      phase: patrol ? 1 : 0,
      position: patrol ? (110 + ((seed >>> 8) % 240)) * 64 : 0,
    },
    racers: grid.map((s, i) => ({
      id: s.id,
      name: s.name,
      slot: s.slot,
      bot: s.bot,
      x: sanctioned(settings.variant)
        ? sanctionedGridX(i, grid.length)
        : Math.round(
            (i - (grid.length - 1) / 2) *
              (grid.length > 1 ? 1150 / (grid.length - 1) : 0),
          ),
      bank: 0,
      motor: createMotor((seed ^ s.slot) >>> 0),
      input: released(),
      crashed: false,
      laneFault: false,
      falseStart: false,
      stagedFirst: false,
      finishTicks: 0,
    })),
  };
}
/** PIT ticks converted to the next 20Hz log tick. Qualifying and bracket trees include an 80-PIT-tick amber. */
export function treeDuration(
  variant: FuserodSettings["variant"],
  seed: number,
): number {
  const pit =
    variant === "grudge" || variant === "timed"
      ? 190
      : 110 + ((seed >>> 0) % 103);
  return Math.ceil((pit * 16384 * 20) / 1193182);
}
export const raceLimit = (race: Race) =>
  race.settings.variant === "timed" ? 1600 : MAX_RACE_TICKS;
export const retired = (r: Racer) =>
  r.crashed || r.laneFault || r.falseStart || r.motor.broken;
function tuneFor(race: Race, driver: Racer): MotorTune {
  const g = race.settings.opponent;
  return driver.bot ? { power: g, gearbox: g, tires: g } : race.settings;
}
/** Reference runs on the three Fuse powertrains take 403, 293 and 242 log ticks respectively. */
function dial(race: Race, driver: Racer): number {
  if (race.settings.variant !== "grudge" || !race.settings.dialInTicks)
    return 0;
  return driver.bot
    ? [403, 293, 242][race.settings.opponent]!
    : race.settings.dialInTicks;
}
export function greenTick(race: Race, driver: Racer): number {
  const slowest = Math.max(...race.racers.map((r) => dial(race, r)));
  return (
    race.treeTicks +
    Math.round(
      (bracketDelay(
        Math.trunc(dial(race, driver) / 2),
        Math.trunc(slowest / 2),
      ) *
        16384 *
        20) /
        1193182,
    )
  );
}
export function brokeOut(race: Race, r: Racer): boolean {
  return (
    r.finishTicks > 0 &&
    Math.trunc(r.finishTicks / 2) < Math.trunc(dial(race, r) / 2)
  );
}
function aheadFeatures(race: Race, driver: Racer) {
  const at = metres(driver.motor.position);
  return courseFeatures(race.settings.route).filter(
    (f) => f.end >= at && f.start <= at + 45,
  );
}
function botInput(
  race: Race,
  driver: Racer,
  player: Racer | undefined,
): DriveInput {
  const curve = roadCurve(race.settings.route, driver.motor.position);
  let target = sanctioned(race.settings.variant)
    ? sanctionedGridX(race.racers.indexOf(driver), race.racers.length)
    : (driver.slot % 2 ? 280 : -280) + Math.trunc(curve / 3);
  const features = aheadFeatures(race, driver);
  for (const f of features) {
    if (f.kind === "bridge") target = 0;
    else if (f.kind === "rock" && Math.abs(target / 1000 - f.lane) < 0.3)
      target = f.lane > 0 ? -120 : 120;
  }
  // A bot looks into a bend and countersteers against its steering-wheel momentum.
  const street =
    race.settings.variant === "street" || race.settings.route === "canyon";
  const desired = street
    ? 8 *
      dodgeTraffic(
        race.traffic,
        { x: driver.x, position: driver.motor.position },
        player && { x: player.x, position: player.motor.position },
        target,
        driver.motor.speed,
      )
    : target - driver.x;
  const error = desired - driver.motor.wheel * 12;
  const steer: Direction = error > 35 ? 1 : error < -35 ? -1 : 0;
  const previous = roadCurve(
    race.settings.route,
    Math.max(0, driver.motor.position - 64),
  );
  const controls = recoveredRivalControls(
    driver.motor,
    tuneFor(race, driver),
    race.settings.opponent,
    {
      route: race.settings.route,
      streetDrag: race.settings.variant === "street",
      king: race.settings.king,
      playerSpeed: player?.motor.speed ?? driver.motor.speed,
      playerPosition: player?.motor.position ?? driver.motor.position,
      turning: Math.abs(curve) > 100 && Math.abs(previous) <= 100,
      slowSection: features.some((f) => f.kind === "rough"),
      police: race.police.phase >= 2,
    },
  );
  // Leave a margin below the rough-surface limit: an entire drivetrain interrupt may elapse before the next brake command.
  const rough = features.some((f) => f.kind === "rough");
  if (rough && driver.motor.speed >= 55)
    return {
      ...controls,
      throttle: false,
      brake: driver.motor.speed >= 58,
      steer,
    };
  return { ...controls, steer };
}
export function rank(race: Race): Racer[] {
  return [...race.racers].sort(
    (a, b) =>
      Number(b.id === race.winnerId) - Number(a.id === race.winnerId) ||
      Number(brokeOut(race, a)) - Number(brokeOut(race, b)) ||
      b.motor.position - a.motor.position ||
      a.slot - b.slot,
  );
}
/** Race kind 2/4 tests actual wheel motion while the lane is red. Neutral revs and a braked preselection are safe. */
function stageDriver(race: Race, driver: Racer): void {
  if (
    driver.bot ||
    retired(driver) ||
    (race.settings.variant !== "grudge" && race.settings.variant !== "timed")
  )
    return;
  const control = driver.input;
  if (control.shift) driver.stagedFirst = control.shift > 0;
  const moving =
    control.throttle &&
    !control.brake &&
    (driver.stagedFirst || race.settings.automatic);
  // A stationary driver can preselect first with the clutch held. Releasing with throttle engages it.
  const motor = advanceMotor(
    { ...driver.motor, pendingShift: 0 },
    {
      throttle: control.throttle,
      brake: false,
      steer: 0,
      shift: moving ? 1 : 0,
    },
    { ...race.settings, automatic: false },
  );
  driver.motor = { ...motor, position: 0 };
  driver.falseStart = moving && motor.speed > 0;
  driver.input.shift = 0;
}

/** In a driver-versus-AI race the DOS finish routine judges both cars at the same road frame. */
export function soloFinish(race: Race): string | undefined {
  if (race.racers.length !== 2 || !race.racers.some((r) => r.finishTicks))
    return;
  const human = race.racers.find((r) => !r.bot),
    rival = race.racers.find((r) => r.bot);
  if (!human || !rival || retired(human) || retired(rival)) return;
  let won = finishAhead(human.motor.position, rival.motor.position);
  if (race.settings.variant === "grudge" && race.settings.dialInTicks) {
    const elapsed =
      human.finishTicks || Math.max(0, race.elapsed - greenTick(race, human));
    won = bracketAdvance(
      won,
      Math.trunc(race.settings.dialInTicks / 2),
      Math.trunc(elapsed / 2),
    );
  }
  return won ? human.id : rival.id;
}
export function advanceRace(race: Race): void {
  race.elapsed++;

  const { route, variant } = race.settings;
  const finish = finishUnits(route, variant);
  const previous = race.racers.map((r) => r.motor);
  // Select the nearest human from the previous tick before any car advances.
  const humans = race.racers.filter((r) => !r.bot);
  const controls = race.racers.map((driver) =>
    driver.bot
      ? botInput(
          race,
          driver,
          humans.reduce<Racer | undefined>(
            (best, h) =>
              !best ||
              Math.abs(h.motor.position - driver.motor.position) <
                Math.abs(best.motor.position - driver.motor.position)
                ? h
                : best,
            undefined,
          ),
        )
      : driver.input,
  );
  let best: { driver: Racer; remaining: number; travel: number } | undefined;
  for (const [i, driver] of race.racers.entries()) {
    if (retired(driver) || driver.finishTicks) continue;
    if (race.elapsed <= greenTick(race, driver)) {
      stageDriver(race, driver);
      continue;
    }
    const old = driver.motor;
    const oldX = driver.x;
    const tune = tuneFor(race, driver);
    const shoulder = courseContact(
      route,
      driver.x,
      old.speed,
      metres(old.position),
    ).shoulder;
    const control = controls[i]!;
    const shift =
      control.shift || (driver.stagedFirst && old.gear === 0 ? 1 : 0);
    driver.motor = advanceMotor(old, { ...control, shift, shoulder }, tune);
    if (driver.motor.gear > 0 || control.shift < 0) driver.stagedFirst = false;
    driver.input.shift = 0;
    const travel = driver.motor.position - old.position;
    const bend = roadCurve(route, old.position);
    driver.x = Math.max(
      -1450,
      Math.min(
        1450,
        driver.x +
          Math.trunc((driver.motor.wheel * travel) / 18) -
          Math.trunc((bend * travel) / (920 + 60 * (tune.tires ?? 0))),
      ),
    );
    if (travel > 0 && race.traffic.obstacles.length) {
      const trafficHit = hitTraffic(
        race.traffic,
        old.position,
        driver.motor.position,
        driver.x,
        driver.motor.speed,
      );
      driver.x = Math.max(
        -1450,
        Math.min(1450, driver.x + trafficHit.sideways),
      );
      driver.motor = slowMotor(driver.motor, trafficHit.speed, tune);
      if (trafficHit.crashed) {
        driver.crashed = true;
        continue;
      }
    }
    if (
      sanctioned(variant) &&
      driver.x * sanctionedGridX(i, race.racers.length) < 0
    ) {
      driver.laneFault = true;
      continue;
    }
    const remaining = finish - old.position;
    if (remaining > 0 && travel >= remaining) {
      driver.finishTicks = race.elapsed - greenTick(race, driver);
      if (
        !brokeOut(race, driver) &&
        (!best || remaining * best.travel < best.remaining * travel)
      )
        best = { driver, remaining, travel };
      continue;
    }
    if (
      driver.motor.steps !== old.steps ||
      (route === "aqueduct" && travel > 0)
    ) {
      const contact = courseContact(
        route,
        driver.x,
        driver.motor.speed,
        metres(driver.motor.position),
      );
      driver.x = contact.x;
      driver.crashed = contact.crashed;
      if (contact.speed < driver.motor.speed)
        driver.motor = slowMotor(driver.motor, contact.speed, tune);
      if (!driver.crashed && route === "aqueduct" && travel > 0) {
        const channel = channelStep(oldX, driver.x, driver.motor.speed);
        driver.x = channel.x;
        driver.bank = channel.roll;
        driver.motor = slowMotor(driver.motor, channel.speed, tune);
      }
    }
  }
  if (!best && variant !== "timed" && race.police.phase <= 1) {
    const crashes = new Set<Racer>();
    for (const [i, rear] of race.racers.entries()) {
      if (retired(rear) || rear.finishTicks) continue;
      for (const [j, lead] of race.racers.entries()) {
        if (
          i !== j &&
          !retired(lead) &&
          !lead.finishTicks &&
          rearEndContact(
            route,
            rear.x,
            lead.x,
            previous[j]!.position - previous[i]!.position,
            lead.motor.position - rear.motor.position,
            speedToStep(rear.motor.speed),
            speedToStep(lead.motor.speed),
          )
        )
          crashes.add(rear);
      }
    }
    for (const rear of crashes) rear.crashed = true;
  }
  if (
    race.police.phase &&
    race.racers.some((r, i) => previous[i]!.position !== r.motor.position)
  ) {
    const driver = humans[0]!;
    const rival = race.racers.find((r) => r.bot)!;
    race.police.phase = policeStep(
      race.police.phase,
      race.police.position,
      driver.motor.position,
      rival.motor.position,
    );
  }
  if (race.police.phase !== 4)
    race.winnerId = soloFinish(race) ?? best?.driver.id ?? null;
  const remaining = race.racers.filter(
    (r) => !retired(r) && !brokeOut(race, r),
  );
  if (
    !race.winnerId &&
    race.police.phase !== 4 &&
    race.racers.length > 1 &&
    remaining.length === 1
  )
    race.winnerId = remaining[0]!.id;
  race.ended =
    !!race.winnerId ||
    race.police.phase === 4 ||
    race.elapsed >= race.treeTicks + raceLimit(race) ||
    remaining.length === 0;
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
    gear: r.motor.gear || Number(r.stagedFirst),
    rpm: r.motor.rpm,
    broken: r.motor.broken,
    crashed: r.crashed,
    bank: r.bank,
    police: race.police.phase >= 2 && r === race.racers.find((p) => p.bot),
    laneFault: r.laneFault,
    falseStart: r.falseStart,
    breakout: brokeOut(race, r),
    elapsedTicks:
      r.finishTicks || Math.max(0, race.elapsed - greenTick(race, r)),
    countdown: Math.max(0, greenTick(race, r) - race.elapsed),
    place: positions.indexOf(r) + 1,
  }));
}
