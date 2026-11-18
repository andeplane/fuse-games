import { ellipse, fill, metal, rect, stroke, type Brush } from "./drawing";

/** Front or front-quarter view; x/y locate the tyres' contact with the road. */
export function front(
  g: Brush,
  x: number,
  y: number,
  width: number,
  paint: string,
  model: number,
  yaw = 0,
) {
  g.save();
  g.translate(x, y);
  g.scale(width / 168, width / 168);
  const quarter = Math.abs(yaw) > 0.3;
  if (yaw < 0) g.scale(-1, 1);
  ellipse(g, "#18182466", 0, 1, 82, 8);
  if (quarter) {
    fill(g, paint, "M-62 -47 L-82 -40 -83 -17 -74 -11 -49 -10Z");
    ellipse(g, "#24232e", -72, -14, 8, 13);
    ellipse(g, "#a8b0a9", -73, -14, 4, 8);
    stroke(g, "#e8d5af", 2, "M-82 -34 L-62 -39");
    g.translate(6, 0);
    g.scale(0.88, 1);
  }
  rect(g, "#252733", -67, -27, 19, 27);
  rect(g, "#252733", 48, -27, 19, 27);
  const roof =
    model % 3 === 2
      ? "M-58 -44 L-49 -72 Q0 -82 49 -72 L58 -44Z"
      : "M-58 -44 L-41 -68 Q0 -81 41 -68 L58 -44Z";
  fill(g, paint, roof);
  fill(
    g,
    metal(g, -72, -44, [0, "#263546"], [1, "#758d93"]),
    "M-50 -46 L-38 -65 Q0 -74 38 -65 L51 -46Z",
  );
  fill(g, "#dddcc275", "M-25 -66 L-19 -67 -36 -47 -43 -47Z");
  fill(
    g,
    paint,
    "M-76 -39 Q-76 -52 -59 -53 L-46 -48 Q0 -55 48 -48 L60 -53 Q76 -51 76 -39 L75 -17 Q65 -7 0 -9 Q-60 -8 -74 -16Z",
  );
  fill(g, "#eecc9f65", "M-59 -46 Q-34 -54 39 -49 L52 -43 Q0 -47 -55 -40Z");
  fill(g, "#25323d", "M-44 -37 Q1 -39 44 -37 L39 -22 Q0 -18 -39 -22Z");
  for (let i = 0; i < 4; i++)
    stroke(
      g,
      "#aebbb4",
      1.4,
      `M${-42 + i} ${-35 + i * 3.5} Q0 ${-36 + i * 4} ${42 - i} ${-35 + i * 3.5}`,
    );
  for (const side of [-1, 1]) {
    ellipse(g, "#62747b", side * 60, -37, 12, 10);
    if (model % 3 === 0) {
      ellipse(g, "#e6deb7", side * 60, -37, 8, 7);
    } else {
      ellipse(g, "#e7dfbd", side * 64, -37, 5, 5);
      ellipse(g, "#e7dfbd", side * 54, -37, 4, 4);
    }
    rect(g, "#dd9d68", side * 62 - 4, -23, 8, 3);
  }
  stroke(g, "#cad7ca", 4, "M-77 -17 Q0 -7 77 -17");
  rect(g, "#dad1b9", -8, -19, 16, 6);
  rect(g, "#59606b", -5, -17, 10, 2);
  g.restore();
}
