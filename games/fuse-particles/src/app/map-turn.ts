/** How the map is turned on screen: a wide map on a tall screen is drawn on its side, so it fills the screen. */
export type Turn = "none" | "left" | "right";

/** A point of the canvas, as fractions of its width and height, in map cells. */
export function mapPoint(
  u: number,
  v: number,
  cols: number,
  rows: number,
  turn: Turn,
): { x: number; y: number } {
  if (turn === "left") return { x: (1 - v) * cols, y: u * rows };
  if (turn === "right") return { x: v * cols, y: (1 - u) * rows };
  return { x: u * cols, y: v * rows };
}

/** A wide map turns on a tall screen, with the viewer's own base at the bottom edge. */
export function turnFor(
  cols: number,
  rows: number,
  stageWidth: number,
  stageHeight: number,
  own: number,
): Turn {
  if (cols <= rows || stageWidth <= 0 || stageHeight <= stageWidth)
    return "none";
  return own === 1 ? "right" : "left";
}
