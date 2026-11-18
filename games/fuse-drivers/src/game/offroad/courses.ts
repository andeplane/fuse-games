import measurements from "./measured-terrain.json" with { type: "json" };
import {
  terrainFromFacets,
  type OffroadFacet,
  type OffroadTerrain,
} from "./terrain.js";

const unpack = (row: string) => row.split(" ").map(Number);
const facets: OffroadFacet[] = measurements.facets.map((record) => {
  const [slopeX, slopeY, direction, kind, solid] = unpack(record) as [
    number,
    number,
    number,
    number,
    number,
  ];
  return { slopeX, slopeY, direction, kind, blocked: solid === 1 };
});
const tiles = measurements.tiles.map(unpack);
const courses = measurements.courses.map((rows) => {
  const centers = new Uint8Array(44 * 44);
  const sectors = new Uint16Array(44 * 44 * 4);
  let cell = 0;
  for (const row of rows) {
    for (const id of unpack(row)) {
      const tile = tiles[id]!;
      centers[cell] = tile[0]!;
      for (let i = 0; i < 4; i++) sectors[cell * 4 + i] = tile[i + 1]!;
      cell++;
    }
  }
  return terrainFromFacets(centers, sectors, facets);
});

/** The reverse race uses the same contact geometry. */
export function getOffroadTerrain(trackName: string): OffroadTerrain | null {
  const id = /^offroad-([1-8])(?:-reverse)?$/.exec(trackName);
  return id ? courses[Number(id[1]) - 1]! : null;
}
