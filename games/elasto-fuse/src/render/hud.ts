import type { WorldView } from "../engine/view.js";
import { STEPS_PER_SECOND, centiseconds } from "../engine/view-kit.js";
import { countOf } from "./cues.js";

/**
 * What a pane writes over its rider's race, decided from one view: the run clock, the apples, the place, the closing
 * countdown and the banner in the middle. Pure, so the words are unit-tested; the scene only paints them.
 */
export interface PaneHud {
  clock: string;
  apples: string;
  /** "1ST" to "5TH" when more than one rider races, otherwise "". */
  place: string;
  /**
   * "RACE ENDS IN 27" once somebody is home and anybody is still riding, otherwise "". Every pane shows it, home or
   * not: a rider who finished sees how long the others have left.
   */
  closing: string;
  /** Ten seconds or less to the close. */
  urgent: boolean;
  banner: string;
  tone: "count" | "go" | "crash" | "finish" | "";
}

/** Hundredths of a second as `m:ss.cc`. */
export function clockText(hundredths: number): string {
  const total = Math.max(0, Math.floor(hundredths));
  const minutes = Math.floor(total / 6000),
    seconds = Math.floor(total / 100) % 60,
    rest = total % 100;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(rest).padStart(2, "0")}`;
}

const ORDINALS = ["1ST", "2ND", "3RD", "4TH", "5TH"] as const;
export const ordinal = (place: number): string =>
  ORDINALS[place - 1] ?? `${place}TH`;

/** How long "GO!" stays up after the start, in steps. */
export const GO_STEPS = Math.round(0.8 * STEPS_PER_SECOND);

/**
 * Whole seconds until the race closes for the riders still out, seen from `slot`'s pane, or undefined when nobody
 * is on the clock. A rider still riding counts down on the view's clock (its own); one who is home counts down on the
 * furthest clock of those still riding, since its own stopped at the flower.
 */
export function closingSeconds(
  world: WorldView,
  slot: number,
): number | undefined {
  const rider = world.riders[slot];
  if (!rider || !world.closing || world.phase !== "racing") return undefined;
  const close = world.step + world.left;
  let clock: number;
  if (rider.status !== "finished") clock = world.step;
  else {
    const out = world.riders.filter((other) => other.status !== "finished");
    if (!out.length) return undefined;
    clock = Math.max(...out.map((other) => other.step));
  }
  return Math.ceil(Math.max(0, close - clock) / STEPS_PER_SECOND);
}

export function paneHud(world: WorldView, slot: number): PaneHud | undefined {
  const rider = world.riders[slot];
  if (!rider) return undefined;
  const seconds = closingSeconds(world, slot);
  const time = clockText(centiseconds(rider.run));
  let banner = "",
    tone: PaneHud["tone"] = "";
  if (world.phase === "countdown") {
    banner = String(countOf(world.go));
    tone = "count";
  } else if (rider.status === "finished") {
    banner = `FINISHED ${time}`;
    tone = "finish";
  } else if (rider.status === "dead") {
    banner = "CRASHED";
    tone = "crash";
  } else if (world.phase === "racing" && world.step < GO_STEPS) {
    banner = "GO!";
    tone = "go";
  }
  return {
    clock: time,
    apples: `${rider.apples} / ${world.apples}`,
    place: world.riders.length > 1 ? ordinal(rider.place) : "",
    closing: seconds === undefined ? "" : `RACE ENDS IN ${seconds}`,
    urgent: seconds !== undefined && seconds <= 10,
    banner,
    tone,
  };
}
