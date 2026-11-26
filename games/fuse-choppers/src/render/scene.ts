import { createChopperVisuals } from "./chopper-visuals.js";
import { createSceneEffects } from "./scene-effects.js";
export { effectKey } from "./scene-effects.js";
export { hexA } from "./palette.js";
import type { WorldView } from "../engine/view.js";
import {
  EXIT_X,
  ROCK_WARNING_STEPS,
  VIEW_H,
  VIEW_W,
  sawY,
  segmentsNear,
  terrain,
  COL,
  COLUMNS,
  type PickupKind,
} from "../engine/view-kit.js";
import { createBackdrop, drawCave, noise } from "./backdrop.js";
import { PICKUP_COLORS, hexA, seatColor } from "./palette.js";
import {
  droneSprite,
  pickupSprite,
  roundRect,
  sawSprite,
  type MakeSurface,
  type Paint,
  type Sprite,
} from "./sprites.js";

/**
 * Draws one frame of a round onto a 960×540 logical canvas. Everything here is cosmetic: particles, trails,
 * wrecks and shake live in this closure and are rebuilt from the frames; nothing feeds back into the simulation.
 * Effects are spawned once per effect id, so a rollback that replays one does not draw it twice.
 */
export interface SceneInput {
  gutterX?: number;
  gutterY?: number;
  world: WorldView;
  /** This device's chopper id, if it flies one. */
  me: string;
  /** What to write over each chopper, by id. */
  labels: ReadonlyMap<string, string>;
  avatars?: ReadonlyMap<string, string>;
  /** Wall time in milliseconds, for animation. */
  now: number;
  reducedMotion?: boolean;
}

export function createScene(
  g: Paint,
  make: MakeSurface,
  random: () => number = () => Math.random(),
) {
  const backdrop = createBackdrop(make);
  const saws = new Map<number, Sprite>(),
    pickups = new Map<PickupKind, Sprite>();
  let drone: Sprite | undefined;
  const sawFor = (r: number) => {
    let s = saws.get(r);
    if (!s) saws.set(r, (s = sawSprite(make, r)));
    return s;
  };
  const pickupFor = (kind: PickupKind) => {
    let s = pickups.get(kind);
    if (!s) pickups.set(kind, (s = pickupSprite(make, kind)));
    return s;
  };

  const effects = createSceneEffects(random);
  const choppers = createChopperVisuals(g, make, random, effects.add);
  let seed = -1,
    last = 0,
    trailClock = 0,
    emberClock = 0;

  function draw(input: SceneInput): void {
    const { world, now } = input,
      time = now / 1000,
      dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (world.seed !== seed) {
      seed = world.seed;
      choppers.resetTrails();
      effects.reset(world);
    }
    effects.spawn(world, input.me);
    effects.tick(dt);
    const camX = world.camX;
    const gutterX = input.gutterX ?? 0,
      gutterY = input.gutterY ?? 0;
    // The extension stays covered even when the scene's visual shake displaces it.
    if (gutterX || gutterY) {
      g.fillStyle = "#070a20";
      g.fillRect(
        -gutterX,
        -gutterY,
        VIEW_W + 2 * gutterX,
        VIEW_H + 2 * gutterY,
      );
    }
    g.save();
    const board = gutterX || gutterY ? g.getTransform() : undefined;
    effects.applyShake(g, input.reducedMotion);
    backdrop.draw(g, camX, time, gutterX, gutterY);
    drawCave(g, world.seed, camX, gutterX, gutterY);
    // An expanded phone view reveals scenery, while hazards and aircraft use the same camera field on all devices.
    if (board) {
      g.save();
      const shaken = g.getTransform();
      g.setTransform(board);
      g.beginPath();
      g.rect(0, 0, VIEW_W, VIEW_H);
      g.clip();
      g.setTransform(shaken);
    }
    drawExit(g, camX, time);
    drawPlatforms(g, world, time);
    drawSaws(g, world, time);
    drawPickups(g, world, time);
    trailClock += dt;
    const sample = trailClock >= 1 / 24;
    if (sample) trailClock = 0;
    for (const chopper of world.choppers)
      choppers.draw(world, chopper, input, time, sample);
    drawDrones(g, world, time);
    drawShots(g, world);
    drawRocks(g, world, time);
    effects.draw(g, camX);
    emberClock += dt;
    drawCrush(g, world, time, emberClock > 0.03);
    if (board) g.restore();
    if (emberClock > 0.03) emberClock = 0;
    g.restore();
    danger(g, world, input.me, time);
  }

  function drawPlatforms(g: Paint, world: WorldView, time: number): void {
    for (const part of segmentsNear(
      world.seed,
      world.camX - 60,
      world.camX + VIEW_W + 60,
    ))
      for (const p of part.platforms) {
        const x = p.x - world.camX;
        if (x > VIEW_W + 10 || x + p.w < -10) continue;
        g.beginPath();
        g.moveTo(x, p.y + 5);
        g.lineTo(x + 5, p.y);
        g.lineTo(x + p.w - 5, p.y);
        g.lineTo(x + p.w, p.y + 5);
        g.lineTo(x + p.w - 2, p.y + p.h * 0.6);
        const teeth = Math.max(3, Math.round(p.w / 16));
        for (let i = 1; i < teeth; i++) {
          const tx = x + p.w - (i / teeth) * p.w,
            drop = noise(p.x, i) * 9;
          g.lineTo(tx, p.y + p.h + drop - 2);
        }
        g.lineTo(x + 2, p.y + p.h * 0.6);
        g.closePath();
        const rock = g.createLinearGradient(0, p.y, 0, p.y + p.h + 8);
        rock.addColorStop(0, "#2a3368");
        rock.addColorStop(0.4, "#161b44");
        rock.addColorStop(1, "#080a22");
        g.fillStyle = rock;
        g.fill();
        g.strokeStyle = "#0a0c20";
        g.lineWidth = 2;
        g.stroke();
        // The landing pad: a lit steel plate says you can set down here.
        g.fillStyle = "#34478f";
        g.fillRect(x + 6, p.y - 3, p.w - 12, 5);
        g.save();
        g.shadowColor = "#7fb2ff";
        g.shadowBlur = 8;
        g.fillStyle = "#b8d2ff";
        g.fillRect(x + 6, p.y - 3, p.w - 12, 1.5);
        g.restore();
        for (let lx = x + 10; lx < x + p.w - 6; lx += 28) {
          const on = (Math.floor(time * 2 + lx * 0.05) & 1) === 0;
          g.fillStyle = on ? "#ffc46a" : "#8a5a22";
          g.beginPath();
          g.arc(lx, p.y + 6, 2, 0, Math.PI * 2);
          g.fill();
        }
      }
  }

  function drawSaws(g: Paint, world: WorldView, time: number): void {
    const { top, bottom } = terrain(world.seed);
    const edgeAt = (edge: Int16Array, x: number) => {
      const c = Math.max(0, Math.min(COLUMNS - 2, Math.floor(x / COL))),
        f = (x - c * COL) / COL;
      return edge[c]! + (edge[c + 1]! - edge[c]!) * f;
    };
    for (const part of segmentsNear(
      world.seed,
      world.camX - 60,
      world.camX + VIEW_W + 60,
    ))
      for (const saw of part.saws) {
        const x = saw.x - world.camX;
        if (x < -60 || x > VIEW_W + 60) continue;
        const y = sawY(saw, Math.floor(world.step)),
          ceiling = edgeAt(top, saw.x),
          floor = edgeAt(bottom, saw.x);
        g.strokeStyle = "#1c2552";
        g.lineWidth = 4;
        g.beginPath();
        if (saw.amp) {
          g.moveTo(x, saw.y - saw.amp - saw.r);
          g.lineTo(x, saw.y + saw.amp + saw.r);
        } else if (y - ceiling < floor - y) {
          g.moveTo(x, ceiling);
          g.lineTo(x, y);
        } else {
          g.moveTo(x, floor);
          g.lineTo(x, y);
        }
        g.stroke();
        const s = sawFor(saw.r);
        g.save();
        g.translate(x, y);
        g.rotate(world.step * 0.3);
        g.drawImage(s.surface, -s.ox, -s.oy, s.width, s.height);
        g.restore();
        const pulse = 0.7 + 0.3 * Math.sin(time * 6 + saw.x);
        const eye = g.createRadialGradient(x, y, 0, x, y, saw.r * 0.55);
        eye.addColorStop(0, `rgba(255,220,220,${pulse})`);
        eye.addColorStop(0.3, `rgba(255,40,60,${pulse})`);
        eye.addColorStop(1, "rgba(255,40,60,0)");
        g.fillStyle = eye;
        g.beginPath();
        g.arc(x, y, saw.r * 0.55, 0, Math.PI * 2);
        g.fill();
      }
  }

  function drawPickups(g: Paint, world: WorldView, time: number): void {
    for (const p of world.pickups) {
      const x = p.x - world.camX;
      if (x < -30 || x > VIEW_W + 30) continue;
      const bob = Math.sin(time * 3 + p.id) * 3,
        s = pickupFor(p.kind);
      const halo = g.createRadialGradient(x, p.y + bob, 4, x, p.y + bob, 30);
      halo.addColorStop(0, hexA(PICKUP_COLORS[p.kind], 0.35));
      halo.addColorStop(1, hexA(PICKUP_COLORS[p.kind], 0));
      g.fillStyle = halo;
      g.fillRect(x - 30, p.y + bob - 30, 60, 60);
      g.drawImage(s.surface, x - s.ox, p.y + bob - s.oy, s.width, s.height);
    }
  }

  function drawDrones(g: Paint, world: WorldView, time: number): void {
    drone ??= droneSprite(make);
    for (const d of world.drones) {
      const x = d.x - world.camX;
      if (x < -50 || x > VIEW_W + 50) continue;
      g.save();
      g.translate(x, d.y);
      g.rotate(Math.sin(time * 2 + d.id) * 0.06);
      g.drawImage(
        drone.surface,
        -drone.ox,
        -drone.oy,
        drone.width,
        drone.height,
      );
      const spin = time * 40 + d.id;
      g.strokeStyle = "rgba(255,200,200,0.8)";
      g.lineWidth = 2;
      for (const phase of [0, Math.PI / 2]) {
        const reach = 26 * Math.cos(spin + phase);
        g.beginPath();
        g.moveTo(-reach, -16);
        g.lineTo(reach, -16);
        g.stroke();
      }
      // The eye: brighter, then blazing while it charges a shot.
      const charge = d.charge > 0 ? 1 - d.charge / 36 : 0,
        radius = 4 + charge * 7;
      const eye = g.createRadialGradient(-10, -2, 0, -10, -2, radius * 2.4);
      eye.addColorStop(0, "#ffffff");
      eye.addColorStop(0.25, "#ff3040");
      eye.addColorStop(1, "rgba(255,30,50,0)");
      g.fillStyle = eye;
      g.beginPath();
      g.arc(-10, -2, radius * 2.4, 0, Math.PI * 2);
      g.fill();
      for (let hp = 0; hp < d.hp; hp++) {
        g.fillStyle = "#ff5a6a";
        g.fillRect(-9 + hp * 7, 16, 5, 2);
      }
      g.restore();
    }
  }

  function drawShots(g: Paint, world: WorldView): void {
    g.save();
    g.globalCompositeOperation = "lighter";
    g.lineCap = "round";
    for (const b of world.bullets) {
      const x = b.x - world.camX,
        angle = Math.atan2(b.vy, b.vx - world.scroll),
        color = seatColor(b.slot);
      g.save();
      g.translate(x, b.y);
      g.rotate(angle);
      const tail = g.createLinearGradient(-28, 0, 0, 0);
      tail.addColorStop(0, hexA(color, 0));
      tail.addColorStop(1, hexA(color, 0.9));
      g.strokeStyle = tail;
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(-28, 0);
      g.lineTo(0, 0);
      g.stroke();
      g.fillStyle = "#ffffff";
      roundRect(g, -6, -2.2, 12, 4.4, 2);
      g.fill();
      g.fillStyle = "#ff4a3a";
      g.fillRect(4, -1.5, 3, 3);
      g.restore();
    }
    for (const b of world.bolts) {
      const x = b.x - world.camX,
        angle = Math.atan2(b.vy, b.vx - world.scroll);
      g.save();
      g.translate(x, b.y);
      g.rotate(angle);
      g.strokeStyle = "rgba(255,40,60,0.8)";
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(-14, 0);
      g.lineTo(6, 0);
      g.stroke();
      g.strokeStyle = "#ffe0e0";
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(-10, 0);
      g.lineTo(6, 0);
      g.stroke();
      g.restore();
    }
    g.restore();
  }

  function drawRocks(g: Paint, world: WorldView, time: number): void {
    const edge = world.crushX - world.camX;
    // Warnings: the crush zone glows and draws the line the rock will take.
    for (const w of world.warnings) {
      const left = Math.max(0, w.at - world.step),
        k = 1 - left / ROCK_WARNING_STEPS,
        pulse = 0.5 + 0.5 * Math.sin(time * 18);
      g.save();
      g.globalAlpha = 0.35 + 0.65 * pulse;
      g.strokeStyle = "#ff3b4e";
      g.setLineDash([8, 8]);
      g.lineDashOffset = -time * 60;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(edge + 34, w.y);
      g.lineTo(edge + 34 + 90 + k * 110, w.y);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = "#ff3b4e";
      g.beginPath();
      g.moveTo(edge + 22, w.y - 13);
      g.lineTo(edge + 36, w.y + 11);
      g.lineTo(edge + 8, w.y + 11);
      g.closePath();
      g.fill();
      g.fillStyle = "#1a0208";
      g.font = "bold 13px 'Press Start 2P', monospace";
      g.textAlign = "center";
      g.fillText("!", edge + 22, w.y + 9);
      g.restore();
    }
    for (const r of world.rocks) {
      const x = r.x - world.camX;
      if (x < -40 || x > VIEW_W + 40) continue;
      const rvx = r.vx - world.scroll;
      g.save();
      g.globalCompositeOperation = "lighter";
      for (let i = 1; i <= 5; i++) {
        g.fillStyle = `rgba(255,${110 - i * 12},40,${0.24 - i * 0.04})`;
        g.beginPath();
        g.arc(
          x - rvx * i * 3,
          r.y - r.vy * i * 3,
          r.r * (1 - i * 0.12),
          0,
          Math.PI * 2,
        );
        g.fill();
      }
      g.restore();
      g.save();
      g.translate(x, r.y);
      g.rotate(world.step * 0.08 + r.id);
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2,
          reach = r.r * (0.8 + noise(r.id, i) * 0.35);
        g.lineTo(Math.cos(angle) * reach, Math.sin(angle) * reach);
      }
      g.closePath();
      const molten = g.createRadialGradient(
        -r.r * 0.3,
        -r.r * 0.3,
        1,
        0,
        0,
        r.r * 1.1,
      );
      molten.addColorStop(0, "#ffd77a");
      molten.addColorStop(0.35, "#ff6a2a");
      molten.addColorStop(0.7, "#7a1c10");
      molten.addColorStop(1, "#2a0906");
      g.fillStyle = molten;
      g.shadowColor = "#ff5a2a";
      g.shadowBlur = 14;
      g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = "#1a0503";
      g.lineWidth = 1.5;
      g.stroke();
      g.restore();
    }
  }

  function drawCrush(
    g: Paint,
    world: WorldView,
    time: number,
    emit: boolean,
  ): void {
    const edge = world.crushX - world.camX;
    if (edge < -60) return;
    const jag = (y: number) =>
      Math.sin(y * 0.045 + time * 3.1) * 7 +
      Math.sin(y * 0.13 - time * 5.3) * 4 +
      (noise(Math.floor(y / 18), 91) - 0.5) * 10;
    // The glowing haze in front of the wall.
    const haze = g.createLinearGradient(edge, 0, edge + 110, 0);
    haze.addColorStop(0, "rgba(255,30,90,0.34)");
    haze.addColorStop(1, "rgba(255,30,90,0)");
    g.fillStyle = haze;
    g.fillRect(edge, 0, 110, VIEW_H);
    // The wall.
    g.beginPath();
    g.moveTo(-20, -20);
    for (let y = -20; y <= VIEW_H + 20; y += 18) g.lineTo(edge + jag(y), y);
    g.lineTo(-20, VIEW_H + 20);
    g.closePath();
    const body = g.createLinearGradient(edge - 320, 0, edge, 0);
    body.addColorStop(0, "#14020b");
    body.addColorStop(0.65, "#4a0620");
    body.addColorStop(1, "#8e0c38");
    g.fillStyle = body;
    g.fill();
    // Tumbling molten boulders inside it.
    g.save();
    g.clip();
    const count = Math.min(60, Math.max(8, Math.ceil(edge / 26) * 6));
    for (let i = 0; i < count; i++) {
      const column = i % 6,
        x = edge - 18 - column * 32 - noise(i, 92) * 14,
        speed = 16 + (i % 3) * 9,
        y =
          ((((i * 71 + time * speed * (column % 2 ? -1 : 1)) % 640) + 640) %
            640) -
          50,
        size = 10 + noise(i, 93) * 17;
      if (x < -30) continue;
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const angle = (k / 6) * Math.PI * 2 + time * 0.4 * (i % 2 ? 1 : -1),
          reach = size * (0.75 + noise(i, k) * 0.4);
        g.lineTo(x + Math.cos(angle) * reach, y + Math.sin(angle) * reach);
      }
      g.closePath();
      g.fillStyle = "#1f030d";
      g.fill();
      g.strokeStyle = `rgba(255,${60 + (i % 4) * 30},90,${0.55 + 0.4 * Math.sin(time * 4 + i)})`;
      g.lineWidth = 1.6;
      g.stroke();
    }
    // Chevrons pointing the way the wall moves.
    for (let row = 0; row < 3; row++) {
      const cy = 120 + row * 160,
        cx = edge - 58;
      if (cx < 10) break;
      for (let k = 0; k < 2; k++) {
        const phase = (time * 2.2 - k * 0.3 - row * 0.15) % 1,
          alpha = 0.35 + 0.65 * Math.max(0, Math.sin(phase * Math.PI));
        g.strokeStyle = `rgba(255,90,130,${alpha})`;
        g.lineWidth = 6;
        g.lineJoin = "miter";
        g.beginPath();
        g.moveTo(cx + k * 18 - 8, cy - 16);
        g.lineTo(cx + k * 18 + 6, cy);
        g.lineTo(cx + k * 18 - 8, cy + 16);
        g.stroke();
      }
    }
    // The warning sign, once the wall is wide enough to carry it.
    if (edge > 170) {
      const sx = edge - 150,
        sy = 212;
      g.shadowColor = "#ff2050";
      g.shadowBlur = 16;
      g.fillStyle = "rgba(38,2,14,0.88)";
      g.strokeStyle = "#ff4466";
      g.lineWidth = 2.5;
      roundRect(g, sx, sy, 112, 104, 8);
      g.fill();
      g.stroke();
      g.shadowBlur = 0;
      g.fillStyle = "#ff4466";
      g.beginPath();
      g.moveTo(sx + 56, sy + 10);
      g.lineTo(sx + 70, sy + 34);
      g.lineTo(sx + 42, sy + 34);
      g.closePath();
      g.fill();
      g.fillStyle = "#26020e";
      g.font = "bold 12px 'Press Start 2P', monospace";
      g.textAlign = "center";
      g.fillText("!", sx + 56, sy + 32);
      g.fillStyle = "#ffe0e6";
      g.font = "bold italic 17px 'Arial Black', Impact, sans-serif";
      g.fillText("CRUSH", sx + 56, sy + 56);
      g.fillText("ZONE", sx + 56, sy + 74);
      g.fillStyle = "#ff8aa0";
      g.font = "7px 'Press Start 2P', monospace";
      g.fillText("MOVING RIGHT!", sx + 56, sy + 92);
    }
    g.restore();
    // The burning edge.
    g.beginPath();
    for (let y = -20; y <= VIEW_H + 20; y += 18) g.lineTo(edge + jag(y), y);
    g.save();
    g.shadowColor = "#ff1450";
    g.shadowBlur = 22;
    g.strokeStyle = "#ff3b5c";
    g.lineWidth = 6;
    g.stroke();
    g.shadowBlur = 0;
    g.strokeStyle = "#ffd9b0";
    g.lineWidth = 2;
    g.stroke();
    g.restore();
    if (emit)
      effects.add({
        x: world.crushX + jag(0) + random() * 6,
        y: random() * VIEW_H,
        vx: 40 + random() * 80 + world.scroll * 60,
        vy: -20 - random() * 40,
        color: random() < 0.5 ? "#ff7a3a" : "#ff3b8a",
        size: 1.2 + random() * 1.8,
        life: 0.5 + random() * 0.6,
      });
  }

  /** A red pulse at the left of the screen when this device's chopper nears the crush zone. */
  function danger(g: Paint, world: WorldView, me: string, time: number): void {
    const mine = world.choppers.find(
      (c) => c.id === me && c.state === "flying",
    );
    if (!mine) return;
    const gap = mine.x - world.crushX;
    if (gap > 160) return;
    const k = (1 - Math.max(0, gap) / 160) * (0.6 + 0.4 * Math.sin(time * 10));
    const vignette = g.createLinearGradient(0, 0, 260, 0);
    vignette.addColorStop(0, `rgba(255,20,60,${0.45 * k})`);
    vignette.addColorStop(1, "rgba(255,20,60,0)");
    g.fillStyle = vignette;
    g.fillRect(0, 0, 260, VIEW_H);
  }

  return {
    draw,
    setPilotAtlas: choppers.setPilotAtlas,
  };
}

function drawExit(g: Paint, camX: number, time: number): void {
  const x = EXIT_X - camX;
  if (x > VIEW_W + 220 || x < -200) return;
  // The finish curtain.
  g.save();
  g.globalCompositeOperation = "lighter";
  const beam = g.createLinearGradient(x - 26, 0, x + 26, 0);
  beam.addColorStop(0, "rgba(40,200,255,0)");
  beam.addColorStop(
    0.5,
    `rgba(90,220,255,${0.45 + 0.15 * Math.sin(time * 6)})`,
  );
  beam.addColorStop(1, "rgba(40,200,255,0)");
  g.fillStyle = beam;
  g.fillRect(x - 26, 0, 52, VIEW_H);
  g.strokeStyle = "rgba(200,245,255,0.7)";
  g.lineWidth = 1;
  for (let y = (time * 90) % 24; y < VIEW_H; y += 24) {
    g.beginPath();
    g.moveTo(x - 10, y);
    g.lineTo(x + 10, y);
    g.stroke();
  }
  g.restore();
  // Beyond the gate: open daylight blue.
  const out = g.createLinearGradient(x, 0, x + 260, 0);
  out.addColorStop(0, "rgba(60,160,255,0.15)");
  out.addColorStop(1, "rgba(120,210,255,0.3)");
  g.fillStyle = out;
  g.fillRect(x, 0, 400, VIEW_H);
  // The sign, as in the concept: EXIT with running chevrons, on a steel mast.
  const sx = x + 22,
    sy = 360;
  g.fillStyle = "#16204d";
  g.fillRect(sx + 60, sy + 70, 10, VIEW_H - sy);
  g.save();
  g.shadowColor = "#34c8ff";
  g.shadowBlur = 18;
  g.fillStyle = "rgba(6,20,52,0.9)";
  g.strokeStyle = "#5fd8ff";
  g.lineWidth = 3;
  roundRect(g, sx, sy, 130, 72, 8);
  g.fill();
  g.stroke();
  g.fillStyle = "#9ff0ff";
  g.font = "bold italic 30px 'Arial Black', Impact, sans-serif";
  g.textBaseline = "middle";
  g.textAlign = "left";
  g.fillText("EXIT", sx + 12, sy + 37);
  g.restore();
  for (let k = 0; k < 3; k++) {
    const alpha =
      0.3 + 0.7 * Math.max(0, Math.sin((time * 3 - k * 0.35) * Math.PI));
    g.strokeStyle = `rgba(120,230,255,${alpha})`;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(sx + 92 + k * 11, sy + 24);
    g.lineTo(sx + 102 + k * 11, sy + 36);
    g.lineTo(sx + 92 + k * 11, sy + 48);
    g.stroke();
  }
}

export { VIEW_W, VIEW_H };
