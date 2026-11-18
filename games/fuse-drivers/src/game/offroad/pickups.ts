import { offroadTruckBounds, type OffroadMotion } from "./motion.js";
import { nextOffroadSeed } from "./rng.js";

type PickupKind = "cash" | "nitro";
export interface OffroadPickup {
  kind: PickupKind;
  x: number;
  y: number;
}
export interface OffroadPickups {
  waitTicks: number;
  active: OffroadPickup | null;
  cashLevel: number;
  nitroLevel: number;
}

// Native contact coordinates at the end of CS:0508. The actor truncates each
// source position to multiples of 32. Reverse variants reuse the physical track.
const LOCATIONS = [
  [
    [1024, 1408],
    [2304, 1408],
    [5376, 1280],
    [8064, 1792],
    [2688, 3456],
    [7232, 3584],
    [10048, 6912],
    [6016, 9472],
    [9600, 9472],
  ],
  [
    [512, 1344],
    [8320, 1344],
    [4352, 3840],
    [8192, 3840],
    [9984, 6656],
    [4736, 9600],
    [9344, 9664],
  ],
  [
    [1024, 3584],
    [3968, 5120],
    [8576, 7360],
    [7424, 8448],
    [5312, 9472],
    [7968, 9728],
  ],
  [
    [896, 2048],
    [8000, 1984],
    [3520, 6912],
    [9760, 6592],
    [2112, 9600],
    [9344, 9664],
  ],
  [
    [512, 2304],
    [8192, 2048],
    [4608, 4608],
    [4608, 7424],
    [7040, 7296],
    [1536, 7680],
    [10240, 8000],
  ],
  [
    [7552, 2432],
    [2816, 2560],
    [3872, 4608],
    [4992, 7296],
    [2944, 8576],
    [9792, 9664],
    [5312, 9728],
  ],
  [
    [2208, 1536],
    [5120, 1664],
    [6784, 2304],
    [3456, 4608],
    [8928, 4256],
    [9600, 6400],
    [3744, 9728],
    [9984, 9728],
  ],
  [
    [768, 1024],
    [8256, 1408],
    [4384, 4224],
    [7232, 6016],
    [4352, 6368],
    [9344, 9120],
    [9696, 9472],
    [4064, 9728],
  ],
] as const;

// DS:341c waits 120 active updates before exposing the one collectible.
const WAIT = 120;
export const initialOffroadPickups = (): OffroadPickups => ({
  waitTicks: WAIT,
  active: null,
  cashLevel: 0,
  nitroLevel: 0,
});

export function isOffroadPickups(
  raw: unknown,
  courseIndex: number,
): raw is OffroadPickups {
  if (!raw || typeof raw !== "object") return false;
  const { waitTicks, active, cashLevel, nitroLevel } =
    raw as Partial<OffroadPickups>;
  const bounded = (n: unknown, max: number): n is number =>
    typeof n === "number" &&
    Number.isInteger(n) &&
    !Object.is(n, -0) &&
    n >= 0 &&
    n <= max;
  if (
    !bounded(waitTicks, WAIT) ||
    !bounded(cashLevel, 9) ||
    !bounded(nitroLevel, 9)
  )
    return false;
  if (active === null) return waitTicks > 0;
  return (
    waitTicks === 0 &&
    !!active &&
    (active.kind === "cash" || active.kind === "nitro") &&
    !!LOCATIONS[courseIndex]?.some(([x, y]) => x === active.x && y === active.y)
  );
}

export interface OffroadPickupAward {
  slot: number;
  kind: PickupKind;
  amount: number;
}

/** Pass trucks in slot order at the pre-movement positions used by the collision pass. */
export function stepOffroadPickups(
  state: OffroadPickups,
  courseIndex: number,
  trucks: readonly Pick<OffroadMotion, "x" | "y" | "heading">[],
  randomSeed: number,
): { state: OffroadPickups; randomSeed: number; award?: OffroadPickupAward } {
  const locations = LOCATIONS[courseIndex];
  if (!locations) return { state, randomSeed };
  const pickup = state.active;
  if (!pickup) {
    if (state.waitTicks > 1)
      return {
        state: { ...state, waitTicks: state.waitTicks - 1 },
        randomSeed,
      };
    const first = nextOffroadSeed(randomSeed);
    const second = nextOffroadSeed(first);
    // The track's lookup repeats its location indices until all 16 slots are filled.
    const [x, y] = locations[((first - 1) & 15) % locations.length]!;
    return {
      state: {
        ...state,
        waitTicks: 0,
        active: { x, y, kind: (second - 1) & 1 ? "nitro" : "cash" },
      },
      randomSeed: second,
    };
  }
  // DS:326a spans eight 128-unit occupancy buckets on each axis, from offset -4
  // in 32-unit actor coordinates. CS:056e resolves the lowest matching slot.
  const left = ((pickup.x >>> 5) - 4) >> 2;
  const top = ((pickup.y >>> 5) - 4) >> 2;
  const slot = trucks.findIndex((truck) => {
    const bounds = offroadTruckBounds(truck);
    return (
      left < bounds.right &&
      left + 8 > bounds.left &&
      top < bounds.bottom &&
      top + 8 > bounds.top
    );
  });
  if (slot < 0) return { state, randomSeed };
  const level = pickup.kind === "cash" ? "cashLevel" : "nitroLevel";
  const amount = Math.min(9, state[level] + 1);
  return {
    state: { ...state, active: null, waitTicks: WAIT, [level]: amount },
    randomSeed,
    award: { slot, kind: pickup.kind, amount },
  };
}

/** CS:376e sums placement credit and collected cash in one two-digit BCD byte.
 * A fifth Fuse driver retains their collected cash. */
export function offroadRacePurse(zeroBasedPlace: number, cash: number): number {
  return (([10, 9, 8, 7][zeroBasedPlace] ?? 0) + cash) % 100;
}
