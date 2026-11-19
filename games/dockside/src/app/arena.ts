import * as THREE from "three";
import { createRadar } from "./radar.js";
import {
  FIELD,
  LANES,
  TURRETS,
  GATE,
  factoryX,
  depotZ,
  teamSign,
  headingAngle,
  jumpHeight,
  lockedUnit,
  type World,
} from "../game/canal.js";
export const COLORS = ["#49dae5", "#ff9259"];
const neutral = "#c9c6b5";
export function createArena(host: HTMLElement, overview = false) {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-label", "Canal Lock arena");
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x142935);
  const scene = new THREE.Scene(),
    wide = new THREE.OrthographicCamera(-40, 40, 24, -24, 0.1, 220),
    chase = new THREE.PerspectiveCamera(48, 1, 0.1, 220);
  let camera: THREE.Camera = wide;
  scene.add(new THREE.HemisphereLight(0xfff3db, 0x506779, 1.9));
  const sun = new THREE.DirectionalLight(0xffebc8, 2);
  sun.position.set(-30, 60, 16);
  scene.add(sun);
  const cube = new THREE.BoxGeometry(1, 1, 1),
    cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  function material(c: string) {
    let m = materials.get(c);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.88 });
      materials.set(c, m);
    }
    return m;
  }
  function part(
    parent: THREE.Object3D,
    c: string,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    geo: THREE.BufferGeometry = cube,
  ) {
    const mesh = new THREE.Mesh(geo, material(c));
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    parent.add(mesh);
    return mesh;
  }
  function label(text: string, css: string) {
    const node = document.createElement("span");
    node.className = "dockside-map-label " + css;
    node.textContent = text;
    host.append(node);
    return node;
  }
  host.append(canvas);
  const hf = FIELD.x / 100,
    depth = FIELD.z / 100,
    water = FIELD.water / 100;
  part(scene, "#285567", 0, -1.5, 0, hf * 2, 1, depth * 2);
  part(scene, "#24424d", 0, -2.2, 0, 240, 1, 240);
  for (const side of [-1, 1]) {
    part(scene, "#394f58", 0, 0.45, side * (depth + 0.6), hf * 2 + 2, 1.8, 1.1);
    for (let k = -4; k <= 4; k++) {
      const h = 3 + (Math.abs(k * 7 + side * 3) % 5);
      part(scene, "#4b626b", k * 8, h / 2 - 0.7, side * (depth + 4), 6, h, 4);
      part(
        scene,
        "#70838a",
        k * 8,
        h - 0.6,
        side * (depth + 4),
        6.25,
        0.3,
        4.25,
      );
    }
    part(scene, "#384e55", side * (hf + 1), 0.4, 0, 1.5, 1.8, depth * 2);
  }
  for (const t of [0, 1]) {
    const s = teamSign(t),
      c = COLORS[t]!,
      fx = factoryX(t) / 100;
    part(
      scene,
      "#707d7c",
      (-(hf + water) / 2) * s,
      -0.7,
      0,
      hf - water,
      1.4,
      depth * 2,
    );
    part(scene, "#b5ab8d", -(water + 0.24) * s, 0.09, 0, 0.48, 0.18, depth * 2);
    for (const l of LANES) {
      part(
        scene,
        "#546467",
        (-(hf + water) / 2) * s,
        0.02,
        l / 100,
        hf - water,
        0.06,
        3.1,
      );
      for (let k = 7; k < 33; k += 2)
        part(scene, "#c7c2a2", -k * s, 0.09, l / 100, 0.75, 0.03, 0.09);
    }
    const gx = (-GATE / 100) * s;
    for (const z of [-2.8, 2.8]) {
      part(scene, "#354850", gx, 0.6, z, 0.65, 1.2, 0.65);
      part(scene, c, gx, 1.27, z, 0.72, 0.16, 0.72);
    }
    part(scene, c, gx, 0.05, 0, 0.38, 0.08, 5.6);
    part(scene, "#3c5057", fx - 2.2 * s, 0.85, -8.2 * s, 2.35, 1.7, 3.3);
    part(scene, c, fx - 2.2 * s, 1.74, -8.2 * s, 2.6, 0.18, 3.55);
    for (let k = 0; k < 2; k++) {
      part(scene, c, fx, 0.09, depotZ(k) / 100, 3.8, 0.16, 3.2);
      part(scene, "#334952", fx, 0.19, depotZ(k) / 100, 2.9, 0.05, 2.3);
      for (const d of [-1, 1])
        part(
          scene,
          c,
          fx + 0.27 * s,
          0.24,
          depotZ(k) / 100 + d * 0.44,
          1.2,
          0.06,
          0.17,
        ).rotation.y = d * 0.55 * s;
    }
    for (const z of [-17, 17])
      for (let k = 0; k < 3; k++) {
        const x = -(18 + k * 3) * s;
        part(scene, "#52676d", x, 0.7, z, 2.4, 1.4, 2);
        part(scene, "#91a09b", x, 1.46, z, 2.36, 0.13, 1.94);
      }
  }
  for (const z of [...LANES, 0]) {
    const width = (z === 0 ? FIELD.catwalk : FIELD.bridge) * 0.02;
    part(
      scene,
      z ? "#999b8a" : "#b99e68",
      0,
      0.05,
      z / 100,
      water * 2 + 0.8,
      0.36,
      width,
    );
    for (let x = -5; x < 6; x++)
      part(scene, "#657477", x, 0.25, z / 100, 0.055, 0.045, width - 0.28);
    for (const edge of [-1, 1])
      part(
        scene,
        "#d9c68e",
        0,
        0.26,
        z / 100 + (edge * width) / 2,
        water * 2 + 0.8,
        0.18,
        0.13,
      );
  }
  const turrets = TURRETS.map((p) => {
    const g = new THREE.Group();
    scene.add(g);
    g.position.set(p.x / 100, 0, p.z / 100);
    part(g, "#384a50", 0, 0.28, 0, 2.9, 0.56, 2.9, cylinder);
    const head = part(g, neutral, 0, 1.02, 0, 1.8, 1.2, 1.8, cylinder);
    part(g, "#344653", 0.78, 1.35, 0, 1.75, 0.38, 0.4);
    return head;
  });
  const rigs = COLORS.map((c) => {
    const group = new THREE.Group();
    scene.add(group);
    const body = new THREE.Group();
    group.add(body);
    part(body, c, 0, 0, 0, 1.7, 1.1, 1.5);
    part(body, "#25414d", 0.13, 0.68, 0, 1.15, 0.45, 1.15);
    part(body, "#a1f4eb", 0.71, 0.67, 0, 0.09, 0.18, 0.87);
    part(body, "#354954", -0.89, 0.08, 0, 0.28, 0.76, 1.1);
    for (const side of [-1, 1]) {
      part(body, "#fcce79", -1.04, 0.25, side * 0.37, 0.07, 0.2, 0.17);
      part(body, "#273e48", -0.16, 0.56, side * 0.57, 0.6, 0.12, 0.18);
    }
    const barrels = [-1, 1].map((side) => {
      part(body, c, -0.05, 0.17, side * 1.05, 1.3, 0.69, 0.69);
      return part(body, "#263942", 0.71, 0.18, side * 1.03, 1.18, 0.33, 0.36);
    });
    const legs = [-1, 1].map((side) =>
      part(group, "#364b52", 0, 0.53, side * 0.6, 0.88, 1.04, 0.59),
    );
    const tread = [-1, 1].map((side) =>
      part(group, "#283d43", 0, 0.3, side * 0.6, 2.25, 0.54, 0.45),
    );
    const shadow = part(
      scene,
      "#495755",
      0,
      0.035,
      0,
      2.45,
      0.035,
      2.78,
      cylinder,
    );
    return { group, body, legs, tread, barrels, shadow };
  });
  const drones = new Map<string, THREE.Group>();
  const beams = TURRETS.map(() =>
    part(scene, "#fff09f", 0, 1, 0, 1, 0.12, 0.12),
  );
  const effects = COLORS.map((teamColor) =>
    [teamColor, "#ffad56", "#e8a7ff"].map((c, i) => {
      const glow = new THREE.MeshBasicMaterial({
        color: c,
        transparent: true,
        opacity: 0.92,
      });
      const mesh = new THREE.Mesh(i === 2 ? cylinder : cube, glow);
      scene.add(mesh);
      return { mesh, glow };
    }),
  );
  const self = label("LOCK", "dockside-lock");
  const radar = overview ? null : createRadar(host, COLORS);
  const labels = overview
    ? []
    : [
        { node: label("NORTH", "dockside-lane"), x: 0, z: LANES[0] / 100 - 2 },
        { node: label("SOUTH", "dockside-lane"), x: 0, z: LANES[1] / 100 + 2 },
        ...([0, 1] as const).map((t) => ({
          node: label("FACTORY", "dockside-lane"),
          x: factoryX(t) / 100,
          z: 5.8,
        })),
      ];
  const position = (
    node: HTMLElement,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
  ) => {
    const v = new THREE.Vector3(x, y, z).project(camera);
    node.style.left = `${Math.max(6, Math.min(94, (v.x + 1) * 50))}%`;
    node.style.top = `${Math.max(4, Math.min(94, (1 - v.y) * 50))}%`;
    node.hidden =
      Math.abs(v.x) > 1 ||
      Math.abs(v.y) > 1 ||
      Math.abs(v.z) > 1 ||
      !width ||
      !height;
  };
  let lastW = 0,
    lastH = 0;
  let yaw = 0,
    lastTick = -1,
    lastMe = -1;
  return {
    draw(w: World, me: number, far = false, expanded = false) {
      const width = host.clientWidth,
        height = host.clientHeight;
      if (!width || !height) return;
      if (width !== lastW || height !== lastH) {
        lastW = width;
        lastH = height;
        renderer.setSize(width, height, false);
      }
      const ratio = width / height,
        pilot = w.rigs[me];
      if (pilot && !overview) {
        const desired = headingAngle(pilot.heading);
        if (lastMe !== me || w.tick < lastTick || lastTick < 0) yaw = desired;
        else if (w.tick !== lastTick)
          yaw +=
            Math.atan2(Math.sin(desired - yaw), Math.cos(desired - yaw)) *
            (1 - Math.pow(0.5, w.tick - lastTick));
        lastTick = w.tick;
        lastMe = me;
        const fx = Math.cos(yaw),
          fz = Math.sin(yaw),
          x = pilot.x / 100,
          z = pilot.z / 100;
        const distance = far ? 15 : 10.5,
          elevation = far ? 17 : 11;
        chase.position.set(x - fx * distance, elevation, z - fz * distance);
        chase.lookAt(x + fx * 4.1, 0.8, z + fz * 4.1);
        chase.aspect = ratio;
        chase.updateProjectionMatrix();
        camera = chase;
      } else {
        const halfW = Math.max(39, ratio * 22);
        wide.left = -halfW;
        wide.right = halfW;
        wide.top = halfW / ratio;
        wide.bottom = -wide.top;
        wide.position.set(0, 70, 39);
        wide.lookAt(0, 0, 0);
        wide.updateProjectionMatrix();
        camera = wide;
      }
      camera.updateMatrixWorld();
      for (const [t, r] of w.rigs.entries()) {
        const v = rigs[t]!;
        v.group.position.set(r.x / 100, jumpHeight(r.jump), r.z / 100);
        v.group.rotation.y = -headingAngle(r.heading);
        v.group.visible = r.hp > 0;
        v.shadow.visible = v.group.visible;
        v.shadow.position.set(r.x / 100, 0.036, r.z / 100);
        v.shadow.rotation.y = v.group.rotation.y;
        v.body.position.y = r.travel ? 0.65 : r.crouched ? 0.92 : 1.48;
        v.barrels.forEach((barrel, i) => {
          const s = r.shots[i]!;
          barrel.position.x = s.tick && w.tick - s.tick < 2 ? 0.48 : 0.71;
        });
        v.legs.forEach((obj) => (obj.visible = !r.travel));
        v.tread.forEach((obj) => (obj.visible = r.travel));
      }
      for (const [i, t] of w.turrets.entries())
        turrets[i]!.material = material(COLORS[t.owner] ?? neutral);
      for (const d of w.drones) {
        const key = `${d.team}:${d.id}`;
        let g = drones.get(key);
        if (!g) {
          g = new THREE.Group();
          scene.add(g);
          drones.set(key, g);
          part(g, "#22383f", 0, 0.28, 0, 1.8, 0.5, 1.2);
          part(g, COLORS[d.team]!, 0, 0.66, 0, 1.5, 0.48, 1);
          part(
            g,
            "#fff2b0",
            teamSign(d.team) * 0.75,
            0.65,
            0,
            0.12,
            0.25,
            0.65,
          );
        }
        g.position.set(d.x / 100, 0, d.z / 100);
      }
      for (const [id, g] of drones)
        if (!w.drones.some((d) => `${d.team}:${d.id}` === id)) {
          scene.remove(g);
          drones.delete(id);
        }
      const shooters = w.turrets.map((t, i) => ({ ...t, ...TURRETS[i]! }));
      shooters.forEach((p, i) => {
        const beam = beams[i]!;
        beam.visible = p.shotTick > 0 && w.tick - p.shotTick < 3;
        if (beam.visible) {
          const dx = (p.beamX - p.x) / 100,
            dz = (p.beamZ - p.z) / 100;
          beam.position.set((p.x + p.beamX) / 200, 0.86, (p.z + p.beamZ) / 200);
          beam.scale.x = Math.hypot(dx, dz);
          beam.rotation.y = -Math.atan2(dz, dx);
        }
      });
      for (const [t, r] of w.rigs.entries())
        for (const [i, s] of r.shots.entries()) {
          const { mesh, glow } = effects[t]![i]!;
          const life = [4, 9, 7][i]!,
            age = w.tick - s.tick,
            progress = age / life;
          mesh.visible = !!s.tick && age < life;
          if (!mesh.visible) continue;
          const dx = (s.x - s.fromX) / 100,
            dz = (s.z - s.fromZ) / 100;
          const fraction = i === 0 ? 0.5 : i === 1 ? progress : 1;
          mesh.position.set(
            s.fromX / 100 + dx * fraction,
            i === 2 ? 0.4 : 1.4,
            s.fromZ / 100 + dz * fraction,
          );
          mesh.rotation.y = -Math.atan2(dz, dx);
          if (i === 0)
            mesh.scale.set(Math.max(0.2, Math.hypot(dx, dz)), 0.14, 0.18);
          else if (i === 1) {
            mesh.scale.set(1.6, 0.35, 0.35);
            mesh.position.y += Math.sin(progress * Math.PI) * 2;
          } else mesh.scale.set(1 + progress * 4, 0.32, 1 + progress * 4);
          glow.opacity = 1 - progress * 0.7;
        }
      const lock = pilot && lockedUnit(w, me);
      self.hidden = !lock;
      if (lock) position(self, lock.x / 100, 2.4, lock.z / 100, width, height);
      radar?.draw(w, me, expanded);
      for (const l of labels) position(l.node, l.x, 0.5, l.z, width, height);
      renderer.render(scene, camera);
    },
    dispose() {
      renderer.dispose();
      cube.dispose();
      cylinder.dispose();
      for (const team of effects) for (const e of team) e.glow.dispose();
      for (const m of materials.values()) m.dispose();
      host.replaceChildren();
    },
  };
}
