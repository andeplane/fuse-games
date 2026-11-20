import type { ChopperView, WorldView } from "../engine/view.js";
import { COL, COLUMNS, terrain } from "../engine/view-kit.js";
import { AVATAR_ATLAS } from "fuse-ui/assets";
import { pilotFrame } from "./pilots.js";
import { hexA, seatColor, seatShade } from "./palette.js";
import type { SceneInput } from "./scene.js";
import type { createSceneEffects } from "./scene-effects.js";
import {
  chopperSprite,
  type MakeSurface,
  type Paint,
  type Sprite,
} from "./sprites.js";

const STEP_S = 1 / 60;
type AddParticle = ReturnType<typeof createSceneEffects>["add"];
type PilotLabels = Pick<SceneInput, "me" | "labels" | "avatars">;
type TrailPoint = { x: number; y: number };

function sampleTrail(trail: TrailPoint[], chopper: ChopperView): void {
  if (chopper.state === "flying") {
    trail.push({ x: chopper.x - 22 * chopper.face, y: chopper.y + 2 });
    if (trail.length > 24) trail.shift();
  } else trail.shift();
}

function paintTrail(
  g: Paint,
  trail: readonly TrailPoint[],
  camX: number,
  color: string,
): void {
  g.save();
  g.globalCompositeOperation = "lighter";
  const length = trail.length;
  trail.forEach((point, i) => {
    const k = (i + 1) / length;
    g.fillStyle = hexA(color, 0.08 + k * 0.55);
    g.beginPath();
    g.arc(point.x - camX, point.y, 1 + k * 2.2, 0, Math.PI * 2);
    g.fill();
  });
  g.restore();
}

export function createChopperVisuals(
  g: Paint,
  make: MakeSurface,
  random: () => number,
  add: AddParticle,
) {
  const choppers = new Map<string, Sprite>();
  const trails = new Map<string, TrailPoint[]>();
  let atlas:
    { image: CanvasImageSource; width: number; height: number } | undefined;
  const chopperFor = (slot: number, avatar: string) => {
    const frame = pilotFrame(avatar, slot);
    const key = `${slot}:${frame}`;
    let s = choppers.get(key);
    if (!s)
      choppers.set(
        key,
        (s = chopperSprite(
          make,
          seatColor(slot),
          seatShade(slot),
          atlas
            ? {
                image: atlas.image,
                x:
                  ((frame % AVATAR_ATLAS.columns) * atlas.width) /
                  AVATAR_ATLAS.columns,
                y:
                  (Math.floor(frame / AVATAR_ATLAS.columns) * atlas.height) /
                  AVATAR_ATLAS.rows,
                width: atlas.width / AVATAR_ATLAS.columns,
                height: atlas.height / AVATAR_ATLAS.rows,
              }
            : undefined,
        )),
      );
    return s;
  };

  function drawTrail(
    c: ChopperView,
    camX: number,
    color: string,
    sample: boolean,
  ) {
    let trail = trails.get(c.id);
    if (!trail) trails.set(c.id, (trail = []));
    if (sample) sampleTrail(trail, c);
    paintTrail(g, trail, camX, color);
  }

  function drawWreck(
    world: WorldView,
    c: ChopperView,
    x: number,
    sprite: Sprite,
  ) {
    const since = Math.max(0, world.step - c.endedAt) * STEP_S;
    if (since > 4) return;
    const { bottom } = terrain(world.seed),
      column = Math.max(0, Math.min(COLUMNS - 1, Math.round(c.x / COL))),
      floor = bottom[column]! - 8,
      y = Math.min(floor, c.y + 0.5 * 700 * since * since),
      landed = y >= floor;
    if (random() < 0.5)
      add({
        x: c.x + (random() - 0.5) * 16,
        y,
        vy: -40,
        kind: "smoke",
        color: "#2c3048",
        size: 4,
        grow: 20,
        life: 0.9,
      });
    if (!landed && random() < 0.6)
      add({
        x: c.x,
        y,
        vx: (random() - 0.5) * 60,
        vy: -20,
        color: "#ff8a3a",
        size: 2.5,
        life: 0.4,
      });
    g.save();
    g.translate(x, y);
    g.rotate(landed ? 0.5 * c.face : since * 7 * c.face);
    g.scale(c.face, 1);
    g.globalAlpha = Math.max(0, 1 - Math.max(0, since - 2.5) / 1.5);
    g.drawImage(
      sprite.surface,
      -sprite.ox,
      -sprite.oy,
      sprite.width,
      sprite.height,
    );
    g.restore();
  }

  function draw(
    world: WorldView,
    c: ChopperView,
    input: PilotLabels,
    time: number,
    sample: boolean,
  ) {
    const color = seatColor(c.slot);
    const x = c.x - world.camX;
    drawTrail(c, world.camX, color, sample);
    if (c.state === "escaped") return;
    const sprite = chopperFor(c.slot, input.avatars?.get(c.id) ?? "");
    if (c.state === "crashed") {
      drawWreck(world, c, x, sprite);
      return;
    }
    const wobble =
        c.stun > 0 ? Math.sin(time * 28) * 0.22 * Math.min(1, c.stun / 20) : 0,
      tilt =
        Math.max(-0.35, Math.min(0.35, c.vx * c.face * 0.09 + c.vy * 0.025)) +
        wobble;
    const flicker = c.grace > 0 && Math.floor(time * 20) % 2 === 0;
    g.save();
    g.translate(x, c.y);
    drawTurbo(g, c, random);
    drawShield(g, c, time);
    drawAirframe(g, c, sprite, { time, tilt, flicker }, random);
    drawStatus(g, c, time);
    drawLabel(g, c, input, color, time, world.lift);
    g.restore();
  }

  return {
    draw,
    resetTrails: () => trails.clear(),
    setPilotAtlas(image: CanvasImageSource, width: number, height: number) {
      atlas = { image, width, height };
      choppers.clear();
    },
  };
}

function star(g: Paint, x: number, y: number, r: number, color: string): void {
  g.fillStyle = color;
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2,
      reach = i % 2 === 0 ? r : r * 0.4;
    g.lineTo(x + Math.cos(angle) * reach, y + Math.sin(angle) * reach);
  }
  g.closePath();
  g.fill();
}

function drawTurbo(g: Paint, c: ChopperView, random: () => number) {
  // Turbo flames from the tail.
  if (c.turbo > 0) {
    g.save();
    g.scale(c.face, 1);
    g.globalCompositeOperation = "lighter";
    const length = 16 + random() * 10;
    const flame = g.createLinearGradient(-34, 0, -34 - length, 0);
    flame.addColorStop(0, "rgba(140,255,170,0.9)");
    flame.addColorStop(1, "rgba(60,255,120,0)");
    g.fillStyle = flame;
    g.beginPath();
    g.moveTo(-32, -4);
    g.lineTo(-34 - length, 0);
    g.lineTo(-32, 3);
    g.fill();
    g.restore();
  }
}

function drawShield(g: Paint, c: ChopperView, time: number) {
  if (c.shield) {
    const pulse = 0.55 + 0.25 * Math.sin(time * 5);
    const bubble = g.createRadialGradient(0, 0, 18, 0, 0, 34);
    bubble.addColorStop(0, "rgba(80,170,255,0)");
    bubble.addColorStop(0.8, `rgba(80,170,255,${pulse * 0.35})`);
    bubble.addColorStop(1, `rgba(160,220,255,${pulse})`);
    g.fillStyle = bubble;
    g.beginPath();
    g.arc(0, 0, 34, 0, Math.PI * 2);
    g.fill();
  }
}

function drawAirframe(
  g: Paint,
  c: ChopperView,
  sprite: Sprite,
  { time, tilt, flicker }: { time: number; tilt: number; flicker: boolean },
  random: () => number,
) {
  g.save();
  g.scale(c.face, 1);
  g.rotate(tilt);
  if (flicker) g.globalAlpha = 0.35;
  g.drawImage(
    sprite.surface,
    -sprite.ox,
    -sprite.oy,
    sprite.width,
    sprite.height,
  );
  // Main rotor: a blur disc and two blade pairs, spinning harder under lift.
  const spin = time * (c.lifting ? 46 : 32) + c.slot;
  g.fillStyle = "rgba(220,235,255,0.2)";
  g.beginPath();
  g.ellipse(1, -16, 32, 2.6, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgba(232,240,255,0.9)";
  g.lineWidth = 2;
  g.lineCap = "round";
  for (const phase of [0, Math.PI / 2]) {
    const reach = 32 * Math.cos(spin + phase);
    g.beginPath();
    g.moveTo(1 - reach, -16);
    g.lineTo(1 + reach, -16);
    g.stroke();
  }
  // Tail rotor.
  g.fillStyle = "rgba(220,235,255,0.25)";
  g.beginPath();
  g.arc(-33, -4, 5.5, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgba(232,240,255,0.85)";
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(-33 + Math.cos(spin * 1.4) * 5.5, -4 + Math.sin(spin * 1.4) * 5.5);
  g.lineTo(-33 - Math.cos(spin * 1.4) * 5.5, -4 - Math.sin(spin * 1.4) * 5.5);
  g.stroke();
  // Triple shot: the gun crackles.
  if (c.triple > 0) {
    g.fillStyle = random() < 0.5 ? "#ffe56b" : "#ffffff";
    g.beginPath();
    g.arc(22 + random() * 3, 5, 1.5 + random() * 2, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

function drawStatus(g: Paint, c: ChopperView, time: number) {
  // Stunned: stars circling the rotor mast.
  if (c.stun > 0)
    for (let i = 0; i < 3; i++) {
      const angle = time * 7 + (i * Math.PI * 2) / 3;
      star(g, Math.cos(angle) * 16, -22 + Math.sin(angle) * 5, 3, "#fff27a");
    }
  if (c.scramble > 0) {
    g.fillStyle = "#ff6fcf";
    g.font = "bold 14px 'Press Start 2P', monospace";
    g.textAlign = "center";
    g.fillText("?", Math.sin(time * 6) * 6, -30);
  }
}

function drawLabel(
  g: Paint,
  c: ChopperView,
  input: PilotLabels,
  color: string,
  time: number,
  lift: WorldView["lift"],
) {
  // The label, like the concept's "P1 ▼".
  const label = input.labels.get(c.id) ?? `P${c.slot + 1}`,
    mine = c.id === input.me;
  g.font = "10px 'Press Start 2P', monospace";
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.lineWidth = 3;
  g.strokeStyle = "#05060f";
  g.strokeText(label, 0, -34);
  g.fillStyle = mine ? "#ffffff" : color;
  g.fillText(label, 0, -34);
  // At GO: a chopper whose pilot has not touched lift yet hovers, and says what to do.
  if (c.hovering && mine) {
    const instruction = lift === "classic" ? "HOLD TO FLY!" : "W TO FLY UP";
    g.globalAlpha = 0.6 + 0.4 * Math.sin(time * 9);
    g.fillStyle = "#ffe34a";
    g.strokeText(instruction, 0, -48);
    g.fillText(instruction, 0, -48);
    g.globalAlpha = 1;
  }
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(-4, -30);
  g.lineTo(4, -30);
  g.lineTo(0, -25);
  g.closePath();
  g.fill();
}
