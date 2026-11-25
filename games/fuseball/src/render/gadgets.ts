import type { BarrierView, WorldView } from "../engine/view.js";
import {
  FIELD_COOL_STEPS,
  GATE_OPEN_STEPS,
  isCircle,
  moverPlace,
  type MapDef,
  type Rect,
} from "../engine/view-kit.js";
import {
  EDGE,
  EDGE_DIM,
  GADGET,
  GADGET_DARK,
  INK,
  LEDGE,
  PORTAL,
  SOLID,
  TEAM,
  TEAM_LIGHT,
  WHITE,
  hexA,
} from "./palette.js";
import type { Paint } from "./sprites.js";
import { copies, solidCopies } from "./wrap.js";

const TAU = Math.PI * 2;

/** The team whose goal a force field stands nearest to, which is the one it guards; −1 with no goal on the map. */
export function guarded(map: MapDef, field: Rect): -1 | 0 | 1 {
  let team: -1 | 0 | 1 = -1,
    nearest = Infinity;
  const along = (d: number, size: number, wraps: boolean) =>
    wraps ? Math.min(Math.abs(d), size - Math.abs(d)) : Math.abs(d);
  for (const goal of map.goals) {
    const gx = isCircle(goal) ? goal.x : goal.x + goal.w / 2,
      gy = isCircle(goal) ? goal.y : goal.y + goal.h / 2,
      far =
        along(gx - (field.x + field.w / 2), map.w, map.wrapX) +
        along(gy - (field.y + field.h / 2), map.h, map.wrapY);
    if (far < nearest) {
      nearest = far;
      team = goal.team;
    }
  }
  return team;
}

/** Both orientations use the same lengths and spacing along the barrier. */
function barrierAxis(g: Paint, rect: Rect) {
  const vertical = rect.h >= rect.w;
  const across = vertical ? rect.x : rect.y;
  const along = vertical ? rect.y : rect.x;
  const width = vertical ? rect.w : rect.h;
  const length = vertical ? rect.h : rect.w;
  return {
    across,
    along,
    width,
    length,
    acrossCenter: across + width / 2,
    alongCenter: along + length / 2,
    fill(cross: number, at: number, span: number, extent: number): void {
      if (vertical) g.fillRect(cross, at, span, extent);
      else g.fillRect(at, cross, extent, span);
    },
  };
}

function drawForceField(
  g: Paint,
  rect: Rect,
  state: BarrierView,
  team: -1 | 0 | 1,
  now: number,
): void {
  const { across, along, width, length, acrossCenter, alongCenter, fill } =
    barrierAxis(g, rect);
  const color = team === -1 ? EDGE : TEAM[team];
  const light = team === -1 ? WHITE : TEAM_LIGHT[team];
  const struck = Math.min(1, state.timer / FIELD_COOL_STEPS);

  // The emitters stay even when the field is down.
  g.fillStyle = state.up ? light : hexA(color, 0.5);
  fill(across - 2, along - 2, width + 4, 3);
  fill(across - 2, along + length - 1, width + 4, 3);
  if (!state.up) {
    g.fillStyle = hexA(color, 0.25 + 0.2 * struck);
    for (let at = 6; at < length - 4; at += 12)
      fill(acrossCenter - 0.5, along + at, 1, 3);
    return;
  }

  const glow = 0.16 + 0.1 * state.left + 0.5 * struck;
  g.fillStyle = hexA(color, glow * 0.5);
  g.fillRect(rect.x - 3, rect.y, rect.w + 6, rect.h);
  g.fillStyle = hexA(struck > 0.5 ? WHITE : color, glow);
  g.fillRect(rect.x, rect.y, rect.w, rect.h);

  g.fillStyle = hexA(light, 0.9);
  for (let at = (now / 40) % 8; at < length - 3; at += 8) {
    fill(across, along + at, 1, 4);
    fill(across + width - 1, along + length - at - 4, 1, 4);
  }

  // One pip for each strike the field can still take.
  g.fillStyle = WHITE;
  for (let pip = 0; pip < state.left; pip++) {
    const at = (pip - (state.left - 1) / 2) * 9;
    fill(acrossCenter - 2, alongCenter + at - 2, 4, 4);
  }
}

function drawGate(g: Paint, rect: Rect, state: BarrierView): void {
  const { across, along, width, length, acrossCenter, alongCenter, fill } =
    barrierAxis(g, rect);
  const open = state.up
    ? 0
    : Math.min(1, state.timer / 24, (GATE_OPEN_STEPS - state.timer) / 12 + 0.3);
  const leaf = (length / 2) * (1 - 0.82 * open);

  for (const start of [along, along + length - leaf]) {
    g.fillStyle = GADGET_DARK;
    fill(across, start, width, leaf);
    g.fillStyle = GADGET;
    for (let at = 0; at < leaf; at += 8) fill(across, start + at, width, 4);
    g.fillStyle = hexA(WHITE, 0.8);
    fill(across, start, 1, leaf);
  }

  if (!state.up) {
    // The light between the leaves runs down as the gate closes.
    const left = state.timer / GATE_OPEN_STEPS;
    const span = (length - 2 * leaf) * left;
    g.fillStyle = hexA(GADGET, 0.75);
    fill(acrossCenter - 1, alongCenter - span / 2, 2, span);
  }
}

function drawBarriers(
  g: Paint,
  map: MapDef,
  states: WorldView["barriers"],
  now: number,
): void {
  map.barriers.forEach((barrier, index) => {
    const state = states[index];
    if (!state) return;
    const parts = solidCopies(map, barrier);
    if (barrier.kind === "field") {
      const team = guarded(map, barrier);
      for (const part of parts) drawForceField(g, part, state, team, now);
    } else {
      for (const part of parts) drawGate(g, part, state);
    }
  });
}

function drawLedges(g: Paint, map: MapDef): void {
  // A ledge is only its top edge: a bright line with open slats under it, so it reads as something to come up
  // through, not a wall.
  for (const ledge of map.ledges) {
    g.fillStyle = hexA(LEDGE, 0.1);
    g.fillRect(ledge.x, ledge.y, ledge.w, ledge.h);
    g.fillStyle = LEDGE;
    g.fillRect(ledge.x, ledge.y, ledge.w, 2);
    g.fillStyle = hexA(LEDGE, 0.55);
    for (let x = ledge.x + 2; x < ledge.x + ledge.w - 3; x += 8)
      g.fillRect(x, ledge.y + 2, 4, ledge.h - 2);
    g.fillStyle = WHITE;
    g.fillRect(ledge.x, ledge.y, 2, 2);
    g.fillRect(ledge.x + ledge.w - 2, ledge.y, 2, 2);
  }
}

function drawMovers(g: Paint, map: MapDef, clock: number): void {
  // A mover is a solid on a rail: the rail shows where it goes, and its end lights say which way it is going.
  for (const mover of map.movers) {
    const at = moverPlace(mover, clock),
      upright = mover.travel.y !== 0,
      going = moverPlace(mover, clock + 1),
      ahead = upright ? going.y - at.y : going.x - at.x,
      mx = mover.x + mover.w / 2,
      my = mover.y + mover.h / 2;
    g.fillStyle = hexA(LEDGE, 0.22);
    const far = Math.abs(upright ? mover.travel.y : mover.travel.x),
      sign = Math.sign(upright ? mover.travel.y : mover.travel.x);
    for (let d = 0; d <= far; d += 6)
      if (upright) g.fillRect(mx - 0.5, my + sign * d - 1, 1, 2);
      else g.fillRect(mx + sign * d - 1, my - 0.5, 2, 1);
    g.fillStyle = EDGE_DIM;
    g.fillRect(at.x, at.y, mover.w, mover.h);
    g.fillStyle = SOLID;
    g.fillRect(at.x + 1, at.y + 2, mover.w - 2, mover.h - 3);
    g.fillStyle = LEDGE;
    g.fillRect(at.x, at.y, mover.w, 2);
    // The lights at the end it is heading for burn brighter.
    const light = (x: number, y: number, lead: boolean) => {
      g.fillStyle = hexA(LEDGE, lead ? 1 : 0.35);
      g.fillRect(x, y, 3, 3);
    };
    const low = at.y + mover.h - 5;
    if (upright) {
      light(at.x + 3, ahead < 0 ? at.y + 3 : low, true);
      light(at.x + mover.w - 6, ahead < 0 ? at.y + 3 : low, true);
    } else {
      light(at.x + 3, at.y + 4, ahead < 0);
      light(at.x + mover.w - 6, at.y + 4, ahead > 0);
    }
  }
}

function drawBumpers(
  g: Paint,
  map: MapDef,
  ball: WorldView["ball"],
  now: number,
): void {
  for (const bumper of map.bumpers) {
    const beat = 0.5 + 0.5 * Math.sin(now / 240 + bumper.x),
      // The ball close by sets it ringing.
      near = Math.hypot(ball.x - bumper.x, ball.y - bumper.y),
      ring = ball.live ? Math.max(0, 1 - (near - bumper.r) / 26) : 0;
    for (const at of copies(map, bumper.x, bumper.y, bumper.r + 8)) {
      const halo = g.createRadialGradient(
        at.x,
        at.y,
        bumper.r - 2,
        at.x,
        at.y,
        bumper.r + 8 + 4 * ring,
      );
      halo.addColorStop(0, hexA(EDGE, 0.5 + 0.4 * ring));
      halo.addColorStop(1, hexA(EDGE, 0));
      g.fillStyle = halo;
      g.beginPath();
      g.arc(at.x, at.y, bumper.r + 8 + 4 * ring, 0, TAU);
      g.fill();
      g.beginPath();
      g.arc(at.x, at.y, bumper.r, 0, TAU);
      g.fillStyle = SOLID;
      g.fill();
      g.lineWidth = 2.5;
      g.strokeStyle = ring > 0.5 ? WHITE : EDGE;
      g.stroke();
      g.beginPath();
      g.arc(at.x, at.y, bumper.r * (0.42 + 0.08 * beat), 0, TAU);
      g.fillStyle = hexA(WHITE, 0.75 + 0.25 * ring);
      g.fill();
      g.fillStyle = EDGE;
      g.fillRect(at.x - 1, at.y - 1, 2, 2);
    }
  }
}

function drawPortals(g: Paint, map: MapDef, now: number): void {
  for (const portal of map.portals) {
    const color = PORTAL[portal.hue];
    [portal.a, portal.b].forEach((end, which) => {
      for (const at of copies(map, end.x, end.y, portal.r + 8)) {
        const well = g.createRadialGradient(
          at.x,
          at.y,
          1,
          at.x,
          at.y,
          portal.r + 6,
        );
        well.addColorStop(0, hexA(INK, 0.95));
        well.addColorStop(0.55, hexA(color, 0.3));
        well.addColorStop(1, hexA(color, 0));
        g.fillStyle = well;
        g.beginPath();
        g.arc(at.x, at.y, portal.r + 6, 0, TAU);
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = color;
        g.beginPath();
        g.arc(at.x, at.y, portal.r, 0, TAU);
        g.stroke();
        // Three arcs spiralling in; the two ends of a pair turn opposite ways.
        g.strokeStyle = hexA(WHITE, 0.85);
        g.lineWidth = 1.5;
        const turn = (which === 0 ? 1 : -1) * (now / 260);
        for (let arm = 0; arm < 3; arm++) {
          const start = turn + (arm * TAU) / 3;
          g.beginPath();
          g.arc(at.x, at.y, portal.r - 3 - arm * 2.5, start, start + 1.1);
          g.stroke();
        }
      }
    });
  }
}

export function drawGadgets(
  g: Paint,
  map: MapDef,
  view: WorldView,
  now: number,
): void {
  drawBarriers(g, map, view.barriers, now);
  drawLedges(g, map);
  drawMovers(g, map, view.clock);
  drawBumpers(g, map, view.ball, now);
  drawPortals(g, map, now);
}
