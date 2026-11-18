export const STATIONS = [
  "engine",
  "intake",
  "carb",
  "header",
  "muffler",
  "differential",
  "gearbox",
  "tyres",
] as const;
export type Station = (typeof STATIONS)[number];
export type Grade = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
interface StationDef {
  label: string;
  bay: "engine" | "under";
  fasteners: readonly string[];
  cost: number;
  models: readonly [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
}
export const STATION: Record<Station, StationDef> = {
  engine: {
    label: "Engine",
    bay: "engine",
    fasteners: ["Engine mount"],
    cost: 170,
    models: [
      "Factory block",
      "Touring six",
      "High-compression six",
      "Street small-block",
      "Long-stroke V8",
      "Cross-plane V8",
      "Forged competition V8",
      "Blueprint race V8",
    ],
  },
  intake: {
    label: "Intake manifold",
    bay: "engine",
    fasteners: ["Front stud", "Rear stud"],
    cost: 55,
    models: [
      "Factory runner",
      "Long runner",
      "Street plenum",
      "High-rise dual plane",
      "Split plenum",
      "Cross-ram",
      "Ported cross-ram",
      "Mechanical injection",
    ],
  },
  carb: {
    label: "Carburettor",
    bay: "engine",
    fasteners: ["Carb stud"],
    cost: 45,
    models: [
      "Stock two-barrel",
      "Economy twin",
      "Street two-barrel",
      "Progressive twin",
      "Vacuum four-barrel",
      "Mechanical four-barrel",
      "Competition double-pumper",
      "Race metering block",
    ],
  },
  header: {
    label: "Exhaust manifold",
    bay: "under",
    fasteners: ["Head flange", "Collector flange"],
    cost: 48,
    models: [
      "Iron manifold",
      "Free-flow cast",
      "Short tube",
      "Equal length",
      "Long tube",
      "Stepped tube",
      "Tuned collector",
      "Competition header",
    ],
  },
  muffler: {
    label: "Muffler",
    bay: "under",
    fasteners: ["Exhaust clamp"],
    cost: 30,
    models: [
      "Stock silencer",
      "Touring chamber",
      "Glasspack",
      "Street straight-through",
      "Twin resonator",
      "Race chamber",
      "Lightweight straight-through",
      "Megaphone",
    ],
  },
  differential: {
    label: "Differential",
    bay: "under",
    fasteners: ["Pinion flange", "Axle mount"],
    cost: 115,
    models: [
      "Stock axle",
      "Highway gearing",
      "Touring axle",
      "Street limited-slip",
      "Close-ratio axle",
      "Competition LSD",
      "Sprint differential",
      "Drag spool",
    ],
  },
  gearbox: {
    label: "Transmission",
    bay: "under",
    fasteners: ["Bellhousing bolt", "Tail mount"],
    cost: 145,
    models: [
      "Standard manual",
      "Close-ratio manual",
      "Cruiser automatic",
      "Street four-speed",
      "Heavy-duty manual",
      "Street automatic",
      "Competition manual",
      "Race automatic",
    ],
  },
  tyres: {
    label: "Tyre set",
    bay: "under",
    fasteners: ["Wheel retainer"],
    cost: 75,
    models: [
      "Stock crossplies",
      "Touring radials",
      "Street radials",
      "Soft compound",
      "Performance radials",
      "Competition tread",
      "Semi-slicks",
      "Drag slicks",
    ],
  },
};
export const GRADES: readonly Grade[] = [0, 1, 2, 3, 4, 5, 6, 7];
export interface Assembly {
  part: Grade | null;
  bolts: number[];
}
export interface Workshop {
  mounts: Record<Station, Assembly>;
  extraCarbs?: [Assembly, Assembly];
  /** Catalogue order, eight parts for each kind. */
  spares: number[];
  wired: boolean;
  jacked: boolean;
  timing: number;
}
export type WorkshopCommand =
  | { type: "jack" | "wire" }
  | { type: "timing"; delta: -1 | 1 }
  | {
      type: "bolt";
      station: Station;
      index: number;
      delta: -1 | 1;
      port?: number;
    }
  | { type: "remove"; station: Station; port?: number }
  | {
      type: "fit" | "buy" | "sell";
      station: Station;
      grade: Grade;
      port?: number;
    };
const emptyCarb = (): Assembly => ({ part: null, bolts: [0] });
export function carbCount(w: Workshop): number {
  const intake = w.mounts.intake.part;
  return intake === null ? 0 : [1, 1, 3, 2, 2, 1, 2, 0][intake]!;
}
export function assemblyAt(w: Workshop, s: Station, port = 0): Assembly {
  return s === "carb" && port > 0
    ? (w.extraCarbs?.[port - 1] ?? emptyCarb())
    : w.mounts[s];
}
function mapStations<T>(make: (station: Station) => T): Record<Station, T> {
  return Object.fromEntries(STATIONS.map((s) => [s, make(s)])) as Record<
    Station,
    T
  >;
}
export const stockIndex = (s: Station, grade: Grade) =>
  STATIONS.indexOf(s) * 8 + grade;
export const price = (s: Station, g: Grade) =>
  Math.round(STATION[s].cost * (1 + g * 0.45));
export const resale = (s: Station, g: Grade) => Math.floor(price(s, g) * 0.5);
export function freshWorkshop(): Workshop {
  return {
    mounts: mapStations((s) => ({
      part: 0,
      bolts: STATION[s].fasteners.map(() => 3),
    })),
    spares: Array<number>(64).fill(0),
    wired: true,
    jacked: false,
    timing: 0,
  };
}
const integer = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export function isWorkshop(v: unknown): v is Workshop {
  if (
    !object(v) ||
    !object(v.mounts) ||
    typeof v.wired !== "boolean" ||
    typeof v.jacked !== "boolean" ||
    !integer(v.timing, -5, 3) ||
    !Array.isArray(v.spares) ||
    v.spares.length !== 64 ||
    !v.spares.every((n) => integer(n, 0, 64)) ||
    v.spares.reduce((sum: number, n: number) => sum + n, 0) > 64
  )
    return false;
  const mounts = v.mounts;
  if (
    v.extraCarbs !== undefined &&
    (!Array.isArray(v.extraCarbs) ||
      v.extraCarbs.length !== 2 ||
      !v.extraCarbs.every(
        (m) =>
          object(m) &&
          (m.part === null || integer(m.part, 0, 7)) &&
          Array.isArray(m.bolts) &&
          m.bolts.length === 1 &&
          integer(m.bolts[0], 0, m.part === null ? 0 : 3),
      ))
  )
    return false;
  return STATIONS.every((s) => {
    const m = mounts[s];
    return (
      object(m) &&
      (m.part === null || integer(m.part, 0, 7)) &&
      Array.isArray(m.bolts) &&
      m.bolts.length === STATION[s].fasteners.length &&
      m.bolts.every((n) => integer(n, 0, m.part === null ? 0 : 3))
    );
  });
}
const needs: Partial<Record<Station, Station>> = {
  intake: "engine",
  carb: "intake",
  muffler: "header",
};
const secured = (w: Workshop, s: Station) =>
  w.mounts[s].part !== null && w.mounts[s].bolts.every((b) => b === 3);
function fitError(w: Workshop, s: Station, g: Grade) {
  const parent = needs[s];
  if (parent && !secured(w, parent))
    return "Secure the " + STATION[parent].label.toLowerCase() + " first.";
  if (s === "carb" && g >= 4 && (w.mounts.intake.part ?? -1) < 2)
    return "The four-barrel flange needs a Street plenum or higher intake.";
  return "";
}
export function inspectWorkshop(w: Workshop) {
  const grade = (s: Station) => w.mounts[s].part ?? 0;
  let reason = "";
  if (w.jacked) reason = "Lower the jack before racing.";
  else if (!w.wired) reason = "Connect the ignition lead before racing.";
  else
    for (const s of STATIONS) {
      if (s === "muffler" && w.mounts[s].part === null) continue;
      if (s === "carb") {
        for (let i = 0; i < carbCount(w); i++) {
          const m = assemblyAt(w, s, i);
          if (m.part === null || m.bolts[0] !== 3) {
            reason =
              "Fit and tighten carburettor " + (i + 1) + " before racing.";
            break;
          }
        }
        if (reason) break;
        continue;
      }
      if (!secured(w, s)) {
        reason =
          "Fit and tighten the " +
          STATION[s].label.toLowerCase() +
          " before racing.";
        break;
      }
    }
  const hp =
    grade("engine") * 12 +
    grade("intake") * 3 +
    grade("carb") * 4 +
    (w.extraCarbs ?? []).reduce(
      (total, m) => total + (m.part === null ? 0 : 4 + 2 * m.part),
      0,
    ) +
    grade("header") * 2 +
    grade("muffler") -
    Math.abs(w.timing - (grade("engine") >= 3 ? 2 : 0)) * 4;
  const bonus = (g: number): 0 | 1 | 2 => (g >= 6 ? 2 : g >= 3 ? 1 : 0);
  return {
    ready: !reason,
    reason,
    hp,
    automatic: [2, 5, 7].includes(grade("gearbox")),
    gripBonus: bonus(grade("tyres")),
    gearBonus: bonus(grade("differential")),
  };
}
type WorkshopResult =
  { ok: true; workshop: Workshop; cash: number } | { ok: false; error: string };
const fail = (error: string): WorkshopResult => ({ ok: false, error });
export function workshopAction(
  prior: Workshop,
  action: WorkshopCommand,
  cash: number,
): WorkshopResult {
  const w = structuredClone(prior);
  const ok = (balance = cash): WorkshopResult => ({
    ok: true,
    workshop: w,
    cash: balance,
  });
  if (action.type === "jack") {
    w.jacked = !w.jacked;
    return ok();
  }
  if (action.type === "wire") {
    if (!w.wired && !secured(w, "engine"))
      return fail("Mount the engine before connecting its ignition lead.");
    w.wired = !w.wired;
    return ok();
  }
  if (action.type === "timing") {
    if (!w.wired || !secured(w, "engine"))
      return fail(
        "Connect the ignition lead and secure the engine to set timing.",
      );
    const value = w.timing + action.delta;
    if (value < -5 || value > 3) return fail("The distributor is at its stop.");
    w.timing = value;
    return ok();
  }
  if (!("station" in action)) return fail("Unknown workshop operation.");
  const s = action.station,
    port = action.port ?? 0;
  if (!integer(port, 0, 2) || (s !== "carb" && port !== 0))
    return fail("Choose a valid mounting position.");
  if (s === "carb" && port > 0) w.extraCarbs ??= [emptyCarb(), emptyCarb()];
  const m = assemblyAt(w, s, port);
  const spareCount = w.spares.reduce((sum, n) => sum + n, 0);
  if (
    action.type === "buy" ||
    action.type === "sell" ||
    action.type === "fit"
  ) {
    const g = action.grade,
      i = stockIndex(s, g),
      n = w.spares[i]!;
    if (action.type === "buy") {
      if (cash < price(s, g))
        return fail("There is not enough cash for that part.");
      if (spareCount >= 64) return fail("Sell a spare to clear shelf space.");
      w.spares[i] = n + 1;
      return ok(cash - price(s, g));
    }
    if (!n) return fail("There is no matching part on the shelf.");
    if (action.type === "sell") {
      w.spares[i] = n - 1;
      return ok(cash + resale(s, g));
    }
  }
  if (STATION[s].bay === "under" && !w.jacked)
    return fail("Raise the car on its jack to work underneath.");
  if (action.type === "fit") {
    if (s === "carb" && port >= carbCount(w))
      return fail("This intake has no carburettor mount in that position.");
    if (m.part !== null) return fail("Remove the fitted part first.");
    const error = fitError(w, s, action.grade);
    if (error) return fail(error);
    const i = stockIndex(s, action.grade);
    w.spares[i] = w.spares[i]! - 1;
    m.part = action.grade;
    m.bolts.fill(1);
    return ok();
  }
  if (m.part === null) return fail("There is no fitted part here.");
  if (action.type === "bolt") {
    if (!integer(action.index, 0, m.bolts.length - 1))
      return fail("Choose a mounting bolt.");
    if (action.delta < 0) {
      if (s === "intake" && w.extraCarbs?.some((c) => c.part !== null))
        return fail("Remove the carburettors first.");
      const child = STATIONS.find(
        (other) => needs[other] === s && w.mounts[other].part !== null,
      );
      if (child)
        return fail(
          "Remove the " + STATION[child].label.toLowerCase() + " first.",
        );
      if (s === "engine" && w.wired)
        return fail("Disconnect the ignition lead before loosening the mount.");
    }
    const next = m.bolts[action.index]! + action.delta;
    if (next < 0 || next > 3) return fail("The bolt is already at its stop.");
    m.bolts[action.index] = next;
    return ok();
  }
  if (action.type === "remove") {
    if (m.bolts.some((n) => n !== 0))
      return fail("Back out every mounting bolt first.");
    if (spareCount >= 64) return fail("Clear a space on the parts shelf.");
    const i = stockIndex(s, m.part);
    w.spares[i] = w.spares[i]! + 1;
    m.part = null;
    return ok();
  }
  return fail("Choose a workshop operation.");
}
