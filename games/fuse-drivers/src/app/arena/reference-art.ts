import type Phaser from "phaser";
import {
  projectOffroad,
  OFFROAD_COURSE_NAMES,
} from "../../game/offroad/course.js";
import { config, TICK_RATE } from "../../game/sim/config.js";
import type { ArenaFrame } from "./frame.js";

interface Sprite<T> {
  x: number;
  y: number;
  width: number;
  pixels: T;
}

interface ReferencePack {
  version: number;
  palette: number[];
  poses: number[][];
  clipHeights: number[];
  tracks: { pixels: string; mask: string; counter: number }[];
  trucks: Sprite<string>[];
  shadows: Sprite<string>[];
}

const WIDTH = 320,
  HEIGHT = 200;
const SCALE_X = config.world.width / WIDTH;
const SCALE_Y = (config.world.height - 4) / HEIGHT;
const bytes = (source: string) =>
  Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
const sprite = (s: Sprite<string>): Sprite<Uint8Array> => ({
  ...s,
  pixels: bytes(s.pixels),
});

/** The DOS driver quantizes the signed difference of two pairs of half-height wheels into five poses. */
export function poseAxis(difference: number): number {
  const signedHigh = (((difference >> 8) + 10) << 24) >> 24;
  return Math.min(16, Math.max(0, signedHigh)) >> 2;
}

export interface ReferenceArt {
  paint(frame: ArenaFrame): void;
}

/** Only the separate loopback development launcher supplies this optional, client-local artwork. */
export function createReferenceArt(
  scene: Phaser.Scene,
  pack: ReferencePack,
): ReferenceArt {
  if (
    pack.version !== 1 ||
    pack.tracks.length !== 8 ||
    pack.trucks.length !== 412 ||
    pack.shadows.length !== 32 ||
    pack.palette.length !== 48
  )
    throw new Error("Unrecognized local off-road art pack");
  const texture = scene.textures.createCanvas(
    "fd-local-reference",
    WIDTH,
    HEIGHT,
  );
  if (!texture) throw new Error("Could not initialize local off-road art");
  scene.game.canvas.style.imageRendering = "pixelated";
  texture.setFilter(1); // NEAREST, including at fractional viewport zoom.
  scene.add
    .image(0, 0, texture.key)
    .setOrigin(0)
    .setScale(SCALE_X, SCALE_Y)
    .setDepth(1);
  const context = texture.getContext();
  const bitmap = context.createImageData(WIDTH, HEIGHT);
  const colors = new Uint32Array(17);
  const rgba = new Uint8ClampedArray(colors.buffer);
  for (let i = 0; i < colors.length; i++) {
    // The four DOS paint schemes are preserved. A fifth Fuse seat gets a violet body.
    rgba.set(
      i === 16 ? [178, 87, 226] : pack.palette.slice(3 * i, 3 * i + 3),
      4 * i,
    );
    rgba[4 * i + 3] = 255;
  }
  const trucks = pack.trucks.map(sprite);
  const shadows = pack.shadows.map(sprite);
  const tracks = pack.tracks.map((t) => ({
    pixels: bytes(t.pixels),
    mask: bytes(t.mask),
    counter: t.counter,
  }));
  const indexed = new Uint8Array(WIDTH * HEIGHT);
  const output = new Uint32Array(bitmap.data.buffer);
  const paintMaps = [4, 8, 12, 8, 0].map((plane, slot) =>
    Array.from({ length: 8 }, (_, raw) => {
      let c = 15 ^ (raw & 3) ^ (raw & 4 ? plane : 0);
      if (slot === 3 && raw & 4) c &= ~2;
      return slot === 4 && raw & 4 ? 16 : c;
    }),
  );
  function stamp(
    s: Sprite<Uint8Array>,
    x: number,
    y: number,
    mask: Uint8Array | undefined,
    paint: number[] | undefined,
  ) {
    const left = x + s.x,
      top = y + s.y;
    for (let i = 0; i < s.pixels.length; i++) {
      const raw = s.pixels[i]!;
      if (!raw) continue;
      const px = left + (i % s.width),
        py = top + Math.floor(i / s.width);
      if (px < 0 || py < 0 || px >= WIDTH || py >= HEIGHT) continue;
      const offset = py * WIDTH + px;
      if (mask && !(mask[offset >> 3]! & (128 >> (offset & 7)))) continue;
      // Shadows set plane zero in the destination. The original pixel underneath supplies its color.
      indexed[offset] = paint
        ? paint[raw]!
        : indexed[offset]! === 16
          ? 16
          : indexed[offset]! | 1;
    }
  }
  // Tiny numerals keep the four counters legible inside the painted one-screen stadium.
  const digits = [
    "75557",
    "26227",
    "71747",
    "71717",
    "55711",
    "74717",
    "74757",
    "71111",
    "75757",
    "75717",
  ];
  function number(text: string, centerX: number, top: number) {
    const x = centerX - Math.floor((text.length * 4 - 1) / 2);
    for (const [i, c] of Array.from(text).entries()) {
      const rows = digits[Number(c)] ?? "00002";
      for (let y = 0; y < 5; y++)
        for (let dx = 0; dx < 3; dx++) {
          if (Number(rows[y]) & (4 >> dx))
            indexed[(top + y) * WIDTH + x + 4 * i + dx] = 12;
        }
    }
  }
  return {
    paint(frame) {
      const { race, track, poses } = frame;
      const id = OFFROAD_COURSE_NAMES.indexOf(track.name) % 8;
      const course = tracks[id];
      if (!course)
        throw new Error(`Missing local reference course ${track.name}`);
      indexed.set(course.pixels);
      const order = race.trucks
        .map((truck, slot) => ({ truck, slot }))
        .sort((a, b) => a.truck.motion.y - b.truck.motion.y);
      for (const { truck, slot } of order) {
        const p = poses[slot];
        if (!p) continue;
        const { bodyHeight, groundHeight, wheels } = truck.suspension;
        const [a, b, c, d] = wheels;
        const row = poseAxis(
          (b.height >>> 1) +
            (c.height >>> 1) -
            (a.height >>> 1) -
            (d.height >>> 1),
        );
        const col = poseAxis(
          (b.height >>> 1) +
            (d.height >>> 1) -
            (a.height >>> 1) -
            (c.height >>> 1),
        );
        const angle = (-(truck.motion.heading >>> 8) & 255) >>> 3;
        const index = pack.poses[row * 5 + col]![angle]!;
        const ground = projectOffroad(
          track.name,
          truck.motion.x,
          truck.motion.y,
          groundHeight,
        );
        const sx = Math.floor((p.x + ground.x - truck.x) / SCALE_X);
        const sy = Math.floor((p.y + ground.y - truck.y) / SCALE_Y);
        stamp(shadows[angle]!, sx - 17, sy - 12, course.mask, undefined);
        const clip = bodyHeight - groundHeight < pack.clipHeights[id]!;
        stamp(
          trucks[index]!,
          Math.floor(p.x / SCALE_X) - 15,
          Math.floor(p.y / SCALE_Y) - 14,
          clip ? course.mask : undefined,
          paintMaps[slot % paintMaps.length]!,
        );
      }
      const left = course.counter % WIDTH;
      const top = Math.floor(course.counter / WIDTH);
      for (const [i, truck] of race.trucks.slice(0, 4).entries()) {
        number(
          String(Math.min(config.laps, truck.laps + 1)),
          left + 5 + 12 * i,
          top + 1,
        );
        number(String(truck.motion.nitros), left + 5 + 12 * i, top + 11);
      }
      number(
        (Math.max(0, race.tick - race.countdownEndTick) / TICK_RATE).toFixed(1),
        left + 15,
        top - 9,
      );
      for (let i = 0; i < output.length; i++) output[i] = colors[indexed[i]!]!;
      context.putImageData(bitmap, 0, 0);
      texture.refresh();
    },
  };
}
