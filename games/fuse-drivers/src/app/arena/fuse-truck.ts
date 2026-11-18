import type Phaser from "phaser";

/** Slot liveries are shared by the trucks, timing tower and local-driver indicators. */
export const STADIUM_LIVERIES = [
  "#29f5dc",
  "#ff60a1",
  "#b2f750",
  "#ffa454",
  "#bb86ff",
] as const;

/** An overhead desert racer: treaded spare, open bed, half cage, flared wheel pods and
 * a light bar at the nose. Each small part is sized to survive the TV downsample. */
export function fuseTruckTexture(scene: Phaser.Scene, slot: number): string {
  const key = `fd-fuse-truck-${slot}`;
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.createCanvas(key, 64, 80);
  if (!texture) throw new Error("Could not create the Fuse truck livery");
  const ctx = texture.getContext();
  const color = STADIUM_LIVERIES[slot % STADIUM_LIVERIES.length]!;
  const rect = (x: number, y: number, w: number, h: number, fill: string) => {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
  };
  const shell = (points: readonly number[], fill: string) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(points[0]!, points[1]!);
    for (let i = 2; i < points.length; i += 2)
      ctx.lineTo(points[i]!, points[i + 1]!);
    ctx.closePath();
    ctx.fill();
  };
  for (const x of [5, 48])
    for (const y of [10, 52]) {
      rect(x, y, 11, 20, "#0b121c");
      for (let t = 2; t < 19; t += 4) rect(x + 1, y + t, 9, 2, "#415065");
    }
  shell(
    [
      16, 7, 23, 4, 41, 4, 48, 7, 48, 19, 52, 29, 52, 49, 48, 55, 49, 71, 44,
      76, 19, 76, 15, 72, 16, 54, 12, 48, 12, 29, 16, 20,
    ],
    "#101a27",
  );
  shell(
    [
      17, 9, 24, 6, 40, 6, 47, 9, 47, 20, 50, 29, 47, 50, 46, 72, 18, 72, 18,
      50, 14, 47, 14, 29, 17, 20,
    ],
    color,
  );
  shell(
    [20, 11, 25, 8, 39, 8, 44, 11, 44, 22, 40, 24, 23, 24, 20, 21],
    "#304559",
  );
  rect(22, 9, 20, 3, "#fff5cc");
  rect(30, 13, 4, 10, color);
  shell([14, 28, 21, 21, 43, 21, 50, 28, 47, 43, 17, 43], "#162b42");
  shell([20, 28, 24, 24, 41, 24, 46, 28, 44, 31, 21, 31], "#9ccbd7");
  shell([20, 33, 44, 33, 42, 46, 21, 46], color);
  rect(21, 33, 22, 2, "#e6ffff");
  ctx.fillStyle = "#122039";
  ctx.font = "bold 13px monospace";
  ctx.textAlign = "center";
  ctx.fillText(String(slot + 1), 32, 45);
  shell([20, 48, 44, 48, 43, 68, 21, 68], "#1c2837");
  for (const x of [20, 41]) rect(x, 48, 2, 20, "#8f9ba5");
  ctx.fillStyle = "#080f1c";
  ctx.beginPath();
  ctx.arc(32, 58, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#526277";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#a1abac";
  ctx.beginPath();
  ctx.arc(32, 58, 3, 0, Math.PI * 2);
  ctx.fill();
  rect(17, 69, 9, 3, "#ff5e65");
  rect(38, 69, 9, 3, "#ff5e65");
  rect(25, 72, 14, 2, "#aab8bb");
  texture.refresh();
  return key;
}
