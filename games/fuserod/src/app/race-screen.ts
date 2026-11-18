import { el } from "fuse-ui";
import type { FrameTiming } from "fuse-netcode";
import { drawRace } from "../art/renderer.js";
import { courseFeatures } from "../course/index.js";
import { nativeCourseSample } from "../course/geometry.js";
import type { FuserodView } from "../game/index.js";
import type { VehicleFittings } from "../art/vehicle-families.js";
export const colors = ["#f17a42", "#40d7da", "#e9ba62", "#b9a0ee", "#70d996"];
interface Appearance {
  model: number;
  paint: string;
  fittings?: VehicleFittings;
}
export function paintRace(
  canvas: HTMLCanvasElement,
  frame: FuserodView,
  me: string,
  car?: Appearance,
  rival?: Appearance,
) {
  const driver = frame.racers.find((r) => r.id === me) ?? frame.racers[0];
  drawRace(canvas, {
    route: frame.route,
    features: courseFeatures(frame.route, driver?.layout ?? 0),
    sampleRoad: (distance: number) =>
      nativeCourseSample(
        frame.route,
        (distance * 5120) / 402.336,
        driver?.layout ?? 0,
      ),
    grade: (driver?.grade ?? 0) / 2,
    steering: driver?.steering ?? 0,
    traffic: frame.traffic,
    wrecked: driver?.crashed,
    ticketed: frame.policePhase === 4,
    bank: driver?.bank ?? 0,
    finishDistance: frame.finishDistance,
    distance: driver?.distance ?? 0,
    speed: driver?.speed ?? 0,
    lateral: driver?.lateral ?? 0,
    curve: driver?.curve ?? 0,
    rpm: driver?.rpm ?? 0,
    gear: driver?.gear ?? 0,
    model: driver?.slot ?? 0,
    paint: colors[(driver?.slot ?? 0) % 5]!,
    ...car,
    opponents: frame.racers
      .filter((r) => r !== driver)
      .map((r) => ({
        distance: r.distance,
        lateral: r.lateral,
        model: r.slot,
        police: r.police,
        paint: colors[r.slot % 5]!,
        ...(r.bot ? rival : undefined),
      })),
  });
}
export function raceScreen() {
  const element = el("section", "", "rod-race");
  const viewport = el("div", "", "rod-viewport"),
    canvas = el("canvas", "", "rod-canvas");
  canvas.setAttribute("aria-label", "Race cockpit");
  const progress = el("progress", "", "rod-progress");
  progress.setAttribute("aria-label", "Distance to finish");
  const light = el("strong", "", "rod-light");
  const callout = el("span", "", "rod-callout");
  const tree = el("div", "", "rod-tree");
  tree.setAttribute("aria-hidden", "true");
  const lamps = ["amber", "amber", "amber", "green", "red"].map((color) => {
    const row = el("i", "", "rod-lamp");
    row.dataset.color = color;
    tree.append(row);
    return row;
  });
  const dash = el("div", "", "rod-dash");
  const instruments = ["Position", "Speed", "Gear", "RPM", "Remaining"].map(
    (label) => {
      const box = el("div"),
        value = el("b", "—");
      box.append(el("small", label), value);
      dash.append(box);
      return value;
    },
  );
  viewport.append(canvas, tree, light, callout, progress);
  element.append(viewport, dash);
  return {
    element,
    paint(
      timing: FrameTiming<FuserodView>,
      me: string,
      car?: Appearance,
      rival?: Appearance,
    ) {
      const { older, newer } = timing;
      if (
        !older ||
        older.matchId !== newer.matchId ||
        older.phase !== newer.phase ||
        newer.tick <= older.tick
      ) {
        paintRace(canvas, newer, me, car, rival);
        return;
      }
      const alpha = Math.max(
        0,
        Math.min(1, (timing.tick - older.tick) / (newer.tick - older.tick)),
      );
      const racers = newer.racers.map((r) => {
        const prior = older.racers.find((p) => r.id === p.id);
        if (!prior) return r;
        return {
          ...r,
          distance: prior.distance + (r.distance - prior.distance) * alpha,
          lateral: prior.lateral + (r.lateral - prior.lateral) * alpha,
          curve: prior.curve + (r.curve - prior.curve) * alpha,
        };
      });
      paintRace(canvas, { ...newer, racers }, me, car, rival);
    },
    render(frame: FuserodView, me: string, automatic: boolean) {
      const driver = frame.racers.find((r) => r.id === me) ?? frame.racers[0];
      if (!driver) return;
      light.hidden =
        driver.countdown === 0 &&
        !driver.falseStart &&
        !driver.broken &&
        !driver.crashed &&
        !driver.laneFault &&
        !driver.breakout;
      light.textContent = driver.falseStart
        ? "False start"
        : driver.laneFault
          ? "Lane fault"
          : driver.breakout
            ? "Breakout"
            : driver.crashed
              ? "Crash"
              : driver.broken
                ? "Engine out"
                : String(Math.ceil(driver.countdown / 20));
      progress.max = frame.finishDistance;
      progress.value = Math.min(frame.finishDistance, driver.distance);
      const sanctioned =
        frame.variant === "timed" || frame.variant === "grudge";
      tree.hidden =
        !sanctioned || (driver.countdown === 0 && driver.elapsedTicks > 14);
      if (!tree.hidden) {
        const lit = driver.falseStart
          ? 4
          : driver.countdown === 0
            ? 3
            : driver.countdown > 30
              ? -1
              : 2 - Math.floor((driver.countdown - 1) / 10);
        lamps.forEach((lamp, i) => lamp.classList.toggle("lit", i === lit));
        if (!driver.falseStart && driver.countdown > 0) light.hidden = true;
      }
      const cue =
        driver.countdown > 0
          ? sanctioned
            ? "Stage on the brake · wait for green"
            : "Get ready"
          : frame.policePhase === 3
            ? "Patrol pursuit"
            : driver.gear === 0 && !automatic
              ? "Shift into first"
              : driver.rpm >= 4450 && !automatic
                ? "Shift up"
                : driver.elapsedTicks < 20
                  ? "Green · go"
                  : "";
      callout.hidden = !cue;
      if (callout.textContent !== cue) callout.textContent = cue;
      const values = [
        driver.place + "/" + frame.racers.length,
        Math.round(driver.speed) + " km/h",
        driver.gear === 0 ? "N" : String(driver.gear),
        String(Math.round(driver.rpm)),
        Math.max(0, Math.ceil(frame.finishDistance - driver.distance)) + " m",
      ];
      instruments.forEach((node, i) => {
        if (node.textContent !== values[i]) node.textContent = values[i]!;
      });
    },
  };
}
