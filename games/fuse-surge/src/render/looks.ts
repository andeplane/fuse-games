/**
 * The looks a device can show a match in. A look is cosmetic and this device's own: it changes what is drawn and
 * nothing about the match, so two riders in one room can each pick a different one. Everything here is plain data,
 * so the menus and the tests can read it without loading the 3D renderer.
 */
export const LOOK_IDS = [
  "reactor",
  "skyisle",
  "toybox",
  "glacier",
  "forge",
  "classic",
] as const;
export type LookId = (typeof LOOK_IDS)[number];
export const DEFAULT_LOOK: LookId = "reactor";

/** How a low surge (jump it) and a high one (duck it) are built. */
export type RollerStyle = "coil" | "log" | "candy" | "prism" | "ingot";
export type HangerStyle = "field" | "slats" | "icicles" | "slab";

/** What a 3D look is made of: colours as `#rrggbb`, lengths in world units (a hundredth of a deck pixel). */
export interface Theme {
  /** The sky from straight up, through the horizon, to below it. */
  sky: { top: string; mid: string; low: string };
  fog: { color: string; near: number; far: number };
  hemi: { sky: string; ground: string; power: number };
  sun: {
    color: string;
    power: number;
    from: readonly [number, number, number];
  };
  /** The light the pit throws up at the deck's edge. */
  under: { color: string; power: number };
  tone: "aces" | "neutral";
  exposure: number;
  /** Bloom strength; 0 draws without the post chain. */
  bloom: number;
  deck: {
    pattern: "panel" | "stone" | "checker" | "ice" | "plate";
    base: string;
    alt: string;
    seam: string;
    side: string;
    trim: string;
    ledge: string;
    /** Painted lines, and how strongly they shine (0: paint only). */
    line: string;
    glow: number;
    rough: number;
    metal: number;
    under: "pylons" | "rock";
    underColor: string;
  };
  pit: {
    a: string;
    b: string;
    c: string;
    /** 0: soft billows; 1: a dark crust with bright cracks. */
    crust: number;
    glow: number;
    speed: number;
    scale: number;
  };
  low: { style: RollerStyle; color: string; accent: string; glow: number };
  high: { style: HangerStyle; color: string; accent: string; glow: number };
  /** The flip gate, and danger (the edge, the last foothold). */
  flip: string;
  danger: string;
  rider: { rough: number; metal: number; glow: number };
  props: "reactor" | "isle" | "toys" | "ice" | "forge";
  /** What drifts in the air: positive `rise` goes up. */
  motes: {
    color: string;
    count: number;
    rise: number;
    drift: number;
    size: number;
    glow: boolean;
  };
}

export interface Look {
  id: LookId;
  title: string;
  /** One line for the menu. */
  blurb: string;
  /** Absent for the 2D picture. */
  theme?: Theme;
}

const REACTOR: Theme = {
  sky: { top: "#02040f", mid: "#0a1440", low: "#2a0b4a" },
  fog: { color: "#0a0f2e", near: 18, far: 64 },
  hemi: { sky: "#6f8cff", ground: "#b3206f", power: 0.42 },
  sun: { color: "#a9c9ff", power: 1.5, from: [-4, 9, 6] },
  under: { color: "#ff2e9d", power: 26 },
  tone: "aces",
  exposure: 1,
  bloom: 0.4,
  deck: {
    pattern: "panel",
    base: "#15214f",
    alt: "#1b2b63",
    seam: "#070e28",
    side: "#0c1640",
    trim: "#16e7ff",
    ledge: "#0f1a47",
    line: "#16e7ff",
    glow: 0.85,
    rough: 0.42,
    metal: 0.55,
    under: "pylons",
    underColor: "#0b1436",
  },
  pit: {
    a: "#0a0220",
    b: "#3d0b52",
    c: "#c22a9c",
    crust: 0.45,
    glow: 1,
    speed: 0.04,
    scale: 0.3,
  },
  low: { style: "coil", color: "#ff5b4a", accent: "#ffd0c4", glow: 1.25 },
  high: { style: "field", color: "#a98bff", accent: "#efe6ff", glow: 1.35 },
  flip: "#7df2c8",
  danger: "#ff4d5e",
  rider: { rough: 0.4, metal: 0.15, glow: 0.3 },
  props: "reactor",
  motes: {
    color: "#7de8ff",
    count: 70,
    rise: 0.25,
    drift: 0.06,
    size: 0.07,
    glow: true,
  },
};

const SKY_ISLE: Theme = {
  sky: { top: "#2a78de", mid: "#8fcbff", low: "#fff1d6" },
  fog: { color: "#cfe9ff", near: 34, far: 120 },
  hemi: { sky: "#e6f4ff", ground: "#8fae6a", power: 1.3 },
  sun: { color: "#fff0cc", power: 3.1, from: [-5, 10, 5] },
  under: { color: "#ffffff", power: 0 },
  tone: "neutral",
  exposure: 1,
  bloom: 0,
  deck: {
    pattern: "stone",
    base: "#dccfb6",
    alt: "#c6b596",
    seam: "#a08e70",
    side: "#a8916f",
    trim: "#8a7358",
    ledge: "#6fbf4b",
    line: "#ffffff",
    glow: 0,
    rough: 0.9,
    metal: 0,
    under: "rock",
    underColor: "#8a7358",
  },
  pit: {
    a: "#9cc8ee",
    b: "#f4faff",
    c: "#ffffff",
    crust: 0,
    glow: 1,
    speed: 0.02,
    scale: 0.11,
  },
  low: { style: "log", color: "#9a6a3c", accent: "#e8c894", glow: 0 },
  high: { style: "slats", color: "#3f8fd6", accent: "#f1e2c2", glow: 0 },
  flip: "#16a37f",
  danger: "#e5484d",
  rider: { rough: 0.6, metal: 0, glow: 0 },
  props: "isle",
  motes: {
    color: "#ffd1e8",
    count: 50,
    rise: -0.18,
    drift: 0.45,
    size: 0.09,
    glow: false,
  },
};

const TOY_BOX: Theme = {
  sky: { top: "#6f58f0", mid: "#ff9ad5", low: "#ffe9a8" },
  fog: { color: "#cdbfff", near: 30, far: 110 },
  hemi: { sky: "#ffffff", ground: "#ffb6d9", power: 1.35 },
  sun: { color: "#ffffff", power: 2.7, from: [-3, 10, 6] },
  under: { color: "#8f7bff", power: 8 },
  tone: "neutral",
  exposure: 1,
  bloom: 0,
  deck: {
    pattern: "checker",
    base: "#fff4d6",
    alt: "#7fd8ff",
    seam: "#ffffff",
    side: "#ff5fa2",
    trim: "#ffd23f",
    ledge: "#8fe36f",
    line: "#3b2a6b",
    glow: 0,
    rough: 0.28,
    metal: 0,
    under: "pylons",
    underColor: "#7b5cff",
  },
  pit: {
    a: "#3a1fa6",
    b: "#6a4cff",
    c: "#b9a6ff",
    crust: 0.15,
    glow: 1,
    speed: 0.03,
    scale: 0.25,
  },
  low: { style: "candy", color: "#ff3b3b", accent: "#ffffff", glow: 0 },
  high: { style: "slats", color: "#7b5cff", accent: "#ffd23f", glow: 0 },
  flip: "#12b89a",
  danger: "#ff3b3b",
  rider: { rough: 0.22, metal: 0, glow: 0 },
  props: "toys",
  motes: {
    color: "#ffd23f",
    count: 60,
    rise: -0.22,
    drift: 0.35,
    size: 0.08,
    glow: false,
  },
};

const GLACIER: Theme = {
  sky: { top: "#050a24", mid: "#123a6b", low: "#2f7f9c" },
  fog: { color: "#173a5e", near: 22, far: 84 },
  hemi: { sky: "#a9dcff", ground: "#2a4a7a", power: 1 },
  sun: { color: "#d6eaff", power: 2.2, from: [-6, 9, 4] },
  under: { color: "#4fd6ff", power: 22 },
  tone: "aces",
  exposure: 1.1,
  bloom: 0.3,
  deck: {
    pattern: "ice",
    base: "#c4e9f6",
    alt: "#92cde9",
    seam: "#ffffff",
    side: "#6fb4d6",
    trim: "#e8fbff",
    ledge: "#eef8fc",
    line: "#1b4f8f",
    glow: 0,
    rough: 0.16,
    metal: 0.1,
    under: "rock",
    underColor: "#7fc4e0",
  },
  pit: {
    a: "#06183a",
    b: "#0f5f8a",
    c: "#d8f6ff",
    crust: 0.4,
    glow: 1,
    speed: 0.03,
    scale: 0.3,
  },
  low: { style: "prism", color: "#1fb4f2", accent: "#ffffff", glow: 0.8 },
  high: { style: "icicles", color: "#d8f6ff", accent: "#8fe8ff", glow: 0.25 },
  flip: "#7dffb0",
  danger: "#ff5f7a",
  rider: { rough: 0.4, metal: 0, glow: 0.12 },
  props: "ice",
  motes: {
    color: "#ffffff",
    count: 130,
    rise: -0.6,
    drift: 0.3,
    size: 0.06,
    glow: false,
  },
};

const FORGE: Theme = {
  sky: { top: "#0a0605", mid: "#2a120a", low: "#7a2a0c" },
  fog: { color: "#2a0f08", near: 16, far: 62 },
  hemi: { sky: "#ffc59a", ground: "#c2360c", power: 0.75 },
  sun: { color: "#ffe2c0", power: 2.3, from: [-4, 9, 6] },
  under: { color: "#ff5a14", power: 40 },
  tone: "aces",
  exposure: 1,
  bloom: 0.35,
  deck: {
    pattern: "plate",
    base: "#41454d",
    alt: "#565b65",
    seam: "#1b1d22",
    side: "#2a2c31",
    trim: "#ffb81f",
    ledge: "#33363c",
    line: "#ffc928",
    glow: 0.3,
    rough: 0.55,
    metal: 0.75,
    under: "pylons",
    underColor: "#23252a",
  },
  pit: {
    a: "#140502",
    b: "#8a2606",
    c: "#ff8a1f",
    crust: 0.7,
    glow: 1.15,
    speed: 0.03,
    scale: 0.3,
  },
  low: { style: "ingot", color: "#ff5a1a", accent: "#ffb347", glow: 1.3 },
  high: { style: "slab", color: "#565b65", accent: "#ffd23f", glow: 1.5 },
  flip: "#5fe0c0",
  danger: "#ff3b2f",
  rider: { rough: 0.45, metal: 0.1, glow: 0.18 },
  props: "forge",
  motes: {
    color: "#ffa040",
    count: 90,
    rise: 0.7,
    drift: 0.25,
    size: 0.06,
    glow: true,
  },
};

export const LOOKS: readonly Look[] = [
  {
    id: "reactor",
    title: "REACTOR",
    blurb: "Neon deck over a plasma core",
    theme: REACTOR,
  },
  {
    id: "skyisle",
    title: "SKY ISLE",
    blurb: "A stone bridge above the clouds",
    theme: SKY_ISLE,
  },
  {
    id: "toybox",
    title: "TOY BOX",
    blurb: "Glossy blocks and candy rollers",
    theme: TOY_BOX,
  },
  {
    id: "glacier",
    title: "GLACIER",
    blurb: "An ice shelf over a freezing sea",
    theme: GLACIER,
  },
  {
    id: "forge",
    title: "FORGE",
    blurb: "Hot steel over molten metal",
    theme: FORGE,
  },
  { id: "classic", title: "PIXEL 2D", blurb: "The flat pixel picture" },
];

export const lookOf = (id: LookId): Look =>
  LOOKS.find((look) => look.id === id) ?? LOOKS[0]!;

/** A look's id from a link or from storage, or nothing when it names none. */
export function parseLook(value: unknown): LookId | undefined {
  if (typeof value !== "string") return undefined;
  const wanted = value.trim().toLowerCase();
  return LOOK_IDS.find((id) => id === wanted);
}

/** The look after `id`, round and round: what a "next look" button shows. */
export const nextLook = (id: LookId): LookId =>
  LOOK_IDS[(LOOK_IDS.indexOf(id) + 1) % LOOK_IDS.length]!;

/** The look a page starts with: a link's `look=` over what this browser last chose. */
export function lookFrom(search: string, saved: string | null): LookId {
  return (
    parseLook(new URLSearchParams(search).get("look")) ??
    parseLook(saved) ??
    DEFAULT_LOOK
  );
}
