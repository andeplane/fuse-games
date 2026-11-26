import { spriteRanges } from "./sprite-ranges.js";

export interface SpriteFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const atlasUrl = new URL("./sprites.png", import.meta.url).href;

const frames = new Map<number, SpriteFrame>();
for (const [first, last, left, y, width, height] of spriteRanges) {
  for (let id = first; id <= last; id++) {
    frames.set(id, { x: left + (id - first) * width, y, width, height });
  }
}

/** Atlas cells retain the transparent space inside each source sprite rectangle. */
export function spriteFrame(resourceId: number): SpriteFrame | undefined {
  return frames.get(resourceId);
}

/** World 0 is Surfaceville, 11 is Trollsville. Images include the original HUD backing. */
export function backgroundUrl(world: number): string {
  if (!Number.isInteger(world) || world < 0 || world > 11) {
    throw new RangeError("Fuseheads world index must be 0 through 11");
  }
  return new URL(`./worlds/${world}.png`, import.meta.url).href;
}
