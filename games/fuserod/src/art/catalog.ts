import { profile } from "./cars";
import { front } from "./front";
import { metal, rect, stroke } from "./drawing";
import { partPicture } from "./parts";
import { portrait } from "./portraits";

type ArtKind = "rival" | "part" | "car";
interface ArtOptions {
  paint?: string;
  angle?: "side" | "front" | "quarter";
}

const carPaint = ["#4ce1d3", "#e8a255", "#eb6999"];

/** Render immediately so disconnected catalogue controls can size this canvas later. */
export function artCanvas(
  kind: ArtKind,
  item: number | string,
  options: ArtOptions = {},
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  const width = kind === "rival" ? 160 : 280,
    height = 144;
  c.width = width * 2;
  c.height = height * 2;
  c.setAttribute("aria-hidden", "true");
  const g = c.getContext("2d");
  if (!g) return c;
  g.scale(2, 2);
  if (kind === "rival") {
    portrait(g, Number(item) || 0);
    return c;
  }
  rect(
    g,
    metal(g, 0, height, [0, "#39404f"], [0.72, "#454656"], [1, "#282e3b"]),
    0,
    0,
    width,
    height,
  );
  for (let i = 1; i < 6; i++) stroke(g, "#acb6b216", 1, `M0 ${i * 26} H280`);
  if (kind === "part") partPicture(g, String(item));
  else {
    const model = Number(item) || 0,
      paint = options.paint ?? carPaint[Math.abs(model) % 3]!;
    if (options.angle === "front" || options.angle === "quarter")
      front(
        g,
        140,
        117,
        186,
        paint,
        model,
        options.angle === "quarter" ? 0.6 : 0,
      );
    else {
      g.translate(7, 21);
      g.scale(0.535, 0.535);
      profile(g, paint, model, 0);
    }
  }
  return c;
}
