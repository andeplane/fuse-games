import { PARTS, type PartKind } from "../game/machine.js";

import { bodiesPainters } from "./bench-art/bodies.js";
import { frameworkPainters } from "./bench-art/framework.js";
import { motionPainters } from "./bench-art/motion.js";
import { powerPainters } from "./bench-art/power.js";
import {
  gradient,
  type Context,
  type PartPainter,
} from "./bench-art/canvas.js";

const painters = {
  ...bodiesPainters,
  ...frameworkPainters,
  ...motionPainters,
  ...powerPainters,
} satisfies Record<PartKind, PartPainter>;

export interface PartDrawing {
  kind: PartKind;
  x: number;
  y: number;
  width: number;
  height: number;
  flip: boolean;
  tick: number;
  active: boolean;
}

export function drawPart(
  c: Context,
  { kind, x, y, width, height, flip, tick, active }: PartDrawing,
) {
  c.save();
  c.translate(x, y);
  c.scale(((flip ? -1 : 1) * width) / 100, height / 100);
  c.lineJoin = "round";
  c.lineCap = "round";
  const metal = gradient(c, "#cfebe8", "#7ba6b6", "#486076");
  const amber = gradient(c, "#ffe19a", "#f4ad52", "#ad693e");
  const red = gradient(c, "#ffb189", "#f17465", "#ad414c");
  const dark = gradient(c, "#516f7c", "#354a58", "#273945");
  if (Object.hasOwn(painters, kind)) {
    const paint: PartPainter = painters[kind];
    paint(c, { kind, tick, active, palette: { metal, amber, red, dark } });
  }
  c.restore();
}

export function partIcon(kind: PartKind): HTMLCanvasElement {
  const icon = document.createElement("canvas");
  icon.width = 112;
  icon.height = 72;
  icon.setAttribute("aria-hidden", "true");
  const c = icon.getContext("2d");
  if (!c) return icon;
  const def = PARTS[kind],
    s = Math.min(100 / def.width, 60 / def.height);
  drawPart(c, {
    kind,
    x: 56,
    y: 36,
    width: def.width * s,
    height: def.height * s,
    flip: false,
    tick: 0,
    active: false,
  });
  return icon;
}
