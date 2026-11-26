import type { Grade, MotorTune } from "./index.js";

/** Installed equipment and condition, in DOS car-record units. */
export interface CarCalibration {
  model: number;
  manifold: number;
  carb: Grade;
  exhaust: 0 | 1;
  muffler: -1 | 0 | 1;
  differential: Grade;
  timing: number;
  wear: number;
  removed: number;
}

// Model class, absent body pieces, engine, transmission, tyres, manifold,
// carburettor, exhaust, muffler and differential. See the local reference probe.
const stock = [
  [1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
  [1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [1, 0, 1, 1, 0, 0, 0, 0, 0, 1],
  [4, 0, 1, 2, 1, 1, 1, 0, 0, 1],
  [3, 0, 1, 1, 0, 0, 0, 0, 1, 0],
  [6, 0, 2, 2, 1, 1, 2, 1, 1, 2],
  [8, 0, 2, 3, 1, 4, 2, 1, 1, 2],
  [0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
  [4, 0, 1, 2, 0, 1, 1, 0, 1, 1],
  [2, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [7, 1, 1, 0, 1, 0, 0, 0, 0, 0],
  [5, 0, 1, 2, 0, 1, 1, 0, 1, 1],
  [8, 2, 2, 3, 1, 4, 2, 1, 1, 2],
  [5, 0, 2, 2, 1, 1, 1, 0, 1, 1],
  [4, 2, 1, 2, 0, 1, 1, 0, 0, 1],
  [6, 0, 1, 1, 0, 0, 0, 0, 0, 0],
  [7, 0, 2, 2, 1, 4, 1, 1, 1, 1],
  [2, 0, 2, 2, 0, 1, 1, 1, 0, 1],
  [0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
  [3, 0, 1, 1, 0, 1, 1, 0, 1, 0],
  [7, 0, 2, 3, 1, 4, 2, 1, 1, 2],
  [8, 7, 2, 3, 2, 4, 2, 1, 1, 2],
] as const;

export function stockDrive(model: number): Required<MotorTune> {
  const row = stock[model];
  if (!row) throw new RangeError("Unknown drivetrain model");
  const [
    ,
    ,
    power,
    transmission,
    tires,
    manifold,
    carb,
    exhaust,
    muffler,
    differential,
  ] = row;
  return {
    power,
    gearbox: (Math.max(1, transmission) - 1) as Grade,
    automatic: transmission === 0,
    tires,
    calibration: {
      model,
      manifold,
      carb,
      exhaust,
      muffler,
      differential,
      timing: 0,
      wear: 0,
      removed: 0,
    },
  };
}

function between(value: unknown, low: number, high: number) {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= low &&
    value <= high
  );
}

export function isCarCalibration(value: unknown): value is CarCalibration {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return (
    Object.keys(c).length === 9 &&
    between(c.model, 0, 21) &&
    between(c.manifold, 0, 8) &&
    between(c.carb, 0, 2) &&
    between(c.exhaust, 0, 1) &&
    between(c.muffler, -1, 1) &&
    between(c.differential, 0, 2) &&
    between(c.timing, -5, 3) &&
    between(c.wear, 0, 10000) &&
    between(c.removed, 0, 7)
  );
}

const intake = [
  [0, 0, 80, 0, 0, 0, 0, 90, 100],
  [0, 40, 0, 70, 60, 50, 60, 90, 100],
  [0, 0, 0, 40, 80, 70, 85, 90, 100],
];
const classScore = [46, 50, 55, 68, 73, 78, 91, 96, 100];
export function performanceFor(tune: MotorTune): number {
  const c = tune.calibration;
  const transmission = tune.automatic ? 0 : (tune.gearbox ?? 0) + 1;
  const row = c && stock[c.model];
  const mask = (row?.[1] ?? 0) | (c?.removed ?? 0);
  const body = ((mask & 1) * 2 + ((mask >> 1) & 1)) * 4 + ((mask >> 2) & 1);
  const manifold = c?.manifold ?? 0;
  const carb = manifold >= 7 ? 0 : (c?.carb ?? 0);
  const spark = Math.trunc((Math.abs(c?.timing ?? 0) * 4) / -3) + 2;
  let score =
    (intake[carb]![manifold]! + [0, 33, 66, 100][transmission]!) * 15 +
    (spark * 44 + classScore[row?.[0] ?? 2]!) * 10 +
    (body * 4 + (tune.power ?? 0) * 50) * 25;
  const differential = c?.differential ?? 1;
  score += Math.trunc((score * (1 - differential) * 5) / 100);
  score = Math.trunc(
    (Math.trunc(score / 100) * (10000 - (c?.wear ?? 0))) / 10000,
  );
  return Math.trunc((score * (tune.automatic ? 24 : 30)) / 100) + 70;
}

export function lowBandFor(base: number, c: CarCalibration): number {
  let up = base;
  const muffler = c.muffler < 0 ? 5 : c.muffler === 1 ? 3 : 0;
  up += Math.trunc((up * muffler) / 100);
  up += Math.trunc((up * c.exhaust * 5) / 100);
  return up + Math.trunc((up * (c.differential - 1) * 5) / 100);
}
