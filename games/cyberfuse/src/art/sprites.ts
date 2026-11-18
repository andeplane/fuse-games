import * as layout from "./layout";

export interface ActorPose {
  /** North, northeast, east, southeast, south, southwest, west, northwest. */
  dir: number;
  /** Idle, look left, look right, four walking poses, fire, recoil. */
  state?: number;
  face?: number;
  /** No equipment (-1), blaster (0) or blade (1). */
  gun?: number;
  /** One-based collapse frame. Zero is alive. */
  death?: number;
  /** CSS colour of the operative's illuminated suit inlays. */
  team?: string;
}

type Ctx = CanvasRenderingContext2D;
type Effect = keyof typeof layout.effects;
type CanvasFactory = () => HTMLCanvasElement;

const RESOLUTION = 4;
const WALL_VARIANTS = [0, 4, 1, 7, 3, 13, 5, 9, 2, 8, 14, 12, 6, 10, 11, 15];

/** Connected wall neighbours encoded as north=1, east=2, south=4, west=8. */
export function wallVariant(mask: number): number {
  return WALL_VARIANTS[mask & 15]!;
}

function index(value: number, count: number): number {
  const i = Number.isFinite(value) ? Math.trunc(value) : 0;
  return ((i % count) + count) % count;
}

export class CyberfuseArt {
  private readonly uniforms = new Map<string, Map<number, HTMLCanvasElement>>();

  constructor(
    private readonly atlas: CanvasImageSource,
    private readonly canvasFactory: CanvasFactory,
  ) {}

  private blit(ctx: Ctx, frame: number[], x: number, y: number, scale: number) {
    const [sx, sy, w, h] = frame as [number, number, number, number];
    ctx.drawImage(
      this.atlas,
      sx,
      sy,
      w * RESOLUTION,
      h * RESOLUTION,
      x,
      y,
      w * scale,
      h * scale,
    );
  }

  /** Raw graphic anchored at the upper left, sized in DOS world pixels. */
  drawSprite(ctx: Ctx, id: number, x: number, y: number, scale = 1) {
    const frame = layout.frames[id];
    if (frame) this.blit(ctx, frame, x, y, scale);
  }

  glyph(ctx: Ctx, code: number, x: number, y: number, scale = 1) {
    const frame = layout.glyphFrames[code];
    if (frame) this.blit(ctx, frame, x, y, scale);
  }

  floor(ctx: Ctx, x: number, y: number, style = 0, variant = 1, scale = 1) {
    const row = layout.floor[index(style, layout.floor.length)]!;
    this.drawSprite(ctx, row[index(variant, row.length)]!, x, y, scale);
  }

  room(ctx: Ctx, x: number, y: number, style = 0, variant = 1, scale = 1) {
    const row = layout.room[index(style, layout.room.length)]!;
    this.drawSprite(ctx, row[index(variant, row.length)]!, x, y, scale);
  }

  wall(ctx: Ctx, x: number, y: number, style = 0, variant = 0, scale = 1) {
    const row = layout.wall[index(style, layout.wall.length)]!;
    this.drawSprite(
      ctx,
      row[index(variant, row.length)]!,
      x,
      y - 12 * scale,
      scale,
    );
  }

  private anchored(
    ctx: Ctx,
    entry: number[],
    x: number,
    y: number,
    scale: number,
  ) {
    const [dx, dy, id] = entry as [number, number, number];
    this.drawSprite(ctx, id, x + dx * scale, y + dy * scale, scale);
  }

  offset(ctx: Ctx, id: number, x: number, y: number, scale = 1) {
    const entry = layout.offsets[id];
    if (entry) this.anchored(ctx, entry, x, y, scale);
  }

  prop(ctx: Ctx, name: string, x: number, y: number, scale = 1) {
    const props: Readonly<Record<string, number[]>> = layout.props;
    if (Object.hasOwn(props, name))
      this.anchored(ctx, props[name]!, x, y, scale);
  }

  effect(
    ctx: Ctx,
    kind: Effect,
    frame: number,
    x: number,
    y: number,
    scale = 1,
  ) {
    const cycle = layout.effects[kind];
    this.anchored(ctx, cycle[index(frame, cycle.length)]!, x, y, scale);
  }

  // The same materials appear across every gait. Dielectric shoulder and chest
  // panels absorb team colour; their shadows, edge light and visor stay legible.
  private uniform(id: number, color: string) {
    let parts = this.uniforms.get(color);
    if (!parts) {
      if (this.uniforms.size >= 16) this.uniforms.clear();
      parts = new Map();
      this.uniforms.set(color, parts);
    }
    const cached = parts.get(id);
    if (cached) return cached;
    const [sx, sy, w, h] = layout.frames[id]! as [
      number,
      number,
      number,
      number,
    ];
    const canvas = this.canvasFactory();
    canvas.width = w * RESOLUTION;
    canvas.height = h * RESOLUTION;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const target = ctx.getImageData(0, 0, 1, 1).data;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
      this.atlas,
      sx,
      sy,
      canvas.width,
      canvas.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = pixels.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === 41 && data[i + 1] === 186 && data[i + 2] === 169) {
        data[i] = target[0]!;
        data[i + 1] = target[1]!;
        data[i + 2] = target[2]!;
      } else if (data[i] === 87 && data[i + 1] === 116 && data[i + 2] === 140) {
        for (let channel = 0; channel < 3; channel++) {
          data[i + channel] =
            data[i + channel]! * 0.35 + target[channel]! * 0.65;
        }
      } else if (data[i] === 51 && data[i + 1] === 75 && data[i + 2] === 99) {
        for (let channel = 0; channel < 3; channel++) {
          data[i + channel] =
            data[i + channel]! * 0.55 + target[channel]! * 0.23;
        }
      }
    }
    ctx.putImageData(pixels, 0, 0);
    parts.set(id, canvas);
    return canvas;
  }

  /** Draw from the actor's ground contact point, using the original directional layer ordering. */
  drawActor(ctx: Ctx, x: number, y: number, pose: ActorPose, scale = 1) {
    if (pose.death && pose.death > 0) {
      const cell = layout.death[Math.trunc(pose.death) - 1];
      if (cell) this.anchored(ctx, cell, x, y, scale);
      return;
    }
    const dir = index(pose.dir, 8);
    const state = index(pose.state ?? 0, 9);
    const gun = pose.gun ?? 0;
    const body = gun < 0 ? 0 : 1;
    const face = index(pose.face ?? 0, layout.head.length);
    const gaze = index(dir + (state === 1 ? -1 : state === 2 ? 1 : 0), 8);
    const bodyId = layout.body[body]![dir]![state]!;
    const bodyOffset = layout.bodyOffset[body]![dir]!;
    const faceOffset = layout.headOffset[face]![gaze]!;
    const neck = layout.neck[body]![dir]!;
    const hand = layout.hand[body]![dir]!;

    const drawBody = () => {
      const left = x + bodyOffset[0]! * scale;
      const top = y + bodyOffset[1]! * scale;
      const tinted = pose.team ? this.uniform(bodyId, pose.team) : null;
      if (tinted)
        ctx.drawImage(
          tinted,
          left,
          top,
          (tinted.width / RESOLUTION) * scale,
          (tinted.height / RESOLUTION) * scale,
        );
      else this.drawSprite(ctx, bodyId, left, top, scale);
    };
    const drawHead = () =>
      this.drawSprite(
        ctx,
        layout.head[face]![gaze]![state >= 7 ? 1 : 0]!,
        x + (neck[0]! + faceOffset[0]!) * scale,
        y + (neck[1]! + faceOffset[1]!) * scale,
        scale,
      );
    const drawGun = () => {
      if (gun < 0) return;
      const cell =
        layout.gun[index(gun, layout.gun.length)]![dir]![
          state === 7 ? 1 : state === 8 ? 2 : 0
        ]!;
      this.anchored(
        ctx,
        cell,
        x + hand[0]! * scale,
        y + hand[1]! * scale,
        scale,
      );
    };

    if (dir <= 1) {
      drawGun();
      drawHead();
      drawBody();
    } else if (dir <= 5) {
      drawBody();
      drawHead();
      drawGun();
    } else {
      drawGun();
      drawBody();
      drawHead();
    }
  }
}

export async function loadCyberArt(): Promise<CyberfuseArt> {
  const image = new Image();
  image.src = new URL("./cyberfuse-atlas.png", import.meta.url).href;
  await image.decode();
  return new CyberfuseArt(image, () => document.createElement("canvas"));
}
