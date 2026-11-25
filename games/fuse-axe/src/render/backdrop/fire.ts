import { VIEW_W } from "../../engine/view-kit.js";
import { hash, type Brush } from "./kit.js";

/** A fire's left column, width, base row, maximum height, and seed. */
export type Fire = readonly [
  x: number,
  width: number,
  base: number,
  height: number,
  seed: number,
];

const SHELTERED = {
  height: 0.55,
  lick: 0.3,
  lickRate: 11,
  sway: 0.2,
  swayRate: 7,
  embers: 3,
  emberRate: 0.3,
  flutter: 3,
  flutterRate: 7,
  drift: 0,
  rise: 30,
  top: -Infinity,
};

/** Wind drives embers up and across the exposed pass. */
export const WINDBLOWN: typeof SHELTERED = {
  height: 0.6,
  lick: 0.25,
  lickRate: 9,
  sway: 0.18,
  swayRate: 6,
  embers: 4,
  emberRate: 0.4,
  flutter: 2,
  flutterRate: 9,
  drift: 10,
  rise: 34,
  top: 0,
};

interface FlameStyle {
  palette: readonly [string, string, string, string];
  ramp?: readonly [vertical: number, edge: number];
}

interface FireStyle {
  palette: FlameStyle["palette"];
  motion?: typeof SHELTERED;
}

interface FlameColumn {
  x: number;
  base: number;
  height: number;
  envelope: number;
}

export interface FireFrame {
  brush: Brush;
  camera: number;
  time: number;
}

const FLAME_RAMP = [3.2, 1.6] as const;

const toneAt = (
  row: number,
  height: number,
  vertical: number,
  edgeShade: number,
) => Math.min(3, Math.floor((row / height) * vertical + edgeShade));

/** Paint a column upward from its base, grouping neighboring rows of the same tone. */
export function drawFlameColumn(
  brush: Brush,
  { x, base, height, envelope }: FlameColumn,
  { palette, ramp = FLAME_RAMP }: FlameStyle,
): void {
  const [vertical, edge] = ramp;
  const edgeShade = (1 - envelope) * edge;
  for (let row = 0; row < height;) {
    const tone = toneAt(row, height, vertical, edgeShade);
    let end = row + 1;
    while (end < height && toneAt(end, height, vertical, edgeShade) === tone)
      end++;
    brush.fillStyle = palette[tone]!;
    brush.fillRect(x, base - end + 1, 1, end - row);
    row = end;
  }
}

/** A repeatable ember's age as a fraction of its current trip. */
export function emberLife(
  {
    time,
    rate,
    variance = rate,
  }: { time: number; rate: number; variance?: number },
  index: number,
  seed: number,
): number {
  return (
    (time * (rate + hash(index, seed) * variance) + hash(index, seed + 1)) % 1
  );
}

/** Draw flames and their embers at a whole-pixel camera offset, in mount order. */
export function drawFires(
  brush: Brush,
  fires: readonly Fire[],
  camera: number,
  time: number,
  { palette, motion = SHELTERED }: FireStyle,
): void {
  const style = { palette, motion };
  const frame = { brush, camera, time };
  for (const fire of fires) {
    const [left, width] = fire;
    if (left + width + 16 < camera || left - 16 >= camera + VIEW_W) continue;
    drawFlame(frame, fire, style);
    drawEmbers(frame, fire, style);
  }
}

function drawFlame(
  { brush, camera, time }: FireFrame,
  [left, width, base, height, seed]: Fire,
  style: Required<FireStyle>,
): void {
  const { motion } = style;
  for (let i = 0; i < width; i++) {
    const column = left + i;
    const x = column - camera;
    if (x < 0 || x >= VIEW_W) continue;
    const envelope = Math.sin((Math.PI * (i + 0.5)) / width);
    const lick =
      motion.lick * Math.sin(column * 0.9 + seed + time * motion.lickRate);
    const sway =
      motion.sway * Math.sin(column * 0.37 + seed * 2 - time * motion.swayRate);
    const tip = Math.max(
      1,
      Math.round(height * envelope * (motion.height + lick + sway)),
    );
    drawFlameColumn(brush, { x, base, height: tip, envelope }, style);
  }
}

function drawEmbers(
  { brush, camera, time }: FireFrame,
  [left, width, base, height, seed]: Fire,
  { palette, motion }: Required<FireStyle>,
): void {
  const clock = { time, rate: motion.emberRate };
  for (let i = 0; i < motion.embers; i++) {
    const life = emberLife(clock, i, seed);
    const drift =
      (hash(i, seed + 2) - 0.5) * width +
      Math.sin(life * motion.flutterRate + i) * motion.flutter;
    const x =
      Math.round(left + width / 2 + drift + life * motion.drift) - camera;
    const y = Math.round(base - height * 0.6 - life * motion.rise);
    if (y < motion.top || x < 0 || x >= VIEW_W) continue;
    brush.fillStyle = palette[1 + Math.min(2, Math.floor(life * 3))]!;
    brush.fillRect(x, y, 1, 1);
  }
}
