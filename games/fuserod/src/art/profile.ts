import { ellipse, fill, metal, rect, stroke, type Brush } from "./drawing";
import {
  roofIsUp,
  vehicleBody,
  type VehicleFittings,
} from "./vehicle-families";

function wheel(g: Brush, x: number, r: number) {
  const y = 169 - r;
  ellipse(g, "#171620", x, y, r, r);
  ellipse(g, "#34323d", x, y, r * 0.88, r * 0.88);
  ellipse(g, "#d8d1be", x, y, r * 0.74, r * 0.74);
  ellipse(g, "#383e49", x, y, r * 0.65, r * 0.65);
  ellipse(
    g,
    metal(
      g,
      y - r,
      y + r,
      [0, "#fbdeaf"],
      [0.42, "#cbdacf"],
      [0.54, "#586777"],
      [1, "#bec4b9"],
    ),
    x,
    y,
    r * 0.56,
    r * 0.56,
  );
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    ellipse(
      g,
      "#596574",
      x + Math.cos(a) * r * 0.38,
      y + Math.sin(a) * r * 0.38,
      r * 0.067,
      r * 0.067,
    );
  }
  ellipse(g, "#d8ddc9", x, y, r * 0.21, r * 0.21);
  ellipse(g, "#8f9b9d", x, y + 2, r * 0.115, r * 0.115);
}

export function profile(
  g: Brush,
  paint: string,
  model: number,
  upgrade: number,
  fittings?: VehicleFittings,
) {
  const b = vehicleBody(model),
    truck = b.style === "pickup" || b.style === "utility",
    open = !roofIsUp(b, fittings);
  const r = b.rearAxle,
    f = b.frontAxle,
    back = b.rearPillar,
    front = b.frontPillar,
    top = b.roofHeight;
  const chrome = metal(
    g,
    78,
    145,
    [0, "#fff0c7"],
    [0.4, "#d5dfcf"],
    [0.5, "#6c8189"],
    [0.8, "#a0b0ad"],
    [1, "#d4cfb9"],
  );
  const rearR = b.style === "drag" ? 42 : truck ? 38 : 35,
    frontR = b.style === "drag" ? 30 : truck ? 37 : 35;
  const arch = (x: number, radius: number) =>
    `Q${x + radius * 1.17} ${169 - radius * 2 - 4} ${x} ${165 - radius * 2} Q${x - radius * 1.09} ${165 - radius * 2} ${x - radius * 1.28} 144`;
  g.save();
  g.translate(250, 0);
  g.scale(b.width * 0.95, 1);
  g.translate(-250, 0);
  ellipse(g, "#10132175", 247, 159, 238, 16);
  wheel(g, r, rearR);
  wheel(g, f, frontR);
  const trunk = truck ? 77 : 83,
    nose = b.style === "pickup" || b.style === "sedan" ? 82 : 90;
  const shell = `M12 ${trunk} Q61 ${trunk - 5} ${back} 73 L${front + 52} 74 Q422 72 458 ${nose - 7} Q476 ${nose - 4} 485 101 L486 127 478 134 ${f + frontR * 1.29} 141 ${arch(f, frontR)} L${r + rearR * 1.29} 147 ${arch(r, rearR)} L17 134 Q9 128 12 116Z`;
  fill(g, paint, shell);
  g.save();
  g.clip(new Path2D(shell));
  rect(
    g,
    metal(
      g,
      72,
      147,
      [0, "#fff1c585"],
      [0.12, "#ded8b649"],
      [0.23, "#ffffff12"],
      [0.5, "#13213935"],
      [1, "#131726bd"],
    ),
    5,
    67,
    488,
    89,
  );
  fill(
    g,
    "#eed8adbc",
    `M14 ${trunk + 12} Q180 93 311 85 L466 ${nose - 4} Q396 91 302 92 L48 107Z`,
  );
  fill(g, "#16263762", "M141 133 L350 118 346 134 148 146Z");
  g.restore();
  if (model === 6) {
    fill(g, "#9c6f4e", `M19 90 L${front + 34} 85 ${front + 20} 98 25 111Z`);
    stroke(
      g,
      "#ddba87",
      2,
      `M22 91 L${front + 24} 86 M22 105 L${front + 20} 94`,
    );
  }
  if (model === 18 || model === 21) {
    fill(g, "#e5d2a7", "M25 99 L369 83 343 90 32 105Z");
    stroke(g, "#4d4b59", 1.3, "M27 107 L342 91");
  }
  if (model === 8 || model === 15 || model === 16)
    for (let slot = 0; slot < 3; slot++)
      stroke(g, "#423d47", 3.3, `M${f - 59 + slot * 5} 97 l-4 10`);
  if (model === 9 || model === 10 || model === 14) {
    fill(
      g,
      paint,
      `M${r - rearR - 4} 123 Q${r - 28} ${159 - rearR * 2} ${r} ${161 - rearR * 2} Q${r + 31} ${158 - rearR * 2} ${r + rearR + 4} 120Z`,
    );
    stroke(g, chrome, 1.8, `M${r - rearR - 4} 123 L${r + rearR + 4} 120`);
  }
  const glass = metal(
    g,
    top,
    71,
    [0, "#1e3043"],
    [0.53, "#3b5162"],
    [1, "#819598"],
  );
  const bar = (a: number, c: number) =>
    stroke(g, "#b8c8bb", 3, `M${a} ${top + 6} L${c} 67`);
  if (open) {
    fill(
      g,
      "#35323a",
      `M${back - 7} 72 L${back + 16} 55 Q${back + 23} 50 ${back + 33} 62 L${back + 35} 67 ${front - 39} 67 Q${front - 39} 50 ${front - 31} 51 Q${front - 17} 52 ${front - 13} 65 L${front + 6} 65 ${front + 2} ${top + 6} L${front + 10} ${top + 6} ${front + 57} 72Z`,
    );
    fill(
      g,
      glass,
      `M${front + 6} ${top + 9} L${front + 12} ${top + 10} ${front + 45} 65 ${front + 13} 65Z`,
    );
    stroke(
      g,
      chrome,
      2.5,
      `M${front + 4} ${top + 6} L${front + 12} ${top + 7} ${front + 53} 71`,
    );
    fill(g, "#4a4246", `M${back - 44} 71 L${back + 2} 64 ${back + 17} 72Z`);
  } else {
    const long = b.style === "wagon" || b.style === "sedan" || truck,
      sloped = b.style === "fastback" || b.style === "drag";
    const rise = long ? 18 : sloped ? 90 : 49;
    const roof = `M${back - 5} 73 Q${back + rise * 0.43} ${long ? top + 9 : top + 20} ${back + rise} ${top + 2} Q${front - 39} ${top - 5} ${front} ${top + 1} L${front + 55} 73Z`;
    fill(
      g,
      metal(
        g,
        top - 5,
        71,
        [0, "#e3e1c9"],
        [0.24, "#c0ccc2"],
        [0.63, "#878d87"],
        [1, "#d8c4a7"],
      ),
      roof,
    );
    fill(
      g,
      glass,
      `M${back + 9} 67 Q${back + rise * 0.53} ${top + 13} ${back + rise + 3} ${top + 8} Q${front - 35} ${top + 2} ${front - 3} ${top + 7} L${front + 38} 67Z`,
    );
    fill(
      g,
      "#dbe1c835",
      `M${front - 63} ${top + 6} h13 l-34 ${60 - top} h-11Z M${front - 38} ${top + 7} h5 l-32 ${60 - top} h-7Z`,
    );
    if (b.style !== "hardtop")
      bar((back + front) / 2 + 8, (back + front) / 2 - 3);
    if (b.style === "wagon" || b.style === "sedan")
      bar(back + rise + 20, back + rise + 11);
    if (b.style === "targa")
      stroke(g, paint, 12, `M${back + 63} ${top + 3} L${back + 51} 69`);
    if (b.style === "hardtop" || b.style === "fastback")
      stroke(g, chrome, 1.5, `M${back + 10} 67 L${front + 39} 67`);
  }
  if (truck) {
    // Fluted cargo box and cab joint distinguish the pickup and car-based utility.
    stroke(g, "#50434c", 2, `M${back - 7} 78 L${back - 10} 133`);
    for (let j = 0; j < 3; j++)
      stroke(
        g,
        "#e6c3a079",
        1.5,
        `M26 ${85 + j * 5} L${back - 22} ${80 + j * 5}`,
      );
    stroke(g, chrome, 3, `M13 76 L${back - 12} 72`);
    if (model === 19) fill(g, "#5b5360", `M${r + 46} 138 h45 l-8 7 h-40Z`);
  }
  if (b.fin > 4) {
    fill(
      g,
      paint,
      `M13 ${trunk + 4} L8 ${trunk - b.fin} 26 ${trunk - b.fin * 0.54} 53 ${trunk + 1}Z`,
    );
    stroke(g, "#e8cda3", 1.6, `M9 ${trunk - b.fin} L49 ${trunk + 1}`);
  }
  const doorBack = truck ? back + 6 : Math.round((back + front) / 2) - 10;
  stroke(
    g,
    "#382e3d9e",
    1.6,
    `M${doorBack} 75 Q${doorBack - 1} 97 ${doorBack - 6} 128 Q${front - 20} 138 ${front + 14} 121 L${front + 20} 77`,
  );
  if (b.style === "sedan" || b.style === "wagon")
    stroke(
      g,
      "#453947a1",
      1.4,
      `M${back + 21} 75 L${back + 13} 117 Q${back + 15} 130 ${doorBack - 6} 130`,
    );
  stroke(g, chrome, 3.2, `M${doorBack + 9} 81 h14`);
  stroke(g, chrome, 3, `M${r + rearR * 1.4} 144 L${f - frontR * 1.4} 138`);
  stroke(
    g,
    "#e8d7ba88",
    1.5,
    `M${r - rearR * 1.15} 118 Q${r - rearR * 0.65} ${159 - rearR * 2} ${r} ${163 - rearR * 2} Q${r + rearR * 0.8} ${159 - rearR * 2} ${r + rearR * 1.18} 119 M${f - frontR * 1.2} 117 Q${f - frontR * 0.62} ${159 - frontR * 2} ${f} ${163 - frontR * 2} Q${f + frontR * 0.74} ${160 - frontR * 2} ${f + frontR * 1.15} 118`,
  );
  if (fittings?.rearBumper !== false)
    stroke(g, chrome, 5.5, "M8 127 Q24 135 47 132");
  if (fittings?.frontBumper !== false)
    stroke(g, chrome, 5.5, "M445 136 L484 127 491 121");
  fill(
    g,
    "#d9675b",
    `M13 ${trunk + 12} L35 ${trunk + 9} 31 ${trunk + 21} 13 ${trunk + 24}Z`,
  );
  fill(g, "#e8d4a8", "M463 87 Q478 90 484 101 L470 100Z");
  fill(g, "#ead5ac", "M476 104 L485 104 484 112 475 112Z");
  if (fittings?.hoodScoop ?? (upgrade > 0 || b.style === "drag")) {
    fill(g, "#34323b", "M353 74 L363 61 392 61 406 73Z");
    stroke(g, chrome, 2, "M365 63 L389 63 397 68");
  }
  g.restore();
}
