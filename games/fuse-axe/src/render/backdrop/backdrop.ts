import { cameraEndPx, VIEW_H, VIEW_W } from "../../engine/view-kit.js";
import { pixelSurface, type MakeSurface } from "../surface.js";
import { ASHEN_VILLAGE } from "./ashen-village.js";
import { CAMP_ART } from "./camp.js";
import { DROWNED_CRYPT } from "./drowned-crypt.js";
import {
  Raster,
  type Brush,
  type LayerArt,
  type Prop,
  type StageArt,
} from "./kit.js";
import { VORHALS_KEEP } from "./vorhals-keep.js";
import { WYRMBONE_PASS } from "./wyrmbone-pass.js";

/**
 * A stage's parallax backdrop at the native 320 × 180. Each static layer is painted once into a pixel buffer and
 * copied into a surface from the renderer's one factory (`../surface.ts`), through its `putPixels` fast path when it
 * has one. A frame then blits each layer at a whole-pixel offset and paints only the fires.
 */
export interface Pen<S> extends Brush {
  drawImage(
    image: S,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void;
}

export interface Backdrop<S> {
  /**
   * Everything behind the heroes: call first each frame, with image smoothing off so the whole-pixel blits stay sharp.
   * `frame` counts 60 Hz steps and only moves the fires; the pen's `fillStyle` is left as it was found.
   */
  draw(
    pen: Pen<S>,
    camX: number,
    frame: number,
    gutterX?: number,
    gutterY?: number,
  ): void;
  /** The foreground in front of the heroes: call after them. */
  drawFront(pen: Pen<S>, camX: number, gutterX?: number): void;
  /**
   * What of it stands on the floor among the figures (camp's fire, `Prop`): draw it after those further up the floor
   * than its row `y` and before the rest. Like `draw`, it leaves the pen's `fillStyle` as it was found.
   */
  readonly prop?: Prop;
}

/** The stages with art of their own: Ashen Village's, Wyrmbone Pass's, the Drowned Crypt's and Vorhal's Keep's. */
export type StageNumber = 1 | 2 | 3 | 4;

const STAGES: Record<StageNumber, StageArt> = {
  1: ASHEN_VILLAGE,
  2: WYRMBONE_PASS,
  3: DROWNED_CRYPT,
  4: VORHALS_KEEP,
};

/** Whether `stage` has a backdrop of its own; one that has none is drawn on Stage 1's (`createScene`). */
export const hasBackdrop = (stage: number): stage is StageNumber =>
  Object.hasOwn(STAGES, stage);

interface Baked<S> {
  surface: S;
  width: number;
  rate: readonly [number, number];
  top: number;
  height: number;
}

/** A layer painted as wide as it scrolls across the stage, to the camera's furthest point `end`. */
function bake<S>(make: MakeSurface<S>, layer: LayerArt, end: number): Baked<S> {
  const [num, den] = layer.rate;
  const raster = new Raster(
    VIEW_W + Math.floor((end * num) / den),
    layer.top,
    layer.height,
  );
  layer.paint(raster);
  return {
    surface: pixelSurface(make, raster.width, raster.height, raster.rgba),
    width: raster.width,
    rate: layer.rate,
    top: layer.top,
    height: layer.height,
  };
}

function blit<S>(pen: Pen<S>, layer: Baked<S>, camX: number, gutter = 0) {
  const sx = Math.floor((camX * layer.rate[0]) / layer.rate[1]);
  const start = Math.max(0, sx - gutter),
    left = sx - start,
    right = Math.min(gutter, layer.width - sx - VIEW_W);
  if (left < gutter)
    pen.drawImage(
      layer.surface,
      0,
      0,
      1,
      layer.height,
      -gutter,
      layer.top,
      gutter - left,
      layer.height,
    );
  if (right < gutter)
    pen.drawImage(
      layer.surface,
      layer.width - 1,
      0,
      1,
      layer.height,
      VIEW_W + right,
      layer.top,
      gutter - right,
      layer.height,
    );
  pen.drawImage(
    layer.surface,
    start,
    0,
    VIEW_W + left + right,
    layer.height,
    start - sx,
    layer.top,
    VIEW_W + left + right,
    layer.height,
  );
}

/** The camera in whole pixels, held to the stage so no layer is sampled past its end. */
const camera = (camX: number, end: number) =>
  Number.isFinite(camX) ? Math.min(Math.max(Math.floor(camX), 0), end) : 0;

/** The fires' clock: a step count that is never negative or NaN, so no flame or ember gets an invalid colour. */
const clock = (frame: number) =>
  Number.isFinite(frame) ? Math.max(frame, 0) : 0;

export function createBackdrop<S>(
  make: MakeSurface<S>,
  stage: StageNumber,
): Backdrop<S> {
  if (!hasBackdrop(stage))
    throw new RangeError(`no backdrop for stage ${String(stage)}`);
  const art = STAGES[stage];
  return fromArt(make, art, art.cameraEnd ?? cameraEndPx(stage));
}

/** Camp's backdrop between stages: one screen, whose camera never moves. */
export const createCampBackdrop = <S>(make: MakeSurface<S>): Backdrop<S> =>
  fromArt(make, CAMP_ART, 0);

/** A backdrop of `art` baked for a camera that goes as far as `end`. */
function fromArt<S>(
  make: MakeSurface<S>,
  art: StageArt,
  end: number,
): Backdrop<S> {
  const back = art.back.map((layer) => bake(make, layer, end));
  const front = bake(make, art.front, end);
  const prop = art.prop;
  return {
    draw(pen, camX, frame, gutterX = 0, gutterY = 0) {
      const cam = camera(camX, end);
      const style = pen.fillStyle;
      if (gutterY) {
        pen.fillStyle = "#0b0b1b";
        pen.fillRect(-gutterX, -gutterY, VIEW_W + 2 * gutterX, gutterY);
        pen.fillStyle = "#1e151d";
        pen.fillRect(-gutterX, VIEW_H, VIEW_W + 2 * gutterX, gutterY);
      }
      for (const layer of back) blit(pen, layer, cam, gutterX);
      art.animate(pen, cam, clock(frame));
      pen.fillStyle = style;
    },
    drawFront(pen, camX, gutterX) {
      blit(pen, front, camera(camX, end), gutterX);
    },
    ...(prop && {
      prop: {
        y: prop.y,
        draw(brush, frame) {
          const style = brush.fillStyle;
          prop.draw(brush, clock(frame));
          brush.fillStyle = style;
        },
      },
    }),
  };
}
