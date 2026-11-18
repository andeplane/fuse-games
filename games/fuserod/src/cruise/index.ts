import {
  backOnEscape,
  button,
  createBackButton,
  createPageHeader,
  el,
} from "fuse-ui";
import { drawRace } from "../art/renderer.js";
import { drivingControls } from "../app/controls.js";
import { type MotorControls, type MotorTune } from "../motor/index.js";
import {
  STOPS,
  canPark,
  continueDrive,
  createDrive,
  distanceToStop,
  driveTick,
  metres,
  setDestination,
  townCurve,
  type TownStop,
} from "./road.js";
import "./town.css";
export type { TownStop } from "./road.js";

export interface CruiseOptions {
  start?: TownStop;
  destination?: TownStop;
  tune?: MotorTune;
  model?: number;
  paint?: string;
  onArrive: (stop: TownStop) => void;
  onBack: () => void;
}

/** Owns its listeners and animation, and disposes before either navigation callback. */
export function mountCruise(
  container: HTMLElement,
  options: CruiseOptions,
): () => void {
  const start = options.start ?? "garage";
  let drive = createDrive(
    start,
    options.destination ?? (start === "diner" ? "garage" : "diner"),
  );
  const root = el("section", "", "rod-race rod-town");
  let live = true;
  let assist = true;
  let input: MotorControls = {
    throttle: false,
    brake: false,
    shift: 0,
    steer: 0,
  };
  const pad = drivingControls(
    () => live && !document.hidden && !drive.motor.broken,
    (v) => {
      input = { ...v, shift: v.shift || input.shift };
    },
  );
  let request = 0;
  const leave = () => {
    dispose();
    options.onBack();
  };
  const arrive = () => {
    const stop = drive.destination;
    dispose();
    options.onArrive(stop);
  };
  const back = createBackButton({ onBack: leave });
  const removeEscape = backOnEscape(back);
  const header = createPageHeader({ title: "Town cruise", back });
  const tools = el("div", "", "town-toolbar");
  const label = el("label", "Destination ");
  const select = el("select");
  for (const [id, stop] of Object.entries(STOPS)) {
    const item = el("option", stop.name);
    item.value = id;
    select.append(item);
  }
  select.value = drive.destination;
  select.onchange = () => {
    if (Object.hasOwn(STOPS, select.value))
      drive = setDestination(drive, select.value as TownStop);
    paint();
  };
  label.append(select);
  const skip = button("Skip drive");
  skip.onclick = arrive;
  const assisted = el("label", " Shift assist");
  const toggle = el("input");
  toggle.type = "checkbox";
  toggle.checked = true;
  toggle.onchange = () => {
    assist = toggle.checked;
  };
  assisted.prepend(toggle);
  tools.append(label, assisted, skip);
  const view = el("div", "", "rod-viewport"),
    canvas = el("canvas", "", "rod-canvas");
  canvas.setAttribute("aria-label", "Town road and destination sign");
  const sign = el("span", "", "town-sign");
  view.append(canvas, sign);
  const help = el(
    "p",
    "W/↑ gas · S/↓ brake · A/D or ←/→ steer. With shift assist off, use X/Z to shift. Brake at the destination, then park.",
    "town-help",
  );
  const status = el("p", "", "town-readout");
  const park = button("Park");
  park.onclick = () => {
    if (canPark(drive)) arrive();
  };
  const restart = button("Restart engine");
  restart.onclick = () => {
    drive = continueDrive(drive);
    pad.clear();
    paint();
  };
  const footer = el("div", "", "town-toolbar");
  footer.append(status, park, restart);
  root.append(header.element, tools, view, footer, pad.element, help);
  container.replaceChildren(root);

  function paint() {
    const stop = STOPS[drive.destination];
    const d = metres(drive.motor.position);
    const road = {
      distance: d,
      speed: drive.motor.speed * 1.609344,
      lateral: drive.lateral,
      curve: townCurve(drive),
      gear: drive.motor.gear,
      rpm: drive.motor.rpm,
      route: "strip" as const,
      opponents: [],
      model: options.model,
      paint: options.paint,
      townStop: {
        name: stop.name,
        kind: drive.destination,
        distance: metres(drive.target),
      },
    };
    drawRace(canvas, road);
    const remaining = metres(distanceToStop(drive));
    sign.textContent =
      stop.name +
      " ↗  " +
      (Math.abs(remaining) <= 17
        ? "Entrance"
        : (remaining < 30 ? "Brake · " : "") +
          Math.ceil(Math.max(0, remaining)) +
          " m");
    status.textContent = drive.motor.broken
      ? "Engine stopped"
      : Math.round(road.speed) +
        " km/h · " +
        (drive.motor.gear ? "Gear " + drive.motor.gear : "Neutral");
    park.textContent = "Park at " + stop.name;
    park.disabled = !canPark(drive);
    restart.hidden = !drive.motor.broken;
  }
  let last = 0,
    accumulator = 0;
  const frame = (now: number) => {
    if (!live) return;
    if (!document.hidden) {
      accumulator += last ? Math.min(200, now - last) : 0;
      while (accumulator >= 50) {
        drive = driveTick(drive, input, options.tune ?? {}, assist);
        input = { ...input, shift: 0 };
        accumulator -= 50;
      }
      paint();
    }
    last = now;
    request = window.requestAnimationFrame(frame);
  };
  paint();
  request = window.requestAnimationFrame(frame);
  function dispose() {
    if (!live) return;
    live = false;
    cancelAnimationFrame(request);
    pad.dispose();
    removeEscape();
    root.remove();
  }
  return dispose;
}
