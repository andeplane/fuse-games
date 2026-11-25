export interface VehicleFittings {
  /** Overrides the as-built roof. False lowers the roof, true installs a top. */
  roof?: boolean;
  frontBumper?: boolean;
  rearBumper?: boolean;
  hoodScoop?: boolean;
}

type BodyStyle =
  | "coupe"
  | "fastback"
  | "hardtop"
  | "sedan"
  | "open"
  | "wagon"
  | "pickup"
  | "utility"
  | "targa"
  | "drag";

interface Body {
  style: BodyStyle;
  rearAxle: number;
  frontAxle: number;
  rearPillar: number;
  frontPillar: number;
  roofHeight: number;
  fin: number;
  width: number;
  tailLights: 1 | 2 | 3;
}
function body(
  style: BodyStyle,
  rearAxle: number,
  frontAxle: number,
  rearPillar: number,
  frontPillar: number,
  roofHeight: number,
  fin: number,
  width: number,
  tailLights: 1 | 2 | 3,
): Body {
  return {
    style,
    rearAxle,
    frontAxle,
    rearPillar,
    frontPillar,
    roofHeight,
    fin,
    width,
    tailLights,
  };
}

// Index matches the campaign catalogue. Geometry is original and expressed in a
// 500×185 side-profile view. Rear pillars are on the left of the picture.
const bodies = [
  body("coupe", 100, 399, 141, 299, 24, 13, 0.98, 1), // Kestrel Six
  body("fastback", 98, 401, 92, 302, 23, 8, 1, 2), // Marlin Eight
  body("hardtop", 104, 400, 132, 300, 23, 15, 1.04, 2), // Meteor GT
  body("coupe", 116, 379, 151, 292, 29, 3, 0.92, 1), // Comet Runabout
  body("sedan", 86, 407, 119, 306, 13, 12, 1.05, 1), // Wren Deluxe
  body("open", 107, 395, 151, 282, 26, 3, 0.98, 2), // Jetstream
  body("wagon", 96, 405, 69, 302, 12, 1, 1.07, 1), // Longshore
  body("pickup", 89, 394, 212, 305, 12, 2, 0.98, 1), // Breaker
  body("fastback", 90, 407, 67, 312, 21, 6, 1.05, 3), // Caldera GT
  body("hardtop", 92, 410, 113, 287, 29, 17, 1.07, 2), // Emberline
  body("sedan", 83, 405, 112, 305, 17, 27, 1.04, 3), // Silverfin
  body("utility", 106, 399, 195, 309, 28, 8, 0.99, 2), // Switchback
  body("open", 111, 393, 170, 284, 32, 2, 0.91, 1), // Arrowhead
  body("open", 90, 406, 133, 296, 24, 17, 1.06, 2), // Vesper
  body("sedan", 81, 416, 100, 305, 11, 8, 1.08, 2), // Northstar
  body("fastback", 111, 382, 119, 282, 33, 2, 0.94, 2), // Chicane Berlinetta
  body("coupe", 104, 385, 171, 295, 27, 4, 0.95, 3), // Corsair
  body("targa", 102, 394, 141, 289, 23, 6, 1, 2), // Sundial
  body("wagon", 82, 414, 51, 311, 21, 7, 1.08, 3), // Riptide
  body("pickup", 111, 392, 220, 308, 9, 2, 1.01, 1), // Outrider
  body("hardtop", 99, 403, 134, 277, 27, 5, 1.05, 3), // Meridian
  body("drag", 94, 419, 163, 302, 30, 3, 1.03, 3), // Wildfire
] as const;

export function vehicleBody(model: number): Body {
  return bodies[model] ?? bodies[0]!;
}
export function roofIsUp(b: Body, fittings?: VehicleFittings) {
  return fittings?.roof ?? b.style !== "open";
}
