import { ellipse, fill, rect, setup, stroke, type Brush } from "./drawing";
import { carhopPose } from "./character-motion";

function limb(
  g: Brush,
  color: string,
  width: number,
  x: number,
  y: number,
  kx: number,
  ky: number,
  ex: number,
  ey: number,
) {
  stroke(g, color, width, `M${x} ${y} L${kx} ${ky} L${ex} ${ey}`);
}

function legs(g: Brush, step: number, pants: string, shoe: string) {
  for (const side of [-1, 1]) {
    const stride = Math.sin(step) * side;
    const heel = Math.max(0, Math.cos(step) * side);
    const foot = side * 3 + stride * 10;
    const ankle = -3 - heel * 6;
    limb(
      g,
      side === -1 ? "#35374b" : pants,
      5.8,
      side * 3,
      -26,
      side * 2 + stride * 6 + heel * 3,
      -16 - heel,
      foot,
      ankle,
    );
    stroke(g, shoe, 4, `M${foot - 1} ${ankle} l6 0`);
  }
}

function head(g: Brush, cap: string) {
  ellipse(g, "#4b343d", 0, -52, 6.2, 7.2);
  fill(
    g,
    "#d59877",
    "M-3 -55 Q3 -60 6 -54 L8 -50 L6 -49 Q6 -45 1 -46 L1 -42 L-4 -44Z",
  );
  fill(
    g,
    cap,
    "M-7 -54 Q-8 -61 -2 -61 L5 -59 L7 -56 L10 -55 L5 -54 Q-1 -57 -7 -54Z",
  );
  rect(g, "#583f44", 4, -53, 1.5, 1);
}

export function carhop(g: Brush, w: number, scale: number, tick: number) {
  const pose = carhopPose(tick);
  if (!pose) return;
  const { frame, returning, progress } = pose;
  const atWindow = returning ? frame < 3 : frame >= 6;
  const stride = atWindow
    ? 0.3
    : Math.PI * 2 * (returning ? (frame - 3) / 7 : (5 - frame) / 6);
  const reach = atWindow ? (returning ? (3 - frame) / 3 : (frame - 5) / 5) : 0;
  const x = returning
    ? w * (0.46 + 0.62 * progress)
    : w * (-0.08 + 0.54 * progress);
  g.save();
  g.translate(x, 430);
  g.scale(scale * 1.45, scale * 1.45);
  g.lineCap = "round";
  ellipse(g, "#29283e52", 0, 0, 13, 2.7);
  legs(g, stride, "#b67968", "#f2dcb7");
  g.translate(0, -Math.abs(Math.sin(stride)) * 1.5);
  fill(
    g,
    "#a14c52",
    "M-6 -44 Q-2 -47 5 -44 L7 -32 L11 -25 Q2 -22 -10 -25 L-5 -34Z",
  );
  fill(
    g,
    "#f5d9b1",
    "M-4 -43 L0 -39 L4 -44 L5 -34 L-4 -34Z M-6 -33 L6 -33 L8 -27 Q0 -25 -7 -27Z",
  );
  limb(g, "#c28770", 3.4, -4, -42, -9, -34, -8 - Math.sin(stride) * 4, -30);
  limb(g, "#ebb995", 3.8, 5, -42, 9, -35, 15 + reach * 5, -40 + reach * 3);
  const tx = 15 + reach * 5,
    ty = -41 + reach * 3;
  ellipse(g, "#bcd1ca", tx, ty, 10, 1.5);
  rect(g, "#fcdfa3", tx - 4, ty - 7, 3.5, 6);
  rect(g, "#dd7464", tx + 2, ty - 6, 4, 5);
  stroke(g, "#faece0", 0.9, `M${tx + 4} ${ty - 6} l1 -3`);
  head(g, "#f0dfc5");
  g.restore();
}

export function championDriver(
  g: Brush,
  x: number,
  y: number,
  scale: number,
  frame: number,
) {
  g.save();
  g.translate(x, y);
  g.scale(scale, scale);
  g.lineCap = "round";
  const stride = frame < 42 ? (frame * Math.PI) / 6 : 0;
  legs(g, stride, "#47627a", "#4a363f");
  fill(g, "#548b91", "M-7 -44 Q-2 -48 5 -44 L8 -28 Q1 -24 -7 -28Z");
  stroke(g, "#dda775", 2, "M-4 -43 L0 -39 L5 -44");
  const wave = Math.max(0, Math.min(1, (frame - 22) / 9, (48 - frame) / 8));
  limb(
    g,
    "#ca9176",
    4,
    4,
    -40,
    10,
    -36 - wave * 12,
    13 + wave * 3,
    -33 - wave * 22 + wave * Math.sin(frame) * 3,
  );
  limb(g, "#3c656c", 4, -5, -41, -9, -34, -8 + Math.sin(stride) * 5, -30);
  head(g, "#333949");
  g.restore();
}

export function drawStarter(
  canvas: HTMLCanvasElement,
  countdown: number,
  elapsed: number,
  distance: number,
  reduced: boolean,
) {
  if (
    canvas.ownerDocument.hidden ||
    (countdown === 0 && (elapsed > 16 || distance > 13))
  )
    return;
  const view = setup(canvas);
  if (!view) return;
  const { g, w } = view;
  const release = countdown === 0;
  const angle = release
    ? reduced
      ? 0.95
      : -1.08 + 2.03 * Math.min(1, (elapsed + 1) / 5)
    : countdown <= 20
      ? -1.08
      : -0.54;
  const slide = release && !reduced ? Math.max(distance / 13, elapsed / 16) : 0;
  g.save();
  g.translate(w * (0.67 + slide * 0.38), 273 + slide * 25);
  const scale = Math.min(w / 620, 1.18) * (1 + slide * 0.35);
  g.scale(scale, scale);
  g.lineCap = "round";
  ellipse(g, "#27233370", 0, 0, 13, 2.8);
  legs(g, 0.48, "#4d586e", "#433b49");
  fill(g, "#ce7056", "M-7 -44 Q-2 -48 5 -44 L8 -27 Q0 -25 -7 -27Z");
  fill(g, "#f7dbaa", "M-4 -44 L-1 -45 L2 -27 L-1 -27Z");
  limb(g, "#c28b70", 3.8, -5, -40, -10, -34, -7, -30);
  head(g, "#d6b889");
  g.translate(5, -41);
  g.rotate(angle);
  limb(g, "#e7b58e", 4, 0, 0, 7, 4, 13, 0);
  stroke(g, "#e9d4af", 1.7, "M9 1 L38 -5");
  const banner = "M19 -2 L38 -6 Q42 1 45 5 Q37 3 25 9Z";
  fill(g, "#efdfbc", banner);
  g.save();
  g.clip(new Path2D(banner));
  g.rotate(-0.2);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 8; c++)
      if ((r + c) % 2 === 0) rect(g, "#364151", 18 + 4 * c, -1 + 4 * r, 4, 4);
  g.restore();
  g.restore();
}
