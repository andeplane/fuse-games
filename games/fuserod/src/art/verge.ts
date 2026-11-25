import { ellipse, type Brush } from "./drawing";

let atlas: HTMLImageElement | undefined;

export const canyonShape = {
  spreadingTree: 4,
  domedTree: 5,
  greyRock: 6,
  clusteredRocks: 7,
} as const;

export function vergeSprite(
  g: Brush,
  x: number,
  y: number,
  size: number,
  kind: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7,
  flip = false,
) {
  if (!atlas) {
    atlas = g.canvas.ownerDocument.createElement("img");
    atlas.src = new URL("./canyon-verge.webp", import.meta.url).href;
  }
  if (!atlas.complete || !atlas.naturalWidth) return false;
  // The atlas has two columns of bottom-anchored original cutouts.
  ellipse(
    g,
    "#4a37334a",
    x + size * 0.06,
    y,
    size * (kind < 2 ? 0.19 : 0.42),
    size * 0.032,
  );
  g.save();
  g.translate(x, y);
  if (flip) g.scale(-1, 1);
  g.drawImage(
    atlas,
    (kind % 2) * 320,
    Math.floor(kind / 2) * 320,
    320,
    320,
    -size / 2,
    -size,
    size,
    size,
  );
  g.restore();
  return true;
}
