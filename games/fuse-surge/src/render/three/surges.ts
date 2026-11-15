import * as THREE from "three";
import type { SurgeView, WorldView } from "../../engine/view.js";
import {
  HIGH,
  HIGH_BOTTOM,
  HIGH_TOP,
  LOW_TOP,
  SPAWN_X,
  TALL,
  TALL_TOP,
} from "../../engine/view-kit.js";
import type { RollerStyle, Theme } from "../looks.js";
import { DECK_DEPTH, UNIT, laneZ } from "../stage-kit.js";
import {
  bar,
  box,
  lamp,
  mesh,
  painted,
  release,
  surface,
  tint,
} from "./kit.js";
import { ARCH_X, RAIL_Z } from "./set.js";

/**
 * What comes down the deck, as models. Every surge is the look's roller, so the three kinds differ only in where it
 * sits, which is exactly what the rules strike:
 *
 * - low: one roller on the deck, as high as a rider must jump;
 * - high: one roller floating at head height on an axle between two thin posts that ride the rails, with clear air
 *   under it to duck through and over it to double-jump across;
 * - tall: a stack of three from the deck up, with no gap, in a colour of its own.
 *
 * A bolt is the Warden's: a ball in one lane, rolling on the deck (jump it) or hovering at head height (duck it).
 */
const SPAN = DECK_DEPTH + 0.5,
  LOW_R = (LOW_TOP * UNIT) / 2,
  /** Drawn a touch above the rule's line, so a ducked head is seen to clear it. */
  HIGH_LOW = HIGH_BOTTOM * UNIT + 0.03,
  HIGH_R = (HIGH_TOP * UNIT - HIGH_LOW) / 2,
  HIGH_Y = HIGH_LOW + HIGH_R,
  CAP_R = 0.2,
  CAP_Y = TALL_TOP * UNIT - CAP_R;

interface Paint {
  style: RollerStyle;
  color: string;
  accent: string;
  glow: number;
}

function stripes(
  doc: Document,
  a: string,
  b: string,
  slant: number,
): THREE.CanvasTexture {
  const texture = painted(doc, 128, 128, (c) => {
    c.fillStyle = a;
    c.fillRect(0, 0, 128, 128);
    c.strokeStyle = b;
    c.lineWidth = 32;
    for (let i = -2; i < 5; i++) {
      c.beginPath();
      c.moveTo(i * 64, 0);
      c.lineTo(i * 64 + slant * 128, 128);
      c.stroke();
    }
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** A roller of the look's kind lying across the deck, `length` long, about its own axis: what turns as it rolls. */
function buildWheel(
  paint: Paint,
  radius: number,
  length: number,
  doc: Document,
): THREE.Group {
  const wheel = new THREE.Group();
  wheel.name = "wheel";
  switch (paint.style) {
    case "coil": {
      wheel.add(
        mesh(
          bar(radius * 0.66, length, 20),
          surface({ color: "#1a2350", rough: 0.35, metal: 0.8 }),
        ),
      );
      const hot = lamp(paint.color, paint.glow);
      const rings = Math.round(length / 0.52);
      for (let i = 0; i <= rings; i++)
        wheel.add(
          mesh(
            new THREE.TorusGeometry(radius * 0.82, radius * 0.2, 8, 20),
            hot,
            [0, 0, -length / 2 + 0.25 + (i * (length - 0.5)) / rings],
            "cast",
          ),
        );
      for (let i = 0; i < 3; i++) {
        const turn = (i * Math.PI * 2) / 3;
        const fin = mesh(
          box(0.035, radius * 0.5, length - 0.5),
          lamp(paint.accent, paint.glow),
          [Math.cos(turn) * radius * 0.78, Math.sin(turn) * radius * 0.78, 0],
          "none",
        );
        fin.rotation.z = turn + Math.PI / 2;
        wheel.add(fin);
      }
      break;
    }
    case "log": {
      const bark = surface({ color: paint.color, rough: 1, flat: true });
      const cut = surface({ color: paint.accent, rough: 0.9 });
      wheel.add(mesh(bar(radius, length, 11), [bark, cut, cut]));
      for (let i = 0; i < 7; i++) {
        const turn = i * 2.4;
        wheel.add(
          mesh(new THREE.DodecahedronGeometry(radius * 0.35, 0), bark, [
            Math.cos(turn) * radius * 0.95,
            Math.sin(turn) * radius * 0.95,
            -length / 2 + 0.5 + (i * (length - 1)) / 6,
          ]),
        );
      }
      for (const z of [-length / 2 + 0.25, length / 2 - 0.25])
        wheel.add(
          mesh(
            bar(radius * 1.06, 0.12, 11),
            surface({ color: "#5d4a3a", rough: 0.6, metal: 0.4 }),
            [0, 0, z],
          ),
        );
      break;
    }
    case "candy": {
      const wrap = stripes(doc, paint.accent, paint.color, 0.7);
      wrap.repeat.set(3, 9);
      wheel.add(
        mesh(
          bar(radius, length - radius * 2, 28),
          surface({ color: "#ffffff", rough: 0.3, map: wrap }),
        ),
      );
      for (const z of [-1, 1])
        wheel.add(
          mesh(
            new THREE.SphereGeometry(radius, 24, 16),
            surface({ color: paint.color, rough: 0.3 }),
            [0, 0, z * (length / 2 - radius)],
          ),
        );
      break;
    }
    case "prism": {
      wheel.add(
        mesh(
          bar(radius * 1.04, length, 6),
          surface({
            color: paint.color,
            rough: 0.06,
            metal: 0.1,
            flat: true,
            opacity: 0.93,
            glow: paint.glow * 0.3,
          }),
        ),
        mesh(
          bar(radius * 0.3, length - 0.2, 6),
          lamp(paint.accent, 1 + paint.glow),
          [0, 0, 0],
          "none",
        ),
      );
      break;
    }
    case "ingot": {
      const heat = painted(doc, 128, 64, (c, w, h) => {
        c.fillStyle = paint.color;
        c.fillRect(0, 0, w, h);
        for (let i = 0; i < 46; i++) {
          c.fillStyle = i % 3 ? paint.accent : "#7a2408";
          c.globalAlpha = 0.5;
          c.beginPath();
          c.ellipse(
            (i * 53) % w,
            (i * 29) % h,
            5 + (i % 5) * 3,
            3 + (i % 4),
            i,
            0,
            7,
          );
          c.fill();
        }
      });
      heat.wrapS = heat.wrapT = THREE.RepeatWrapping;
      heat.repeat.set(2, 6);
      const glowing = new THREE.MeshBasicMaterial({
        map: heat,
        color: tint("#ffffff").multiplyScalar(paint.glow),
      });
      glowing.toneMapped = false;
      wheel.add(
        mesh(bar(radius * 0.84, length, 20), glowing, [0, 0, 0], "cast"),
      );
      const flange = surface({ color: "#2a2c31", rough: 0.5, metal: 0.8 });
      for (let i = 0; i < 6; i++)
        wheel.add(
          mesh(bar(radius, 0.14, 8), flange, [
            0,
            0,
            -length / 2 + 0.2 + (i * (length - 0.4)) / 5,
          ]),
        );
      break;
    }
  }
  return wheel;
}

/** The light a glowing roller throws on the deck under it. */
function pool(color: string, doc: Document): THREE.Mesh {
  return mesh(
    new THREE.PlaneGeometry(1.5, SPAN).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: tint(color),
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      map: painted(doc, 64, 8, (c, w, h) => {
        const fade = c.createLinearGradient(0, 0, w, 0);
        fade.addColorStop(0, "#000000");
        fade.addColorStop(0.5, "#ffffff");
        fade.addColorStop(1, "#000000");
        c.fillStyle = fade;
        c.fillRect(0, 0, w, h);
      }),
    }),
    [0, 0.016, 0],
    "none",
  );
}

/** Two thin posts on the rails, up to an axle at `height`: what holds a roller in the air. */
function posts(theme: Theme, height: number): THREE.Group {
  const stand = new THREE.Group();
  const frame = surface({
    color: theme.deck.side,
    rough: 0.5,
    metal: theme.deck.metal,
  });
  for (const side of [-1, 1])
    stand.add(
      mesh(box(0.34, 0.12, 0.2), frame, [0, 0.12, side * RAIL_Z]),
      mesh(box(0.07, height, 0.07), frame, [0, height / 2, side * RAIL_Z]),
      mesh(bar(0.09, 0.12, 10), frame, [0, height, side * RAIL_Z]),
    );
  stand.add(mesh(bar(0.03, RAIL_Z * 2, 8), frame, [0, height, 0], "none"));
  return stand;
}

/** A surge across the deck, of `kind`. Its wheels are named so the crew can turn them. */
function buildSurge(kind: number, theme: Theme, doc: Document): THREE.Group {
  const made = new THREE.Group();
  const low: Paint = theme.low,
    high: Paint = { style: theme.low.style, ...theme.high },
    tall: Paint = {
      style: theme.low.style,
      color: theme.tall,
      accent: theme.high.accent,
      glow: theme.low.glow,
    };
  const place = (paint: Paint, radius: number, y: number, length: number) => {
    const wheel = buildWheel(paint, radius, length, doc);
    wheel.position.y = y;
    made.add(wheel);
  };
  if (kind === HIGH) {
    made.add(posts(theme, HIGH_Y));
    place(high, HIGH_R, HIGH_Y, SPAN - 0.5);
  } else if (kind === TALL) {
    made.add(posts(theme, CAP_Y));
    place(tall, LOW_R, LOW_R, SPAN - 0.5);
    place(tall, HIGH_R, HIGH_Y, SPAN - 0.5);
    place(tall, CAP_R, CAP_Y, SPAN - 0.5);
    if (theme.low.glow > 0) made.add(pool(theme.tall, doc));
  } else {
    place(low, LOW_R, LOW_R, SPAN);
    if (theme.low.glow > 0) made.add(pool(theme.low.color, doc));
  }
  return made;
}

/** A bolt: a ball in one lane, rolling on the deck or hovering at head height in a ring. */
function buildBolt(kind: number, theme: Theme): THREE.Group {
  const made = new THREE.Group();
  const paint = kind === HIGH ? theme.high : theme.low;
  const radius = kind === HIGH ? HIGH_R : LOW_R,
    y = kind === HIGH ? HIGH_Y : LOW_R;
  const skin =
    paint.glow > 0
      ? lamp(paint.color, paint.glow)
      : surface({ color: paint.color, rough: 0.3 });
  const band = surface({ color: paint.accent, rough: 0.4 });
  const ball = new THREE.Group();
  ball.name = "wheel";
  ball.position.y = y;
  ball.add(
    mesh(new THREE.SphereGeometry(radius, 20, 14), skin),
    mesh(new THREE.TorusGeometry(radius * 0.98, radius * 0.16, 8, 20), band),
  );
  made.add(ball);
  if (kind === HIGH) {
    // What it hovers in: a ring that tilts and turns, and a thread of light down to the deck.
    const halo = mesh(
      new THREE.TorusGeometry(radius * 1.45, 0.025, 6, 28).rotateX(Math.PI / 2),
      lamp(paint.accent, 1 + paint.glow * 0.4),
      [0, y, 0],
      "none",
    );
    halo.name = "halo";
    made.add(halo);
  }
  return made;
}

interface SurgeParts {
  model: THREE.Group;
  /** What turns as it rolls, a bolt's ring, and how far a turn takes it. */
  wheels: { node: THREE.Object3D; radius: number }[];
  halo: THREE.Object3D | undefined;
}
interface SurgeActor extends SurgeParts {
  root: THREE.Group;
  /** What it was built as: the kind, and whether it is a bolt. */
  shape: number;
  marker: THREE.Mesh;
  seen: number;
}
export interface SurgeCrew {
  group: THREE.Group;
  /** Shows the view's surges; `live` is 1 while a round is played and falls to 0 as it ends. */
  show(view: WorldView, nowMs: number, live: number): void;
  /** Each surge across the deck: its near end in the world and how faded it is, for the arrows. */
  each(
    visit: (surge: SurgeView, near: THREE.Vector3, dim: number) => void,
  ): void;
}

export function buildSurges(theme: Theme, doc: Document): SurgeCrew {
  const group = new THREE.Group();
  const actors = new Map<number, SurgeActor>();
  const flipLamp = lamp(theme.flip, 2);
  const flipShape = new THREE.OctahedronGeometry(0.2, 0);
  const near = new THREE.Vector3();
  let frame = 0;
  const shown: { surge: SurgeView; x: number; y: number; dim: number }[] = [];
  // Every marker shares one shape and one lamp; this hidden one keeps them in the scene, so they are freed with it
  // even when no surge is on the deck.
  const keeper = mesh(flipShape, flipLamp, [0, 0, 0], "none");
  keeper.visible = false;
  group.add(keeper);
  const shapeOf = (surge: SurgeView) => surge.kind + (surge.lane >= 0 ? 10 : 0);
  /** A model for a surge, with the parts that move found once. */
  const parts = (surge: SurgeView): SurgeParts => {
    const model =
      surge.lane >= 0
        ? buildBolt(surge.kind, theme)
        : buildSurge(surge.kind, theme, doc);
    const wheels: SurgeParts["wheels"] = [];
    model.traverse((node) => {
      if (node.name !== "wheel") return;
      // Every wheel turns at the rate of one rolling on the deck, whatever its size or height.
      wheels.push({ node, radius: LOW_R });
    });
    return { model, wheels, halo: model.getObjectByName("halo") };
  };
  return {
    group,
    show(view, nowMs, live) {
      frame++;
      shown.length = 0;
      const t = nowMs / 1000;
      const lanes = view.riders.length;
      for (const surge of view.surges) {
        let actor = actors.get(surge.id);
        const shape = shapeOf(surge);
        if (!actor) {
          const root = new THREE.Group();
          const marker = mesh(flipShape, flipLamp, [0, 0, 0], "none");
          actor = { root, shape, marker, seen: 0, ...parts(surge) };
          root.add(actor.model, marker);
          group.add(root);
          actors.set(surge.id, actor);
        } else if (actor.shape !== shape) {
          // It flipped at the gate: the other kind takes its place.
          actor.root.remove(actor.model);
          release(actor.model);
          actor.shape = shape;
          Object.assign(actor, parts(surge));
          actor.root.add(actor.model);
        }
        actor.seen = frame;
        const x = surge.x * UNIT;
        // Past the deck's edge it drops into the pit; fresh out of the arch it grows to full size.
        const over = Math.max(0, -x);
        const fall = over * over * 2.6;
        const grown = Math.min(
          1,
          Math.max(0.2, (SPAWN_X * UNIT - x) / 0.5 + 0.2),
        );
        actor.root.position.set(
          x,
          -fall,
          surge.lane >= 0 ? laneZ(surge.lane, lanes) : 0,
        );
        actor.root.rotation.z = over * 0.5;
        const size = Math.max(0.001, live) * grown;
        actor.root.scale.set(size, size, surge.lane >= 0 ? size : 1);
        actor.root.visible = live > 0.02;
        for (const wheel of actor.wheels)
          wheel.node.rotation.z = (-x / wheel.radius) % (Math.PI * 2);
        if (actor.halo) {
          actor.halo.rotation.x = Math.sin(t * 2.3 + surge.id) * 0.5;
          actor.halo.rotation.y = t * 3;
        }
        actor.marker.visible = surge.flips;
        actor.marker.rotation.y = t * 4;
        actor.marker.position.y =
          (surge.kind === HIGH ? HIGH_Y + HIGH_R + 0.45 : 1.0) +
          Math.sin(t * 6) * 0.06;
        if (surge.lane < 0)
          shown.push({
            surge,
            x,
            y: -fall,
            dim: live * Math.min(1, Math.max(0, 1 + x / 1.1)),
          });
      }
      for (const [id, actor] of actors)
        if (actor.seen !== frame) {
          group.remove(actor.root);
          release(actor.model);
          actors.delete(id);
        }
    },
    each(visit) {
      for (const item of shown)
        visit(item.surge, near.set(item.x, item.y, RAIL_Z + 0.2), item.dim);
    },
  };
}

// ---- the Warden ----
export interface Warden {
  group: THREE.Group;
  /** Shows it (or not) and moves it by the wall clock. */
  show(visible: boolean, nowMs: number, dtMs: number): void;
  /** It throws a volley: the hands punch forward and the eye flares. */
  hurl(): void;
}

/**
 * The boss over the arch: a hovering head with one eye, two horns, a ring and two loose hands. It is scenery with a
 * cue; what it "throws" is the bolts the rules send, which leave the arch below it.
 */
export function buildWarden(theme: Theme): Warden {
  const group = new THREE.Group();
  const shell = surface({
    color: theme.deck.side,
    rough: 0.45,
    metal: Math.max(0.2, theme.deck.metal),
  });
  const trim = surface({
    color: theme.deck.trim,
    rough: 0.4,
    metal: theme.deck.metal,
    glow: theme.deck.glow * 0.7,
  });
  const eyeLamp = lamp(theme.danger, 1.2);
  const head = new THREE.Group();
  const eye = mesh(
    new THREE.SphereGeometry(0.2, 20, 14),
    eyeLamp,
    [-0.44, 0.02, 0],
  );
  eye.scale.set(0.5, 1, 1.25);
  const brow = mesh(box(0.2, 0.09, 0.62), shell, [-0.5, 0.26, 0]);
  brow.rotation.z = -0.25;
  head.add(
    mesh(new THREE.SphereGeometry(0.56, 28, 20), shell),
    eye,
    brow,
    mesh(
      new THREE.TorusGeometry(0.57, 0.05, 8, 32).rotateX(Math.PI / 2),
      trim,
      [0, -0.12, 0],
    ),
  );
  for (const side of [-1, 1]) {
    const horn = mesh(new THREE.ConeGeometry(0.13, 0.5, 8), trim, [
      0.02,
      0.62,
      side * 0.3,
    ]);
    horn.rotation.x = side * 0.5;
    head.add(horn);
  }
  const halo = mesh(
    new THREE.TorusGeometry(0.86, 0.03, 6, 40).rotateX(Math.PI / 2),
    lamp(theme.danger, 1 + theme.deck.glow * 0.6),
    [0, 0, 0],
    "none",
  );
  const hands = [-1, 1].map((side) => {
    const hand = new THREE.Group();
    hand.add(
      mesh(new THREE.SphereGeometry(0.18, 16, 12), shell),
      mesh(new THREE.TorusGeometry(0.18, 0.04, 6, 20), trim),
    );
    hand.position.set(-0.25, -0.5, side * 0.95);
    return hand;
  });
  group.add(head, halo, ...hands);
  group.position.set(ARCH_X - 0.45, 3.0, 0);
  // Turned toward the camera, so its eye is on the riders and on you.
  group.rotation.y = 0.8;
  group.visible = false;
  const danger = tint(theme.danger);
  let punch = 0;
  return {
    group,
    show(visible, nowMs, dtMs) {
      group.visible = visible;
      if (!visible) return;
      const t = nowMs / 1000;
      punch = Math.max(0, punch - dtMs / 380);
      group.position.y = 3.0 + Math.sin(t * 1.7) * 0.08;
      head.rotation.z = Math.sin(t * 0.9) * 0.05 + punch * 0.25;
      halo.rotation.x = Math.sin(t * 0.8) * 0.35;
      halo.rotation.y = t * 1.2;
      eyeLamp.color
        .copy(danger)
        .multiplyScalar(1.1 + punch * 1.6 + 0.15 * Math.sin(t * 5));
      eye.scale.set(0.5, 1 + punch * 0.5, 1.25 + punch * 0.4);
      hands.forEach((hand, index) => {
        const side = index ? 1 : -1;
        hand.position.set(
          -0.25 - punch * 0.75,
          -0.5 + Math.sin(t * 2.1 + index * 2) * 0.07 + punch * 0.15,
          side * (0.95 - punch * 0.25),
        );
        hand.rotation.z = t * 1.5 * side;
      });
    },
    hurl() {
      punch = 1;
    },
  };
}
