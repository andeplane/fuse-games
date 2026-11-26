import {
  FIELD,
  LANES,
  TURRETS,
  GATE,
  factoryX,
  teamSign,
  headingAngle,
  type Point,
  type World,
} from "../game/canal.js";
export function radarProjection(
  pilot: Point,
  expanded: boolean,
  center?: Point,
) {
  const scale = expanded ? (center ? 12 : 20) : 8;
  return {
    x: (v: number) =>
      180 + (v - (expanded ? (center?.x ?? 0) : pilot.x)) / scale,
    z: (v: number) =>
      110 + (v - (expanded ? (center?.z ?? 0) : pilot.z)) / scale,
    scale,
  };
}
export function createRadar(host: HTMLElement, colors: readonly string[]) {
  const canvas = document.createElement("canvas");
  canvas.className = "dockside-radar";
  canvas.setAttribute(
    "aria-label",
    "Tactical map of both bases, bridges, turrets, pilots and convoys",
  );
  canvas.width = 360;
  canvas.height = 220;
  host.append(canvas);
  const ctx = canvas.getContext("2d");
  return {
    draw(w: World, me: number, expanded: boolean, center?: Point) {
      canvas.hidden = me < 0;
      canvas.classList.toggle("expanded", expanded);
      if (!ctx || me < 0) return;
      const { x, z, scale } = radarProjection(w.rigs[me]!, expanded, center);
      ctx.fillStyle = "#0e202a";
      ctx.fillRect(0, 0, 360, 220);
      ctx.fillStyle = "#193743";
      ctx.fillRect(
        x(-FIELD.x),
        z(-FIELD.z),
        (2 * FIELD.x) / scale,
        (2 * FIELD.z) / scale,
      );
      ctx.fillStyle = "#334d52";
      for (const west of [-FIELD.x, FIELD.water])
        ctx.fillRect(
          x(west),
          z(-FIELD.z),
          (FIELD.x - FIELD.water) / scale,
          (2 * FIELD.z) / scale,
        );
      ctx.fillStyle = "#819496";
      for (const lane of [...LANES, 0]) {
        const half = lane ? FIELD.bridge : FIELD.catwalk;
        ctx.fillRect(
          x(-FIELD.water),
          z(lane - half),
          (FIELD.water * 2) / scale,
          (half * 2) / scale,
        );
      }
      for (const [i, p] of TURRETS.entries()) {
        ctx.fillStyle = colors[w.turrets[i]!.owner] ?? "#e2cc91";
        ctx.fillRect(x(p.x) - 4, z(p.z) - 4, 8, 8);
      }
      for (const t of [0, 1]) {
        ctx.strokeStyle = colors[t]!;
        ctx.lineWidth = 3;
        ctx.strokeRect(x(-teamSign(t) * GATE) - 2, z(-280), 4, 560 / scale);
        for (const sign of [-1, 1])
          ctx.strokeRect(x(factoryX(t)) - 4, z(sign * 300) - 3, 8, 6);
      }
      for (const d of w.drones) {
        ctx.fillStyle = colors[d.team]!;
        ctx.beginPath();
        ctx.arc(x(d.x), z(d.z), 4, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const [t, r] of w.rigs.entries()) {
        if (!r.hp) continue;
        ctx.save();
        ctx.translate(x(r.x), z(r.z));
        ctx.rotate(headingAngle(r.heading));
        ctx.fillStyle = colors[t]!;
        ctx.strokeStyle = t === me ? "#fff" : "#102127";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(9, 0);
        ctx.lineTo(-6, -5);
        ctx.lineTo(-4, 0);
        ctx.lineTo(-6, 5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    },
  };
}
