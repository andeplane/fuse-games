import { uuid } from "fuse-netcode";
import {
  MODELS,
  PAINTS,
  FITTINGS,
  FLEET_CAPACITY,
  listings,
  nextIssue,
  stockFittings,
  type ModelId,
  type Paint,
  type Fittings,
} from "./models.js";
import {
  freshWorkshop,
  inspectWorkshop,
  isWorkshop,
  workshopAction,
  type Workshop,
  type WorkshopCommand,
} from "../workshop/mechanics.js";
export * from "./models.js";
export const ROUTES = {
  strip: { name: "Launch Strip", description: "Straight-line sprint" },
  aqueduct: { name: "Spillway Run", description: "Concrete channel" },
  canyon: { name: "Summit Road", description: "Mountain bends" },
} as const;
export type Route = keyof typeof ROUTES;
export const RIVALS = ["Finch", "Pulse", "Sable", "Juno", "Redline"] as const;
export const FINAL_DAY = 91;
export const ROAD_WINS_NEEDED = 6;
export const CHAMPIONSHIP = ["strip", "canyon", "aqueduct"] as const;
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
export const ACTIVE_SAVE = KEY;
export const TANK = 170;
export const FUEL = {
  strip: 7,
  canyon: 17,
  aqueduct: 12,
  grudge: 24,
  championship: 36,
} as const;
export const GEARS = ["short", "street", "tall"] as const;
type Gearing = (typeof GEARS)[number];
export type Part = "engine" | "tyres";
type Grade = 0 | 1 | 2;
export type StoragePort = Pick<Storage, "getItem" | "setItem">;
export interface Vehicle {
  fittings: Fittings;
  workshop: Workshop;
  fuel: number;
  paint: Paint;
  model: ModelId;
  engine: Grade;
  tyres: Grade;
  gearing: Gearing;
  condition: number;
}
export interface Setup {
  modelIndex: number;
  automatic: boolean;
  fittings: Fittings;
  gearBonus: Grade;
  paint: Paint;
  model: ModelId;
  power: number;
  grip: Grade;
  gearing: Gearing;
  condition: number;
}
export interface Challenge {
  /** Absent only on sequence-only tickets written before attempt IDs were introduced. */
  attemptId?: string;
  id: string;
  route: Route;
  wager: number;
  rivalName: string;
  rivalRank: number;
  car: Setup;
  stakeKind: "cash" | "title" | "bracket";
  rivalCar: ModelId;
  heat: number;
  variant: "timed" | "grudge" | "street" | "duel";
  dialInTicks: number;
  king: boolean;
}
export interface Campaign {
  jailed: boolean;
  driver: string;
  version: 1;
  day: number;
  cash: number;
  rank: number;
  next: number;
  qualified: boolean;
  canyonWins: number;
  aqueductWins: number;
  roadStarts: number;
  finalLeg: 0 | 1 | 2;
  fleet: Vehicle[];
  selected: ModelId | null;
  pending: Challenge | null;
  receipt: string;
}
export type Action =
  | { type: "name"; driver: string }
  | { type: "workbench"; command: WorkshopCommand }
  | { type: "body"; fitting: keyof Fittings }
  | { type: "newspaper" }
  | { type: "buy" | "select" | "sell"; model: ModelId; offer?: number }
  | { type: "paint"; paint: Paint }
  | { type: "refuel" }
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
  | {
      type: "settle";
      id: string;
      won: boolean;
      damage: number;
      speedingMph?: number;
      elapsedTicks?: number;
    }
  | { type: "restart" };
export type Result =
  { ok: true; state: Campaign } | { ok: false; error: string };
type StartAction = Extract<Action, { type: "race" | "grudge" }>;
type LoggedAction =
  Exclude<Action, StartAction> | (StartAction & { attemptId: string });
const validAttempt = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value,
  );
export const freshCampaign = (): Campaign => ({
  jailed: false,
  driver: "Driver",
  version: 1,
  day: 1,
  cash: 1100,
  rank: 0,
  next: 1,
  qualified: false,
  canyonWins: 0,
  aqueductWins: 0,
  roadStarts: 0,
  finalLeg: 0,
  fleet: [],
  selected: null,
  pending: null,
  receipt: "",
});
export const activeCar = (s: Campaign) =>
  s.fleet.find((c) => c.model === s.selected);
export const bankrupt = (s: Campaign) =>
  !s.fleet.length &&
  !listings(s.day).some((model) => dealerQuote(s.day, model) <= s.cash);
export const finished = (s: Campaign) =>
  s.jailed || s.rank === RIVALS.length || s.day > FINAL_DAY || bankrupt(s);
export function cruiseBlockReason(s: Campaign): string {
  if (finished(s)) return "The season has ended.";
  if (s.pending)
    return "Finish or retire your active race before driving into town.";
  const car = activeCar(s);
  return car
    ? inspectWorkshop(car.workshop).reason
    : "Buy a car in the classifieds before driving into town.";
}
export const eligible = (s: Campaign) =>
  s.qualified &&
  s.canyonWins >= ROAD_WINS_NEEDED &&
  s.aqueductWins >= ROAD_WINS_NEEDED &&
  s.canyonWins + s.aqueductWins >= Math.floor(s.roadStarts / 2);
export const unlockedRank = (s: Campaign) =>
  Math.min(s.rank, eligible(s) ? RIVALS.length - 1 : RIVALS.length - 2);
export const rivalCar = (rank: number): ModelId =>
  (["kestrel", "marlin", "arrowhead", "meridian", "wildfire"] as const)[rank]!;
const stockCar = (model: ModelId): Vehicle => ({
  model,
  fittings: stockFittings(),
  workshop: freshWorkshop(),
  fuel: 40,
  paint: MODELS[model].paint,
  engine: 0,
  tyres: MODELS[model].grip,
  gearing: MODELS[model].gearing,
  condition: 100,
});
export const purse = (rank: number) => 240 + rank * 140;
export const stakes = [0, 100, 300] as const;
export const partPrice = (c: Vehicle, p: Part) =>
  (p === "engine" ? 230 : 145) * (1 + c[p]);
export const repairPrice = (c: Vehicle) => 3 * (100 - c.condition);
export const sellPrice = (c: Vehicle) =>
  Math.floor(MODELS[c.model].price * (0.35 + 0.0015 * c.condition)) +
  100 * c.engine +
  65 * c.tyres;
/** Each weekly listing has a stable dealer reserve. Returning to the ad cannot reroll the offer. */
export function dealerQuote(day: number, model: ModelId, car?: Vehicle) {
  const week = Math.floor((day - 1) / 7),
    n = (MODELS[model].sprite * 11 + week * 7) % 15;
  return car
    ? Math.round((sellPrice(car) * (1 + (n + 1) / 100)) / 5) * 5
    : Math.floor((MODELS[model].price * (0.8 + n / 100)) / 5) * 5;
}
export function rivalAccepts(
  s: Campaign,
  c: Vehicle,
  rank: number,
  wager: number,
  title: boolean,
) {
  if ((!wager && !title) || rank === RIVALS.length - 1) return true;
  const motor = setup(c),
    opponentHp = MODELS[rivalCar(rank)].hp;
  const edge =
    (motor.power - opponentHp) / 5 + (s.rank - rank) * 3 + (motor.grip - 1) * 4;
  if (edge <= 12) return true;
  const chance = Math.max(
    5,
    Math.min(95, 90 - edge * (title ? 1.6 : wager >= 300 ? 1.25 : 0.65)),
  );
  return (s.day * 29 + rank * 13 + MODELS[c.model].sprite * 17) % 100 < chance;
}
const validDriver = (value: unknown): value is string =>
  typeof value === "string" &&
  value === value.trim() &&
  Array.from(value).length >= 1 &&
  Array.from(value).length <= 24 &&
  !/[\u0000-\u001f\u007f\p{Cs}]/u.test(value);
export function fuelQuote(c: Vehicle, cash: number) {
  const amount = Math.min(TANK - c.fuel, Math.max(0, cash - 10) * 20);
  return { amount, price: amount ? 10 + Math.ceil(amount / 20) : 0 };
}
export function setup(c: Vehicle): Setup {
  const bay = inspectWorkshop(c.workshop);
  return {
    modelIndex: MODELS[c.model].sprite,
    automatic: bay.automatic,
    gearBonus: bay.gearBonus,
    fittings: { ...c.fittings },
    paint: c.paint,
    model: c.model,
    power: MODELS[c.model].hp + 55 * c.engine + bay.hp,
    grip: Math.min(2, c.tyres + bay.gripBonus) as Grade,
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
    gearbox: Math.min(
      2,
      (c.gearing === "street" ? 0 : c.gearing === "short" ? 1 : 2) +
        c.gearBonus,
    ) as Grade,
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
    isWorkshop(v.workshop) &&
    isFittings(v.fittings) &&
    own(PAINTS, v.paint) &&
    integer(v.fuel, 0, TANK) &&
    integer(v.engine, 0, 2) &&
    integer(v.tyres, 0, 2) &&
    (GEARS as readonly unknown[]).includes(v.gearing) &&
    integer(v.condition, 0, 100)
  );
}
function isFittings(value: unknown): value is Fittings {
  return (
    record(value) &&
    Object.keys(FITTINGS).every((k) => typeof value[k] === "boolean")
  );
}
function createChallenge(
  s: Campaign,
  c: Vehicle,
  route: Route,
  wager: number,
  rivalRank: number,
  stakeKind: Challenge["stakeKind"],
  attemptId: string | undefined,
  heat = 0,
  dialInTicks = 0,
): Challenge {
  return {
    id: attemptId ? `race-${s.next}-${attemptId}` : `race-${s.next}`,
    ...(attemptId ? { attemptId } : {}),
    route,
    wager,
    rivalName: RIVALS[rivalRank]!,
    rivalRank,
    car: setup(c),
    stakeKind,
    heat,
    rivalCar: rivalCar(rivalRank),
    variant:
      stakeKind === "bracket"
        ? heat === 0
          ? "timed"
          : "grudge"
        : route === "strip"
          ? "street"
          : "duel",
    dialInTicks,
    king: rivalRank === RIVALS.length - 1 && stakeKind !== "bracket",
  };
}
function decode(v: unknown): Campaign | undefined {
  if (record(v) && Array.isArray(v.fleet) && v.fleet.length <= FLEET_CAPACITY) {
    const oldTicket =
      record(v.pending) &&
      !("dialInTicks" in v.pending) &&
      !("roadStarts" in v);
    v = {
      qualified: false,
      driver: "Driver",
      jailed: false,
      roadStarts: 0,
      canyonWins: 0,
      aqueductWins: 0,
      finalLeg: 0,
      ...v,
      ...(oldTicket && record(v.pending)
        ? {
            pending:
              v.pending.stakeKind === "bracket"
                ? { ...v.pending, heat: 0, rivalRank: 0, dialInTicks: 0 }
                : { heat: 0, stakeKind: "cash", ...v.pending, dialInTicks: 0 },
          }
        : {}),
      fleet: v.fleet.map((car) =>
        record(car) && own(MODELS, car.model)
          ? {
              fuel: 40,
              paint: MODELS[car.model as ModelId].paint,
              workshop: freshWorkshop(),
              fittings: stockFittings(),
              ...car,
            }
          : car,
      ),
    };
  }
  if (
    !record(v) ||
    v.version !== 1 ||
    !validDriver(v.driver) ||
    typeof v.jailed !== "boolean" ||
    !integer(v.day, 1, FINAL_DAY + 1) ||
    !integer(v.cash, 0, 1_000_000) ||
    !integer(v.rank, 0, RIVALS.length) ||
    !integer(v.next, 1, 1_000_000_000) ||
    typeof v.qualified !== "boolean" ||
    !integer(v.canyonWins, 0, FINAL_DAY * 3) ||
    !integer(v.aqueductWins, 0, FINAL_DAY * 3) ||
    !integer(v.roadStarts, 0, FINAL_DAY * 3) ||
    v.canyonWins + v.aqueductWins > v.roadStarts ||
    !integer(v.finalLeg, 0, 2) ||
    !Array.isArray(v.fleet) ||
    v.fleet.length > FLEET_CAPACITY ||
    !v.fleet.every(isCar) ||
    new Set(v.fleet.map((c) => c.model)).size !== v.fleet.length ||
    typeof v.receipt !== "string" ||
    v.receipt.length > 200
  )
    return;
  const selected = v.fleet.find((c) => c.model === v.selected);
  if (v.fleet.length ? !selected : v.selected !== null) return;
  const s: Campaign = {
    jailed: v.jailed,
    driver: v.driver,
    version: 1,
    day: v.day,
    cash: v.cash,
    rank: v.rank,
    next: v.next,
    qualified: v.qualified,
    canyonWins: v.canyonWins,
    aqueductWins: v.aqueductWins,
    roadStarts: v.roadStarts,
    finalLeg: v.finalLeg as 0 | 1 | 2,
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
      !integer(p.heat, 0, 4) ||
      !integer(p.dialInTicks, 0, 72_000) ||
      (p.stakeKind !== "cash" && p.wager !== 0)
    )
      return;
    if (
      p.stakeKind === "bracket"
        ? !grudgeNight(s.day) ||
          (p.heat === 0) !== (p.dialInTicks === 0) ||
          p.rivalRank !== Math.max(0, p.heat - 1) ||
          p.route !== "strip"
        : p.heat !== 0 || p.dialInTicks !== 0 || p.rivalRank > unlockedRank(s)
    )
      return;
    if (p.attemptId !== undefined && !validAttempt(p.attemptId)) return;
    const pending = createChallenge(
      s,
      selected,
      p.route as Route,
      Number(p.wager),
      p.rivalRank,
      p.stakeKind,
      p.attemptId,
      p.heat,
      p.dialInTicks,
    );
    if (p.id !== pending.id) return;
    if (
      pending.king &&
      (pending.route !== CHAMPIONSHIP[s.finalLeg] ||
        pending.stakeKind !== (s.finalLeg === 2 ? "title" : "cash") ||
        pending.wager !== 0)
    )
      return;
    s.pending = pending;
  }
  return s;
}
export function loadCampaign(storage: StoragePort): Campaign {
  const raw = storage.getItem(KEY);
  if (raw === null) return freshCampaign();
  return parseSave(raw);
}
export function parseSave(raw: string): Campaign {
  try {
    if (raw.length <= 65_536) {
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
export function change(s: Campaign, a: LoggedAction): Result {
  if ((a.type === "race" || a.type === "grudge") && !validAttempt(a.attemptId))
    return fail("Invalid race attempt.");
  if (a.type === "name") {
    const driver = a.driver.trim();
    if (!validDriver(driver))
      return fail("Use a driver name between 1 and 24 characters.");
    return success({ ...s, driver, receipt: "Licence updated." });
  }
  if (a.type === "restart") {
    if (!finished(s))
      return fail("Finish this season before starting a new one.");
    return success({ ...freshCampaign(), next: s.next, driver: s.driver });
  }
  if (finished(s)) return fail("The season has ended.");
  const c = activeCar(s);
  if (a.type === "settle") {
    if (!s.pending || !c || a.id !== s.pending.id || !integer(a.damage, 0, 100))
      return fail("This race ticket is no longer active.");
    const {
      wager,
      rivalName,
      rivalRank,
      stakeKind,
      heat,
      route,
      dialInTicks,
      king,
    } = s.pending;
    const wear = Math.min(100, 6 + a.damage);
    const worked = s.fleet.map((v) =>
      v === c ? { ...v, condition: Math.max(0, v.condition - wear) } : v,
    );
    if (a.speedingMph !== undefined) {
      if (
        !Number.isFinite(a.speedingMph) ||
        a.speedingMph < 0 ||
        a.won ||
        route !== "canyon" ||
        king ||
        stakeKind === "bracket"
      )
        return fail("Invalid patrol result.");
      const fine = a.speedingMph > 80 ? 75 : a.speedingMph > 50 ? 50 : 20,
        wallet = s.cash + wager,
        jailed = fine > wallet;
      return success({
        ...s,
        pending: null,
        next: s.next + 1,
        day: s.day + 1,
        finalLeg: 0,
        fleet: worked,
        cash: Math.max(0, wallet - fine),
        jailed,
        receipt: jailed
          ? `Unable to pay the $${fine} speeding ticket.`
          : `Patrol stopped the race. $${fine} speeding fine paid.`,
      });
    }
    if (stakeKind === "bracket") {
      const next = { ...s, fleet: worked, next: s.next + 1, pending: null };
      if (heat === 0 && a.won && !integer(a.elapsedTicks, 1, 72_000))
        return fail("A strip finish time is needed to settle this run.");
      const breakout =
        heat > 0 &&
        a.elapsedTicks !== undefined &&
        a.elapsedTicks < dialInTicks;
      const tooSlow =
        heat === 0 && a.elapsedTicks !== undefined && a.elapsedTicks > 1600;
      // A rival can break out before this car crosses the stripe. The race engine owns the winner.
      const advanced = a.won && !tooSlow;
      if (advanced && heat < 4) {
        const following = createChallenge(
          next,
          activeCar(next)!,
          "strip",
          0,
          heat,
          "bracket",
          s.pending.attemptId,
          heat + 1,
          heat === 0 ? a.elapsedTicks! : dialInTicks,
        );
        return success({
          ...next,
          pending: following,
          receipt:
            heat === 0
              ? "Dial-in recorded. Heat 1 is ready."
              : `Won heat ${heat}. Heat ${heat + 1} is ready.`,
        });
      }
      return success({
        ...next,
        day: s.day + 1,
        qualified: s.qualified || advanced,
        cash: s.cash + (advanced ? GRUDGE_PURSE : 0),
        receipt: advanced
          ? `Won Grudge Night. $${GRUDGE_PURSE} purse and a championship qualifier.`
          : breakout
            ? "Breakout. Your run beat your dial-in."
            : tooSlow
              ? "Time run exceeded 80 seconds."
              : heat === 0
                ? "Retired from the time run."
                : `Eliminated in heat ${heat}.`,
      });
    }
    const rank =
      s.rank +
      Number(a.won && rivalRank === s.rank && (!king || s.finalLeg === 2));
    const next = {
      ...s,
      pending: null,
      next: s.next + 1,
      day: s.day + 1,
      rank,
      fleet: worked,
      roadStarts: s.roadStarts + Number(route !== "strip"),
      canyonWins: s.canyonWins + Number(a.won && route === "canyon"),
      aqueductWins: s.aqueductWins + Number(a.won && route === "aqueduct"),
    };
    if (king) {
      if (!a.won) {
        next.finalLeg = 0;
        next.canyonWins = Math.max(0, next.canyonWins - 3);
        next.aqueductWins = Math.max(0, next.aqueductWins - 2);
      } else if (s.finalLeg < 2) {
        const leg = s.finalLeg === 0 ? 1 : 2;
        const following = { ...next, day: s.day, finalLeg: leg as 1 | 2 };
        return success({
          ...following,
          pending: createChallenge(
            following,
            activeCar(following)!,
            CHAMPIONSHIP[leg],
            0,
            rivalRank,
            leg === 2 ? "title" : "cash",
            s.pending.attemptId,
          ),
          receipt: `Beat Redline on ${ROUTES[route].name}. Next: ${ROUTES[CHAMPIONSHIP[leg]].name}.`,
        });
      }
    }
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
      const owned =
        worked.some((v) => v.model === model) ||
        worked.length >= FLEET_CAPACITY;
      const trade = Math.floor(MODELS[model].price / 2);
      return success({
        ...next,
        fleet: owned ? worked : [...worked, stockCar(model)],
        cash: s.cash + (owned ? trade : 0),
        receipt: owned
          ? `Traded the ${MODELS[model].title} title for $${trade}.`
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
  if (a.type === "newspaper") {
    const day = nextIssue(s.day);
    if (day > FINAL_DAY) return fail("This is the final issue of the season.");
    return success({ ...s, day, receipt: "The new classifieds are in." });
  }
  if (a.type === "buy") {
    if (s.fleet.length >= FLEET_CAPACITY)
      return fail("All 16 garage spaces are occupied.");
    if (!listings(s.day).includes(a.model))
      return fail("This car is no longer listed this week.");
    if (s.fleet.some((v) => v.model === a.model))
      return fail("This model is already in your garage.");
    const car = MODELS[a.model];
    const price = a.offer ?? car.price,
      reserve = dealerQuote(s.day, a.model);
    if (!integer(price, 1, car.price))
      return fail("Enter a whole-dollar offer up to the asking price.");
    if (price < reserve) return fail(`Seller's counteroffer: $${reserve}.`);
    if (price > s.cash) return fail("You need more cash for this car.");
    return success({
      ...s,
      cash: s.cash - price,
      selected: a.model,
      fleet: [...s.fleet, stockCar(a.model)],
      receipt: `Bought ${car.title} for $${price}.`,
    });
  }
  if (a.type === "select") {
    if (!s.fleet.some((v) => v.model === a.model))
      return fail("Buy this car before selecting it.");
    return success({ ...s, selected: a.model, receipt: "" });
  }
  if (a.type === "sell") {
    const car = s.fleet.find((v) => v.model === a.model);
    if (!car) return fail("This car is no longer in your garage.");
    const fleet = s.fleet.filter((v) => v !== car),
      reserve = dealerQuote(s.day, a.model, car),
      price = a.offer ?? sellPrice(car);
    if (!integer(price, 1, 1_000_000))
      return fail("Enter a positive whole-dollar asking price.");
    if (price > reserve) return fail(`Buyer's counteroffer: $${reserve}.`);
    return success({
      ...s,
      fleet,
      selected: car === c ? (fleet[0]?.model ?? null) : s.selected,
      cash: s.cash + price,
      receipt: `Sold ${MODELS[car.model].title} for $${price}.`,
    });
  }
  if (!c) return fail("Buy a car in the classifieds first.");
  if (a.type === "workbench") {
    const out = workshopAction(c.workshop, a.command, s.cash);
    if (!out.ok) return out;
    return success({
      ...s,
      cash: out.cash,
      fleet: s.fleet.map((v) =>
        v === c ? { ...v, workshop: out.workshop } : v,
      ),
      receipt: "",
    });
  }
  if (a.type === "race" || a.type === "grudge") {
    const bay = inspectWorkshop(c.workshop);
    if (!bay.ready) return fail(bay.reason);
  }
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
    if (c.fuel < FUEL.grudge)
      return fail("Grudge Night needs 2.4 gal. Visit the station.");
    return success({
      ...s,
      cash: s.cash - GRUDGE_FEE,
      fleet: s.fleet.map((v) =>
        v === c ? { ...v, fuel: v.fuel - FUEL.grudge } : v,
      ),
      pending: createChallenge(s, c, "strip", 0, 0, "bracket", a.attemptId),
      receipt: "",
    });
  }
  if (a.type === "race") {
    const rank = a.rivalRank ?? unlockedRank(s);
    if (!integer(rank, 0, unlockedRank(s)))
      return fail(
        "Beat the next rival and qualify at Grudge Night to reach the champion.",
      );
    if (!own(ROUTES, a.route)) return fail("Unknown course.");
    const fuel = rank === RIVALS.length - 1 ? FUEL.championship : FUEL[a.route];
    if (c.fuel < fuel)
      return fail(
        `This event needs ${(fuel / 10).toFixed(1)} gal. Visit the station.`,
      );
    const fleet = s.fleet.map((v) =>
      v === c ? { ...v, fuel: v.fuel - fuel } : v,
    );
    if (rank === RIVALS.length - 1)
      return success({
        ...s,
        fleet,
        pending: createChallenge(
          s,
          c,
          CHAMPIONSHIP[s.finalLeg],
          0,
          rank,
          s.finalLeg === 2 ? "title" : "cash",
          a.attemptId,
        ),
        receipt: "",
      });
    if (
      !own(ROUTES, a.route) ||
      !(stakes as readonly number[]).includes(a.wager) ||
      a.wager > s.cash
    )
      return fail("Choose a stake you can cover.");
    if (a.pinkSlip && a.wager !== 0)
      return fail("Choose a cash stake or a car title.");
    if (!rivalAccepts(s, c, rank, a.wager, a.pinkSlip ?? false))
      return fail(
        `${RIVALS[rank]} declined those odds. Lower the stake or choose another car.`,
      );
    return success({
      ...s,
      fleet,
      cash: s.cash - a.wager,
      pending: createChallenge(
        s,
        c,
        a.route,
        a.wager,
        rank,
        a.pinkSlip ? "title" : "cash",
        a.attemptId,
      ),
      receipt: "",
    });
  }
  let replacement: Vehicle;
  let cost = 0;
  let receipt = "";
  switch (a.type) {
    case "body":
      if (
        !own(FITTINGS, a.fitting) ||
        (a.fitting === "roof" && !MODELS[c.model].openTop)
      )
        return fail("That fitting is fixed on this model.");
      cost = 20;
      replacement = {
        ...c,
        fittings: { ...c.fittings, [a.fitting]: !c.fittings[a.fitting] },
      };
      receipt = "Bodywork complete.";
      break;
    case "paint":
      if (!own(PAINTS, a.paint) || c.paint === a.paint)
        return fail("Choose another paint colour.");
      cost = 20;
      replacement = { ...c, paint: a.paint };
      receipt = "Paintwork finished.";
      break;
    case "refuel": {
      if (c.fuel === TANK) return fail("Your tank is full.");
      const quote = fuelQuote(c, s.cash);
      if (!quote.amount)
        return fail("The station needs $11 for fuel and service.");
      cost = quote.price;
      replacement = { ...c, fuel: c.fuel + quote.amount };
      receipt = `Added ${(quote.amount / 10).toFixed(1)} gal.`;
      break;
    }
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
export function transact(
  storage: StoragePort,
  action: Action,
  issueAttempt: () => string = uuid,
): Result {
  try {
    const logged =
      action.type === "race" || action.type === "grudge"
        ? { ...action, attemptId: issueAttempt() }
        : action;
    const out = change(loadCampaign(storage), logged);
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
export function undoWorkshop(
  storage: StoragePort,
  before: Campaign,
  after: Campaign,
): Result {
  try {
    if (JSON.stringify(loadCampaign(storage)) !== JSON.stringify(after))
      return fail(
        "The garage has changed. This work order can no longer be undone.",
      );
    storage.setItem(KEY, JSON.stringify(before));
    return success(before);
  } catch {
    return fail("The workbench could not restore this change.");
  }
}
export function settleRace(
  storage: StoragePort,
  id: string,
  outcome: {
    won: boolean;
    damage?: number;
    elapsedTicks?: number;
    speedingMph?: number;
  },
): Result {
  return transact(storage, {
    type: "settle",
    id,
    won: outcome.won,
    damage: outcome.damage ?? 0,
    elapsedTicks: outcome.elapsedTicks,
    speedingMph: outcome.speedingMph,
  });
}
