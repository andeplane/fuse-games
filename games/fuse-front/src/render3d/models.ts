/**
 * Procedural models in Z's chunky style, built once from three.js primitives: a model is a list of parts, one merged
 * geometry per paint, so a unit kind draws as a few instanced meshes. Team colour goes on the large `team` surfaces
 * (white here, tinted per instance); trims are dark metal and visors glow. Every part carries baked vertex colour —
 * dirt toward the feet, shade under overhangs, worn bright edges — and the metal paints share one procedural panel
 * map (grooves, seams, rivets, grime streaks) for their normals, roughness and colour. The robot units and heroes are
 * built from the concept kit in `kit/`, and walk on its shared leg so each instance can swing them. Models face
 * +z and stand on y = 0, one tile is one unit of length.
 * Presentation only: nothing here reads or writes the simulation.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { BuildingKind, HeroView, UnitKind } from "../engine/view.js";
import { hash, normalMap, tileNoise } from "./terrain.js";
import { decalAtlas } from "./kit/decals.js";
import { conceptBuilding } from "./kit/buildings.js";
import { heroModel } from "./kit/heroes.js";
import type { Detail, V3 } from "./kit/rig.js";

// prettier-ignore
export const PAINTS = {
  team: { color: 0xffffff, roughness: 0.42, metalness: 0.25 },
  steel: { color: 0x7d838a, roughness: 0.3, metalness: 0.85 },
  /** The radar dish is an open shell, seen from inside as often as from behind. */
  dish: { color: 0x9aa0a6, roughness: 0.35, metalness: 0.8, side: THREE.DoubleSide },
  dark: { color: 0x26282c, roughness: 0.65, metalness: 0.55 },
  orange: { color: 0xe0701c, roughness: 0.5, metalness: 0.3 },
  gold: { color: 0xe8b828, roughness: 0.45, metalness: 0.45 },
  visor: { color: 0x082028, emissive: 0x38e8ff, emissiveIntensity: 2.2, roughness: 0.15, metalness: 0.2 },
  flame: { color: 0x301008, emissive: 0xff7a1c, emissiveIntensity: 2.4, roughness: 0.4, metalness: 0 },
  amber: { color: 0x302008, emissive: 0xffd028, emissiveIntensity: 2.2, roughness: 0.15, metalness: 0.2 },
  eye: { color: 0x300808, emissive: 0xff2a2a, emissiveIntensity: 3, roughness: 0.2, metalness: 0 },
  concrete: { color: 0xb4ab9a, roughness: 0.92, metalness: 0 },
  glass: { color: 0x9fd4e4, roughness: 0.08, metalness: 0.7 },
  hazard: { color: 0xffffff, roughness: 0.6, metalness: 0.2 },
  char: { color: 0x2a2420, roughness: 1, metalness: 0 },
  /** Sandbags round the turrets' pads and the flags' bases. */
  sand: { color: 0xc4a46c, roughness: 0.95, metalness: 0 },
  /** Track rubber: links scroll along z by the instance colour's red channel (`treadPhase`), so it is never tinted. */
  tread: { color: 0x2c2a28, roughness: 0.9, metalness: 0.2 },
  /** Near-black gunmetal for weapons. */
  gun: { color: 0x1f2124, roughness: 0.45, metalness: 0.7 },
  /** Stencilled squad numbers: cut out of the shared atlas (`decalAtlas`) and drawn just over the plate under them. */
  decal: { color: 0xffffff, roughness: 0.7, metalness: 0, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 },
} as const;
export type Paint = keyof typeof PAINTS;
/** The paints the panel map details. */
const DETAILED: readonly Paint[] = [
  "team",
  "steel",
  "dark",
  "orange",
  "gold",
  "gun",
];

export interface Part {
  paint: Paint;
  geometry: THREE.BufferGeometry;
}
export type Model = Part[];

export const HERO_KINDS = ["brick", "vix", "rivet", "tally"] as const;
export type HeroKind = (typeof HERO_KINDS)[number];
export type ModelKind = UnitKind | "tankTurret" | HeroKind;
/** Shared parts drawn per instance: a mine. Walkers' legs are `kit/units`' robot leg. */
export type PartKind = "mine";

function texture(data: Uint8Array, n: number, srgb = false): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, n, n);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = tex.needsUpdate = true;
  return tex;
}

/** Yellow and black diagonal stripes for doors, 16 × 16 texels. */
function hazardTexture(): THREE.DataTexture {
  const n = 16,
    data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const on = ((i % n) + Math.floor(i / n)) % 8 < 4;
    data.set(on ? [240, 196, 32, 255] : [24, 22, 20, 255], i * 4);
  }
  const tex = texture(data, n, true);
  tex.magFilter = THREE.NearestFilter;
  tex.repeat.set(2, 1);
  return tex;
}

const PANEL = {
  border: 0.035,
  borderGroove: 0.022,
  rim: 0.04,
  seams: { left: 0.18, right: 0.82, lower: 0.62, upper: 0.94, width: 0.012 },
  rivets: { inset: 0.09, outer: 0.91, waist: 0.35, radius: 0.03 },
} as const;

/** One armour panel per face: a rounded rim, a boxed-in seam, rivets and hammered grain. */
export function panelHeights(n: number): Float32Array {
  const grain = tileNoise(n, 6, 21);
  const heights = new Float32Array(n * n);
  const { seams, rivets } = PANEL;
  const bump = (distance: number, radius: number) =>
    Math.max(0, 1 - (distance / radius) ** 2);
  const columns = Array.from({ length: Math.ceil(n) }, (_, x) => {
    const u = (x + 0.5) / n;
    return {
      edge: Math.min(u, 1 - u),
      insideSeam: u > seams.left && u < seams.right,
      seam: bump(
        Math.min(Math.abs(u - seams.left), Math.abs(u - seams.right)),
        seams.width,
      ),
      rivet: Math.min(Math.abs(u - rivets.inset), Math.abs(u - rivets.outer)),
    };
  });
  for (let y = 0; y < n; y++) {
    const v = (y + 0.5) / n;
    const rowEdge = Math.min(v, 1 - v);
    const inUpperPanel = v > seams.lower && v < seams.upper;
    const rowSeam = bump(Math.abs(v - seams.lower), seams.width);
    const rowRivet = Math.min(
      Math.abs(v - rivets.inset),
      Math.abs(v - rivets.outer),
      Math.abs(v - rivets.waist),
    );
    for (let x = 0; x < n; x++) {
      const column = columns[x]!;
      const edge = Math.min(column.edge, rowEdge);
      const seam =
        (inUpperPanel ? column.seam : 0) + (column.insideSeam ? rowSeam : 0);
      const rivet = bump(Math.hypot(column.rivet, rowRivet), rivets.radius);
      const index = y * n + x;
      heights[index] =
        -bump(edge - PANEL.border, PANEL.borderGroove) -
        0.6 * Math.min(1, seam) +
        0.8 * Math.sqrt(rivet) +
        (grain[index]! - 0.3) * 0.12 +
        Math.min(edge, PANEL.rim) * 3;
    }
  }
  return heights;
}

/**
 * The shared panel maps: normals from `panelHeights`; roughness (green) dirtier in the grooves and smoother on
 * scuffs; and a grime colour map (multiplied into the paint) darker in the grooves, streaked down each face.
 */
// prettier-ignore
export function detailMaps(n = 64): { normal: THREE.DataTexture; rough: THREE.DataTexture; grime: THREE.DataTexture } {
  const h = panelHeights(n), streaks = tileNoise(n, 12, 23), mottle = tileNoise(n, 4, 25);
  const rough = new Uint8Array(n * n * 4), grime = new Uint8Array(n * n * 4);
  const pixel = new Uint8Array([0, 0, 0, 255]);
  for (let i = 0; i < n * n; i++) {
    const groove = Math.max(0, -h[i]!), streak = Math.max(0, streaks[i % n]! - 0.45);
    const g = Math.min(255, Math.max(0, Math.round(215 + h[i]! * -90 - (mottle[i]! > 0.62 ? 50 : 0))));
    pixel[0] = pixel[1] = pixel[2] = g;
    rough.set(pixel, i * 4);
    const k = Math.round(255 * Math.min(1, Math.max(0.4, 0.97 + (mottle[i]! - 0.4) * 0.15 - groove * 0.3 - streak * 0.6)));
    pixel[0] = k;
    pixel[1] = Math.round(k * 0.985);
    pixel[2] = Math.round(k * 0.96);
    grime.set(pixel, i * 4);
  }
  const map = texture(grime, n, true);
  return { normal: texture(normalMap(h, n, 2.2), n), rough: texture(rough, n), grime: map };
}

/** Puts the panel maps on the metal paints, or takes them off (`maps` undefined: low quality). */
export function setDetail(
  paints: Record<Paint, THREE.MeshStandardMaterial>,
  maps?: { normal: THREE.Texture; rough: THREE.Texture; grime?: THREE.Texture },
): void {
  for (const paint of DETAILED) {
    paints[paint].normalMap = maps?.normal ?? null;
    paints[paint].roughnessMap = maps?.rough ?? null;
    paints[paint].map = maps?.grime ?? null;
    paints[paint].normalScale.setScalar(0.7);
    paints[paint].needsUpdate = true;
  }
}

/**
 * Track links: the tread paint's rubber darkens between links that run along z with the instance's phase, which
 * arrives as the instance colour's red channel and so is never applied as a tint.
 */
export function patchTread(shader: {
  vertexShader: string;
  fragmentShader: string;
}): void {
  const head = "varying float vTread;\n";
  shader.vertexShader =
    head +
    shader.vertexShader.replace(
      "#include <color_vertex>",
      "vTread = position.z * 16.0 + instanceColor.r;",
    );
  shader.fragmentShader =
    head +
    shader.fragmentShader.replace(
      "#include <color_fragment>",
      "diffuseColor.rgb *= 0.4 + 0.6 * smoothstep(0.25, 0.4, fract(vTread));",
    );
}

/** One PBR material per paint; dispose each (and the hazard map) when done. Detail maps go on with `setDetail`. */
export function paintMaterials(): Record<Paint, THREE.MeshStandardMaterial> {
  const out = {} as Record<Paint, THREE.MeshStandardMaterial>;
  for (const [paint, spec] of Object.entries(PAINTS) as [Paint, object][])
    out[paint] = new THREE.MeshStandardMaterial({
      ...spec,
      vertexColors: paint !== "tread",
    });
  out.hazard.map = hazardTexture();
  out.decal.map = decalAtlas();
  out.tread.onBeforeCompile = patchTread;
  out.tread.customProgramCacheKey = () => "tread";
  return out;
}

/**
 * Bakes grime into a geometry's vertex colour: darker toward `floor` (contact shade and dust), darker facing down,
 * a little mottled, and brighter where the normal leans off every axis — a bevel's worn edge.
 */
// prettier-ignore
export function shade(g: THREE.BufferGeometry, floor = 0, span = 0.35): THREE.BufferGeometry {
  const p = g.getAttribute("position"), n = g.getAttribute("normal"), c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
    const edge = 1 - Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz));
    const ao = (0.55 + 0.45 * Math.min(1, Math.max(0, (p.getY(i) - floor) / span))) * (0.82 + 0.18 * (ny * 0.5 + 0.5));
    const mottle = 0.9 + 0.1 * hash(Math.round(p.getX(i) * 40), Math.round(p.getY(i) * 40 + p.getZ(i) * 17), 7);
    const color = ao * mottle * (1 + edge * 0.9);
    const offset = i * 3;
    c[offset] = c[offset + 1] = c[offset + 2] = color;
  }
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  return g;
}

/** Flatten and merge a builder's owned parts, then release the temporary geometry. */
export function mergeOwnedParts(
  geometries: THREE.BufferGeometry[],
  prepare: (part: THREE.BufferGeometry, index: number) => void,
): THREE.BufferGeometry {
  const owned = new Set(geometries);
  try {
    if (geometries.length === 0)
      throw new RangeError("No geometry parts to merge");
    const parts = geometries.map((geometry, index) => {
      const part = geometry.index ? geometry.toNonIndexed() : geometry;
      owned.add(part);
      prepare(part, index);
      return part;
    });
    const merged = mergeGeometries(parts);
    if (!merged) throw new Error("Geometry parts have incompatible attributes");
    return merged;
  } finally {
    for (const part of owned) part.dispose();
  }
}

/** Bake one shaded, non-indexed mesh per paint. The input parts belong to the builder. */
export function bakePaintGroups(
  groups: ReadonlyMap<Paint, THREE.BufferGeometry[]>,
  floor: number,
  span: number,
): Model {
  return [...groups].map(([paint, geometries]) => {
    const geometry = mergeOwnedParts(geometries, (part) => {
      shade(part, floor, span);
      part.clearGroups();
    });
    geometry.computeBoundingBox();
    return { paint, geometry };
  });
}

/** Collects primitives by paint and merges each paint into one shaded geometry. */
class Kit {
  private readonly groups = new Map<Paint, THREE.BufferGeometry[]>();
  constructor(
    private readonly floor = 0,
    private readonly span = 0.35,
  ) {}
  add(paint: Paint, ...geometries: THREE.BufferGeometry[]): this {
    const list = this.groups.get(paint);
    if (list) list.push(...geometries);
    else this.groups.set(paint, geometries);
    return this;
  }
  build(): Model {
    return bakePaintGroups(this.groups, this.floor, this.span);
  }
}

const ORIGIN: V3 = [0, 0, 0];
type Tilt = readonly [aroundX: number, aroundZ: number];

function at(
  geometry: THREE.BufferGeometry,
  position: V3,
  [aroundX, aroundZ]: Tilt = [0, 0],
): THREE.BufferGeometry {
  return geometry
    .rotateX(aroundX)
    .rotateZ(aroundZ)
    .translate(...position);
}

/** Rounded floor plate with its bevel limited by the thinnest dimension. */
function floorPlate(
  w: number,
  h: number,
  d: number,
  bevel: number,
): THREE.BufferGeometry {
  return new RoundedBoxGeometry(
    w,
    h,
    d,
    2,
    Math.min(bevel, w / 2.2, h / 2.2, d / 2.2),
  );
}

interface RodShape {
  topRadius: number;
  bottomRadius?: number;
  height: number;
  segments?: number;
}

/** A straight or tapered cylinder along +y before placement. */
function rod(
  { topRadius, bottomRadius = topRadius, height, segments = 12 }: RodShape,
  position: V3,
  tilt?: Tilt,
): THREE.BufferGeometry {
  return at(
    new THREE.CylinderGeometry(topRadius, bottomRadius, height, segments),
    position,
    tilt,
  );
}

/** Vix's sticky mine: a dark puck with a team band and three prongs; its light blinks on its own. */
// prettier-ignore
function mine(): Model {
  return new Kit().add("dark", rod({ topRadius: 0.11, bottomRadius: 0.13, height: 0.05, segments: 14 }, [0, 0.025, 0]))
    .add("team", rod({ topRadius: 0.115, height: 0.02, segments: 14 }, [0, 0.045, 0]))
    .add("steel", ...[0, 2.1, 4.2].map((a) => rod({ topRadius: 0.012, height: 0.09 }, [Math.sin(a) * 0.1, 0.06, Math.cos(a) * 0.1], [0.5, 0])))
    .build();
}

/** Which hero model a hero wears: its `kind`'s (Brick for one without a model). */
export function heroKindOf(hero: HeroView): HeroKind {
  return HERO_KINDS.find((k) => k === hero.kind) ?? "brick";
}

/** A hero's model (built by `kit/heroes`); its legs stand still in it unless `moving` parts are left out. */
export function unitModel(
  kind: HeroKind,
  moving = true,
  detail: Detail = "near",
): Model {
  return heroModel(kind, detail, moving);
}

export function partModel(kind: PartKind): Model {
  return { mine }[kind]();
}

/** The ground ring's outer radius under a body, in tiles: bigger bodies, bigger rings. */
export const RING: Record<UnitKind | "hero", number> = {
  grunt: 0.27,
  torch: 0.33,
  lightTank: 0.46,
  sentry: 0.3,
  hero: 0.56,
};

export interface BuildingModel {
  body: Model;
  /** A part on a pivot above the roof: the fort's radar dish spins, the turret's head aims. */
  pivot?: { model: Model; x: number; y: number; z: number; aims: boolean };
  /** Where smoke leaves the chimney. */
  smoke?: [number, number, number];
  /** The roof's height, for the health bar. */
  height: number;
}

/** A building's model at a level of detail (built by `kit/buildings`). */
export function buildingModel(
  kind: BuildingKind,
  detail: Detail = "near",
): BuildingModel {
  return conceptBuilding(kind, detail);
}

/** A burnt-out ruin over a `w` × `d` footprint: a charred floor, broken wall stumps and bent rebar. */
// prettier-ignore
export function ruinModel(w: number, d: number, seed: number): Model {
  let s = seed * 9301 + 49297;
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const kit = new Kit().add("char", at(floorPlate(w * 0.95, 0.08, d * 0.95, 0.02), [0, 0.04, 0]));
  for (let i = 0; i < 7; i++) {
    const cw = 0.15 + r() * w * 0.3, ch = 0.12 + r() * 0.4, cd = 0.15 + r() * d * 0.25;
    const chunk = at(new THREE.BoxGeometry(cw, ch, cd), ORIGIN, [(r() - 0.5) * 0.6, 0]).rotateY(r() * 3).translate((r() - 0.5) * w * 0.75, ch / 2, (r() - 0.5) * d * 0.75);
    kit.add(i % 3 ? "concrete" : "char", chunk);
  }
  for (let i = 0; i < 4; i++)
    kit.add("steel", rod({ topRadius: 0.012, height: 0.35 }, [(r() - 0.5) * w * 0.7, 0.16, (r() - 0.5) * d * 0.7], [(r() - 0.5) * 1.2, (r() - 0.5) * 1.2]));
  return kit.build();
}

/** Turns `from` toward `to` by at most `step` radians, the short way round. */
export function approachAngle(from: number, to: number, step: number): number {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return Math.abs(delta) <= step ? to : from + Math.sign(delta) * step;
}

/** How high a body bobs this frame: a walking hop while it moves, a slow breath while it stands. */
export function bob(
  moving: boolean,
  now: number,
  id: number,
  tracked: boolean,
): number {
  if (tracked) return moving ? Math.abs(Math.sin(now / 45 + id)) * 0.008 : 0;
  return moving
    ? Math.abs(Math.sin(now / 95 + id)) * 0.045
    : (Math.sin(now / 700 + id) + 1) * 0.006;
}

/** A leg's swing in radians (forward positive) this frame: in step with `bob`'s hop, the two sides opposite. */
export function legSwing(
  moving: boolean,
  now: number,
  id: number,
  side: number,
): number {
  return moving ? Math.sin(now / 95 + id) * 0.6 * side : 0;
}

/** How far back (tiles) a gun has kicked `ms` after it fired: a sharp kick that eases home within 220 ms. */
export function recoil(ms: number): number {
  return ms >= 0 && ms < 220 ? 0.07 * (1 - ms / 220) ** 2 : 0;
}

/** Where a tank's track links stand: its position along its heading, so they roll exactly as far as it drives. */
export function treadPhase(x: number, z: number, yaw: number): number {
  const d = (x * Math.sin(yaw) + z * Math.cos(yaw)) * 16;
  return d - Math.floor(d);
}

/** Bends a flag cloth's vertices (built along +x from the pole) into a travelling wave; the pole edge stays put. */
export function waveCloth(
  base: ArrayLike<number>,
  out: { setZ(i: number, z: number): unknown },
  now: number,
): void {
  for (let i = 0; i < base.length / 3; i++) {
    const x = base[i * 3]!;
    out.setZ(
      i,
      Math.sin(x * 9 - now / 160) * 0.09 * x + Math.sin(now / 500) * 0.04 * x,
    );
  }
}
