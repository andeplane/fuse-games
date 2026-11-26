import { button, el } from "fuse-ui";
import { WEAPONS, getMission } from "../campaign/index.js";
import type { MissionState } from "../sim/index.js";

const objectiveColors = ["#ffd382", "#6ef4d4", "#ff7795", "#b9a6ff", "#81c9ff"];
const keys: Record<string, string> = {
  yellow: "#f9cf64",
  green: "#78d385",
  blue: "#80b6ff",
  red: "#ff7382",
};

function drawMap(canvas: HTMLCanvasElement, world: MissionState) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const unit = 8;
  canvas.width = world.width * unit;
  canvas.height = world.height * unit;
  ctx.fillStyle = "#08131c";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const ready = world.objectives.every((o) => o.done >= o.required);
  let left = world.width,
    right = -1,
    top = world.height,
    bottom = -1;
  for (let y = 0; y < world.height; y++)
    for (let x = 0; x < world.width; x++) {
      const t = world.tiles[y]?.[x];
      if (ready && t === "E") {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
      if (world.seen[y]?.[x] !== "1") continue;
      ctx.fillStyle =
        t === "#"
          ? "#667881"
          : ready && t === "E"
            ? "#55d19f"
            : t === "D"
              ? "#e1ae69"
              : "#243946";
      ctx.fillRect(x * unit, y * unit, unit, unit);
    }
  if (right >= left) {
    ctx.strokeStyle = "#84ffbd";
    ctx.lineWidth = 2;
    ctx.strokeRect(
      left * unit + 1,
      top * unit + 1,
      (right - left + 1) * unit - 2,
      (bottom - top + 1) * unit - 2,
    );
  }
  const mark = (x: number, y: number, color: string, r = 3) => {
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc((x / 16) * unit, (y / 12) * unit, r, 0, Math.PI * 2);
    ctx.fill();
  };
  const visible = (x: number, y: number) =>
    world.seen[Math.floor(y / 12)]?.[Math.floor(x / 16)] === "1";
  for (const door of world.doors)
    if (door.key && world.seen[door.y]?.[door.x] === "1") {
      ctx.fillStyle = keys[door.key]!;
      ctx.fillRect(door.x * unit, door.y * unit, unit, unit);
    }
  for (const key of world.keys)
    if (visible(key.x, key.y)) mark(key.x, key.y, keys[key.color]!);
  const objectiveMark = (o: {
    objectiveIndex: number | null;
    x: number;
    y: number;
  }) => {
    if (o.objectiveIndex === null) return;
    const data = getMission(
      world.mission,
      world.campaign < 0 ? undefined : world.campaign,
    )?.objectives[o.objectiveIndex];
    if (!data || data.flags & 1 || (!(data.flags & 2) && !visible(o.x, o.y)))
      return;
    mark(o.x, o.y, objectiveColors[o.objectiveIndex % objectiveColors.length]!);
  };
  for (const item of world.items) objectiveMark(item);
  for (const actor of world.actors)
    if (actor.hp > 0) {
      if (actor.seat !== null) mark(actor.x, actor.y, "#f5f5ed", 4);
      else objectiveMark(actor);
    }
}

/** Accept a clean touch release even when the browser omits its synthesized click. */
function bindMapButton(button: HTMLButtonElement, activate: () => void): void {
  let start: Touch | undefined;
  const withinTap = (touch: Touch | undefined) =>
    start &&
    touch &&
    touch.identifier === start.identifier &&
    Math.hypot(touch.clientX - start.clientX, touch.clientY - start.clientY) <=
      12;
  button.onclick = activate;
  button.addEventListener(
    "touchstart",
    (event) => {
      start = event.touches.length === 1 ? event.changedTouches[0] : undefined;
    },
    { passive: true },
  );
  button.addEventListener("touchcancel", () => {
    start = undefined;
  });
  button.addEventListener(
    "touchmove",
    (event) => {
      if (!withinTap(event.touches[0]) || event.touches.length !== 1)
        start = undefined;
    },
    { passive: true },
  );
  button.addEventListener(
    "touchend",
    (event) => {
      const last = event.changedTouches[0];
      const tap = withinTap(last) && !event.touches.length;
      start = undefined;
      if (!tap || !last) return;
      const target = button.ownerDocument.elementFromPoint(
        last.clientX,
        last.clientY,
      );
      if (!button.contains(target)) return;
      // Avoid a second activation through the compatibility click where possible.
      if (event.cancelable) event.preventDefault();
      activate();
    },
    { passive: false },
  );
}

export function createHud(inspect: (open: boolean) => void) {
  const element = el("div", "", "cf-hud"),
    mission = el("strong"),
    objective = el("span"),
    gear = el("span"),
    hp = el("meter"),
    mapButton = button("Map", "cf-map-button");
  hp.min = 0;
  hp.setAttribute("aria-label", "Health");
  const vitals = el("div", "", "cf-vitals");
  vitals.append(gear, hp);
  const brief = el("div", "", "cf-objective");
  brief.append(mission, objective);
  element.append(brief, vitals, mapButton);
  const panel = el("section", "", "cf-map-panel");
  panel.hidden = true;
  panel.setAttribute("aria-label", "Mission map");
  const bar = el("div", "", "cf-map-bar"),
    close = button("Close map"),
    map = el("canvas"),
    list = el("ul");
  bar.append(el("h2", "Mission map"), close);
  panel.append(bar, map, list);
  let latest: MissionState | undefined;
  const setOpen = (open: boolean) => {
    if (!latest || latest.mode === "dogfight" || open === !panel.hidden) return;
    panel.hidden = !open;
    inspect(open);
    mapButton.setAttribute("aria-expanded", String(open));
    if (open) {
      drawMap(map, latest);
      list.replaceChildren(
        ...latest.objectives
          .filter((o) => o.required > 0 || o.done > 0)
          .map((o) =>
            el("li", o.description + (o.done >= o.required ? " ✓" : "")),
          ),
      );
    }
  };
  bindMapButton(mapButton, () => setOpen(true));
  bindMapButton(close, () => setOpen(false));
  return {
    element,
    panel,
    toggle: () => setOpen(panel.hidden),
    update(world: MissionState, me: string) {
      latest = world;
      const dog = world.mode === "dogfight";
      const actor = world.actors.find((a) => a.seat === me);
      const description = dog
        ? "Dogfight"
        : getMission(
            world.mission,
            world.campaign < 0 ? undefined : world.campaign,
          )?.title;
      mission.textContent = description ?? "Mission";
      const next = world.objectives.find((o) => o.done < o.required);
      objective.textContent = dog
        ? "Last operative standing"
        : next
          ? next.flags & 8
            ? next.description
            : next.description +
              " · " +
              Math.min(next.done, next.required) +
              "/" +
              next.required
          : world.extraction > 0
            ? "Extracting · " + Math.ceil((350 - world.extraction) / 70) + " s"
            : "Rendezvous at extraction";
      vitals.hidden = !actor;
      if (actor) {
        hp.max = actor.maxHp;
        hp.value = Math.max(0, actor.hp);
        gear.textContent =
          (WEAPONS[actor.weapon]?.name ?? "Unarmed") +
          " · " +
          Math.max(0, actor.hp) +
          " HP";
      }
      mapButton.hidden = dog;
      if (dog) panel.hidden = true;
      if (!panel.hidden) drawMap(map, world);
    },
    reset() {
      latest = undefined;
      panel.hidden = true;
      mapButton.setAttribute("aria-expanded", "false");
    },
  };
}
