import * as THREE from "three";
import {
  FIELD,
  LANES,
  TURRETS,
  GATE,
  factoryX,
  depotZ,
  teamSign,
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
    camera = new THREE.OrthographicCamera(-40, 40, 24, -24, 0.1, 220);
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
    for (const z of [-2.3, 2.3]) part(scene, c, gx, 1.5, z, 0.65, 3, 0.65);
    part(scene, c, gx, 3.1, 0, 0.65, 0.45, 5.1);
    part(scene, "#3c5057", fx - 2.2 * s, 0.95, 0, 2.35, 1.9, 3.3);
    part(scene, c, fx - 2.2 * s, 2, 0, 2.6, 0.28, 3.55);
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
    const body = part(group, c, 0, 1, 0, 1.65, 1, 1.2);
    part(group, "#25414d", 0, 1.38, 0, 0.7, 0.36, 0.8);
    const legs = [-1, 1].map((side) =>
      part(group, "#364b52", 0, 0.37, side * 0.7, 0.69, 0.8, 0.48),
    );
    const tread = [-1, 1].map((side) =>
      part(group, "#283d43", 0, 0.3, side * 0.6, 2.25, 0.54, 0.45),
    );
    return { group, body, legs, tread };
  });
  const drones = new Map<string, THREE.Group>();
  const beams = [0, 1, 2, 3].map(() =>
    part(scene, "#fff09f", 0, 1, 0, 1, 0.12, 0.12),
  );
  const self = label("YOU", "dockside-you");
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
    node.hidden = Math.abs(v.x) > 1 || Math.abs(v.y) > 1 || !width || !height;
  };
  let lastW = 0,
    lastH = 0;
  return {
    draw(w: World, me: number) {
      const width = host.clientWidth,
        height = host.clientHeight;
      if (!width || !height) return;
      if (width !== lastW || height !== lastH) {
        lastW = width;
        lastH = height;
        renderer.setSize(width, height, false);
      }
      const ratio = width / height,
        follow = ratio < 1.05 && !overview && me >= 0;
      const halfW = follow ? 19 : Math.max(39, ratio * 22);
      const halfH = halfW / ratio,
        x = follow ? Math.max(-20, Math.min(20, w.rigs[me]!.x / 100)) : 0;
      camera.left = -halfW;
      camera.right = halfW;
      camera.top = halfH;
      camera.bottom = -halfH;
      camera.position.set(x, 70, 39);
      camera.lookAt(x, 0, 0);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      for (const [t, r] of w.rigs.entries()) {
        const v = rigs[t]!;
        v.group.position.set(r.x / 100, 0, r.z / 100);
        v.group.visible = r.hp > 0;
        v.body.position.y = r.travel ? 0.66 : 1.05;
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
      const shooters = [
        ...w.rigs,
        ...w.turrets.map((t, i) => ({ ...t, ...TURRETS[i]! })),
      ];
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
      const pilot = w.rigs[me];
      self.hidden = !pilot || !pilot.hp;
      if (pilot?.hp)
        position(self, pilot.x / 100, 2.55, pilot.z / 100, width, height);
      for (const l of labels) position(l.node, l.x, 0.5, l.z, width, height);
      renderer.render(scene, camera);
    },
    dispose() {
      renderer.dispose();
      cube.dispose();
      cylinder.dispose();
      for (const m of materials.values()) m.dispose();
      host.replaceChildren();
    },
  };
}
