import {
  ellipse,
  fill,
  metal,
  rect,
  stroke,
  type,
  type Brush,
} from "./drawing";
import { glazing } from "./glazing";
import { vehicleBody, type VehicleFittings } from "./vehicle-families";

const steel = (g: Brush, top: number, bottom: number) =>
  metal(
    g,
    top,
    bottom,
    [0, "#fff4dc"],
    [0.32, "#d9f6ed"],
    [0.48, "#637c89"],
    [0.53, "#27384d"],
    [1, "#acc7c3"],
  );

export { profile } from "./profile";

/** Tail view with separate paint, wraparound glass, lamps, trunk and bumper. */
export function tail(
  g: Brush,
  x: number,
  y: number,
  width: number,
  color: string,
  model: number,
  police = false,
  fittings?: VehicleFittings,
) {
  g.save();
  g.translate(x, y);
  g.scale(width / 140, width / 140);
  const body = vehicleBody(model);
  g.scale(body.width, 1);
  ellipse(g, "#160f2180", 0, -1, 78, 7);
  rect(g, "#100f19", -55, -25, 17, 25);
  rect(g, "#100f19", 38, -25, 17, 25);
  const top = glazing(g, model, color, true, fittings);
  fill(
    g,
    color,
    "M-65 -18 L-63 -43 -48 -48 Q0 -50 49 -47 L62 -44 66 -18 60 -9 -57 -9Z",
  );
  fill(g, "#fff0ca70", "M-60 -43 Q0 -48 59 -43 L48 -39 -47 -39Z");
  fill(g, "#16203570", "M-62 -32 Q0 -24 63 -33 L60 -15 -60 -15Z");
  stroke(g, "#eee0c4", 1.4, "M-58 -38 L-39 -36 40 -36 58 -38");
  fill(
    g,
    "#692b36",
    "M-57 -35 L-35 -32 -37 -23 -57 -25Z M57 -35 L35 -32 37 -23 57 -25Z",
  );
  stroke(g, "#ff624f", 3, "M-55 -32 L-39 -30 M55 -32 L39 -30");
  for (let i = 1; i < body.tailLights; i++)
    for (const side of [-1, 1])
      stroke(
        g,
        "#332937",
        1.8,
        `M${side * (56 - (20 * i) / body.tailLights)} -34 v10`,
      );
  if (body.fin > 8)
    for (const side of [-1, 1])
      fill(
        g,
        color,
        `M${side * 53} -42 L${side * 63} ${-40 - body.fin * 0.52} L${side * 65} -37Z`,
      );
  rect(g, "#b7bdaf", -9, -25, 18, 8);
  rect(g, "#373e46", -6, -22, 12, 2);
  if (fittings?.rearBumper !== false)
    stroke(g, steel(g, -17, -7), 5, "M-65 -16 Q-5 -9 64 -16");
  if (police) {
    fill(g, "#d9dcc8", "M-46 -43 Q0 -48 47 -43 L39 -36 -38 -36Z");
    type(g, "PATROL", 0, -29, 6.5, "#f1edd8", "center");
    g.translate(0, top + 69);
    rect(g, "#26323d", -19, -80, 38, 4);
    rect(g, "#fc7065", -17, -85, 14, 5);
    rect(g, "#85b5eb", 3, -85, 14, 5);
  }
  g.restore();
}

export function gauge(
  g: Brush,
  x: number,
  y: number,
  r: number,
  value: number,
  max: number,
  label: string,
  danger: number,
) {
  const from = Math.PI * 0.76,
    arc = Math.PI * 1.49;
  ellipse(g, steel(g, y - r, y + r), x, y, r, r);
  ellipse(g, "#101823", x, y, r * 0.93, r * 0.93);
  ellipse(g, "#1b2630", x, y, r * 0.79, r * 0.79);
  for (let i = 0; i <= 24; i++) {
    const a = from + (arc * i) / 24;
    const outer = r * 0.84,
      inner = r * (i % 4 === 0 ? 0.63 : 0.75);
    stroke(
      g,
      i / 24 >= danger ? "#fb855c" : "#c4d9cf",
      i % 4 === 0 ? 1.8 : 1,
      `M${x + Math.cos(a) * inner} ${y + Math.sin(a) * inner} L${x + Math.cos(a) * outer} ${y + Math.sin(a) * outer}`,
    );
  }
  type(g, label, x, y + r * 0.47, r * 0.22, "#c8d6cc", "center");
  const angle = from + arc * Math.min(1, Math.max(0, value / max));
  stroke(
    g,
    "#ff935f",
    2.8,
    `M${x - Math.cos(angle) * r * 0.15} ${y - Math.sin(angle) * r * 0.15} L${x + Math.cos(angle) * r * 0.7} ${y + Math.sin(angle) * r * 0.7}`,
  );
  ellipse(g, "#b1c7bf", x, y, r * 0.095, r * 0.095);
}
