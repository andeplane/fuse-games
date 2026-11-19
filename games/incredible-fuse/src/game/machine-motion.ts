import type { PartKind } from "./machine-parts.js";

/** Native moving classes use the measured DOS density table. Fuse-only pieces borrow the nearest material. */
const density: Partial<Record<PartKind, number>> = {
  bowling: 2832,
  balloon: 9,
  basketball: 1322,
  cage: 7552,
  cat: 2000,
  basket: 7552,
  spark: 1132,
  baseball: 2000,
  rocket: 18000,
  mouse: 2000,
  ball: 21428,
  tennis: 1322,
  candle: 2000,
  heart: 11,
  crate: 2832,
  pumpkin: 2000,
};

/** Integer acceleration and cap, measured in 1/512 pixel per DOS simulation tick. */
export function atmosphere(kind: PartKind, air: number, gravity: number) {
  const pressure = air < 70 ? Math.floor(air / 2) : 16 * air;
  const field =
    gravity < 140
      ? Math.floor(gravity / 4) + 1
      : gravity > 278
        ? 2 * gravity
        : gravity;
  const material = density[kind] ?? 2000;
  const acceleration =
    material > pressure
      ? field - Math.floor((pressure * field) / material)
      : material < pressure
        ? Math.floor((material * field) / pressure) - field
        : 0;
  const terminal = kind === "ball" ? 12288 : 9728 - pressure;
  return { acceleration, terminal };
}
