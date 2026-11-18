import {
  offroadVehicleSetup,
  type OffroadDriver,
} from "../offroad/campaign.js";
import { offroadCpuStats } from "../offroad/cpu.js";
import {
  advanceOffroadMotion,
  createOffroadMotion,
  steerOffroadMotion,
  type OffroadMotion,
} from "../offroad/motion.js";
import {
  createOffroadSuspension,
  stepOffroadSuspension,
} from "../offroad/suspension.js";
import {
  getOffroadCourse,
  projectOffroad,
} from "../offroad/course.js";
import { atan2, cos, sin } from "./deterministic-math.js";
import type { TruckStats } from "./config.js";
import type { TruckInput } from "./input.js";
import type { Track } from "./track.js";
import { createTruck, wrapAngle, type Truck } from "./truck.js";

const TURN = (2 * Math.PI) / 65536;
/** Grid positions retain the original integer terrain coordinates. */
export function startTruck(
  track: Track,
  slot: number,
  stats: TruckStats,
  cpuLevel: number | undefined,
  driver?: OffroadDriver,
  gridIndex = slot < 4 ? 3 - slot : slot,
): Truck {
  const projected = track.spawns[slot]!;
  const spawn = getOffroadCourse(track.name).spawns[gridIndex]!;
  const motion = createOffroadMotion(
    spawn.x,
    spawn.y,
    spawn.heading,
    cpuLevel !== undefined ? 10 : (driver?.nitros ?? stats.nitros),
  );
  // Race setup runs the tire probes once, even for trucks resting on a sloping grid.
  const cpu = cpuLevel === undefined ? undefined : offroadCpuStats(cpuLevel);
  const { suspension } = stepOffroadSuspension(
    createOffroadSuspension(spawn.height),
    motion,
    getOffroadCourse(track.name).terrain.sample,
    0,
    cpu
      ? { ...cpu, topSpeed: cpu.speedLimit }
      : driver
        ? offroadVehicleSetup(driver).suspension
        : undefined,
  );
  const vehicle = placeTruck(
    track,
    createTruck(
      slot,
      projected.x,
      projected.y,
      projected.heading,
      stats,
      motion,
      suspension,
    ),
    motion,
  );
  return driver && cpuLevel === undefined
    ? {
        ...vehicle,
        upgrades: {
          topSpeed: driver.topSpeed,
          tires: driver.tires,
          shocks: driver.shocks,
        },
      }
    : vehicle;
}

export function placeTruck(
  track: Track,
  truck: Truck,
  motion: OffroadMotion,
): Truck {
  const angle = motion.heading * TURN;
  const height = truck.suspension.bodyHeight;
  const pose = projectOffroad(track.name, motion.x, motion.y, height);
  const nose = projectOffroad(track.name, motion.x + 256 * cos(angle), motion.y + 256 * sin(angle), height);
  const heading = atan2(nose.y - pose.y, nose.x - pose.x);
  return {
    ...truck,
    ...pose,
    heading: wrapAngle(heading),
    motion,
    speed: (motion.speed / 134) * truck.stats.topSpeed,
    nitros: motion.nitros,
  };
}

/** Translate with the previous momentum, sample four tires, then steer and apply engine power. */
export function driveTruck(
  track: Track,
  truck: Truck,
  input: TruckInput,
  tick: number,
  seed: number,
): [Truck, number] {
  const controls = {
    steer: (input.left === input.right ? 0 : input.left ? -1 : 1) as -1 | 0 | 1,
    gas: input.gas === true,
    nitro: input.nitro,
  };
  const cpu = truck.cpu ? offroadCpuStats(truck.cpu.level) : undefined;
  const human = truck.upgrades
    ? offroadVehicleSetup(truck.upgrades)
    : undefined;
  const moving = advanceOffroadMotion(
    cpu ? { ...truck.motion, acceleration: cpu.acceleration } : truck.motion,
    controls,
  );
  const sample = getOffroadCourse(track.name).terrain.sample;
  const contact = stepOffroadSuspension(
    truck.suspension,
    moving,
    sample,
    seed,
    cpu ? { ...cpu, topSpeed: cpu.speedLimit } : human?.suspension,
  );
  const resolved = {
    ...contact.motion,
    x: contact.stopX ? truck.motion.x : contact.motion.x,
    y: contact.stopY ? truck.motion.y : contact.motion.y,
  };
  const motion = steerOffroadMotion(
    resolved,
    controls,
    contact.groundMask,
    cpu ?? human?.drive,
  );
  const hitWall = contact.stopX || contact.stopY;
  const next = placeTruck(
    track,
    {
      ...truck,
      suspension: contact.suspension,
      wallTicks: hitWall ? truck.wallTicks + 1 : 0,
      prevNitro: input.nitro,
      nitrosUsed:
        truck.nitrosUsed + Math.max(0, truck.motion.nitros - motion.nitros),
      nitroUntilTick: motion.nitroTicks ? tick + motion.nitroTicks : 0,
      airborneUntilTick: contact.groundMask === 0 ? tick + 1 : 0,
      turnDir: controls.steer,
    },
    motion,
  );
  return [next, contact.randomSeed];
}
