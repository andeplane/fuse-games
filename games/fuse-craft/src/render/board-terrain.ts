import type { Cell, World } from "../engine/types.js";
import { hexCenter, hexPoints } from "./projection.js";
import { terrainArt, WALKABLE_GROUND } from "./terrain-art.js";
import {
  rockRelief,
  rockReliefMarkup,
  type RockRelief,
} from "./terrain-relief.js";
import { escaped, image, type Sprites } from "./svg-sprite.js";
import { vesselMarkup, type Vessel } from "./vessels.js";

function terrainHit(
  index: number,
  x: number,
  y: number,
  rock: RockRelief | undefined,
) {
  return `<ellipse class="terrain-hit" data-cell="${index}" cx="${x}" cy="${y - 3 - (rock?.height ?? 0)}" rx="${rock ? 24 : 20}" ry="${rock ? 32 : 25}"/>`;
}

function rockObject(
  sprites: Sprites,
  art: string,
  x: number,
  y: number,
  rock: RockRelief | undefined,
) {
  const silhouette =
    image(sprites, art, x, y - (rock?.height ?? 0), rock ? 48 : 60) ||
    image(sprites, "blocker-boulder", x, y, 60) ||
    `<path class="terrain-fallback" d="M${x - 23} ${y + 13}l5 -29 22 -10 22 23 -4 24Z" fill="#68757a" stroke="#29383d" stroke-width="3"/>`;
  return rock ? rockReliefMarkup(rock) + silhouette : silhouette;
}

function terrainObject(
  cell: Cell,
  index: number,
  sprites: Sprites,
  x: number,
  y: number,
  rock: RockRelief | undefined,
) {
  if (cell.terrain === "open")
    return cell.towerSite
      ? `<circle class="tower-site" cx="${x}" cy="${y}" r="19"/><text x="${x}" y="${y + 5}" text-anchor="middle">+</text>`
      : "";
  const art = terrainArt(cell, index)!;
  const object =
    cell.terrain === "deposit"
      ? image(sprites, art, x, y, 58) ||
        `<text x="${x}" y="${y + 6}" text-anchor="middle">${cell.resourceKind === "biomass" ? "◈" : "◇"}</text>`
      : rockObject(sprites, art, x, y, rock);
  return object + terrainHit(index, x, y, rock);
}

export function terrainMarkup(
  world: Readonly<World>,
  sprites: Sprites,
): string {
  const { width, cells } = world.map;
  const relief = new Map(
    rockRelief(world.map).map((rock) => [rock.cell, rock]),
  );
  return cells
    .map((cell, index) => {
      const { x, y } = hexCenter(width, index);
      const points = hexPoints(width, index);
      const ground = cell.terrain === "open" ? terrainArt(cell, index) : null;
      const object = terrainObject(
        cell,
        index,
        sprites,
        x,
        y,
        relief.get(index),
      );
      return `<g class="hex terrain-${cell.terrain}" data-cell="${index}"><polygon points="${points}"/><clipPath id="tile-${index}"><polygon points="${points}"/></clipPath><g class="ground-patch" clip-path="url(#tile-${index})">${ground ? image(sprites, ground, x, y, 82) : ""}</g>${object ? `<g class="terrain-object" data-terrain="${cell.terrain}"${cell.terrain === "deposit" ? ` data-resource="${cell.resourceKind}" style="--delay:${(-((index * 0.618) % 1) * 3.6).toFixed(2)}s"` : ""} data-depth="${index}" pointer-events="none"><ellipse cx="${x + 9}" cy="${y + 14}" rx="30" ry="10" fill="url(#contact-shadow)"/>${object}</g>` : ""}<polygon class="hex-hover-outline" points="${hexPoints(width, index, 1.5)}"/></g>`;
    })
    .join("");
}

/** Decorative ground continues beyond the selectable cells; it has no game state. */
export function backdropMarkup(
  sprites: Sprites,
  size: { width: number; height: number },
  vessels: readonly Vessel[],
): string {
  const ground = sprites[WALKABLE_GROUND];
  const cliff = sprites["terrain-cliff-material-v1"];
  return `<defs><pattern id="cliff-material" patternUnits="userSpaceOnUse" width="180" height="180"><rect width="180" height="180" fill="#657078"/>${cliff ? `<image data-sprite="terrain-cliff-material-v1" href="${escaped(cliff)}" width="180" height="180"/>` : ""}</pattern><radialGradient id="contact-shadow"><stop offset="0" stop-color="#000" stop-opacity="0.7"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient><pattern id="ground-continuation" patternUnits="userSpaceOnUse" width="${size.width * 2}" height="${size.height * 2}"><rect width="${size.width * 2}" height="${size.height * 2}" fill="#172723"/>${ground ? ["", `translate(${size.width * 2} 0) scale(-1 1)`, `translate(0 ${size.height * 2}) scale(1 -1)`, `translate(${size.width * 2} ${size.height * 2}) scale(-1 -1)`].map((transform) => `<image data-sprite="${WALKABLE_GROUND}" href="${escaped(ground)}" width="${size.width}" height="${size.height}" preserveAspectRatio="none" transform="${transform}" opacity="0.5"/>`).join("") : ""}</pattern></defs><rect class="terrain-backdrop" width="100%" height="100%" fill="url(#ground-continuation)"/>${vesselMarkup(vessels)}`;
}
