import type Phaser from "phaser";

/** Slot paint also identifies each driver in the timing tower. */
export const STADIUM_LIVERIES = [
  "#29f5dc",
  "#ff60a1",
  "#b2f750",
  "#ffa454",
  "#bb86ff",
] as const;
const HEADINGS = 48;
const CELL = 96;

type Vertex = readonly [forward: number, across: number, height: number];
type Face = { points: Vertex[]; paint: string };

export function truckFrame(heading: number): number {
  return (
    ((Math.round((heading * HEADINGS) / (2 * Math.PI)) % HEADINGS) + HEADINGS) %
    HEADINGS
  );
}

/** World-up stays vertical as the pickup turns. Each heading is baked once, including
 * the sidewalls, axles and daylight below the lifted chassis. */
export function fuseTruckTexture(scene: Phaser.Scene, slot: number): string {
  const key = `fd-monster-${slot}`;
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.createCanvas(key, CELL * 8, CELL * 6);
  if (!texture) throw new Error("Could not create monster truck atlas");
  const ctx = texture.getContext();
  const color = STADIUM_LIVERIES[slot % STADIUM_LIVERIES.length]!;
  const flankColor =
    "#" +
    [1, 3, 5]
      .map((i) =>
        Math.round(parseInt(color.slice(i, i + 2), 16) * 0.65)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");
  const faces: Face[] = [];
  const face = (paint: string, ...points: Vertex[]) =>
    faces.push({ paint, points });
  // Cross-sections from the tailgate to the nose. Recess the bed and rake the windshield.
  const sections = (
    stations: readonly Vertex[],
    bottom: number,
    flank: string,
    top: string,
  ) => {
    for (let i = 1; i < stations.length; i++) {
      const [a, u, h] = stations[i - 1]!,
        [b, v, k] = stations[i]!;
      face(top, [a, -u, h], [b, -v, k], [b, v, k], [a, u, h]);
      for (const side of [-1, 1])
        face(
          flank,
          [a, side * u, bottom],
          [b, side * v, bottom],
          [b, side * v, k],
          [a, side * u, h],
        );
    }
    for (const [x, w, z] of [stations[0]!, stations.at(-1)!])
      face(flank, [x, -w, bottom], [x, w, bottom], [x, w, z], [x, -w, z]);
  };
  sections(
    [
      [-22, 5, 13],
      [22, 5, 13],
    ],
    7,
    "#26313a",
    "#66717a",
  );
  sections(
    [
      [-28, 11, 22],
      [-24, 12, 24],
      [22, 12, 24],
      [28, 10, 21],
    ],
    16,
    flankColor,
    color,
  );
  sections(
    [
      [27, 11, 16],
      [30, 10, 16],
    ],
    13,
    "#4a6272",
    "#c2d6ce",
  );
  sections(
    [
      [-30, 11, 16],
      [-27, 12, 16],
    ],
    13,
    "#435463",
    "#a1b4ba",
  );
  face(
    "#263746",
    [-25, -9, 23.7],
    [-10, -9, 24.4],
    [-10, 9, 24.4],
    [-25, 9, 23.7],
  );
  for (const side of [-1, 1]) {
    face(
      "#afcad0",
      [-26, side * 10.8, 24],
      [-9, side * 10.8, 24.7],
      [-9, side * 9, 24.7],
      [-26, side * 9, 24],
    );
    face(
      "#fff1b2",
      [-24, side * 12.1, 19],
      [-12, side * 12.1, 22],
      [17, side * 12.1, 22],
      [7, side * 12.1, 19],
    );
    face(
      "#0c5770",
      [-10, side * 9, 24],
      [-6, side * 8, 32],
      [4, side * 8, 32],
      [10, side * 9, 24],
    );
  }
  face("#0d3446", [-10, -9, 24], [-6, -8, 32], [-6, 8, 32], [-10, 9, 24]);
  face("#57a4bb", [4, -8, 32], [10, -9, 24], [10, 9, 24], [4, 8, 32]);
  face(
    color,
    [-6.5, -8.8, 32.5],
    [4.5, -8.8, 32.5],
    [4.5, 8.8, 32.5],
    [-6.5, 8.8, 32.5],
  );
  const numbers = [
    "010110010010111",
    "111001111100111",
    "111001111001111",
    "101101111001001",
    "111100111001111",
  ];
  for (const [i, bit] of [...numbers[slot % numbers.length]!].entries()) {
    if (bit !== "1") continue;
    const x = -4 + (i % 3) * 2,
      y = -5 + Math.floor(i / 3) * 2;
    face(
      "#182336",
      [x, y, 33],
      [x + 2, y, 33],
      [x + 2, y + 2, 33],
      [x, y + 2, 33],
    );
  }
  sections(
    [
      [14, 3, 25.8],
      [20, 3, 25.8],
    ],
    24.1,
    "#233c4b",
    "#687d83",
  );
  // A pair of rally lamps on the roof and the raised bar behind the cab give the
  // truck a readable nose and tail on the small race canvas.
  for (const side of [-1, 1]) {
    face(
      "#ffeeb0",
      [4.7, side * 7, 32],
      [4.7, side * 3.6, 32],
      [4.7, side * 3.6, 34],
      [4.7, side * 7, 34],
    );
    face(
      "#d7d7b6",
      [-12, side * 9, 24],
      [-10, side * 9, 29],
      [-8.4, side * 9, 29],
      [-10.4, side * 9, 24],
    );
  }
  face("#c7dad9", [-10, -9, 29], [-8.4, -9, 29], [-8.4, 9, 29], [-10, 9, 29]);
  face(
    "#fff1b2",
    [11, -3, 24.3],
    [22, -3, 24.3],
    [27, -2, 21.6],
    [27, 1, 21.6],
    [11, 1, 24.3],
  );
  for (const s of [-1, 1]) {
    face(
      "#fff6ce",
      [28.1, s * 9, 18.5],
      [28.1, s * 5, 18.5],
      [28.1, s * 5, 21],
      [28.1, s * 9, 21],
    );
    face(
      "#ff4145",
      [-28.1, s * 10, 18],
      [-28.1, s * 8, 18],
      [-28.1, s * 8, 21],
      [-28.1, s * 10, 21],
    );
  }
  for (const axle of [-18, 18])
    for (const side of [-1, 1]) {
      const segments = 16;
      const ring = (i: number, offset: number, r: number): Vertex => {
        const a = (i * 2 * Math.PI) / segments;
        return [axle + r * Math.cos(a), side * offset, 10 + r * Math.sin(a)];
      };
      for (let i = 0; i < segments; i++) {
        const tread = i % 2 === 0 ? "#43505b" : "#161e2a";
        face(
          tread,
          ring(i, 7, 10),
          ring(i + 1, 7, 10),
          ring(i + 1, 18, 10),
          ring(i, 18, 10),
        );
        face(
          "#141c27",
          ring(i, 18, 10),
          ring(i + 1, 18, 10),
          ring(i + 1, 18.6, 5.4),
          ring(i, 18.6, 5.4),
        );
        face(
          i % 2 === 0 ? "#b3c7c9" : "#647987",
          ring(i, 18.6, 5.4),
          ring(i + 1, 18.6, 5.4),
          [axle, side * 19, 10],
        );
      }
    }
  for (let i = 0; i < HEADINGS; i++) {
    const a = (i * 2 * Math.PI) / HEADINGS,
      c = Math.cos(a),
      s = Math.sin(a);
    const x = (i % 8) * CELL,
      y = Math.floor(i / 8) * CELL;
    const projected = faces
      .map((f) => {
        let depth = 0;
        const points = f.points.map(([u, v, z]) => {
          const d = u * s + v * c;
          depth += d * 0.84 + z * 0.54;
          return [
            x + 48 + u * c - v * s,
            y + 53 + d * 0.54 - z * 0.84,
          ] as const;
        });
        return { points, paint: f.paint, depth: depth / f.points.length };
      })
      .sort((a, b) => a.depth - b.depth);
    for (const { points, paint } of projected) {
      ctx.beginPath();
      points.forEach(([x, y], j) =>
        j === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y),
      );
      ctx.closePath();
      ctx.fillStyle = paint;
      ctx.fill();
      ctx.strokeStyle = paint;
      ctx.lineWidth = 0.55;
      ctx.stroke();
    }
    texture.add(i, 0, x, y, CELL, CELL);
  }
  texture.refresh();
  return key;
}
