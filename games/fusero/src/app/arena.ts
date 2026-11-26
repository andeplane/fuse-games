import type { WorldView } from "../engine/classic/codec.js";
import { WIDTH, HEIGHT } from "../engine/index.js";
import { CLASSIC_PROJECTILES } from "../engine/classic/catalog.js";
import { decodeTerrainRow } from "../engine/classic/terrain.js";
import { AIR, ROCK } from "../engine/classic/terrain-types.js";
import { faceDirection } from "../engine/classic/physics-types.js";
import { cameraFor, type Camera } from "./camera.js";

/** Native art is drawn in logical screen pixels: two of those per world pixel. */
export const NATIVE_DRAW_SCALE = Object.freeze({
  worldPixelsPerNativePixel: 0.5,
  worm: Object.freeze({ width: 10, height: 9 }),
  crosshair: Object.freeze({ distance: 16, width: 3, height: 3 }),
  pixelProjectile: Object.freeze({ width: 1, height: 1 }),
});

export interface ArenaDisplay {
  readonly wideScreen: boolean;
  viewport(): { width: number; height: number };
  touchControls(): boolean;
}

export const COLORS = ["#b6ff4d", "#16e7ff", "#ff2e9d", "#ffe46b", "#a78bfa"];
const ROCK_COLOR = [56, 80, 105] as const;
const EDGE_COLOR = [143, 87, 190] as const;
const GRAIN_COLOR = [52, 34, 72] as const;
const DIRT_COLOR = [35, 24, 49] as const;

/** Fractional presentation between runtime snapshots; this copy is never fed back into the engine. */
export function interpolateArena(
  world: WorldView,
  older: WorldView | undefined,
  fraction: number,
): WorldView {
  if (!older || older.seed !== world.seed || fraction >= 1 || fraction < 0)
    return world;
  const mix = (before: number, after: number) =>
    before + (after - before) * fraction;
  const previousProjectiles = new Map<
    number,
    WorldView["projectiles"][number]
  >();
  for (const shot of older.projectiles)
    if (shot.used) previousProjectiles.set(shot.id, shot);
  return {
    ...world,
    worms: world.worms.map((worm) => {
      const before = older.worms.find((old) => old.id === worm.id);
      if (
        !before ||
        before.alive !== worm.alive ||
        before.spawnedOnce !== worm.spawnedOnce ||
        Math.abs(before.x - worm.x) + Math.abs(before.y - worm.y) > 300
      )
        return worm;
      const rope =
        worm.rope &&
        before.rope &&
        worm.rope.state === before.rope.state &&
        worm.rope.attachedId === before.rope.attachedId
          ? {
              ...worm.rope,
              x: mix(before.rope.x, worm.rope.x),
              y: mix(before.rope.y, worm.rope.y),
            }
          : worm.rope;
      return {
        ...worm,
        x: mix(before.x, worm.x),
        y: mix(before.y, worm.y),
        rope,
      };
    }),
    projectiles: world.projectiles.map((shot) => {
      const before = previousProjectiles.get(shot.id);
      return !shot.used || !before
        ? shot
        : { ...shot, x: mix(before.x, shot.x), y: mix(before.y, shot.y) };
    }),
  };
}

/** Canvas reads source-derived state. Art never supplies collision geometry or advances the world. */
export function createArena(canvas: HTMLCanvasElement, display: ArenaDisplay) {
  const ctx = canvas.getContext("2d")!;
  const terrain = document.createElement("canvas"),
    ground = terrain.getContext("2d")!;
  let oldRows: string[] = [],
    decoded: Uint8Array[] = [];
  let camera: Camera = {
    x: 0,
    y: 0,
    width: WIDTH,
    height: HEIGHT,
    overview: true,
  };
  return {
    camera: () => ({ ...camera }),
    draw(
      world: WorldView,
      names: ReadonlyMap<string, string>,
      self: string,
      minimapTop = 0,
    ) {
      const { width, height, rows } = world.terrain;
      if (terrain.width !== width || terrain.height !== height) {
        terrain.width = width;
        terrain.height = height;
        oldRows = [];
        decoded = [];
      }
      const changed = new Set<number>();
      for (let y = 0; y < height; y++)
        if (oldRows[y] !== rows[y]) {
          decoded[y] = decodeTerrainRow(rows[y]!, width);
          changed.add(y);
          if (y > 0) changed.add(y - 1);
          if (y + 1 < height) changed.add(y + 1);
        }
      for (const y of changed) {
        const pixels = ground.createImageData(width, 1),
          row = decoded[y]!;
        for (let x = 0; x < width; x++) {
          const material = row[x];
          if (material === AIR) continue;
          const edge =
            row[x - 1] === AIR ||
            row[x + 1] === AIR ||
            decoded[y - 1]?.[x] === AIR ||
            decoded[y + 1]?.[x] === AIR;
          const color =
            material === ROCK
              ? ROCK_COLOR
              : edge
                ? EDGE_COLOR
                : (x * 7 + y * 11) % 29 < 3
                  ? GRAIN_COLOR
                  : DIRT_COLOR;
          const at = x * 4;
          pixels.data[at] = color[0]!;
          pixels.data[at + 1] = color[1]!;
          pixels.data[at + 2] = color[2]!;
          pixels.data[at + 3] = 255;
        }
        ground.putImageData(pixels, 0, y);
      }
      oldRows = rows.slice();
      camera = cameraFor(world, self, display.viewport(), {
        wideScreen: display.wideScreen,
        touchControls: display.touchControls(),
      });
      if (
        canvas.width !== camera.width * 2 ||
        canvas.height !== camera.height * 2
      ) {
        canvas.width = camera.width * 2;
        canvas.height = camera.height * 2;
      }
      canvas.dataset.camera = camera.overview ? "overview" : "follow";
      canvas.dataset.cameraX = String(camera.x);
      canvas.dataset.cameraY = String(camera.y);
      ctx.imageSmoothingEnabled = false;
      ctx.setTransform(2, 0, 0, 2, 0, 0);
      ctx.fillStyle = "#080917";
      ctx.fillRect(0, 0, camera.width, camera.height);
      ctx.save();
      ctx.translate(-camera.x, -camera.y);
      for (let i = 0; i < 300; i++) {
        ctx.fillStyle = i % 3 ? "#172238" : "#233b46";
        ctx.fillRect(
          (i * 163 + 37) % width,
          (i * 79 + 29) % height,
          2,
          i % 3 ? 2 : 5,
        );
      }
      ctx.drawImage(terrain, 0, 0);
      for (const bonus of world.bonuses) {
        ctx.fillStyle = bonus.type === "health" ? "#b6ff4d" : "#ffe46b";
        ctx.fillRect(
          Math.round(bonus.x) - 2.5,
          Math.round(bonus.y) - 2.5,
          5,
          5,
        );
        ctx.fillStyle = "#101524";
        if (bonus.type === "health") {
          ctx.fillRect(bonus.x - 0.5, bonus.y - 2, 1, 4);
          ctx.fillRect(bonus.x - 2, bonus.y - 0.5, 4, 1);
        } else ctx.fillRect(bonus.x - 1.5, bonus.y - 0.5, 3.5, 1.5);
      }
      for (const shot of world.projectiles) {
        if (!shot.used) continue;
        const descriptor = CLASSIC_PROJECTILES[shot.descriptorId];
        const sourceColor =
          descriptor?.type === "pixel" ? descriptor.colors[0] : undefined;
        ctx.fillStyle = sourceColor
          ? `rgb(${sourceColor.join(",")})`
          : COLORS[
              (world.worms.find((w) => w.id === shot.owner)?.slot ?? 0) %
                COLORS.length
            ]!;
        const size =
          descriptor?.type === "image"
            ? (descriptor.bitmap?.height ?? descriptor.width) / 2
            : NATIVE_DRAW_SCALE.pixelProjectile.width;
        ctx.fillRect(
          Math.round(shot.x) - size / 2,
          Math.round(shot.y) - size / 2,
          size,
          size,
        );
        if (descriptor?.type === "image") {
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(shot.x, shot.y);
          ctx.lineTo(shot.x - shot.vx * 0.016, shot.y - shot.vy * 0.016);
          ctx.stroke();
        }
      }
      for (const effect of world.effects) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, Math.max(0, effect.lifeMs / 100));
        if (
          effect.kind === "beam" &&
          effect.endX !== undefined &&
          effect.endY !== undefined
        ) {
          ctx.strokeStyle = "#ff76cf";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(effect.x, effect.y);
          ctx.lineTo(effect.endX, effect.endY);
          ctx.stroke();
        } else {
          ctx.strokeStyle = effect.kind.includes("smoke")
            ? "#99afc9"
            : "#ffe46b";
          ctx.lineWidth = effect.kind === "explosion" ? 2 : 1;
          ctx.beginPath();
          ctx.arc(
            effect.x,
            effect.y,
            Math.max(1, effect.radius),
            0,
            Math.PI * 2,
          );
          ctx.stroke();
        }
        ctx.restore();
      }
      for (const worm of world.worms) {
        if (!worm.alive) continue;
        const x = Math.round(worm.x),
          y = Math.round(worm.y),
          color = COLORS[worm.slot % COLORS.length]!,
          dir = faceDirection(worm);
        if (worm.rope) {
          ctx.strokeStyle =
            worm.rope.state === "shooting" ? "#16e7ff" : "#c5e3ef";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(worm.rope.x, worm.rope.y);
          ctx.stroke();
          ctx.fillStyle = worm.rope.state === "falling" ? "#ffe46b" : "#ffffff";
          ctx.fillRect(worm.rope.x - 0.5, worm.rope.y - 0.5, 1, 1);
        }
        ctx.fillStyle = "#02040a";
        ctx.fillRect(
          x - 4,
          y - NATIVE_DRAW_SCALE.worm.height / 2,
          8,
          NATIVE_DRAW_SCALE.worm.height,
        );
        ctx.fillStyle = color;
        ctx.fillRect(x - 3, y - 3.5, 5, 7);
        ctx.fillRect(x - 4, y + 2.5, 7, 1);
        ctx.fillStyle = "#f5fff5";
        ctx.fillRect(x + (worm.facing === 1 ? 0 : -2), y - 2.5, 2, 1.5);
        ctx.fillStyle = "#111620";
        ctx.fillRect(x + (worm.facing === 1 ? 1 : -2), y - 2.5, 0.5, 1);
        ctx.strokeStyle = "#dee8f7";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(
          x + dir.x * (NATIVE_DRAW_SCALE.worm.width / 2 - 0.5),
          y + dir.y * 4,
        );
        ctx.stroke();
        if (worm.id === self) {
          const ax = x + dir.x * NATIVE_DRAW_SCALE.crosshair.distance,
            ay = y + dir.y * NATIVE_DRAW_SCALE.crosshair.distance;
          ctx.strokeStyle = color;
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(ax - NATIVE_DRAW_SCALE.crosshair.width / 2, ay);
          ctx.lineTo(ax + NATIVE_DRAW_SCALE.crosshair.width / 2, ay);
          ctx.moveTo(ax, ay - NATIVE_DRAW_SCALE.crosshair.height / 2);
          ctx.lineTo(ax, ay + NATIVE_DRAW_SCALE.crosshair.height / 2);
          ctx.stroke();
        }
        const label = names.get(worm.id) ?? "Worm",
          labelY = Math.max(8, y - 8);
        ctx.font = "4px monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = "#080917";
        ctx.fillRect(
          x - ctx.measureText(label).width / 2 - 3,
          labelY - 6,
          ctx.measureText(label).width + 6,
          7,
        );
        ctx.fillStyle = color;
        ctx.fillText(label, x, labelY);
        ctx.fillStyle = "#111620";
        ctx.fillRect(x - 5, y - 5.5, 10, 0.5);
        ctx.fillStyle = color;
        ctx.fillRect(x - 5, y - 5.5, Math.max(0, worm.health) * 0.1, 0.5);
      }
      ctx.restore();
      if (!camera.overview) {
        const mapWidth = Math.min(60, camera.width * 0.2),
          mapHeight = (mapWidth * height) / width,
          own = world.worms.find((w) => w.id === self);
        const viewport = display.viewport();
        const scaleToScreen = Math.min(
          viewport.width / camera.width,
          viewport.height / camera.height,
        );
        const y =
          minimapTop > 0 ? Math.ceil(minimapTop / scaleToScreen) + 3 : 5;
        const right = camera.width - mapWidth - 5,
          x =
            own &&
            own.x - camera.x > right - 8 &&
            Math.abs(own.y - camera.y - y - mapHeight / 2) < mapHeight / 2 + 15
              ? 5
              : right,
          scale = mapWidth / width;
        ctx.fillStyle = "#050812";
        ctx.fillRect(x - 3, y - 3, mapWidth + 6, mapHeight + 6);
        ctx.drawImage(terrain, x, y, mapWidth, mapHeight);
        ctx.strokeStyle = "#90acbc";
        ctx.lineWidth = 1;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, mapWidth, mapHeight);
        ctx.clip();
        ctx.strokeRect(
          x + camera.x * scale,
          y + camera.y * scale,
          camera.width * scale,
          camera.height * scale,
        );
        ctx.restore();
        for (const worm of world.worms)
          if (worm.alive) {
            const px = Math.round(x + worm.x * scale),
              py = Math.round(y + worm.y * scale);
            ctx.fillStyle = COLORS[worm.slot % COLORS.length]!;
            ctx.fillRect(px - 1, py - 1, 2, 2);
            if (worm.id === self) {
              ctx.strokeStyle = "#ffffff";
              ctx.strokeRect(px - 2, py - 2, 4, 4);
            }
          }
      }
    },
  };
}
