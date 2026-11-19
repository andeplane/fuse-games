import * as THREE from "three";
import { GATE_X } from "../../engine/view-kit.js";
import type { Theme } from "../looks.js";
import { DECK_DEPTH, UNIT } from "../stage-kit.js";
import { DECK_LEN, TEX_W, TEX_H, deckPainter } from "./deck-paint.js";
import {
  box,
  dot,
  lamp,
  mesh,
  painted,
  scatter,
  surface,
  tint,
} from "./kit.js";
import { addScenery, type Animate } from "./scenery.js";

/**
 * The place a match is played in, for one look: the sky, the lamps, the deck with its painted lines, the rails the
 * surges ride, the arch they come out of, the pit, the scenery and whatever drifts in the air. All of it is built
 * from the look's theme; nothing here reads the match beyond how many lanes and footholds to paint.
 */
export { DECK_LEN } from "./deck-paint.js";
export const PIT_Y = -3.4,
  RAIL_Z = DECK_DEPTH / 2 + 0.14,
  ARCH_X = 10.2;

export interface StageSet {
  group: THREE.Group;
  fog: THREE.Fog;
  /** Paints the deck for a match's lanes and footholds. */
  layout(lanes: number, maxHits: number): void;
  /** `flow` is how far the surges have run in all, world units; `flipping` lights the flip gate. */
  update(nowMs: number, dtMs: number, flow: number, flipping: boolean): void;
}

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uLow;
varying vec3 vDir;
void main() {
  float h = normalize(vDir).y;
  vec3 col = mix(uLow, uMid, smoothstep(-0.25, 0.12, h));
  col = mix(col, uTop, smoothstep(0.1, 0.75, h));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const PIT_VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;
const PIT_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform vec3 uFog;
uniform float uCrust;
uniform float uGlow;
uniform float uSpeed;
uniform float uScale;
varying vec3 vWorld;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
  return v;
}
void main() {
  vec2 p = vWorld.xz * uScale;
  vec2 flow = vec2(uTime * uSpeed, uTime * uSpeed * 0.6);
  float w = fbm(p + flow);
  float ridge = 1.0 - abs(2.0 * fbm(p * 1.7 - flow * 1.4 + w) - 1.0);
  float m = mix(w * 1.3, pow(ridge, 3.0), uCrust);
  vec3 col = mix(uA, uB, smoothstep(0.25, 0.7, m));
  col = mix(col, uC, smoothstep(0.7, 1.0, m));
  col *= uGlow;
  col = mix(col, uFog, smoothstep(26.0, 110.0, length(vWorld.xz - vec2(5.0, 0.0))));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
export function buildSet(theme: Theme, doc: Document): StageSet {
  const group = new THREE.Group();
  const animators: Animate[] = [];
  const random = scatter(11);
  const deck = theme.deck;

  // ---- sky, air and lamps ----
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(150, 24, 16),
    new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      uniforms: {
        uTop: { value: tint(theme.sky.top) },
        uMid: { value: tint(theme.sky.mid) },
        uLow: { value: tint(theme.sky.low) },
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    }),
  );
  sky.renderOrder = -10;
  group.add(sky);
  const sprite = dot(doc);
  const fog = new THREE.Fog(
    tint(theme.fog.color),
    theme.fog.near,
    theme.fog.far,
  );
  group.add(
    new THREE.HemisphereLight(
      tint(theme.hemi.sky),
      tint(theme.hemi.ground),
      theme.hemi.power,
    ),
  );
  const sun = new THREE.DirectionalLight(
    tint(theme.sun.color),
    theme.sun.power,
  );
  sun.position.set(
    4.6 + theme.sun.from[0],
    theme.sun.from[1],
    theme.sun.from[2],
  );
  sun.target.position.set(4.6, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -9,
    right: 9,
    top: 7,
    bottom: -7,
    near: 1,
    far: 40,
  });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  group.add(sun, sun.target);
  // A soft lamp from the camera's side, so nothing facing it goes black.
  const fill = new THREE.DirectionalLight(tint(theme.hemi.sky), 0.45);
  fill.position.set(9, 4, 9);
  group.add(fill);
  if (theme.under.power > 0) {
    const under = new THREE.PointLight(
      tint(theme.under.color),
      theme.under.power,
      18,
      1.6,
    );
    under.position.set(-1.4, -1.7, 0.5);
    group.add(under);
  }

  // ---- the deck ----
  const topMaterial = surface({
    color: "#ffffff",
    rough: deck.rough,
    metal: deck.metal,
  });
  const sideMaterial = surface({
    color: deck.side,
    rough: Math.min(1, deck.rough + 0.15),
    metal: deck.metal,
  });
  const trimMaterial = surface({
    color: deck.trim,
    rough: 0.4,
    metal: deck.metal,
    glow: deck.glow * 0.7,
  });
  const slab = mesh(
    box(DECK_LEN, 0.5, DECK_DEPTH),
    [
      sideMaterial,
      sideMaterial,
      topMaterial,
      sideMaterial,
      sideMaterial,
      sideMaterial,
    ],
    [DECK_LEN / 2, -0.25, 0],
    "receive",
  );
  group.add(slab);
  let painted_ = "";
  const layout = (lanes: number, maxHits: number) => {
    const key = `${lanes}:${maxHits}`;
    if (key === painted_) return;
    painted_ = key;
    const paintDeck = deckPainter(theme, lanes, maxHits);
    topMaterial.map?.dispose();
    topMaterial.map = painted(doc, TEX_W, TEX_H, (c) => paintDeck(c, false));
    if (deck.glow > 0) {
      topMaterial.emissiveMap?.dispose();
      topMaterial.emissiveMap = painted(doc, TEX_W, TEX_H, (c) =>
        paintDeck(c, true),
      );
      topMaterial.emissive = new THREE.Color(0xffffff);
      topMaterial.emissiveIntensity = deck.glow;
    }
    topMaterial.needsUpdate = true;
  };
  // The rim along the back and the front, and the rails on it.
  for (const side of [-1, 1]) {
    group.add(
      mesh(
        box(DECK_LEN, 0.62, 0.3),
        sideMaterial,
        [DECK_LEN / 2, -0.31, side * RAIL_Z],
        "both",
      ),
      mesh(
        box(DECK_LEN, 0.07, 0.12),
        trimMaterial,
        [DECK_LEN / 2, 0.035, side * RAIL_Z],
        "both",
      ),
    );
  }
  // The lip over the pit.
  group.add(
    mesh(
      box(0.1, 0.12, DECK_DEPTH + 0.58),
      lamp(theme.danger, 1 + deck.glow * 0.5),
      [-0.05, -0.08, 0],
      "none",
    ),
  );
  // Lights that run along the rails with the surges, so the speed can be seen.
  const RUNNERS = 14,
    runnerGap = DECK_LEN / RUNNERS;
  const runners = new THREE.InstancedMesh(
    box(0.3, 0.03, 0.07),
    lamp(deck.glow > 0 ? deck.line : "#ffffff", deck.glow > 0 ? 1.6 : 1),
    RUNNERS * 2,
  );
  runners.frustumCulled = false;
  group.add(runners);
  const placing = new THREE.Matrix4();

  // The flip gate's posts.
  const gateLamp = lamp(theme.flip, 1);
  gateLamp.toneMapped = false;
  const gateColor = tint(theme.flip);
  for (const side of [-1, 1]) {
    group.add(
      mesh(
        new THREE.CylinderGeometry(0.06, 0.09, 1, 10),
        sideMaterial,
        [GATE_X * UNIT, 0.5, side * (RAIL_Z + 0.22)],
        "both",
      ),
      mesh(
        new THREE.OctahedronGeometry(0.15, 0),
        gateLamp,
        [GATE_X * UNIT, 1.16, side * (RAIL_Z + 0.22)],
        "none",
      ),
    );
  }

  // The arch the surges come out of, dark inside.
  const archZ = DECK_DEPTH / 2 + 0.85;
  for (const side of [-1, 1])
    group.add(
      mesh(
        box(1.1, 4.2, 0.9),
        sideMaterial,
        [ARCH_X + 0.55, 1.6, side * archZ],
        "both",
      ),
      mesh(
        box(0.08, 3.4, 0.1),
        trimMaterial,
        [ARCH_X - 0.02, 1.7, side * (archZ - 0.5)],
        "none",
      ),
    );
  group.add(
    mesh(
      box(1.1, 0.9, archZ * 2 + 0.9),
      sideMaterial,
      [ARCH_X + 0.55, 3.85, 0],
      "both",
    ),
    mesh(
      box(0.08, 0.1, archZ * 2 - 0.9),
      trimMaterial,
      [ARCH_X - 0.02, 3.4, 0],
      "none",
    ),
    mesh(
      box(0.1, 3.5, archZ * 2 - 0.8),
      new THREE.MeshBasicMaterial({
        color: tint(deck.side).multiplyScalar(0.12),
      }),
      [ARCH_X + 1.05, 1.7, 0],
      "none",
    ),
    mesh(
      box(DECK_LEN - ARCH_X - 1.1, 4.6, archZ * 2 + 0.9),
      sideMaterial,
      [(DECK_LEN + ARCH_X + 1.1) / 2, 1.8, 0],
      "cast",
    ),
  );

  // What holds the deck up.
  const underMaterial = surface({
    color: deck.underColor,
    rough: 0.85,
    metal: deck.metal * 0.6,
    flat: deck.under === "rock",
  });
  if (deck.under === "pylons") {
    for (let x = 1.1; x < DECK_LEN; x += 3.1)
      for (const side of [-1, 1])
        group.add(
          mesh(box(0.7, 7, 0.7), underMaterial, [x, -4, side * 1.7], "none"),
        );
    group.add(
      mesh(
        box(DECK_LEN, 0.35, 0.5),
        underMaterial,
        [DECK_LEN / 2, -0.8, 1.7],
        "none",
      ),
      mesh(
        box(DECK_LEN, 0.35, 0.5),
        underMaterial,
        [DECK_LEN / 2, -0.8, -1.7],
        "none",
      ),
    );
  } else {
    for (let i = 0; i < 11; i++) {
      const radius = 1.3 + random() * 1.3,
        height = 2.2 + random() * 3.2;
      const spike = mesh(
        new THREE.ConeGeometry(radius, height, 6).rotateX(Math.PI),
        underMaterial,
        [0.9 + i * 1.15, -0.5 - height / 2, (random() - 0.5) * 3.4],
        "none",
      );
      spike.rotation.y = random() * Math.PI;
      group.add(spike);
    }
    group.add(
      mesh(
        box(DECK_LEN - 0.3, 0.7, DECK_DEPTH + 3.2),
        underMaterial,
        [DECK_LEN / 2 + 0.15, -0.86, -1.3],
        "none",
      ),
    );
  }
  // A ledge behind the back rail, for the scenery to stand on.
  const LEDGE_Z = -(RAIL_Z + 0.15 + 0.9);
  group.add(
    mesh(
      box(DECK_LEN, 0.5, 1.8),
      [
        sideMaterial,
        sideMaterial,
        surface({ color: deck.ledge, rough: 0.95, metal: deck.metal * 0.5 }),
        sideMaterial,
        sideMaterial,
        sideMaterial,
      ],
      [DECK_LEN / 2, -0.25, LEDGE_Z],
      "receive",
    ),
  );

  // ---- the pit ----
  const pitMaterial = new THREE.ShaderMaterial({
    vertexShader: PIT_VERTEX,
    fragmentShader: PIT_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uA: { value: tint(theme.pit.a) },
      uB: { value: tint(theme.pit.b) },
      uC: { value: tint(theme.pit.c) },
      uFog: { value: tint(theme.fog.color) },
      uCrust: { value: theme.pit.crust },
      uGlow: { value: theme.pit.glow },
      uSpeed: { value: theme.pit.speed },
      uScale: { value: theme.pit.scale },
    },
    fog: false,
  });
  const pit = new THREE.Mesh(
    new THREE.PlaneGeometry(320, 320).rotateX(-Math.PI / 2),
    pitMaterial,
  );
  pit.position.set(5, PIT_Y, 0);
  group.add(pit);

  addScenery(theme.props, {
    group,
    animators,
    random,
    archX: ARCH_X,
    ledgeZ: LEDGE_Z,
    pitY: PIT_Y,
  });

  // ---- what drifts in the air ----
  const motes = theme.motes;
  const spots = new Float32Array(motes.count * 3),
    sway = new Float32Array(motes.count);
  for (let i = 0; i < motes.count; i++) {
    spots[i * 3] = -4 + random() * 18;
    spots[i * 3 + 1] = PIT_Y + random() * 10;
    spots[i * 3 + 2] = -6 + random() * 11;
    sway[i] = random() * 6.28;
  }
  const moteGeometry = new THREE.BufferGeometry().setAttribute(
    "position",
    new THREE.BufferAttribute(spots, 3),
  );
  const moteMaterial = new THREE.PointsMaterial({
    size: motes.size * 2.2,
    map: sprite,
    color: tint(motes.color).multiplyScalar(motes.glow ? 2 : 1),
    transparent: true,
    opacity: motes.glow ? 0.9 : 0.85,
    depthWrite: false,
    blending: motes.glow ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  moteMaterial.toneMapped = !motes.glow;
  const cloud = new THREE.Points(moteGeometry, moteMaterial);
  cloud.frustumCulled = false;
  group.add(cloud);

  return {
    group,
    fog,
    layout,
    update(nowMs, dtMs, flow, flipping) {
      const t = nowMs / 1000,
        dt = dtMs / 1000;
      pitMaterial.uniforms.uTime!.value = t;
      for (const animate of animators) animate(t, dt);
      for (let i = 0; i < motes.count; i++) {
        let y = spots[i * 3 + 1]! + motes.rise * dt;
        if (y > PIT_Y + 10) y -= 10;
        if (y < PIT_Y) y += 10;
        spots[i * 3 + 1] = y;
        spots[i * 3] =
          spots[i * 3]! + Math.sin(t * 0.7 + sway[i]!) * motes.drift * dt;
      }
      moteGeometry.attributes.position!.needsUpdate = true;
      const run = ((flow % runnerGap) + runnerGap) % runnerGap;
      for (let i = 0; i < RUNNERS; i++) {
        const x = Math.max(0.15, DECK_LEN - i * runnerGap - run);
        placing.makeTranslation(x, 0.08, -RAIL_Z);
        runners.setMatrixAt(i * 2, placing);
        placing.makeTranslation(x, 0.08, RAIL_Z);
        runners.setMatrixAt(i * 2 + 1, placing);
      }
      runners.instanceMatrix.needsUpdate = true;
      gateLamp.color
        .copy(gateColor)
        .multiplyScalar(flipping ? 1.6 + 1.2 * Math.sin(nowMs / 70) : 0.9);
    },
  };
}
