import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GATE_X, START_X, footholds } from "../../engine/view-kit.js";
import type { Theme } from "../looks.js";
import { laneColor } from "../palette.js";
import { DECK_DEPTH, UNIT } from "../stage-kit.js";
import {
  bar,
  box,
  dot,
  lamp,
  mesh,
  painted,
  scatter,
  surface,
  tint,
} from "./kit.js";

/**
 * The place a match is played in, for one look: the sky, the lamps, the deck with its painted lines, the rails the
 * surges ride, the arch they come out of, the pit, the scenery and whatever drifts in the air. All of it is built
 * from the look's theme; nothing here reads the match beyond how many lanes and footholds to paint.
 */
export const DECK_LEN = 12.8,
  PIT_Y = -3.4,
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
const TEX_W = 2048,
  TEX_H = 1024;

/** The deck's top, painted: the look's floor, then the lanes, the footholds, the flip gate and the edge. */
function paintDeck(
  c: CanvasRenderingContext2D,
  theme: Theme,
  lanes: number,
  maxHits: number,
  glowOnly: boolean,
): void {
  const px = (x: number) => (x / DECK_LEN) * TEX_W,
    pz = (z: number) => ((z + DECK_DEPTH / 2) / DECK_DEPTH) * TEX_H;
  const deck = theme.deck,
    random = scatter(7);
  c.fillStyle = glowOnly ? "#000000" : deck.base;
  c.fillRect(0, 0, TEX_W, TEX_H);
  if (!glowOnly)
    switch (deck.pattern) {
      case "panel": {
        const pw = px(1.6),
          ph = TEX_H / 4;
        for (let i = 0; i * pw < TEX_W; i++)
          for (let j = 0; j < 4; j++) {
            if ((i + j) % 2) {
              c.fillStyle = deck.alt;
              c.fillRect(i * pw, j * ph, pw, ph);
            }
            c.strokeStyle = deck.seam;
            c.lineWidth = 5;
            c.strokeRect(i * pw, j * ph, pw, ph);
            c.fillStyle = deck.seam;
            for (const [dx, dy] of [
              [14, 14],
              [pw - 14, 14],
              [14, ph - 14],
              [pw - 14, ph - 14],
            ] as const) {
              c.beginPath();
              c.arc(i * pw + dx, j * ph + dy, 4, 0, Math.PI * 2);
              c.fill();
            }
          }
        break;
      }
      case "stone": {
        c.fillStyle = deck.seam;
        c.fillRect(0, 0, TEX_W, TEX_H);
        const rows = 8,
          th = TEX_H / rows,
          tw = px(0.82);
        const a = tint(deck.base),
          b = tint(deck.alt);
        for (let row = 0; row < rows; row++)
          for (let col = -1; col * tw < TEX_W; col++) {
            c.fillStyle = `#${a.clone().lerp(b, random()).getHexString()}`;
            c.beginPath();
            c.roundRect(
              col * tw + (row % 2 ? tw / 2 : 0) + 3,
              row * th + 3,
              tw - 6,
              th - 6,
              7,
            );
            c.fill();
          }
        c.fillStyle = "rgba(60,45,25,0.10)";
        for (let i = 0; i < 900; i++)
          c.fillRect(random() * TEX_W, random() * TEX_H, 3, 3);
        break;
      }
      case "checker": {
        const size = TEX_H / 8,
          wide = px((DECK_DEPTH / 8) * 1);
        for (let i = 0; i * wide < TEX_W; i++)
          for (let j = 0; j < 8; j++)
            if ((i + j) % 2) {
              c.fillStyle = deck.alt;
              c.fillRect(i * wide, j * size, wide, size);
            }
        break;
      }
      case "ice": {
        const wash = c.createLinearGradient(0, 0, TEX_W, TEX_H);
        wash.addColorStop(0, deck.base);
        wash.addColorStop(0.5, deck.alt);
        wash.addColorStop(1, deck.base);
        c.fillStyle = wash;
        c.fillRect(0, 0, TEX_W, TEX_H);
        c.lineCap = "round";
        for (let i = 0; i < 70; i++) {
          let x = random() * TEX_W,
            y = random() * TEX_H;
          c.strokeStyle = `rgba(255,255,255,${0.18 + random() * 0.3})`;
          c.lineWidth = 1 + random() * 2.5;
          c.beginPath();
          c.moveTo(x, y);
          for (let k = 0; k < 4; k++) {
            x += (random() - 0.5) * 220;
            y += (random() - 0.5) * 160;
            c.lineTo(x, y);
          }
          c.stroke();
        }
        c.fillStyle = "rgba(255,255,255,0.7)";
        for (let i = 0; i < 260; i++)
          c.fillRect(random() * TEX_W, random() * TEX_H, 2, 2);
        break;
      }
      case "plate": {
        const step = px(0.17);
        c.fillStyle = deck.alt;
        for (let i = 0; i * step < TEX_W; i++)
          for (let j = 0; j * step < TEX_H; j++) {
            c.save();
            c.translate(i * step + step / 2, j * step + step / 2);
            c.rotate(((i + j) % 2 ? 1 : -1) * 0.7);
            c.fillRect(-step * 0.34, -2.5, step * 0.68, 5);
            c.restore();
          }
        c.strokeStyle = deck.seam;
        c.lineWidth = 6;
        for (let x = px(2.4); x < TEX_W; x += px(2.4)) {
          c.beginPath();
          c.moveTo(x, 0);
          c.lineTo(x, TEX_H);
          c.stroke();
          c.fillStyle = deck.seam;
          for (let j = 0; j < 9; j++) {
            c.beginPath();
            c.arc(x + 16, 40 + j * 118, 6, 0, Math.PI * 2);
            c.arc(x - 16, 40 + j * 118, 6, 0, Math.PI * 2);
            c.fill();
          }
          c.fillStyle = deck.alt;
        }
        break;
      }
    }

  const laneH = TEX_H / lanes;
  // Each lane wears its rider's colour, and has a pad where that rider starts.
  for (let lane = 0; lane < lanes; lane++) {
    if (!glowOnly) {
      c.globalAlpha = 0.09;
      c.fillStyle = laneColor(lane);
      c.fillRect(0, lane * laneH, TEX_W, laneH);
    }
    c.globalAlpha = glowOnly ? 0.75 : 0.95;
    c.strokeStyle = laneColor(lane);
    c.lineWidth = 9;
    c.beginPath();
    c.roundRect(
      px(START_X * UNIT - 0.28),
      lane * laneH + laneH * 0.2,
      px(0.56),
      laneH * 0.6,
      18,
    );
    c.stroke();
    c.globalAlpha = 1;
  }
  c.strokeStyle = deck.line;
  c.globalAlpha = glowOnly ? 0.5 : 0.6;
  for (let lane = 0; lane <= lanes; lane++) {
    const edge = lane === 0 || lane === lanes;
    c.lineWidth = edge ? 10 : 4;
    const y = Math.min(TEX_H - 5, Math.max(5, lane * laneH));
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(TEX_W, y);
    c.stroke();
  }
  c.globalAlpha = 1;
  const cross = (x: number, color: string, width: number, dash: number[]) => {
    c.strokeStyle = color;
    c.lineWidth = width;
    c.setLineDash(dash);
    c.beginPath();
    c.moveTo(px(x), 0);
    c.lineTo(px(x), TEX_H);
    c.stroke();
    c.setLineDash([]);
  };
  // Footholds: one for every hit a rider can take, redder toward the edge.
  const steps = footholds(maxHits);
  const amber = tint("#ffb347"),
    danger = tint(theme.danger);
  steps.forEach((x, index) => {
    if (index === 0) return;
    const t = steps.length > 1 ? index / (steps.length - 1) : 1;
    cross(
      x * UNIT,
      `#${amber.clone().lerp(danger, t).getHexString()}`,
      8,
      [26, 20],
    );
  });
  cross(GATE_X * UNIT, theme.flip, 8, [10, 22]);
  // The edge over the pit.
  if (glowOnly) cross(0.06, theme.danger, 14, []);
  else {
    const stripe = px(0.34);
    c.save();
    c.beginPath();
    c.rect(0, 0, stripe, TEX_H);
    c.clip();
    c.fillStyle = theme.danger;
    c.fillRect(0, 0, stripe, TEX_H);
    c.strokeStyle = "rgba(10,10,20,0.75)";
    c.lineWidth = 22;
    for (let y = -stripe; y < TEX_H + stripe; y += 64) {
      c.beginPath();
      c.moveTo(-10, y);
      c.lineTo(stripe + 10, y + stripe + 20);
      c.stroke();
    }
    c.restore();
  }
}

type Animate = (seconds: number, dtSeconds: number) => void;

export function buildSet(theme: Theme, doc: Document): StageSet {
  const group = new THREE.Group();
  const animators: Animate[] = [];
  const random = scatter(11);
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(random() * items.length)]!;
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
    topMaterial.map?.dispose();
    topMaterial.map = painted(doc, TEX_W, TEX_H, (c) =>
      paintDeck(c, theme, lanes, maxHits, false),
    );
    if (deck.glow > 0) {
      topMaterial.emissiveMap?.dispose();
      topMaterial.emissiveMap = painted(doc, TEX_W, TEX_H, (c) =>
        paintDeck(c, theme, lanes, maxHits, true),
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

  // ---- scenery ----
  const onLedge = (
    count: number,
    make: (x: number, z: number) => THREE.Object3D,
  ) => {
    for (let i = 0; i < count; i++) {
      const x = 0.5 + ((i + 0.2 + random() * 0.6) / count) * (ARCH_X - 1);
      group.add(make(x, LEDGE_Z + (random() - 0.5) * 1.0));
    }
  };
  const tree = (height: number, leaf: string, cap?: string) => {
    const made = new THREE.Group();
    made.add(
      mesh(
        new THREE.CylinderGeometry(0.07, 0.1, height * 0.35, 6),
        surface({ color: "#7a5230", rough: 1, flat: true }),
        [0, height * 0.17, 0],
        "cast",
      ),
    );
    for (let tier = 0; tier < 3; tier++)
      made.add(
        mesh(
          new THREE.ConeGeometry(0.5 - tier * 0.12, height * 0.42, 7),
          surface({
            color: cap && tier === 2 ? cap : leaf,
            rough: 0.9,
            flat: true,
          }),
          [0, height * (0.42 + tier * 0.22), 0],
          "cast",
        ),
      );
    return made;
  };
  const rock = (radius: number, color: string, opacity = 1) => {
    const made = mesh(
      new THREE.DodecahedronGeometry(radius, 0),
      surface({ color, rough: opacity < 1 ? 0.12 : 0.95, flat: true, opacity }),
      [0, radius * 0.5, 0],
      "cast",
    );
    made.rotation.set(random() * 3, random() * 3, random() * 3);
    made.scale.set(1, 0.7 + random() * 0.5, 0.8 + random() * 0.4);
    return made;
  };
  const place = <T extends THREE.Object3D>(
    made: T,
    x: number,
    y: number,
    z: number,
  ): T => {
    made.position.set(x, y, z);
    return made;
  };

  switch (theme.props) {
    case "reactor": {
      const strips = ["#16e7ff", "#ff2e9d"];
      for (let i = 0; i < 11; i++) {
        const x = -8 + i * 2.9,
          z = -8.5 - (i % 2) * 1.5;
        group.add(
          mesh(
            box(1, 22, 1),
            surface({ color: "#0e1a4a", rough: 0.6, metal: 0.5 }),
            [x, 4, z],
            "none",
          ),
          mesh(
            box(0.1, 16, 0.06),
            lamp(strips[i % 2]!, 1.5),
            [x, 5, z + 0.54],
            "none",
          ),
        );
      }
      const core = new THREE.Group();
      const outer = mesh(
        new THREE.TorusGeometry(3.4, 0.16, 10, 56),
        lamp("#16e7ff", 1.6),
        [0, 0, 0],
        "none",
      );
      const inner = mesh(
        new THREE.TorusGeometry(2.4, 0.12, 10, 48),
        lamp("#ff2e9d", 1.6),
        [0, 0, 0],
        "none",
      );
      core.add(
        outer,
        inner,
        mesh(
          new THREE.IcosahedronGeometry(1.1, 1),
          lamp("#ffe9ff", 1.2),
          [0, 0, 0],
          "none",
        ),
      );
      group.add(place(core, 6.5, 0.2, -13));
      animators.push((t) => {
        outer.rotation.set(t * 0.3, t * 0.2, 0);
        inner.rotation.set(-t * 0.4, 0, t * 0.25);
      });
      onLedge(7, (x, z) => {
        const console_ = new THREE.Group();
        const tall = 0.5 + random() * 0.9;
        console_.add(
          mesh(
            box(0.7, tall, 0.5),
            surface({ color: "#13205a", rough: 0.5, metal: 0.5 }),
            [0, tall / 2, 0],
            "both",
          ),
          mesh(
            box(0.5, 0.16, 0.02),
            lamp(pick(strips), 2),
            [0, tall * 0.7, 0.26],
            "none",
          ),
        );
        return place(console_, x, 0, z);
      });
      break;
    }
    case "isle": {
      const greens = ["#4fae3d", "#63c04a", "#3f9a45"];
      onLedge(9, (x, z) =>
        random() < 0.65
          ? place(tree(1.3 + random() * 1.1, pick(greens)), x, 0, z)
          : place(rock(0.3 + random() * 0.25, "#b9ab95"), x, 0, z),
      );
      const islets: THREE.Object3D[] = [];
      for (const [x, y, z, size] of [
        [-7, -1.5, -11, 2.2],
        [3.5, 1.2, -17, 3],
        [13, -0.5, -12, 2.4],
        [20, 2.5, -22, 3.6],
        [-13, 3.5, -24, 3.2],
        [8, -3, -8, 1.3],
      ] as const) {
        const islet = new THREE.Group();
        islet.add(
          mesh(
            new THREE.ConeGeometry(size, size * 1.7, 7).rotateX(Math.PI),
            surface({ color: "#8a7358", rough: 1, flat: true }),
            [0, -size * 0.85, 0],
            "none",
          ),
          mesh(
            new THREE.CylinderGeometry(size * 1.02, size, 0.3, 7),
            surface({ color: "#6fbf4b", rough: 1, flat: true }),
            [0, 0.1, 0],
            "none",
          ),
        );
        for (let k = 0; k < 3; k++)
          islet.add(
            place(
              tree(size * (0.45 + random() * 0.3), pick(greens)),
              (random() - 0.5) * size,
              0.2,
              (random() - 0.5) * size,
            ),
          );
        islets.push(place(islet, x, y, z));
        group.add(islet);
      }
      const clouds: THREE.Object3D[] = [];
      const white = surface({ color: "#ffffff", rough: 1, flat: true });
      for (let i = 0; i < 9; i++) {
        const cloud = new THREE.Group();
        for (let k = 0; k < 5; k++) {
          const puff = mesh(
            new THREE.IcosahedronGeometry(0.9 + random() * 0.9, 1),
            white,
            [(k - 2) * 1.1, random() * 0.5, (random() - 0.5) * 1.2],
            "none",
          );
          puff.scale.y = 0.6;
          cloud.add(puff);
        }
        clouds.push(
          place(
            cloud,
            -24 + random() * 60,
            -1.5 + random() * 10,
            -14 - random() * 26,
          ),
        );
        group.add(cloud);
      }
      animators.push((t, dt) => {
        islets.forEach((islet, index) => {
          islet.position.y += Math.sin(t * 0.5 + index * 1.7) * 0.0025;
        });
        for (const cloud of clouds) {
          cloud.position.x += dt * 0.25;
          if (cloud.position.x > 38) cloud.position.x = -26;
        }
      });
      break;
    }
    case "toys": {
      const paints = [
        "#e58a7a",
        "#8fb8d9",
        "#f0c36a",
        "#a9cf8f",
        "#a99ad6",
        "#f0a56b",
      ];
      const toy = (color: string) => surface({ color, rough: 0.55 });
      onLedge(9, (x, z) => {
        const stack = new THREE.Group();
        const kind = random();
        if (kind < 0.5) {
          let y = 0;
          for (let k = 0; k < 1 + Math.floor(random() * 3); k++) {
            const size = 0.55 - k * 0.1;
            const cube = mesh(
              new RoundedBoxGeometry(size, size, size, 3, 0.06),
              toy(pick(paints)),
              [0, y + size / 2, 0],
              "both",
            );
            cube.rotation.y = random();
            stack.add(cube);
            y += size;
          }
        } else if (kind < 0.8)
          stack.add(
            mesh(
              new THREE.SphereGeometry(0.34, 24, 16),
              toy(pick(paints)),
              [0, 0.34, 0],
              "both",
            ),
          );
        else {
          stack.add(
            mesh(
              new THREE.CylinderGeometry(0.05, 0.05, 1, 10),
              toy("#ffffff"),
              [0, 0.5, 0],
              "both",
            ),
          );
          for (let k = 0; k < 4; k++) {
            const ring = mesh(
              new THREE.TorusGeometry(0.3 - k * 0.05, 0.09, 10, 24).rotateX(
                Math.PI / 2,
              ),
              toy(paints[k]!),
              [0, 0.1 + k * 0.19, 0],
              "both",
            );
            stack.add(ring);
          }
        }
        return place(stack, x, 0, z);
      });
      for (let i = 0; i < 16; i++) {
        const size = 1.6 + random() * 2.6;
        const far = mesh(
          random() < 0.6
            ? new RoundedBoxGeometry(size, size, size, 3, size * 0.1)
            : new THREE.SphereGeometry(size * 0.6, 24, 16),
          toy(pick(paints)),
          [
            -12 + i * 2.4 + random(),
            PIT_Y + size * 0.35 + random() * 3,
            -9 - random() * 12,
          ],
          "none",
        );
        far.rotation.set(random(), random() * 3, random());
        group.add(far);
      }
      break;
    }
    case "ice": {
      onLedge(9, (x, z) =>
        random() < 0.55
          ? place(tree(1.2 + random() * 1.2, "#2f6f63", "#f4fbff"), x, 0, z)
          : place(rock(0.3 + random() * 0.3, "#bfeaff", 0.85), x, 0, z),
      );
      const ice = surface({
        color: "#9fdcf5",
        rough: 0.18,
        flat: true,
        glow: 0.12,
        glowColor: "#4fd6ff",
      });
      for (let i = 0; i < 18; i++) {
        const height = 4 + random() * 9;
        const spire = mesh(
          new THREE.ConeGeometry(0.8 + random() * 1.4, height, 5),
          ice,
          [
            -12 + i * 2.1 + random(),
            PIT_Y + height / 2 - 0.3,
            -7.5 - random() * 14,
          ],
          "none",
        );
        spire.rotation.set(
          (random() - 0.5) * 0.25,
          random() * 3,
          (random() - 0.5) * 0.25,
        );
        group.add(spire);
      }
      break;
    }
    case "forge": {
      const steel = surface({ color: "#2b2e34", rough: 0.6, metal: 0.8 });
      const dark = surface({ color: "#17181b", rough: 0.8, metal: 0.6 });
      group.add(
        mesh(box(60, 30, 1), dark, [5, 6, -10], "none"),
        mesh(box(60, 0.6, 0.8), steel, [5, 7.2, -5], "none"),
        mesh(box(60, 0.6, 0.8), steel, [5, 7.2, 5.5], "none"),
      );
      for (let i = 0; i < 9; i++)
        group.add(
          mesh(box(0.9, 30, 0.9), steel, [-9 + i * 3.6, 6, -9.2], "none"),
        );
      for (const x of [-1.5, 5.4, 12.3]) {
        group.add(
          mesh(box(3.2, 2.6, 0.3), steel, [x, 2.6, -9.3], "none"),
          mesh(
            new THREE.PlaneGeometry(2.5, 1.9),
            lamp("#ff7a1a", 2.6),
            [x, 2.5, -9.1],
            "none",
          ),
          mesh(
            new THREE.PlaneGeometry(1.5, 1),
            lamp("#ffe08a", 2.4),
            [x, 2.25, -9.08],
            "none",
          ),
        );
      }
      for (const [x, z] of [
        [1.5, -5],
        [6.2, -5],
        [9, -5],
        [3.5, 5.5],
      ] as const) {
        const hanging = new THREE.Group();
        const drop = 2.2 + random() * 1.6;
        hanging.add(
          mesh(
            new THREE.CylinderGeometry(0.03, 0.03, drop, 6),
            dark,
            [0, -drop / 2, 0],
            "none",
          ),
          mesh(
            new THREE.TorusGeometry(0.2, 0.05, 8, 16, Math.PI * 1.4),
            steel,
            [0, -drop - 0.15, 0],
            "none",
          ),
        );
        group.add(place(hanging, x, 7, z));
        const phase = random() * 6;
        animators.push((t) => {
          hanging.rotation.z = Math.sin(t * 0.9 + phase) * 0.07;
        });
      }
      onLedge(8, (x, z) => {
        const kind = random();
        if (kind < 0.45)
          return place(
            mesh(
              new THREE.CylinderGeometry(0.28, 0.28, 0.8, 14),
              surface({
                color: pick(["#7a3b1e", "#3e5a6b", "#56595f"]),
                rough: 0.5,
                metal: 0.6,
              }),
              [0, 0.4, 0],
              "both",
            ),
            x,
            0,
            z,
          );
        const tall = 0.4 + random() * 0.5;
        return place(
          mesh(box(0.7, tall, 0.6), steel, [0, tall / 2, 0], "both"),
          x,
          0,
          z,
        );
      });
      group.add(
        mesh(
          bar(0.14, 14, 12).rotateY(Math.PI / 2),
          surface({ color: "#8a4a22", rough: 0.45, metal: 0.7 }),
          [5, 1.5, LEDGE_Z - 0.75],
          "cast",
        ),
      );
      break;
    }
  }

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
      for (let i = 0; i < RUNNERS; i++)
        for (let side = 0; side < 2; side++) {
          placing.makeTranslation(
            Math.max(0.15, DECK_LEN - i * runnerGap - run),
            0.08,
            (side ? 1 : -1) * RAIL_Z,
          );
          runners.setMatrixAt(i * 2 + side, placing);
        }
      runners.instanceMatrix.needsUpdate = true;
      gateLamp.color
        .copy(gateColor)
        .multiplyScalar(flipping ? 1.6 + 1.2 * Math.sin(nowMs / 70) : 0.9);
    },
  };
}
