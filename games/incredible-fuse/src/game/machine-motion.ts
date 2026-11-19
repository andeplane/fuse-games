import type { Part, PartKind } from "./machine-parts.js";

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

/** Motion is expressed in the original 1/512-pixel lattice per simulation tick. */
export const UNIT = 512;
export const quant = (n: number) => Math.round(n * UNIT) / UNIT;
export const clampVelocity = (n: number, maximum: number) =>
  quant(Math.max(-maximum, Math.min(maximum, n)));
export interface Material {
  bounce: number;
  mass: number;
}
const materials: Partial<Record<PartKind, Material>> = {
  bowling: { bounce: 128, mass: 16 },
  basketball: { bounce: 192, mass: 4 },
  baseball: { bounce: 128, mass: 3 },
  tennis: { bounce: 192, mass: 1 },
  balloon: { bounce: 24, mass: 1 },
  heart: { bounce: 24, mass: 1 },
  ball: { bounce: 128, mass: 4 },
  crate: { bounce: 0, mass: 8 },
  pumpkin: { bounce: 36, mass: 6 },
  mouse: { bounce: 0, mass: 1 },
  cat: { bounce: 0, mass: 4 },
  rocket: { bounce: 0, mass: 1 },
};
const looseMaterial: Material = { bounce: 32, mass: 3 };
export const isDynamic = (part: Part) =>
  part.mobile ?? Object.hasOwn(materials, part.kind);
export function bodyKind(part: Part): PartKind {
  return part.kind === "popper" ? "tennis" : part.kind;
}
export const bodyMass = (part: Part) =>
  (materials[bodyKind(part)] ?? looseMaterial).mass;

export const materialOf = (kind: PartKind): Material =>
  materials[kind] ?? looseMaterial;
