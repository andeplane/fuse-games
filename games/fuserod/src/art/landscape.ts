import {
  ellipse,
  fill,
  metal,
  noise,
  polygon,
  rect,
  stroke,
  type Brush,
} from "./drawing";

export type Route = "strip" | "canyon" | "aqueduct";

let canyonPanorama: HTMLImageElement | undefined;

const skies = {
  strip: ["#292e55", "#94627a", "#e69376", "#ffd59b"],
  canyon: ["#252c4c", "#81576f", "#e28066", "#ffd395"],
  aqueduct: ["#19384d", "#49757e", "#94a39a", "#f7d1a0"],
} as const;

export function horizon(
  g: Brush,
  w: number,
  h: number,
  route: Route,
  bend: number,
) {
  if (route === "canyon") {
    if (!canyonPanorama) {
      canyonPanorama = new Image();
      canyonPanorama.src = new URL(
        "./canyon-sunset.webp",
        import.meta.url,
      ).href;
    }
    if (canyonPanorama.complete && canyonPanorama.naturalWidth) {
      const sw = canyonPanorama.naturalWidth;
      const sh = canyonPanorama.naturalHeight * 0.72;
      const sample = Math.min(sw * 0.95, (sh * w) / h);
      const left =
        (sw - sample) * (0.5 + 0.24 * Math.max(-1, Math.min(1, bend)));
      g.drawImage(canyonPanorama, left, 0, sample, sh, 0, 0, w, h + 1);
      return;
    }
  }
  const colors = skies[route];
  rect(
    g,
    metal(
      g,
      0,
      h,
      [0, colors[0]],
      [0.46, colors[1]],
      [0.78, colors[2]],
      [1, colors[3]],
    ),
    0,
    0,
    w,
    h + 1,
  );
  for (let i = 0; i < 32; i++) {
    const y = noise(i + 50) * h * 0.58;
    ellipse(
      g,
      `rgba(254,236,209,${0.35 * (1 - y / h)})`,
      noise(i) * w,
      y,
      0.6 + noise(i + 2) * 0.65,
      0.6,
    );
  }
  const sunX = w * 0.71 - bend * 15,
    sunY = h * 0.66,
    r = h * 0.17;
  const glow = g.createRadialGradient(sunX, sunY, 2, sunX, sunY, r * 2.5);
  glow.addColorStop(0, "#ffd09388");
  glow.addColorStop(1, "#ffc59100");
  ellipse(g, glow, sunX, sunY, r * 2.5, r * 2.5);
  ellipse(g, "#ffe4ad", sunX, sunY, r, r);
  for (let i = 0; i < 8; i++) {
    const y = h * (0.24 + i * 0.075),
      x = w * noise(72 + i) - bend * 6;
    const span = (0.07 + noise(i + 92) * 0.18) * w;
    polygon(g, "#efb2a23b", [
      x - span,
      y,
      x - span * 0.47,
      y - 1,
      x - span * 0.36,
      y - 3,
      x + span * 0.31,
      y - 2,
      x + span,
      y + 1,
    ]);
  }
  const hillside = (
    base: number,
    height: number,
    step: number,
    seed: number,
    col: string,
  ) => {
    const points: number[] = [-step, h + 1];
    for (let i = -2; i <= Math.ceil(w / step) + 2; i++) {
      const x = i * step - bend * (6 + seed * 0.18);
      const ridge =
        base -
        height *
          (0.23 + 0.54 * noise(i + seed) + 0.23 * Math.cos(i * 0.55 + seed));
      points.push(x, ridge);
    }
    points.push(w + step, h + 1);
    polygon(g, col, points);
  };
  hillside(h * 0.92, h * 0.38, 52, 25, "#a57584");
  hillside(h * 0.97, h * 0.34, 37, 38, "#86647c");
  hillside(h * 1.08, h * 0.36, 30, 65, "#65576f");
  if (route === "strip") {
    for (let i = 0; i < Math.ceil(w / 10) + 2; i++) {
      const x = i * 10 - bend * 3,
        tall = (0.02 + 0.11 * noise(i + 55)) * h;
      rect(g, "#514c63", x, h - tall, 9 + noise(i + 8) * 7, tall + 1);
      if (i % 5 === 0) rect(g, "#ddae87", x + 2, h - tall + 3, 2, 2);
    }
  }
  hillside(h * 1.075, h * 0.21, 21, 84, "#50475b");
}

export function roadside(
  g: Brush,
  x: number,
  y: number,
  s: number,
  id: number,
  route: Route,
  side: number,
) {
  g.save();
  g.translate(x, y);
  g.scale(s * side, s);
  if (id % 6 === 0) {
    // Bent tubular standards cast the lights toward the pavement.
    stroke(g, "#4b3c49", 3.5, "M0 0 L0 -104 Q2 -115 -11 -115 L-24 -115");
    stroke(g, "#f3c899", 1, "M-1 -3 L-1 -104");
    fill(g, "#4a4248", "M-31 -117 L-17 -118 -12 -115 -15 -112 -32 -112Z");
    rect(g, "#ffe7b6", -31, -113, 14, 2);
  } else if (route === "canyon" && id % 3 === 0) {
    fill(
      g,
      "#403d4b",
      "M-5 0 L-5 -18 -16 -19 Q-22 -20 -22 -27 L-22 -43 Q-20 -47 -18 -43 L-18 -28 Q-17 -24 -6 -25 L-6 -57 Q-2 -64 1 -58 L1 -32 7 -34 8 -49 Q10 -53 12 -49 L12 -32 Q11 -26 1 -26 L2 0Z",
    );
  } else if (id % 7 === 2) {
    stroke(g, "#443e4c", 3, "M0 0 L0 -51 M20 -1 L20 -52");
    fill(g, "#ddae78", "M-7 -62 L24 -65 32 -56 24 -47 -7 -45Z");
    stroke(g, "#674457", 3, "M3 -59 L8 -55 3 -50 M13 -60 L18 -56 13 -51");
  } else if (id % 4 === 1) {
    fill(g, "#484050", "M-3 0 Q2 -38 -5 -65 L-2 -66 Q7 -31 2 0Z");
    for (let i = 0; i < 8; i++) {
      const direction = i % 2 ? 1 : -1,
        endX = direction * (15 + noise(i + id) * 25),
        endY = -65 + (i - 3) * 3;
      fill(
        g,
        i % 3 === 0 ? "#51485a" : "#443f51",
        `M-3 -65 Q${endX * 0.5} -91 ${endX} ${endY} Q${endX * 0.55} -74 -3 -62Z`,
      );
    }
  } else {
    fill(
      g,
      "#544452",
      "M-24 0 Q-20 -6 -13 -5 Q-9 -18 -2 -13 Q5 -20 12 -8 Q18 -10 23 -2 L28 0Z",
    );
    stroke(g, "#b07f74", 1, "M-9 -9 L-5 -12 -1 -10 M6 -11 L11 -8");
  }
  g.restore();
}
