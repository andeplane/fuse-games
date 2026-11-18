export const MODELS = {
  kestrel: {
    title: "Kestrel Six",
    body: "Club coupe",
    price: 700,
    hp: 160,
    paint: "#4ce1d3",
    sprite: 0,
  },
  marlin: {
    title: "Marlin Eight",
    body: "Fastback",
    price: 1500,
    hp: 230,
    paint: "#e8a255",
    sprite: 1,
  },
  meteor: {
    title: "Meteor GT",
    body: "Sport hardtop",
    price: 2400,
    hp: 295,
    paint: "#eb6999",
    sprite: 2,
  },
} as const;
export type ModelId = keyof typeof MODELS;
export const ROUTES = {
  strip: { name: "Launch Strip", description: "Straight-line sprint" },
  aqueduct: { name: "Spillway Run", description: "Concrete channel" },
  canyon: { name: "Summit Road", description: "Mountain bends" },
} as const;
export type Route = keyof typeof ROUTES;
export const RIVALS = ["Finch", "Pulse", "Sable", "Juno", "Redline"] as const;
export const FINAL_DAY = 28;
export const GRUDGE_FEE = 30;
export const GRUDGE_PURSE = 450;
export const WEEKDAYS = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;
export const grudgeNight = (day: number) =>
  day <= FINAL_DAY && (day - 1) % 7 === 2;
export const daysToGrudge = (day: number) => (2 - ((day - 1) % 7) + 7) % 7;
const KEY = "fuserod.garage.v1";
export const GEARS = ["short", "street", "tall"] as const;
type Gearing = (typeof GEARS)[number];
export type Part = "engine" | "tyres";
type Grade = 0 | 1 | 2;
export type StoragePort = Pick<Storage, "getItem" | "setItem">;
export interface Vehicle {
  model: ModelId;
  engine: Grade;
  tyres: Grade;
  gearing: Gearing;
  condition: number;
}
export interface Setup {
  model: ModelId;
  power: number;
  grip: Grade;
  gearing: Gearing;
  condition: number;
}
export interface Challenge {
  id: string;
  route: Route;
  wager: number;
  rivalName: string;
  rivalRank: number;
  car: Setup;
  stakeKind: "cash" | "title" | "bracket";
  rivalCar: ModelId;
  heat: number;
}
export interface Campaign {
  version: 1;
  day: number;
  cash: number;
  rank: number;
  next: number;
  qualified: boolean;
  fleet: Vehicle[];
  selected: ModelId | null;
  pending: Challenge | null;
  receipt: string;
}
export type Action =
  | { type: "buy" | "select"; model: ModelId }
  | { type: "upgrade"; part: Part }
  | { type: "gear"; gearing: Gearing }
  | { type: "repair" }
  | {
      type: "race";
      route: Route;
      wager: number;
      rivalRank?: number;
      pinkSlip?: boolean;
    }
  | { type: "grudge" }
  | { type: "wait" }
  | { type: "settle"; id: string; won: boolean; damage: number }
  | { type: "restart" };
export type Result =
  { ok: true; state: Campaign } | { ok: false; error: string };
export const freshCampaign = (): Campaign => ({
  version: 1,
  day: 1,
  cash: 1100,
  rank: 0,
  next: 1,
  qualified: false,
  fleet: [],
  selected: null,
  pending: null,
  receipt: "",
});
export const activeCar = (s: Campaign) =>
  s.fleet.find((c) => c.model === s.selected);
export const bankrupt = (s: Campaign) =>
  !s.fleet.length && s.cash < MODELS.kestrel.price;
export const finished = (s: Campaign) =>
  s.rank === RIVALS.length || s.day > FINAL_DAY || bankrupt(s);
export const unlockedRank = (s: Campaign) =>
  Math.min(s.rank, s.qualified ? RIVALS.length - 1 : RIVALS.length - 2);
export const rivalCar = (rank: number): ModelId =>
  (["kestrel", "marlin", "kestrel", "meteor", "meteor"] as const)[rank]!;
const stockCar = (model: ModelId): Vehicle => ({
  model,
  engine: 0,
  tyres: 0,
  gearing: "street",
  condition: 100,
});
export const purse = (rank: number) => 240 + rank * 140;
export const stakes = [0, 100, 300] as const;
export const partPrice = (c: Vehicle, p: Part) =>
  (p === "engine" ? 230 : 145) * (1 + c[p]);
export const repairPrice = (c: Vehicle) => 3 * (100 - c.condition);
export function setup(c: Vehicle): Setup {
  return {
    model: c.model,
    power: MODELS[c.model].hp + 55 * c.engine,
    grip: c.tyres,
    gearing: c.gearing,
    condition: c.condition,
  };
}
export function motorSetup(c: Setup): {
  power: Grade;
  tires: Grade;
  gearbox: Grade;
} {
  const hp = c.power * (0.75 + 0.0025 * c.condition);
  return {
    power: hp < 205 ? 0 : hp < 270 ? 1 : 2,
    tires: c.grip,
    gearbox: c.gearing === "street" ? 0 : c.gearing === "short" ? 1 : 2,
  };
}
const own = (dict: object, key: unknown): key is string =>
  typeof key === "string" && Object.hasOwn(dict, key);
const integer = (v: unknown, min: number, max: number): v is number =>
  Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
function isCar(v: unknown): v is Vehicle {
  return (
    record(v) &&
    own(MODELS, v.model) &&
    integer(v.engine, 0, 2) &&
    integer(v.tyres, 0, 2) &&
    (GEARS as readonly unknown[]).includes(v.gearing) &&
    integer(v.condition, 0, 100)
  );
}
function createChallenge(
  s: Campaign,
  c: Vehicle,
  route: Route,
  wager: number,
  rivalRank: number,
  stakeKind: Challenge["stakeKind"],
  heat = 0,
): Challenge {
  return {
    id: `race-${s.next}`,
    route,
    wager,
    rivalName: RIVALS[rivalRank]!,
    rivalRank,
    car: setup(c),
    stakeKind,
    heat,
    rivalCar: rivalCar(rivalRank),
  };
}
function decode(v: unknown): Campaign | undefined {
  if (
    !record(v) ||
    v.version !== 1 ||
    !integer(v.day, 1, FINAL_DAY + 1) ||
    !integer(v.cash, 0, 1_000_000) ||
    !integer(v.rank, 0, RIVALS.length) ||
    !integer(v.next, 1, 1_000_000_000) ||
    typeof v.qualified !== "boolean" ||
    !Array.isArray(v.fleet) ||
    v.fleet.length > 3 ||
    !v.fleet.every(isCar) ||
    new Set(v.fleet.map((c) => c.model)).size !== v.fleet.length ||
    typeof v.receipt !== "string" ||
    v.receipt.length > 200
  )
    return;
  const selected = v.fleet.find((c) => c.model === v.selected);
  if (v.fleet.length ? !selected : v.selected !== null) return;
  const s: Campaign = {
    version: 1,
    day: v.day,
    cash: v.cash,
    rank: v.rank,
    next: v.next,
    qualified: v.qualified,
    fleet: v.fleet,
    selected: selected?.model ?? null,
    pending: null,
    receipt: v.receipt,
  };
  if (v.pending !== null) {
    const p = v.pending;
    if (
      !selected ||
      finished(s) ||
      !record(p) ||
      !own(ROUTES, p.route) ||
      !(stakes as readonly unknown[]).includes(p.wager)
    )
      return;
    if (
      p.stakeKind !== "cash" &&
      p.stakeKind !== "title" &&
      p.stakeKind !== "bracket"
    )
      return;
    if (
      !integer(p.rivalRank, 0, RIVALS.length - 1) ||
      !integer(p.heat, 0, 3) ||
      (p.stakeKind !== "cash" && p.wager !== 0)
    )
      return;
    if (
      p.stakeKind === "bracket"
        ? !grudgeNight(s.day) ||
          p.heat < 1 ||
          p.rivalRank !== p.heat - 1 ||
          p.route !== "strip"
        : p.heat !== 0 || p.rivalRank > unlockedRank(s)
    )
      return;
    const pending = createChallenge(
      s,
      selected,
      p.route as Route,
      Number(p.wager),
      p.rivalRank,
      p.stakeKind,
      p.heat,
    );
    if (p.id !== pending.id) return;
    s.pending = pending;
  }
  return s;
}
export function loadCampaign(storage: StoragePort): Campaign {
  const raw = storage.getItem(KEY);
  if (raw === null) return freshCampaign();
  try {
    if (raw.length <= 8192) {
      const state = decode(JSON.parse(raw));
      if (state) return state;
    }
  } catch {
    /* Report an unreadable save without overwriting it. */
  }
  throw new Error("This garage save could not be read.");
}
const fail = (error: string): Result => ({ ok: false, error });
const success = (state: Campaign): Result => ({ ok: true, state });
export function change(s: Campaign, a: Action): Result {
  if (a.type === "restart") {
    if (!finished(s))
      return fail("Finish this season before starting a new one.");
    return success({ ...freshCampaign(), next: s.next });
  }
  if (finished(s)) return fail("The season has ended.");
  const c = activeCar(s);
  if (a.type === "settle") {
    if (!s.pending || !c || a.id !== s.pending.id || !integer(a.damage, 0, 100))
      return fail("This race ticket is no longer active.");
    const { wager, rivalName, rivalRank, stakeKind, heat } = s.pending;
    const wear = Math.min(100, 6 + a.damage);
    const worked = s.fleet.map((v) =>
      v === c ? { ...v, condition: Math.max(0, v.condition - wear) } : v,
    );
    if (stakeKind === "bracket") {
      const next = { ...s, fleet: worked, next: s.next + 1, pending: null };
      if (a.won && heat < 3) {
        const following = createChallenge(
          next,
          activeCar(next)!,
          "strip",
          0,
          heat,
          "bracket",
          heat + 1,
        );
        return success({
          ...next,
          pending: following,
          receipt: `Won heat ${heat}. Heat ${heat + 1} is ready.`,
        });
      }
      return success({
        ...next,
        day: s.day + 1,
        qualified: s.qualified || a.won,
        cash: s.cash + (a.won ? GRUDGE_PURSE : 0),
        receipt: a.won
          ? `Won Grudge Night. $${GRUDGE_PURSE} purse and a championship qualifier.`
          : `Eliminated in heat ${heat}.`,
      });
    }
    const rank = s.rank + Number(a.won && rivalRank === s.rank);
    const next = {
      ...s,
      pending: null,
      next: s.next + 1,
      day: s.day + 1,
      rank,
      fleet: worked,
    };
    if (stakeKind === "title") {
      if (!a.won) {
        const fleet = worked.filter((v) => v.model !== c.model);
        return success({
          ...next,
          fleet,
          selected: fleet[0]?.model ?? null,
          receipt: `Lost the title to your ${MODELS[c.model].title}.`,
        });
      }
      const model = s.pending.rivalCar;
      const owned = worked.some((v) => v.model === model);
      const trade = Math.floor(MODELS[model].price / 2);
      return success({
        ...next,
        fleet: owned ? worked : [...worked, stockCar(model)],
        cash: s.cash + (owned ? trade : 0),
        receipt: owned
          ? `Traded the duplicate ${MODELS[model].title} title for $${trade}.`
          : `Won the title to a ${MODELS[model].title}.`,
      });
    }
    const earnings = a.won ? 2 * wager + purse(rivalRank) : 0;
    return success({
      ...next,
      cash: s.cash + earnings,
      receipt: a.won
        ? `Beat ${rivalName}. Payout $${earnings}.`
        : `Lost to ${rivalName}. Stake $${wager}.`,
    });
  }
  if (s.pending) return fail("Finish or retire the active race first.");
  if (a.type === "buy") {
    if (s.fleet.some((v) => v.model === a.model))
      return fail("This model is already in your garage.");
    const car = MODELS[a.model];
    if (car.price > s.cash) return fail("You need more cash for this car.");
    return success({
      ...s,
      cash: s.cash - car.price,
      selected: a.model,
      fleet: [...s.fleet, stockCar(a.model)],
      receipt: `Bought ${car.title}.`,
    });
  }
  if (a.type === "select") {
    if (!s.fleet.some((v) => v.model === a.model))
      return fail("Buy this car before selecting it.");
    return success({ ...s, selected: a.model, receipt: "" });
  }
  if (!c) return fail("Buy a car in the classifieds first.");
  if (a.type === "wait") {
    const days = daysToGrudge(s.day);
    if (days === 0 || s.day + days > FINAL_DAY)
      return fail("No later Grudge Night is available this season.");
    return success({
      ...s,
      day: s.day + days,
      receipt: "Wednesday evening. Grudge Night is open.",
    });
  }
  if (a.type === "grudge") {
    if (!grudgeNight(s.day) || s.cash < GRUDGE_FEE)
      return fail("Enter Grudge Night on Wednesday with the entry fee.");
    return success({
      ...s,
      cash: s.cash - GRUDGE_FEE,
      pending: createChallenge(s, c, "strip", 0, 0, "bracket", 1),
      receipt: "",
    });
  }
  if (a.type === "race") {
    const rank = a.rivalRank ?? unlockedRank(s);
    if (!integer(rank, 0, unlockedRank(s)))
      return fail(
        "Beat the next rival and qualify at Grudge Night to reach the champion.",
      );
    if (
      !own(ROUTES, a.route) ||
      !(stakes as readonly number[]).includes(a.wager) ||
      a.wager > s.cash
    )
      return fail("Choose a stake you can cover.");
    if (a.pinkSlip && a.wager !== 0)
      return fail("Choose a cash stake or a car title.");
    return success({
      ...s,
      cash: s.cash - a.wager,
      pending: createChallenge(
        s,
        c,
        a.route,
        a.wager,
        rank,
        a.pinkSlip ? "title" : "cash",
      ),
      receipt: "",
    });
  }
  let replacement: Vehicle;
  let cost = 0;
  let receipt = "";
  switch (a.type) {
    case "gear":
      replacement = { ...c, gearing: a.gearing };
      receipt = "Final drive adjusted.";
      break;
    case "repair":
      cost = repairPrice(c);
      if (!cost) return fail("This car is already in top condition.");
      replacement = { ...c, condition: 100 };
      receipt = "Repairs complete.";
      break;
    case "upgrade":
      if (c[a.part] >= 2) return fail("This part is fully upgraded.");
      cost = partPrice(c, a.part);
      replacement = { ...c, [a.part]: c[a.part] + 1 };
      receipt =
        a.part === "engine" ? "Engine kit installed." : "New tyres fitted.";
      break;
    default:
      return fail("Unknown garage action.");
  }
  if (cost > s.cash) return fail("You need more cash for this work.");
  return success({
    ...s,
    cash: s.cash - cost,
    fleet: s.fleet.map((v) => (v === c ? replacement : v)),
    receipt,
  });
}
export function transact(storage: StoragePort, action: Action): Result {
  try {
    const out = change(loadCampaign(storage), action);
    if (out.ok) storage.setItem(KEY, JSON.stringify(out.state));
    return out;
  } catch (error) {
    return fail(
      error instanceof Error
        ? error.message
        : "The garage could not save this change.",
    );
  }
}
export function settleRace(
  storage: StoragePort,
  id: string,
  outcome: { won: boolean; damage?: number },
): Result {
  return transact(storage, {
    type: "settle",
    id,
    won: outcome.won,
    damage: outcome.damage ?? 0,
  });
}
