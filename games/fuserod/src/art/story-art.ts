import {
  ellipse,
  fill,
  metal,
  noise,
  rect,
  stroke,
  type,
  type Brush,
} from "./drawing";
import { front } from "./front";
import { profile } from "./profile";
import { horizon } from "./landscape";
import { partPicture } from "./parts";
import type { VehicleFittings } from "./vehicle-families";

export interface StoryOptions {
  model?: number;
  paint?: string;
  fittings?: VehicleFittings;
  driverName?: string;
  record?: string;
}
export type StoryPage = "title" | "credits" | "licence" | "ticket" | "jail";

function paper(
  g: Brush,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) {
  rect(g, "#12182688", x + 5, y + 9, w, h);
  rect(g, color, x, y, w, h);
  for (let i = 0; i < 48; i++)
    rect(
      g,
      "#8a786117",
      x + noise(i + 90) * w,
      y + noise(i + 311) * h,
      1 + noise(i) * 2,
      1,
    );
}

function driverStamp(g: Brush, x: number, y: number) {
  rect(g, "#437773", x - 23, y - 28, 46, 58);
  ellipse(g, "#dcbd96", x, y - 7, 16, 19);
  fill(g, "#2f5357", `M${x - 15} ${y - 11} q10 -9 31 -8 l-2 10 -12 8 -11 -2Z`);
  fill(
    g,
    "#b39d7f",
    `M${x - 20} ${y + 29} q4 -13 15 -16 l4 4 6 -4 q9 4 16 16Z`,
  );
}

export function story(
  g: Brush,
  w: number,
  h: number,
  which: StoryPage,
  options: StoryOptions,
) {
  const s = Math.min(w / 610, 1.28),
    paint = options.paint ?? "#e9a26c",
    model = options.model ?? 1;
  if (which === "title") {
    horizon(g, w, h * 0.62, "strip", -0.3);
    rect(
      g,
      metal(g, h * 0.6, h, [0, "#716373"], [0.5, "#45475a"], [1, "#262b3a"]),
      0,
      h * 0.6,
      w,
      h * 0.4,
    );
    for (let i = 0; i < 9; i++) {
      const p = i / 9;
      stroke(
        g,
        "#f6c58c50",
        1 + p * 2,
        `M${w * (-0.03 + p * 0.12)} ${h * (0.65 + p * 0.31)} L${w * (0.38 + p * 0.07)} ${h * (0.63 + p * 0.18)}`,
      );
    }
    const titleSize = Math.min(w * 0.135, 116),
      tx = w * 0.5,
      ty = h * 0.26;
    g.save();
    g.translate(tx, ty);
    g.transform(1, 0, -0.18, 1, 0, 0);
    type(g, "FUSEROD", 3, 5, titleSize, "#554051", "center", 900);
    type(g, "FUSEROD", 0, 0, titleSize, "#f8d7a2", "center", 900);
    rect(g, "#f2b386", -titleSize * 2.22, 10, titleSize * 4.44, 3);
    g.restore();
    front(
      g,
      w * 0.5,
      h * 0.86,
      Math.min(w * 0.64, 462),
      paint,
      model,
      0.63,
      false,
      options.fittings,
    );
    return;
  }
  if (which === "jail") {
    rect(g, metal(g, 0, h, [0, "#33434e"], [1, "#1b222e"]), 0, 0, w, h);
    g.save();
    g.translate(w * 0.5, h * 0.46);
    g.scale(s, s);
    rect(g, "#18232f", -202, -104, 404, 193);
    rect(g, "#b49c90", -191, -94, 382, 172);
    g.save();
    g.beginPath();
    g.rect(-191, -94, 382, 172);
    g.clip();
    g.translate(-191, -94);
    horizon(g, 382, 172, "canyon", 0);
    g.restore();
    for (let i = 0; i < 7; i++)
      rect(
        g,
        metal(g, -97, 79, [0, "#768288"], [0.46, "#3f4f5a"], [1, "#26343e"]),
        -172 + i * 56,
        -96,
        8,
        178,
      );
    rect(g, "#26343d", -193, 17, 386, 7);
    rect(g, "#53606a", -198, 80, 396, 6);
    g.restore();
    return;
  }
  rect(
    g,
    metal(g, 0, h, [0, "#4c4e5b"], [0.48, "#666069"], [1, "#363845"]),
    0,
    0,
    w,
    h,
  );
  // A drawing board, workshop ring-binder and traffic citation use different paper forms.
  g.save();
  g.translate(w * 0.5, h * 0.5);
  g.scale(s, s);
  if (which === "credits") {
    g.rotate(-0.045);
    paper(g, -223, -128, 445, 254, "#40656b");
    for (let x = -220; x < 220; x += 15)
      stroke(g, "#a6bfac42", 0.65, `M${x} -126 v251`);
    for (let y = -126; y < 126; y += 15)
      stroke(g, "#a6bfac42", 0.65, `M-221 ${y} h441`);
    stroke(g, "#d4d5b6", 1.5, "M-195 -98 H196 V98 H-195Z");
    g.save();
    g.translate(-165, -61);
    g.scale(0.66, 0.66);
    profile(g, "#9bb4a5", model, 1, options.fittings);
    g.restore();
    stroke(
      g,
      "#efdfb8",
      1,
      "M-166 61 H167 M-161 55 v12 M161 55 v12 M-178 -50 v100 M-184 -46 h12 M-184 47 h12",
    );
    g.save();
    g.translate(78, 46);
    g.scale(0.46, 0.46);
    partPicture(g, "engine");
    g.restore();
    type(g, "BODY STUDY", -182, 89, 11, "#f2dfbb");
    type(g, "FUSEROD", 183, -83, 13, "#f2dfbb", "right");
    g.restore();
    return;
  }
  if (which === "licence") {
    g.rotate(-0.035);
    rect(g, "#453d41", -239, -143, 478, 287);
    paper(g, -229, -134, 226, 263, "#d4c8a9");
    paper(g, 2, -134, 226, 263, "#e1d5b8");
    for (const y of [-102, -75, -47, -19, 9, 37, 65, 93])
      stroke(g, "#96977e80", 1, `M19 ${y} h192`);
    for (let i = 0; i < 3; i++) {
      ellipse(g, "#716453", 0, -82 + i * 83, 8, 7);
      stroke(
        g,
        "#bab7a5",
        4,
        `M-11 ${-84 + i * 83} Q0 ${-94 + i * 83} 11 ${-84 + i * 83}`,
      );
    }
    type(g, "GARAGE LOG", -207, -108, 14, "#4f5958");
    rect(g, "#64776f", -207, -99, 182, 2);
    paper(g, -209, -77, 182, 115, "#e8dbb9");
    driverStamp(g, -176, -20);
    type(g, "DRIVER", -143, -51, 9, "#606c65");
    type(
      g,
      (options.driverName || "OWNER DRIVER").slice(0, 15),
      -143,
      -27,
      11,
      "#344b4e",
    );
    type(g, "FUSEROD CLUB", -143, 11, 8, "#8d705d");
    g.save();
    g.translate(-200, 54);
    g.scale(0.32, 0.32);
    profile(g, paint, model, 0, options.fittings);
    g.restore();
    type(g, "RACE RECORD", 21, -109, 13, "#58665f");
    type(g, (options.record ?? "").slice(0, 22), 23, -77, 11, "#3f6266");
    g.restore();
    return;
  }
  g.rotate(-0.07);
  paper(g, -151, -151, 301, 296, "#e5c7a5");
  rect(g, "#b47661", -151, -151, 301, 22);
  type(g, "COUNTY PATROL", 0, -94, 22, "#6e514e", "center");
  type(g, "RACE CITATION", 0, -67, 16, "#5c5556", "center");
  for (let i = 0; i < 5; i++)
    stroke(g, "#ab8b76", 1, `M-124 ${-43 + i * 28} h248`);
  type(g, "DRIVER", -118, -48, 8, "#74685e");
  type(
    g,
    (options.driverName || "DRIVER").slice(0, 20),
    -118,
    -21,
    13,
    "#435663",
  );
  type(g, "REASON", -118, 7, 8, "#74685e");
  type(g, "Pulled over", -118, 31, 15, "#475666");
  g.save();
  g.translate(65, 87);
  g.rotate(-0.12);
  stroke(g, "#a3655a", 2, "M-48 -11 H48 V12 H-48Z");
  type(g, "RECORDED", 0, 7, 13, "#a3655a", "center");
  g.restore();
  g.restore();
}

export function fracturedGlass(g: Brush, w: number, h: number) {
  const cx = w * 0.75,
    cy = h * 0.43;
  g.save();
  g.translate(cx, cy);
  g.scale(h / 540, h / 540);
  for (let i = 0; i < 9; i++) {
    const angle = (i * Math.PI * 2) / 9 + noise(i) * 0.26,
      co = Math.cos(angle),
      si = Math.sin(angle),
      d = 80 + noise(i + 40) * 145;
    const x1 = co * d * 0.25 - si * 8,
      y1 = si * d * 0.25 + co * 8,
      x2 = co * d * 0.62 + si * 12,
      y2 = si * d * 0.62 - co * 12;
    stroke(
      g,
      "#dce6d998",
      1.3,
      `M0 0 L${x1} ${y1} ${x2} ${y2} ${co * d} ${si * d}`,
    );
    stroke(
      g,
      "#64768177",
      0.8,
      `M${x1} ${y1} l${co * 30 - si * 18} ${si * 30 + co * 18}`,
    );
  }
  stroke(
    g,
    "#c8d8d296",
    1,
    "M-31 -6 L-18 -19 5 -20 18 -10 23 6 13 21 -4 25 -19 14Z",
  );
  g.restore();
}
