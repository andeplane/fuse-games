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
  isOffroadCourse,
  projectOffroad,
} from "../offroad/course.js";
import { atan2, cos, sin } from "./deterministic-math.js";
import type { TruckStats } from "./config.js";
import type { TruckInput } from "./input.js";
import type { Track } from "./track.js";
import { createTruck, wrapAngle, type Truck } from "./truck.js";

const TURN = (2 * Math.PI) / 65536;
const FLAT = {
  height: 0x8000,
  blocked: false,
  kind: 0,
  direction: 0,
  slopeX: 0,
  slopeY: 0,
};
const sampleFlat = () => FLAT;

/** Tiled maps use 16 engine units per map unit. DOS courses retain their integer world coordinates. */
export function startTruck(
  track: Track,
  slot: number,
  stats: TruckStats,
  bot: boolean,
): Truck {
  const projected = track.spawns[slot]!;
  if (!isOffroadCourse(track.name))
    return createTruck(
      slot,
      projected.x,
      projected.y,
      projected.heading,
      stats,
    );
  const spawn = getOffroadCourse(track.name).spawns[
    slot < 4 ? 3 - slot : slot
  ]!;
  const motion = createOffroadMotion(
    spawn.x,
    spawn.y,
    spawn.heading,
    bot ? 10 : stats.nitros,
  );
  // Race setup runs the tire probes once, even for trucks resting on a sloping grid.
  const { suspension } = stepOffroadSuspension(
    createOffroadSuspension(spawn.height),
    motion,
    getOffroadCourse(track.name).terrain.sample,
    0,
  );
  return placeTruck(
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
}

export function placeTruck(
  track: Track,
  truck: Truck,
  motion: OffroadMotion,
): Truck {
  const angle = motion.heading * TURN;
  const height = truck.suspension.bodyHeight;
  const pose = isOffroadCourse(track.name)
    ? projectOffroad(track.name, motion.x, motion.y, height)
    : { x: motion.x / 16, y: motion.y / 16 };
  let heading = angle;
  if (isOffroadCourse(track.name)) {
    const nose = projectOffroad(
      track.name,
      motion.x + 256 * cos(angle),
      motion.y + 256 * sin(angle),
      height,
    );
    heading = atan2(nose.y - pose.y, nose.x - pose.x);
  }
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
  const moving = advanceOffroadMotion(
    cpu ? { ...truck.motion, acceleration: cpu.acceleration } : truck.motion,
    controls,
  );
  const sample = isOffroadCourse(track.name)
    ? getOffroadCourse(track.name).terrain.sample
    : sampleFlat;
  const contact = stepOffroadSuspension(
    truck.suspension,
    moving,
    sample,
    seed,
    cpu ? { ...cpu, topSpeed: cpu.speedLimit } : undefined,
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
    cpu,
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
