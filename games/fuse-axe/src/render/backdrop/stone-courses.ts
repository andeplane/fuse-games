import type { Raster } from "./kit.js";

interface CourseLayout {
  top: number;
  bottom: number;
  firstHeight: number;
}

export interface StoneCourse {
  index: number;
  top: number;
  bottom: number;
}

export interface StoneSpan {
  left: number;
  width: number;
}

/** Perspective rows of paving, each a pixel deeper than the last. */
export function* stoneCourses({
  top,
  bottom,
  firstHeight,
}: CourseLayout): Generator<StoneCourse> {
  for (let index = 0, start = top; start < bottom; index++) {
    const end = Math.min(start + firstHeight + index, bottom);
    yield { index, top: start, bottom: end };
    start = end;
  }
}
/** Clip the visible part of a stone while leaving its original coordinates to the shader. */
export function paintStone(
  raster: Raster,
  { top, bottom }: StoneCourse,
  { left, width }: StoneSpan,
  shade: (x: number, y: number) => number,
): void {
  const start = Math.max(left, 0);
  const end = Math.min(left + width, raster.width);
  for (let y = top; y < bottom; y++)
    for (let x = start; x < end; x++) raster.px(x, y, shade(x, y));
}
