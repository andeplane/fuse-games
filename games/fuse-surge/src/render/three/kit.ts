import * as THREE from "three";

/** Small tools the 3D picture is built with. Nothing here knows about the match. */

export const tint = (hex: string): THREE.Color => new THREE.Color(hex);

/** A cheap, seeded scatter for decoration: the same set every time a look is built. */
export function scatter(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A texture painted on a 2D canvas. */
export function painted(
  doc: Document,
  width: number,
  height: number,
  paint: (c: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.CanvasTexture {
  const canvas = doc.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const c = canvas.getContext("2d");
  if (c) paint(c, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

export interface Surface {
  color: string;
  rough?: number;
  metal?: number;
  /** A colour it shines with, and how strongly. */
  glow?: number;
  glowColor?: string;
  flat?: boolean;
  opacity?: number;
  map?: THREE.Texture;
}
export function surface(spec: Surface): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: tint(spec.color),
    roughness: spec.rough ?? 0.7,
    metalness: spec.metal ?? 0,
    flatShading: spec.flat === true,
  });
  if (spec.glow) {
    material.emissive = tint(spec.glowColor ?? spec.color);
    material.emissiveIntensity = spec.glow;
  }
  if (spec.opacity !== undefined && spec.opacity < 1) {
    material.transparent = true;
    material.opacity = spec.opacity;
  }
  if (spec.map) material.map = spec.map;
  return material;
}

/** Light itself: a colour the lamps do not change. `power` above 1 feeds the bloom. */
export function lamp(color: string, power = 1): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: tint(color).multiplyScalar(power),
  });
  material.toneMapped = power <= 1;
  return material;
}

export function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
  at: readonly [number, number, number] = [0, 0, 0],
  shadows: "cast" | "both" | "receive" | "none" = "both",
): THREE.Mesh {
  const made = new THREE.Mesh(geometry, material);
  made.position.set(at[0], at[1], at[2]);
  made.castShadow = shadows === "cast" || shadows === "both";
  made.receiveShadow = shadows === "receive" || shadows === "both";
  return made;
}

export const box = (w: number, h: number, d: number) =>
  new THREE.BoxGeometry(w, h, d);
/** A cylinder lying across the deck, along z. */
export const bar = (
  radius: number,
  length: number,
  sides = 24,
  radiusEnd = radius,
) =>
  new THREE.CylinderGeometry(radius, radiusEnd, length, sides).rotateX(
    Math.PI / 2,
  );

/**
 * Frees everything under `root` that holds GPU memory: geometry, materials and their textures, the instance
 * buffers of an instanced mesh, and the shadow map of a lamp that casts one.
 */
export function release(root: THREE.Object3D): void {
  const seen = new Set<THREE.Material>();
  root.traverse((node) => {
    if (node instanceof THREE.InstancedMesh) node.dispose();
    if (
      node instanceof THREE.DirectionalLight ||
      node instanceof THREE.PointLight ||
      node instanceof THREE.SpotLight
    )
      node.shadow.dispose();
    const held = node as Partial<THREE.Mesh>;
    held.geometry?.dispose();
    const materials = Array.isArray(held.material)
      ? held.material
      : held.material
        ? [held.material]
        : [];
    for (const material of materials) {
      if (seen.has(material)) continue;
      seen.add(material);
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) value.dispose();
      if (material instanceof THREE.ShaderMaterial)
        for (const uniform of Object.values(material.uniforms))
          if (uniform.value instanceof THREE.Texture) uniform.value.dispose();
      material.dispose();
    }
  });
}

/** A soft round dot, for points and glows. */
export const dot = (doc: Document): THREE.CanvasTexture =>
  painted(doc, 64, 64, (c) => {
    const fade = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    fade.addColorStop(0, "rgba(255,255,255,1)");
    fade.addColorStop(0.45, "rgba(255,255,255,0.55)");
    fade.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = fade;
    c.fillRect(0, 0, 64, 64);
  });
