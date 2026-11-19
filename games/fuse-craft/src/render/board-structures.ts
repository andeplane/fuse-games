import type { Structure, StructureKind, World } from "../engine/types.js";
import { STRUCTURES } from "../engine/catalog.js";
import { neighbors } from "../engine/map.js";
import { structureArt, teamSvgFilter } from "./art.js";
import { buildingRootsMarkup } from "./building-roots.js";
import { TEAM_PALETTES } from "./creep.js";
import { damagePlume } from "./damage-plume.js";
import type { KeyedItem } from "./keyed-layer.js";
import {
  neuronImageUrl,
  neuronMarkup,
  neuronVisual,
  type NeuronVisual,
} from "./neuron-art.js";
import type { Neighbour } from "./neuron-form.js";
import { hexCenter } from "./projection.js";
import { sporeMarkup } from "./spore-art.js";
import { teamSpritePaint } from "./sprite-raster.js";
import { image, type Sprites } from "./svg-sprite.js";

const colors = TEAM_PALETTES.map((p) => p.glow);

/** Same-owner structures around a cell, as projected offsets for dendrites to reach toward. */
export function neuronNeighbours(
  world: Readonly<World>,
  cell: number,
  owner: string,
  occupied?: ReadonlySet<number>,
): Neighbour[] {
  const at = hexCenter(world.map.width, cell);
  return neighbors(world.map, cell)
    .filter(
      (n) =>
        occupied?.has(n) ??
        world.structures.some((s) => s.cell === n && s.ownerId === owner),
    )
    .map((n) => {
      const to = hexCenter(world.map.width, n);
      return { cell: n, dx: to.x - at.x, dy: to.y - at.y };
    });
}
/** The selected neuron as a standalone image for the inspector portrait. */
export function neuronPortraitUrl(
  world: Readonly<World>,
  cell: number,
): string | undefined {
  const s = world.structures.find((s) => s.cell === cell);
  if (s?.kind !== "neuron") return undefined;
  const { x, y } = hexCenter(world.map.width, cell);
  const slot = world.players.find((p) => p.id === s.ownerId)?.slot ?? 0;
  return neuronImageUrl(
    neuronVisual(x, y, cell, neuronNeighbours(world, cell, s.ownerId)),
    slot,
  );
}
/** Procedural neuron: unique per cell and team, reaching toward its neighbours. */
export function neuronArtwork(
  width: number,
  cell: number,
  slot: number,
  neighbours: readonly Neighbour[] = [],
): string {
  const { x, y } = hexCenter(width, cell);
  return neuronMarkup(neuronVisual(x, y, cell, neighbours), slot);
}
export const buildingFoot = 25;
export function buildingSize(kind: Exclude<StructureKind, "neuron">): number {
  return kind === "brain" ? 90 : kind === "relay" ? 96 : 84;
}
export function structureArtwork(
  width: number,
  cell: number,
  kind: StructureKind,
  slot: number,
  sprites: Sprites = {},
): string {
  if (kind === "neuron") return neuronArtwork(width, cell, slot);
  if (kind === "spore") {
    const at = hexCenter(width, cell);
    return sporeMarkup(at.x, at.y, slot);
  }
  const { x, y } = hexCenter(width, cell);
  const size = buildingSize(kind);
  return `<g class="building-art" filter="${teamSvgFilter(slot)}">${image(sprites, structureArt(kind), x, y + buildingFoot - size / 2, size, { key: teamSpritePaint(slot), filter: teamSvgFilter(slot) }) || `<circle class="structure-core" cx="${x}" cy="${y}" r="16"/>`}</g>`;
}
/** Project the sprite silhouette away from a shared upper-left light source. */
export function shadowMarkup(world: Readonly<World>, sprites: Sprites): string {
  return world.structures
    .map((s) => {
      if (s.kind === "neuron" || s.kind === "spore") return "";
      const { x, y } = hexCenter(world.map.width, s.cell);
      const foot = y + buildingFoot;
      const size = buildingSize(s.kind);
      return `<g class="building-cast-shadow" transform="matrix(1 0 -0.55 -0.3 ${0.55 * foot} ${1.3 * foot})" filter="url(#nd-art-shadow)" opacity="0.28">${image(sprites, structureArt(s.kind), x, foot - size / 2, size, { key: "shadow", filter: "url(#nd-art-shadow)" })}</g>`;
    })
    .join("");
}
export type NeuronMemo = Map<string, { visual: NeuronVisual; markup: string }>;
type Point = ReturnType<typeof hexCenter>;
type NeuronForms = {
  previous: NeuronMemo;
  next: NeuronMemo;
  visuals: Map<number, NeuronVisual>;
};

function slotFor(world: Readonly<World>, owner: string): number {
  return world.players.find((p) => p.id === owner)?.slot ?? 0;
}

function ownedCells(structures: readonly Structure[]) {
  const owners = new Map<string, Set<number>>();
  for (const { ownerId, cell } of structures) {
    let cells = owners.get(ownerId);
    if (!cells) {
      cells = new Set<number>();
      owners.set(ownerId, cells);
    }
    cells.add(cell);
  }
  return owners;
}

function neuronForm(
  world: Readonly<World>,
  s: Structure,
  at: Point,
  slot: number,
  forms: NeuronForms,
  occupied: ReadonlySet<number> | undefined,
) {
  const neighbours = neuronNeighbours(world, s.cell, s.ownerId, occupied);
  const key = `${s.cell}:${slot}:${neighbours.map((n) => n.cell).join(",")}`;
  let form = forms.previous.get(key);
  if (!form) {
    const visual = neuronVisual(at.x, at.y, s.cell, neighbours);
    form = { visual, markup: neuronMarkup(visual, slot) };
  }
  forms.next.set(key, form);
  forms.visuals.set(s.cell, form.visual);
  return form.markup;
}

function buildingArt(
  width: number,
  s: Structure,
  { x, y }: Point,
  slot: number,
  sprites: Sprites,
) {
  return (
    buildingRootsMarkup(
      x,
      y + buildingFoot,
      slot,
      s.cell * 7 + 3,
      s.kind === "brain" ? 1.3 : 1,
    ) +
    structureArtwork(width, s.cell, s.kind, slot, sprites) +
    damagePlume(x + 6, y - 18, s.hp / STRUCTURES[s.kind].hp, s.id)
  );
}

function structureHealth(s: Structure, { x, y }: Point): string {
  const hpMax = STRUCTURES[s.kind].hp;
  const healthY =
    s.kind === "neuron" ? y - 35 : y + buildingFoot - buildingSize(s.kind) - 7;
  const health =
    s.hp < hpMax
      ? `<rect class="structure-hp-bg" x="${x - 18}" y="${healthY}" width="36" height="3"/><rect class="structure-hp" x="${x - 18}" y="${healthY}" width="${36 * Math.max(0, Math.min(1, s.hp / hpMax))}" height="3"/>`
      : "";
  return health;
}

function structureHit(s: Structure) {
  // Select the raised body as well as the ground footprint. These are
  // presentation hit regions only; placement continues to target terrain.
  return s.kind === "neuron"
    ? { rx: 17, ry: 17, offset: 0 }
    : s.kind === "brain" || s.kind === "relay"
      ? { rx: 24, ry: 41, offset: -19 }
      : { rx: 24, ry: 33, offset: -14 };
}

function structureSupply(
  s: Structure,
  { x, y }: Point,
  stock: number,
  slot: number,
) {
  if (!stock || !s.connected) return { supply: "", orbit: "" };
  const supply = `<ellipse class="supply-footprint" cx="${x}" cy="${y + 20}" rx="${s.kind === "neuron" ? 20 : 29}" ry="9" opacity="${Math.min(0.35, stock / 96)}"/>`;
  const orbit = `<g class="supply-orbit" style="transform-origin:${x}px ${y}px">${Array.from({ length: Math.min(6, Math.ceil(stock / 8)) }, (_, i) => `<circle cx="${x + Math.cos((i * Math.PI) / 3) * 22}" cy="${y + Math.sin((i * Math.PI) / 3) * 22}" r="2" fill="${colors[slot]}"/>`).join("")}</g>`;
  return { supply, orbit };
}

interface StructureLayers {
  world: Readonly<World>;
  sprites: Sprites;
  forms: NeuronForms;
  stocks: ReadonlyMap<string, number>;
  cells: ReadonlyMap<string, ReadonlySet<number>>;
}

function structureItem(
  s: Structure,
  { world, sprites, forms, stocks, cells }: StructureLayers,
): KeyedItem {
  const at = hexCenter(world.map.width, s.cell);
  const { x, y } = at;
  const slot = slotFor(world, s.ownerId);
  const stock = stocks.get(`${s.ownerId}:${s.cell}`) ?? 0;
  const artwork =
    s.kind === "neuron"
      ? neuronForm(world, s, at, slot, forms, cells.get(s.ownerId))
      : buildingArt(world.map.width, s, at, slot, sprites);
  const hit = structureHit(s);
  const health = structureHealth(s, at);
  const { supply, orbit } = structureSupply(s, at, stock, slot);
  const markup = `<g class="structure structure-${s.kind} ${s.connected ? "" : "disconnected"}" data-cell="${s.cell}" style="--team:${colors[slot]}"><ellipse class="contact-shadow" cx="${x + 4}" cy="${y + 19}" rx="${s.kind === "neuron" ? 23 : 34}" ry="16" fill="url(#contact-shadow)"/>${supply}<circle class="owner-ring" cx="${x}" cy="${y}" r="${s.kind === "brain" ? 27 : 10}"/>${artwork || `<circle class="structure-core" cx="${x}" cy="${y}" r="15"/>`}${orbit}${health}<ellipse class="structure-hit" cx="${x}" cy="${y + hit.offset}" rx="${hit.rx}" ry="${hit.ry}"/></g>`;
  return { key: `s${s.id}`, markup };
}

export function structureItems(
  world: Readonly<World>,
  sprites: Sprites,
  neurons: Map<number, NeuronVisual>,
  memo: { neurons: NeuronMemo },
): KeyedItem[] {
  const stocks = new Map<string, number>();
  for (const particle of world.particles) {
    if (particle.mode !== "stationed") continue;
    const key = `${particle.ownerId}:${particle.cell}`;
    stocks.set(key, (stocks.get(key) ?? 0) + 1);
  }
  const forms: NeuronForms = {
    previous: memo.neurons,
    next: new Map(),
    visuals: neurons,
  };
  const layers = {
    world,
    sprites,
    forms,
    stocks,
    cells: ownedCells(world.structures),
  };
  const items = [...world.structures]
    .sort((a, b) => a.cell - b.cell)
    .map((s) => structureItem(s, layers));
  memo.neurons = forms.next;
  return items;
}
