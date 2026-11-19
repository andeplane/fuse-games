import type { SpritePaint } from "./sprite-raster.js";

export type Sprites = Readonly<Record<string, string>>;

export const escaped = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function image(
  sprites: Sprites,
  name: string,
  x: number,
  y: number,
  size: number,
  paint?: { key: SpritePaint; filter: string },
): string {
  const url = sprites[`${name}-v2`] ?? sprites[name];
  return url
    ? `<image href="${escaped(url)}" data-sprite="${escaped(name)}"${paint ? ` data-sprite-paint="${paint.key}" data-sprite-filter="${paint.filter}"` : ""} x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}" pointer-events="none"/>`
    : "";
}
