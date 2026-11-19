import type { Shot } from "../sim/index.js";

/** Composite the whole gas field once. Overlapping particles build up colour inside this
 * layer, while its final opacity always leaves the floor and its markings readable. */
export class Vapor {
  private readonly layer: HTMLCanvasElement;
  private readonly poison: HTMLCanvasElement;
  private readonly confusion: HTMLCanvasElement;

  constructor(document: Document) {
    this.layer = document.createElement("canvas");
    this.poison = makeWisp(document, "154,209,102");
    this.confusion = makeWisp(document, "183,149,224");
  }

  draw(ctx: CanvasRenderingContext2D, shots: readonly Shot[]): void {
    if (!shots.length) return;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const shot of shots) {
      x0 = Math.min(x0, shot.x);
      x1 = Math.max(x1, shot.x);
      y0 = Math.min(y0, shot.y);
      y1 = Math.max(y1, shot.y);
    }
    const left = Math.floor(x0) - 18;
    const top = Math.floor(y0) - 20;
    const width = Math.ceil(x1) + 18 - left;
    const height = Math.ceil(y1) + 12 - top;
    // Allocate in blocks so a travelling cloud does not reallocate its layer each frame.
    if (this.layer.width < width * 2)
      this.layer.width = Math.ceil(width / 16) * 32;
    if (this.layer.height < height * 2)
      this.layer.height = Math.ceil(height / 16) * 32;
    const ink = this.layer.getContext("2d")!;
    ink.setTransform(2, 0, 0, 2, 0, 0);
    ink.clearRect(0, 0, width, height);
    for (const shot of shots) {
      const age = Math.max(0, shot.age);
      const t = (age + shot.frame * 9) / 24;
      const growth = 0.7 + Math.min(1, age / 17) * 0.3;
      const w = (17 + 3 * Math.sin(t)) * growth;
      const h = (10 + 2 * Math.cos(t)) * growth;
      const x = shot.x - left + Math.sin(t + shot.frame) * 1.5;
      const y = shot.y - top - Math.min(4, age * 0.06);
      const fade = Math.min(1, Math.max(0, shot.range - age) / 9);
      ink.globalAlpha = fade;
      ink.drawImage(
        shot.special === "confuse" ? this.confusion : this.poison,
        x - w / 2,
        y - h / 2,
        w,
        h,
      );
    }
    ink.globalAlpha = 1;
    ctx.save();
    ctx.globalAlpha = 0.43;
    ctx.drawImage(
      this.layer,
      0,
      0,
      width * 2,
      height * 2,
      left,
      top,
      width,
      height,
    );
    ctx.restore();
  }
}

function makeWisp(document: Document, rgb: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 56;
  const ctx = canvas.getContext("2d")!;
  // Separate tendrils with feathered edges leave openings within each cloud.
  for (const [x, y, rx, ry] of [
    [24, 33, 24, 13],
    [48, 23, 28, 17],
    [73, 20, 22, 10],
    [63, 37, 23, 10],
  ]) {
    ctx.save();
    ctx.translate(x!, y!);
    ctx.scale(rx!, ry!);
    const falloff = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    falloff.addColorStop(0, "rgba(" + rgb + ",.58)");
    falloff.addColorStop(0.48, "rgba(" + rgb + ",.34)");
    falloff.addColorStop(1, "rgba(" + rgb + ",0)");
    ctx.fillStyle = falloff;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }
  return canvas;
}
