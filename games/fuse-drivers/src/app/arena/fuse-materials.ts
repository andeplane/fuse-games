import type { OffroadTerrainSample } from "../../game/offroad/terrain.js";
import type { Point } from "../../game/sim/track.js";
import type { Track } from "../../game/sim/track.js";

/** Each terraced stadium is lit from the upper left. The plateau, approach and far face
 * deliberately have different values so a crest remains readable without its rail. */
const ASPHALT = [
  "#182037",
  "#29344c",
  "#3b4661",
  "#515d78",
  "#626e89",
  "#8492a8",
  "#becbda",
];
const WATER = [
  "#093047",
  "#095067",
  "#0e687a",
  "#198b96",
  "#38a5a8",
  "#65bbbc",
  "#a2dcce",
];

export function floodlitFacet(
  sample: OffroadTerrainSample,
  onCourse: boolean,
): string {
  const grade = Math.round(3 - (sample.slopeX + 1.6 * sample.slopeY) / 6);
  if (sample.kind === 2) return WATER[Math.min(6, Math.max(0, grade))]!;
  return onCourse ? ASPHALT[Math.min(6, Math.max(0, grade))]! : "#1d2537";
}

/** A maintenance deck visible between the bends. Repeating panels, cooling slots and
 * seam fasteners share one tiny material swatch; the driving surface stays quieter. */
export function deckMaterial(
  ctx: CanvasRenderingContext2D,
): CanvasPattern | string {
  const tile = ctx.canvas.ownerDocument.createElement("canvas");
  tile.width = 32;
  tile.height = 20;
  const ink = tile.getContext("2d");
  if (!ink) return "#1d2537";
  ink.fillStyle = "#192235";
  ink.fillRect(0, 0, 32, 20);
  ink.fillStyle = "#222d41";
  ink.fillRect(1, 1, 30, 17);
  ink.fillStyle = "#2d394e";
  ink.fillRect(2, 1, 26, 1);
  ink.fillStyle = "#111b2d";
  for (let i = 0; i < 4; i++) ink.fillRect(5 + i * 3, 13, 2, 3);
  ink.fillStyle = "#4c5b6e";
  ink.fillRect(27, 4, 1, 1);
  ink.fillRect(27, 15, 1, 1);
  return ctx.createPattern(tile, "repeat") ?? "#1d2537";
}

export interface StadiumEdge {
  a: Point;
  b: Point;
  stripe: boolean;
}

/** A rail has a cast shadow, a steel fascia, separate luminous tubes, and short couplers.
 * All strokes follow the existing boundary. In particular, they never bridge a jump. */
export function drawFuseRails(
  ctx: CanvasRenderingContext2D,
  edges: readonly StadiumEdge[],
): void {
  ctx.lineCap = "round";
  function strip(
    offset: number,
    width: number,
    color: (edge: StadiumEdge) => string,
    shorten = 0,
  ) {
    ctx.lineWidth = width;
    for (const edge of edges) {
      const { a, b } = edge;
      ctx.strokeStyle = color(edge);
      ctx.beginPath();
      ctx.moveTo(
        a.x + (b.x - a.x) * shorten,
        a.y + (b.y - a.y) * shorten + offset,
      );
      ctx.lineTo(
        b.x + (a.x - b.x) * shorten,
        b.y + (a.y - b.y) * shorten + offset,
      );
      ctx.stroke();
    }
  }
  strip(0.9, 2.5, () => "#161b2b");
  strip(-0.45, 2.1, () => "#354459");
  strip(-1.25, 1.1, (e) => (e.stripe ? "#28e5d4" : "#ffa865"), 0.045);
  strip(-1.55, 0.32, (e) => (e.stripe ? "#b5fff0" : "#fff0c4"), 0.075);
}

/** Material texture is baked once into the course canvas. Its generator never touches race RNG. */
export function finishFuseMaterials(ctx: CanvasRenderingContext2D): void {
  const pixels = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  let seed = 0x8511;
  for (let i = 0; i < pixels.data.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const grit = (seed >>> 27) - 16;
    const strength = pixels.data[i + 2]! > 83 ? 0.32 : 0.14;
    for (let ch = 0; ch < 3; ch++)
      pixels.data[i + ch] = pixels.data[i + ch]! + grit * strength;
  }
  ctx.putImageData(pixels, 0, 0);
}

/** Skids trace the actual reference line. The clip keeps wheel marks inside the course even
 * where the racing line rounds a tight corner. Grid boxes remain visible under the trucks. */
export function markFuseTrack(
  ctx: CanvasRenderingContext2D,
  footprint: Path2D,
  track: Track,
  sx: number,
  sy: number,
): void {
  ctx.save();
  ctx.clip(footprint);
  const waypoints = track.waypoints.map((p) => ({ x: p.x * sx, y: p.y * sy }));
  const tireBand = (offset: number, width: number, color: string) => {
    ctx.save();
    ctx.translate(0, offset);
    ctx.beginPath();
    for (let i = 0; i < waypoints.length; i++) {
      const previous =
        waypoints[(i + waypoints.length - 1) % waypoints.length]!;
      const curr = waypoints[i]!,
        next = waypoints[(i + 1) % waypoints.length]!;
      if (i === 0)
        ctx.moveTo((previous.x + curr.x) / 2, (previous.y + curr.y) / 2);
      ctx.quadraticCurveTo(
        curr.x,
        curr.y,
        (curr.x + next.x) / 2,
        (curr.y + next.y) / 2,
      );
    }
    ctx.closePath();
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.restore();
  };
  tireBand(0.65, 4.2, "#19213720");
  tireBand(1.7, 0.55, "#141b302c");
  tireBand(-0.75, 0.65, "#141b302c");
  for (const [i, spawn] of track.spawns.entries()) {
    ctx.save();
    ctx.translate(spawn.x * sx, spawn.y * sy);
    ctx.rotate(spawn.heading);
    ctx.strokeStyle = "#e4e4c489";
    ctx.lineWidth = 0.55;
    ctx.beginPath();
    ctx.moveTo(-4, -3.1);
    ctx.lineTo(3.9, -3.1);
    ctx.lineTo(3.9, 3.1);
    ctx.lineTo(-4, 3.1);
    ctx.stroke();
    // The last slot is Fuse's fifth-seat extension.
    ctx.fillStyle = "#f8ecb0";
    ctx.fillRect(-4, 3.4, 1 + i * 0.3, 0.38);
    ctx.restore();
  }
  ctx.restore();
}

/** Seat banks and trackside equipment occupy *whole* infield plots. Testing their footprint
 * against the projected race mask keeps fixtures off the dirt on every course and direction. */
export function furnishStadium(
  ctx: CanvasRenderingContext2D,
  footprint: Path2D,
): void {
  const mask = ctx.canvas.ownerDocument.createElement("canvas");
  mask.width = 320;
  mask.height = 200;
  const ink = mask.getContext("2d");
  if (!ink) return;
  ink.fill(footprint);
  ink.lineWidth = 3;
  ink.stroke(footprint);
  const data = ink.getImageData(0, 0, 320, 200).data;
  const occupied = new Uint8Array(320 * 200);
  for (let i = 0; i < occupied.length; i++) occupied[i] = data[i * 4 + 3]!;
  function plot(x: number, y: number, w: number, h: number): boolean {
    if (x < 0 || y < 0 || x + w > 320 || y + h > 200) return false;
    for (let r = y; r < y + h; r++)
      for (let c = x; c < x + w; c++) if (occupied[r * 320 + c]) return false;
    for (let r = y; r < y + h; r++)
      occupied.fill(1, r * 320 + x, r * 320 + x + w);
    return true;
  }
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  function grandstand(x: number, y: number) {
    rect(x + 1, y + 1, 21, 7, "#111a29");
    for (let row = 0; row < 3; row++) {
      rect(x, y + row * 2.1, 21, 1.75, "#415368");
      rect(x, y + row * 2.1 + 1.4, 21, 0.5, "#111b2a");
      for (let seat = 0; seat < 12; seat++) {
        const colors = ["#53aaac", "#a0aaaa", "#bd917a", "#586b89", "#ba7387"];
        const hash = (seat * 7 + row * 23 + x + y + seat * row) % 17;
        if (hash % 6 === 0) continue;
        rect(
          x + 0.7 + seat * 1.65,
          y + 0.2 + row * 2.1,
          0.95,
          1.3,
          colors[hash % colors.length]!,
        );
      }
    }
    rect(x, y + 6.3, 21, 0.75, "#0b1828");
    rect(x + 0.5, y + 6.3, 20, 0.35, "#63c2c1");
  }
  // Stadium galleries form continuous rows around the outside, with access corridors
  // through the ends. Blocks inside hairpins face the cars from a lower terrace.
  for (let y = 2; y < 196; y += 10)
    for (let x = 2; x < 310; x += 24) {
      const outer = y < 22 || y > 174;
      if ((outer || (y + 2 * x) % 5 === 0) && plot(x, y, 23, 9))
        grandstand(x + 1, y + 1);
    }
  for (let y = 11; y < 188; y += 13)
    for (let x = 9; x < 312; x += 18) {
      if (!plot(x, y, 12, 8)) continue;
      rect(x + 1, y + 3, 10, 4, "#0e1826");
      rect(x + 1, y + 2, 9, 3.8, "#3a4e60");
      rect(x + 2, y + 1, 7, 1.8, "#61717b");
      for (let vent = 0; vent < 4; vent++)
        rect(x + 2 + vent * 1.7, y + 2.5, 0.7, 2, "#172437");
      rect(x + 1.5, y + 5.5, 2.5, 0.5, "#efaa63");
      rect(x + 6, y + 5.5, 2.5, 0.5, "#54c8bc");
    }
}
