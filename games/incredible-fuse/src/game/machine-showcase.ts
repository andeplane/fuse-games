import type { MachineLink } from "./machine-links.js";
import type { PartKind, Puzzle } from "./machine-parts.js";

/** The belt waits for the outlet. A builder supplies the missing incline. */
const stations: [PartKind, number, number, boolean?][] = [
  ["ball", 110, 50],
  ["outlet", 254, 278],
  ["motor", 386, 257, true],
  ["belt", 394, 156],
  ["crate", 376, 103],
  ["basket", 572, 240],
  ["bulb", 68, 266],
  ["shelf", 68, 294],
  ["timber", 250, 299],
  ["timber", 384, 283],
  ["shelf", 572, 266],
  ["wall", 572, 284],
];

export const SHOWCASE_PUZZLE: Puzzle & { links: MachineLink[] } = {
  title: "Clocking out",
  goal: "Use the marble to switch on the packing line and deliver the last parcel to the basket.",
  stock: { ramp: 1, shelf: 1, gear: 1 },
  targets: [2, 3, 6, 7],
  links: [
    { kind: "wire", a: 2, b: 3 },
    { kind: "wire", a: 2, b: 7 },
    { kind: "belt", a: 3, b: 4 },
  ],
  parts: stations.map(([kind, x, y, flip = false], index) => ({
    id: index + 1,
    kind,
    x,
    y,
    flip,
    fixed: true,
  })),
};
