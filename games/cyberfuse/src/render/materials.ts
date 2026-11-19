import type { CyberfuseArt } from "../art/sprites.js";

// The DOS mission indices are nine hue families with three values apiece.
// The new artwork retains its material highlights and takes its midtones from that mission.
const HUES = [
  [195, 94, 81],
  [96, 164, 112],
  [82, 133, 202],
  [162, 107, 185],
  [147, 157, 162],
  [109, 145, 165],
  [191, 172, 105],
  [164, 130, 98],
  [89, 172, 172],
] as const;
export type Surface = "wall" | "room" | "floor";

/** A palette affects a sprite's opaque pixels only. Cache the small recoloured 4× tile
 * so the normal draw is one blit, including on phones. */
export class Materials {
  private cache = new Map<string, HTMLCanvasElement>();
  constructor(private readonly document: Document) {}

  draw(
    ctx: CanvasRenderingContext2D,
    art: CyberfuseArt,
    surface: Surface,
    x: number,
    y: number,
    style: number,
    variant: number,
    range: number,
  ) {
    const key = [surface, style, variant, range].join("/");
    let picture = this.cache.get(key);
    const wall = surface === "wall";
    const height = wall ? 24 : 12;
    if (!picture) {
      picture = this.document.createElement("canvas");
      picture.width = 64;
      picture.height = height * 4;
      const ink = picture.getContext("2d", { willReadFrequently: true })!;
      ink.scale(4, 4);
      art[surface](ink, 0, wall ? 12 : 0, style, variant);
      const family = Math.abs(range) % 27;
      const color = HUES[Math.floor(family / 3)]!;
      const value = 1 - (family % 3) * 0.11;
      const pixels = ink.getImageData(0, 0, 64, picture.height);
      const data = pixels.data;
      for (let i = 0; i < data.length; i += 4) {
        if (!data[i + 3]) continue;
        const lum = data[i]! * 0.25 + data[i + 1]! * 0.57 + data[i + 2]! * 0.18;
        // Deep joint shadows and cyan/amber fixture highlights retain the painter's values.
        const mix =
          0.62 *
          Math.min(1, lum / 35) *
          Math.min(1, Math.max(0, (178 - lum) / 65));
        for (let c = 0; c < 3; c++) {
          const graded = lum * (color[c]! / 142) * value;
          data[i + c] = data[i + c]! * (1 - mix) + graded * mix;
        }
      }
      ink.putImageData(pixels, 0, 0);
      if (this.cache.size >= 384) this.cache.clear();
      this.cache.set(key, picture);
    }
    ctx.drawImage(picture, x, wall ? y - 12 : y, 16, height);
  }
}
