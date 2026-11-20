import type { Rig, V3 } from "./rig.js";

const FORWARD: V3 = [Math.PI / 2, 0, 0];

export interface CannonSpec {
  readonly segments: number;
  readonly barrel: {
    readonly topRadius: number;
    readonly bottomRadius: number;
    readonly height: number;
    readonly z: number;
  };
  readonly sleeve: {
    readonly radius: number;
    readonly height: number;
    readonly z: number;
  };
  readonly muzzle: {
    readonly size: V3;
    readonly bevel: number;
    readonly z: number;
  };
}

/** Place a tapered barrel, its sleeve and its muzzle along +Z in the owning rig. */
export function mountCannon(
  rig: Rig,
  [x, y]: readonly [number, number],
  { segments, barrel, sleeve, muzzle }: CannonSpec,
): void {
  const { z: barrelZ, ...tube } = barrel;
  const { z: sleeveZ, ...collar } = sleeve;
  rig
    .add("steel", rig.cylinder({ ...tube, segments }), [x, y, barrelZ], FORWARD)
    .add("gun", rig.cylinder({ ...collar, segments }), [x, y, sleeveZ], FORWARD)
    .add("gun", rig.box(...muzzle.size, muzzle.bevel), [x, y, muzzle.z]);
}
