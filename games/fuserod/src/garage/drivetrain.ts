import { stockDrive, type Grade } from "../motor/index.js";
import {
  freshWorkshop,
  STATIONS,
  carbCount,
  type Workshop,
  type Grade as BenchGrade,
} from "../workshop/mechanics.js";
import { MODELS, type ModelId } from "./models.js";
import type { Vehicle } from "./campaign.js";

// The workshop offers eight named parts per station. The motor uses the
// original equipment classes, so several catalogue items share a race class.
const engine = [0, 0, 0, 1, 1, 1, 2, 2] as const;
const tyre = [0, 0, 1, 1, 1, 2, 2, 2] as const;
const transmission = [0, 1, 0, 1, 1, 0, 2, 0] as const;
const axle = [1, 0, 0, 1, 1, 1, 2, 2] as const;
const carburettor = [0, 0, 1, 1, 2, 2, 2, 2] as const;
const grade = (n: number) => Math.min(2, n) as Grade;
export type InstalledDrive = ReturnType<typeof stockDrive>;

export function factoryWorkshop(model: ModelId): Workshop {
  const drive = stockDrive(MODELS[model].sprite),
    cfg = drive.calibration;
  const w = freshWorkshop(),
    m = w.mounts;
  m.engine.part = ([0, 3, 6] as const)[drive.power];
  m.tyres.part = ([0, 2, 6] as const)[drive.tires];
  m.gearbox.part = drive.automatic ? 2 : ([0, 3, 6] as const)[drive.gearbox];
  m.differential.part = ([1, 0, 6] as const)[cfg.differential];
  m.intake.part = cfg.manifold as BenchGrade;
  m.carb.part = ([0, 2, 4] as const)[cfg.carb];
  m.header.part = cfg.exhaust ? 2 : 0;
  m.muffler.part = cfg.muffler === -1 ? null : cfg.muffler ? 2 : 0;
  if (m.muffler.part === null) m.muffler.bolts.fill(0);
  if (carbCount(w) > 1) {
    const secondary = (port: number) =>
      port < carbCount(w)
        ? { part: m.carb.part, bolts: [3] }
        : { part: null, bolts: [0] };
    w.extraCarbs = [secondary(1), secondary(2)];
  }
  return w;
}

// Prior saves represented all factory parts with catalogue grade zero.
// Retain missing parts, loose fasteners, spare inventory and in-progress work.
export function migrateBench(original: Workshop, model: ModelId): Workshop {
  const factory = factoryWorkshop(model);
  const mounts = { ...original.mounts };
  for (const s of STATIONS) {
    if (mounts[s].part === 0)
      mounts[s] = { ...mounts[s], part: factory.mounts[s].part };
  }
  return {
    ...original,
    mounts,
    ...(original.mounts.intake.part === 0 &&
    !original.extraCarbs &&
    factory.extraCarbs
      ? { extraCarbs: factory.extraCarbs }
      : {}),
  };
}

export function installedDrive(c: Vehicle): InstalledDrive {
  const drive = stockDrive(MODELS[c.model].sprite),
    m = c.workshop.mounts;
  const box = m.gearbox.part ?? 0;
  return {
    power: grade(engine[m.engine.part ?? 0] + c.engine),
    tires: grade(tyre[m.tyres.part ?? 0] + c.tyres),
    gearbox: transmission[box],
    automatic: box === 2 || box === 5 || box === 7,
    calibration: {
      ...drive.calibration,
      manifold: m.intake.part ?? 0,
      carb: carbCount(c.workshop) ? carburettor[m.carb.part ?? 0] : 0,
      exhaust: (m.header.part ?? 0) >= 2 ? 1 : 0,
      muffler: m.muffler.part === null ? -1 : m.muffler.part >= 2 ? 1 : 0,
      differential:
        c.gearing === "street"
          ? axle[m.differential.part ?? 0]
          : c.gearing === "short"
            ? 2
            : 0,
      timing: c.workshop.timing,
      wear: (100 - c.condition) * 100,
      removed:
        Number(!c.fittings.roof) +
        2 * Number(!c.fittings.frontBumper) +
        4 * Number(!c.fittings.rearBumper),
    },
  };
}
