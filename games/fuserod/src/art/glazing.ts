import { fill, metal, stroke, type Brush } from "./drawing";
import {
  roofIsUp,
  vehicleBody,
  type VehicleFittings,
} from "./vehicle-families";

/** Orthographic cabin shared by forward and tail sprites in their local frames. */
export function glazing(
  g: Brush,
  model: number,
  paint: string,
  rear: boolean,
  fittings?: VehicleFittings,
) {
  const b = vehicleBody(model),
    wide = b.style === "wagon" || b.style === "pickup" || b.style === "sedan";
  const up = roofIsUp(b, fittings),
    base = rear ? -47 : -45,
    top = base - (45 - b.roofHeight) * 0.8 - 9;
  const crest = (wide ? 45 : 38) + (b.width - 1) * 23,
    baseW = rear ? 51 : 57;
  const glass = metal(g, top, base, [0, "#1c3347"], [1, "#809596"]);
  if (up) {
    fill(
      g,
      paint,
      `M${-baseW} ${base} L${-crest} ${top + 2} Q0 ${top - 8} ${crest} ${top + 2} L${baseW} ${base}Z`,
    );
    fill(
      g,
      glass,
      `M${-baseW + 6} ${base - 1} L${-crest + 4} ${top + 5} Q0 ${top - 2} ${crest - 4} ${top + 5} L${baseW - 6} ${base - 1}Z`,
    );
    fill(g, "#c4d6c649", `M-20 ${top + 3} h8 l-17 ${base - top - 5} h-8Z`);
  } else {
    if (rear) {
      fill(
        g,
        "#443943",
        "M-49 -44 L-48 -56 Q-46 -62 -40 -61 L-30 -61 Q-25 -59 -26 -49 L12 -49 12 -57 Q14 -62 20 -61 L28 -60 Q33 -56 32 -46Z",
      );
      stroke(
        g,
        "#a7b9b1",
        2,
        `M-44 -49 L-37 ${top + 10} Q0 ${top + 6} 37 ${top + 10} L44 -49`,
      );
    } else {
      fill(
        g,
        glass,
        `M-52 ${base} L-40 ${top + 9} Q0 ${top + 6} 40 ${top + 9} L52 ${base}Z`,
      );
      stroke(
        g,
        "#cbd1bd",
        2,
        `M-54 ${base} L-41 ${top + 7} Q0 ${top + 4} 41 ${top + 7} L54 ${base}`,
      );
    }
  }
  return top;
}
