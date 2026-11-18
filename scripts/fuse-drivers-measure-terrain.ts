// pnpm exec tsx scripts/fuse-drivers-measure-terrain.ts /path/to/local/OFFROAD
// Records the four contact planes and their shared center elevation in every
// cell. The output uses new dictionaries and contains no source file offsets.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeOffroadTerrain } from "../games/fuse-drivers/src/game/offroad/terrain.js";

const directory = process.argv[2];
if (!directory) throw new Error("Supply a local DOS game directory");
const read = (filename: string) => readFileSync(join(directory, filename));
const polygons = read("poly.bin");
const quads = read("quad.bin");
const facets = new Map<string, number>();
const tiles = new Map<string, number>();
const courses: string[][] = [];
function intern(dictionary: Map<string, number>, values: number[]) {
  const key = values.join(" ");
  const existing = dictionary.get(key);
  if (existing !== undefined) return existing;
  const id = dictionary.size;
  dictionary.set(key, id);
  return id;
}

for (let course = 0; course < 8; course++) {
  const terrain = decodeOffroadTerrain(
    course,
    read(`contour${course}.xx`),
    quads,
    polygons,
  );
  const rows: string[] = [];
  for (let y = 0; y < 44; y++) {
    const row = [];
    for (let x = 0; x < 44; x++) {
      const sample = (fx: number, fy: number) =>
        terrain.sample(x * 256 + fx, y * 256 + fy)!;
      const center = sample(128, 128);
      const tile = [center.height >>> 8];
      for (const face of [
        sample(75, 190),
        center,
        sample(25, 94),
        sample(170, 25),
      ]) {
        tile.push(
          intern(facets, [
            face.slopeX,
            face.slopeY,
            face.direction,
            face.kind,
            Number(face.blocked),
          ]),
        );
      }
      row.push(intern(tiles, tile));
    }
    rows.push(row.join(" "));
  }
  courses.push(rows);
}

const measurements = {
  facets: [...facets.keys()],
  tiles: [...tiles.keys()],
  courses,
};
writeFileSync(
  new URL(
    "../games/fuse-drivers/src/game/offroad/measured-terrain.json",
    import.meta.url,
  ),
  JSON.stringify(measurements, null, 2) + "\n",
);
