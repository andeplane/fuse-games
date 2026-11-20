import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { Theme } from "../looks.js";
import { bar, box, lamp, mesh, surface } from "./kit.js";

export type Animate = (seconds: number, dtSeconds: number) => void;

interface SceneryStage {
  group: THREE.Group;
  animators: Animate[];
  random: () => number;
  archX: number;
  ledgeZ: number;
  pitY: number;
}

const place = <T extends THREE.Object3D>(
  made: T,
  x: number,
  y: number,
  z: number,
): T => {
  made.position.set(x, y, z);
  return made;
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

interface SceneryContext {
  group: THREE.Group;
  animators: Animate[];
  random: () => number;
  pick<T>(items: readonly T[]): T;
  onLedge(count: number, make: (x: number, z: number) => THREE.Object3D): void;
  rock: (radius: number, color: string, opacity?: number) => THREE.Mesh;
  ledgeZ: number;
  pitY: number;
}

const builders: Record<Theme["props"], (scenery: SceneryContext) => void> = {
  reactor({ group, animators, random, pick, onLedge }) {
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
  },
  isle({ group, animators, random, pick, onLedge, rock }) {
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
  },
  toys({ group, random, pick, onLedge, pitY }) {
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
          pitY + size * 0.35 + random() * 3,
          -9 - random() * 12,
        ],
        "none",
      );
      far.rotation.set(random(), random() * 3, random());
      group.add(far);
    }
  },
  ice({ group, random, onLedge, rock, pitY }) {
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
          pitY + height / 2 - 0.3,
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
  },
  forge({ group, animators, random, pick, onLedge, ledgeZ }) {
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
        [5, 1.5, ledgeZ - 0.75],
        "cast",
      ),
    );
  },
};

/** Add scenery with the same seeded scatter stream as the rest of the set. */
export function addScenery(
  theme: Theme["props"],
  { group, animators, random, archX, ledgeZ, pitY }: SceneryStage,
): void {
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(random() * items.length)]!;
  const onLedge = (
    count: number,
    make: (x: number, z: number) => THREE.Object3D,
  ) => {
    for (let i = 0; i < count; i++) {
      const x = 0.5 + ((i + 0.2 + random() * 0.6) / count) * (archX - 1);
      group.add(make(x, ledgeZ + (random() - 0.5) * 1.0));
    }
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

  builders[theme]({
    group,
    animators,
    random,
    pick,
    onLedge,
    rock,
    ledgeZ,
    pitY,
  });
}
