/** Angles describe the displayed screen's rotation from a portrait phone. */
export function phoneHomeEdge(angle: number | undefined) {
  switch (((angle ?? 0) + 360) % 360) {
    case 90:
      return "right";
    case 180:
      return "top";
    case 270:
      return "left";
    default:
      return "bottom";
  }
}
