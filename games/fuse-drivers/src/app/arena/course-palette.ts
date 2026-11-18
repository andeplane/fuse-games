type Ramp = readonly [string, string, string];
type Surface = "clay" | "sand" | "stone" | "ice";

function blend(a: string, b: string, t: number): string {
  const channels = [1, 3, 5].map((i) => {
    const start = parseInt(a.slice(i, i + 2), 16);
    const end = parseInt(b.slice(i, i + 2), 16);
    return Math.round(start + (end - start) * t)
      .toString(16)
      .padStart(2, "0");
  });
  return "#" + channels.join("");
}

function lightRamp([shadow, mid, sun]: Ramp): string[] {
  return [
    shadow,
    blend(shadow, mid, 0.4),
    blend(shadow, mid, 0.75),
    mid,
    blend(mid, sun, 0.28),
    blend(mid, sun, 0.62),
    sun,
  ];
}

function circuit(
  surface: Surface,
  dirt: Ramp,
  water: Ramp,
  deck: string,
  accent: string,
  kerb: string,
) {
  return {
    surface,
    dirt: lightRamp(dirt),
    water: lightRamp(water),
    deck,
    panel: blend(deck, accent, 0.16),
    seam: blend(deck, "#080918", 0.55),
    trim: blend(deck, accent, 0.39),
    accent,
    kerb,
  };
}

// Each circuit has its own soil, trackside material and two contrasting rail colours.
const CIRCUITS = [
  // Blaster: red volcanic clay and electric blue.
  circuit(
    "clay",
    ["#65223c", "#dc5443", "#ffcc81"],
    ["#103c78", "#197fdd", "#79efff"],
    "#192956",
    "#479dff",
    "#ffe268",
  ),
  // Big Dukes: golden dunes against a deep plum stadium.
  circuit(
    "sand",
    ["#804028", "#edb13f", "#fff1a5"],
    ["#214261", "#159d9b", "#a0ffe6"],
    "#502554",
    "#ed70ff",
    "#8cfff0",
  ),
  // Cliffhanger: turquoise stone and coral rails.
  circuit(
    "stone",
    ["#054458", "#2eb89b", "#ccf8a7"],
    ["#172d65", "#1976b4", "#a7ebf9"],
    "#403154",
    "#ff8469",
    "#ffe46a",
  ),
  // Sidewinder: sun-baked terracotta, a turquoise grandstand and lemon kerbs.
  circuit(
    "clay",
    ["#833942", "#e58049", "#ffda8b"],
    ["#074b69", "#10b6bc", "#acffee"],
    "#0b4d5b",
    "#32f4d8",
    "#ffe56b",
  ),
  // Fandango: a magenta night course with lime track furniture.
  circuit(
    "stone",
    ["#4b2260", "#af509e", "#ffc7c6"],
    ["#162870", "#426ad1", "#a8f4ff"],
    "#283668",
    "#bcf64f",
    "#ff9f60",
  ),
  // Hurricane Gulch: cobalt ice framed by orange and fuchsia.
  circuit(
    "ice",
    ["#244c99", "#60b9e9", "#e0ffff"],
    ["#202969", "#565bcd", "#aaa7ff"],
    "#34306d",
    "#ffad45",
    "#ff69b6",
  ),
  // Wipeout: lush green shale, deep pools and hot pink rails.
  circuit(
    "stone",
    ["#2d503c", "#84ae4e", "#e3ef8b"],
    ["#064d79", "#168fb5", "#8be4de"],
    "#194057",
    "#ff69b3",
    "#54edff",
  ),
  // Huevos Grande: violet highlands with gold and mint trim.
  circuit(
    "sand",
    ["#4b326a", "#9772cd", "#eec6fc"],
    ["#185268", "#2bb5a6", "#b3ffd1"],
    "#423154",
    "#ffc452",
    "#71f4b0",
  ),
] as const;

export type CoursePalette = (typeof CIRCUITS)[number];
export function coursePalette(id: string): CoursePalette {
  const match = /^offroad-([1-8])(?:-reverse)?$/.exec(id);
  return CIRCUITS[match ? Number(match[1]) - 1 : 0]!;
}
export function courseAccent(id: string): string {
  return coursePalette(id).accent;
}
