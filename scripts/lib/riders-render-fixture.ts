import { createPhaserArena } from "../../games/fuse-riders/src/render/phaser/arena.js";

type PixelRegion = readonly [
  left: number,
  top: number,
  width: number,
  height: number,
];
const RGBA_CHANNELS = 4;

export async function mountWorldArena(
  renderer: "auto" | "canvas" = "auto",
  { clearPage = true, canvasStyle = "" } = {},
) {
  if (clearPage) {
    document.body.replaceChildren();
    document.body.style.cssText = "margin:0;background:#020715";
  }
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 900;
  if (canvasStyle) canvas.style.cssText = canvasStyle;
  document.body.append(canvas);
  const arena = createPhaserArena(canvas, { renderer, resolution: "world" });
  await arena.ready;
  return { canvas, arena };
}

/** Read a top-left rectangle in backing pixels, keeping the renderer's native row order. */
export function readArenaPixels(
  canvas: HTMLCanvasElement,
  renderer: string,
  [left, top, width, height]: PixelRegion = [0, 0, canvas.width, canvas.height],
): Uint8Array {
  if (renderer !== "webgl")
    return new Uint8Array(
      canvas.getContext("2d")!.getImageData(left, top, width, height).data,
    );
  const gl = canvas.getContext("webgl");
  if (!gl) throw new Error("Missing WebGL context");
  const pixels = new Uint8Array(width * height * RGBA_CHANNELS);
  gl.readPixels(
    left,
    canvas.height - top - height,
    width,
    height,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    pixels,
  );
  return pixels;
}

/** Find a top-left point in a full frame. WebGL reads rows from the bottom. */
export function pixelOffset(
  canvas: HTMLCanvasElement,
  renderer: string,
  x: number,
  y: number,
): number {
  const row = renderer === "webgl" ? canvas.height - 1 - y : y;
  return (row * canvas.width + x) * RGBA_CHANNELS;
}

/** Compare RGB channels in rectangles of two captured full frames. */
export function arenaRegionDifference(
  canvas: HTMLCanvasElement,
  renderer: string,
) {
  return (
    a: Uint8Array,
    b: Uint8Array,
    [left, top, width, height]: PixelRegion,
  ): number => {
    let difference = 0;
    for (let y = top; y < top + height; y++) {
      const end = pixelOffset(canvas, renderer, left + width, y);
      for (
        let i = pixelOffset(canvas, renderer, left, y);
        i < end;
        i += RGBA_CHANNELS
      ) {
        difference +=
          Math.abs(a[i]! - b[i]!) +
          Math.abs(a[i + 1]! - b[i + 1]!) +
          Math.abs(a[i + 2]! - b[i + 2]!);
      }
    }
    return difference;
  };
}
