import { wallVariant, type loadCyberArt } from "../art/sprites.js";
import type { Mission } from "../campaign/index.js";
import type { MissionState } from "../sim/index.js";
import { TILE_H, TILE_W } from "./camera.js";
import type { Materials } from "./materials.js";

export type Art = Awaited<ReturnType<typeof loadCyberArt>>;
type Context = CanvasRenderingContext2D;

const LIGHTS = [
  "#ff977b",
  "#a1edab",
  "#8abbff",
  "#df9cf5",
  "#c4d5d9",
  "#a9cce5",
  "#ffd98c",
  "#e8ba92",
  "#83f1db",
];
const lampColor = (range: number) =>
  LIGHTS[Math.floor((Math.abs(range) % 27) / 3)]!;

/** Stable surface variation belongs to presentation. It consumes no gameplay randomness. */
function tileNoise(x: number, y: number): number {
  let value = Math.imul(x + 11, 0x45d9f3b) ^ Math.imul(y + 23, 0x27d4eb2d);
  value = Math.imul(value ^ (value >>> 15), 0x27d4eb2d);
  return (value ^ (value >>> 13)) >>> 0;
}

export function lightPool(
  ctx: Context,
  x: number,
  y: number,
  rx: number,
  ry: number,
  tint: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(rx, ry);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  glow.addColorStop(0, tint);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

/** Fixtures spill onto the surrounding deck, including tiles below the wall face. */
export function drawDeckLight(
  ctx: Context,
  world: MissionState,
  altRange: number,
  col: number,
  row: number,
): void {
  if (world.tiles[row]?.[col] !== "#" || world.tiles[row + 1]?.[col] === "#")
    return;
  const x = col * TILE_W;
  const y = (row + 1) * TILE_H;
  // Contact shadow tapers away from the raised wall, leaving the tile artwork legible.
  const shade = ctx.createLinearGradient(0, y - 2, 0, y + 5);
  shade.addColorStop(0, "rgba(0,7,14,.6)");
  shade.addColorStop(1, "rgba(0,7,14,0)");
  ctx.fillStyle = shade;
  ctx.fillRect(x, y - 2, TILE_W, 7);
  if ((col + row) % 4 !== 1) return;
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  const accent = lampColor(altRange);
  lightPool(ctx, x + 8, y + 4, 21, 17, accent + "35");
  lightPool(ctx, x + 8, y + 2, 10, 6, accent + "28");
  ctx.restore();
}

/** A broad helmet lamp leads the player's direction. World-space clipping keeps the light on visible tiles. */
export function drawHelmetLight(
  ctx: Context,
  x: number,
  y: number,
  dir: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, 0.78);
  ctx.rotate((dir * Math.PI) / 4 - Math.PI / 2);
  ctx.globalCompositeOperation = "screen";
  const beam = ctx.createRadialGradient(0, 0, 2, 0, 0, 55);
  beam.addColorStop(0, "rgba(169,214,202,.21)");
  beam.addColorStop(0.45, "rgba(135,201,201,.14)");
  beam.addColorStop(1, "rgba(94,168,184,0)");
  ctx.fillStyle = beam;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, 55, -0.48, 0.48);
  ctx.closePath();
  ctx.fill();
  lightPool(ctx, 4, 0, 24, 17, "rgba(133,200,191,.10)");
  ctx.restore();
}

export function drawDeck(
  ctx: Context,
  art: Art,
  materials: Materials,
  world: MissionState,
  spec: Mission,
  col: number,
  row: number,
): void {
  const x = col * TILE_W;
  const y = row * TILE_H;
  const tile = world.tiles[row]?.[col];
  if (tile === "#") return;
  const noise = tileNoise(col, row);
  const shadow = world.tiles[row - 1]?.[col] === "#";
  const surface = world.decor[row]?.[col];
  const variant = shadow ? 0 : surface === "1" ? 2 : surface === "2" ? 3 : 1;
  if (surface === "r")
    materials.draw(
      ctx,
      art,
      "room",
      x,
      y,
      Math.abs(spec.roomStyle),
      variant,
      spec.roomRange,
    );
  else if (surface === "d") art.drawSprite(ctx, 164, x, y);
  else
    materials.draw(
      ctx,
      art,
      "floor",
      x,
      y,
      Math.abs(spec.floorStyle),
      variant,
      spec.floorRange,
    );
  if (tile === "E") {
    const active = world.objectives.every((o) => o.done >= o.required);
    if (!active) return;
    art.drawSprite(
      ctx,
      (spec.exitStyle % 2 ? 380 : 375) + Number(shadow),
      x,
      y,
    );
    ctx.fillStyle = "rgba(56,255,187,.23)";
    ctx.fillRect(x, y, TILE_W, TILE_H);
    const rows = world.tiles;
    ctx.fillStyle = "#6fffcd";
    if (rows[row - 1]?.[col] !== "E") ctx.fillRect(x, y + 0.5, TILE_W, 0.75);
    if (rows[row + 1]?.[col] !== "E") ctx.fillRect(x, y + 10.75, TILE_W, 0.75);
    if (rows[row]?.[col - 1] !== "E") ctx.fillRect(x + 0.5, y, 0.75, TILE_H);
    if (rows[row]?.[col + 1] !== "E") ctx.fillRect(x + 14.75, y, 0.75, TILE_H);
    ctx.beginPath();
    ctx.moveTo(x + 5, y + 7);
    ctx.lineTo(x + 8, y + 4);
    ctx.lineTo(x + 11, y + 7);
    ctx.lineTo(x + 8, y + 5.5);
    ctx.closePath();
    ctx.fill();
    return;
  }
  // Painted alignment cross and embedded service channel. Both lie flush with the deck.
  if (noise % 31 === 1) {
    ctx.fillStyle = "rgba(195,218,208,.26)";
    ctx.fillRect(x + 6, y + 6, 4.5, 0.45);
    ctx.fillRect(x + 8, y + 4.5, 0.45, 3.5);
  }
  if (row % 7 === 3 && col % 8 >= 2 && col % 8 <= 6) {
    ctx.fillStyle = "rgba(9,22,29,.66)";
    ctx.fillRect(x, y + 8.5, TILE_W, 1.15);
    ctx.fillStyle = "rgba(145,196,187,.35)";
    ctx.fillRect(x, y + 8.6, 13.5, 0.25);
  }
}

export function drawStructure(
  ctx: Context,
  art: Art,
  materials: Materials,
  world: MissionState,
  spec: Mission,
  col: number,
  row: number,
): void {
  const x = col * TILE_W;
  const y = row * TILE_H;
  const tile = world.tiles[row]?.[col];
  if (tile === "#") {
    const rows = world.tiles;
    const n = rows[row - 1]?.[col] === "#";
    const e = rows[row]?.[col + 1] === "#";
    const s = rows[row + 1]?.[col] === "#";
    const w = rows[row]?.[col - 1] === "#";
    const mask = Number(n) + 2 * Number(e) + 4 * Number(s) + 8 * Number(w);
    materials.draw(
      ctx,
      art,
      "wall",
      x,
      y,
      Math.abs(spec.wallStyle),
      wallVariant(mask),
      spec.wallRange,
    );
    if (!s && (col + row) % 4 === 1) {
      const light = lampColor(spec.altRange);
      lightPool(ctx, x + 8, y + 9, 14, 8, light + "22");
      ctx.fillStyle = "#10252b";
      ctx.fillRect(x + 5, y + 1, 6, 1.75);
      ctx.fillStyle = light;
      ctx.fillRect(x + 5.75, y + 1.2, 4.5, 0.65);
    }
  } else if (tile === "D" || tile === "+") {
    const door = world.doors.find((d) => d.x === col && d.y === row);
    const horizontal = door?.horizontal ?? false;
    const bank = Math.abs(spec.doorStyle) % 4;
    const suffix = ["", "2", "3", "4"][bank];
    const locked = door?.key;
    if (tile === "+" && horizontal) {
      art.drawSprite(ctx, [109, 342, 546, 561][bank]!, x, y);
    } else {
      const stem = horizontal
        ? locked || bank >= 2
          ? "hdoor"
          : "door"
        : "vdoor";
      const name =
        tile === "+"
          ? bank
            ? "vdoor2_open"
            : "vdoor_open"
          : stem + suffix + (locked ? "_" + locked : "");
      art.prop(ctx, name, x, y - TILE_H);
    }
  }
}
