import type { WorldView } from "../engine/view.js";
import { PICKUP_KINDS, VIEW_W } from "../engine/view-kit.js";
import { hexA, PICKUP_COLORS, PICKUP_LABELS, seatColor } from "./palette.js";
import type { Paint } from "./sprites.js";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  color: string;
  kind: "dot" | "ring" | "smoke" | "shard" | "text";
  text?: string;
}

const MAX_PARTICLES = 700;
/**
 * What an effect is, for drawing it once: its kind, seat, moment and place, not its id. A rollback that changes an
 * earlier outcome renumbers every later effect, and the same explosion must not go off twice for it.
 */
export const effectKey = (fx: {
  kind: string;
  slot: number;
  at: number;
  x: number;
  y: number;
}): string =>
  `${fx.kind}:${fx.slot}:${Math.floor(fx.at / 6)}:${Math.round(fx.x / 16)}:${Math.round(fx.y / 16)}`;

type Effect = WorldView["fx"][number];
type EffectRecipe = (
  fx: Effect,
  color: string,
  world: WorldView,
  me: string,
) => void;

function isLocal(world: WorldView, slot: number, me: string): boolean {
  return world.choppers.find((chopper) => chopper.slot === slot)?.id === me;
}

/** Keep surviving particles in draw order while advancing their motion. */
function advanceParticles(particles: Particle[], dt: number): void {
  let kept = 0;
  for (const particle of particles) {
    particle.life -= dt;
    if (particle.life <= 0) continue;
    particle.vy += particle.gravity * dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.size += particle.grow * dt;
    if (particle.kind !== "ring") {
      particle.vx *= 0.985;
      particle.vy *= particle.gravity ? 1 : 0.985;
    }
    particles[kept++] = particle;
  }
  particles.length = kept;
}

export function createSceneEffects(random: () => number) {
  const particles: Particle[] = [];
  let seen = new Set<string>();
  let shake = 0;

  const add = (p: Partial<Particle> & Pick<Particle, "x" | "y">) => {
    if (particles.length >= MAX_PARTICLES) particles.shift();
    particles.push({
      vx: 0,
      vy: 0,
      gravity: 0,
      life: 0.6,
      size: 3,
      grow: 0,
      color: "#fff",
      kind: "dot",
      ...p,
      max: p.max ?? p.life ?? 0.6,
    });
  };
  const burst = (
    x: number,
    y: number,
    count: number,
    colors: readonly string[],
    speed: number,
    options: Partial<Particle> = {},
  ) => {
    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2,
        v = speed * (0.35 + random() * 0.65);
      add({
        x,
        y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        color: colors[i % colors.length]!,
        size: 1.5 + random() * 2.5,
        life: 0.35 + random() * 0.45,
        ...options,
      });
    }
  };
  const ring = (
    x: number,
    y: number,
    color: string,
    radius: number,
    life = 0.45,
    size = 3,
  ) => add({ x, y, kind: "ring", color, size, grow: radius / life, life });
  const text = (x: number, y: number, label: string, color: string) =>
    add({ x, y, vy: -38, kind: "text", text: label, color, life: 1.1 });

  const recipes: Record<Effect["kind"], EffectRecipe> = {
    explode(fx, color, world, me) {
      burst(fx.x, fx.y, 40, ["#fff3b0", "#ffb13b", "#ff5a2a", color], 280, {
        gravity: 320,
      });
      burst(fx.x, fx.y, 10, ["#39405e", "#24283d"], 60, {
        kind: "smoke",
        grow: 26,
        life: 1.2,
        vy: -30,
      });
      ring(fx.x, fx.y, "#fff1c8", 70, 0.4, 4);
      ring(fx.x, fx.y, color, 110, 0.6, 2);
      text(fx.x, fx.y - 30, "CRASH!", color);
      shake = Math.max(shake, isLocal(world, fx.slot, me) ? 14 : 8);
    },
    hit(fx, color, world, me) {
      burst(fx.x, fx.y, 12, [color, "#ffffff"], 170);
      ring(fx.x, fx.y, color, 28, 0.25, 2);
      if (isLocal(world, fx.slot, me)) shake = Math.max(shake, 4);
    },
    shieldPop(fx) {
      ring(fx.x, fx.y, "#6cc4ff", 60, 0.45, 4);
      burst(fx.x, fx.y, 16, ["#6cc4ff", "#d6f0ff"], 200, { kind: "shard" });
      text(fx.x, fx.y - 30, "SHIELD SAVED YOU", "#8fd4ff");
    },
    pickup(fx) {
      const kind = PICKUP_KINDS[fx.data] ?? "shield",
        tint = PICKUP_COLORS[kind];
      ring(fx.x, fx.y, tint, 46, 0.4, 3);
      burst(fx.x, fx.y, 14, [tint, "#ffffff"], 120);
      text(fx.x, fx.y - 24, `+${PICKUP_LABELS[kind]}`, tint);
    },
    shock(fx) {
      ring(fx.x, fx.y, "#c06bff", 300, 0.55, 6);
      ring(fx.x, fx.y, "#f0d0ff", 200, 0.4, 3);
      burst(fx.x, fx.y, 24, ["#c06bff", "#ffffff"], 340);
      shake = Math.max(shake, 7);
    },
    scramble(fx) {
      text(fx.x, fx.y - 30, "SCRAMBLED!", "#ff7ad2");
      ring(fx.x, fx.y, "#ff5fc8", 36, 0.4, 2);
    },
    shatter(fx) {
      burst(fx.x, fx.y, 12, ["#3a1a14", "#6a2a18"], 180, {
        kind: "shard",
        gravity: 380,
      });
      burst(fx.x, fx.y, 8, ["#ff8a3a", "#ffd07a"], 140);
    },
    droneDown(fx, color) {
      burst(fx.x, fx.y, 30, ["#fff0b0", "#ff7a3a", "#ff2a3c"], 240, {
        gravity: 260,
      });
      ring(fx.x, fx.y, "#ff5a4a", 70, 0.45, 3);
      if (fx.slot >= 0) text(fx.x, fx.y - 28, "DRONE DOWN", color);
      shake = Math.max(shake, 5);
    },
    exit(fx, color) {
      ring(fx.x, fx.y, color, 90, 0.6, 4);
      burst(fx.x, fx.y, 30, [color, "#ffffff", "#7fe0ff"], 220);
      text(fx.x, fx.y - 34, "ESCAPED!", color);
    },
    bolt(fx) {
      burst(fx.x, fx.y, 6, ["#ff4a5a", "#ffd0d0"], 90);
    },
    droneHit(fx) {
      burst(fx.x, fx.y, 8, ["#ffffff", "#ff6a6a"], 140);
    },
    bump(fx) {
      burst(fx.x, fx.y, 10, ["#ffffff", "#fff4a0"], 160);
      text(fx.x, fx.y - 22, "BUMP!", "#fff4a0");
    },
    spark(fx, color) {
      burst(fx.x, fx.y, 5, [color, "#ffffff"], 90);
    },
  };

  function spawn(world: WorldView, me: string): void {
    for (const fx of world.fx) {
      const key = effectKey(fx);
      if (seen.has(key)) continue;
      seen.add(key);
      // Effects from before a reload or rejoin were already shown.
      if (world.step - fx.at > 20) continue;
      const color = fx.slot >= 0 ? seatColor(fx.slot) : "#ffffff";
      recipes[fx.kind]?.(fx, color, world, me);
    }
    if (seen.size > 600) seen = new Set([...seen].slice(-300));
  }

  function tick(dt: number): void {
    advanceParticles(particles, dt);
    shake *= Math.pow(0.02, dt);
    if (shake < 0.2) shake = 0;
  }

  return {
    add,
    spawn,
    tick,
    draw: (g: Paint, camX: number) => drawParticles(g, camX, particles),
    reset(world: WorldView) {
      particles.length = 0;
      seen = new Set(world.fx.map(effectKey));
    },
    applyShake(g: Paint, reducedMotion: boolean | undefined) {
      if (shake && !reducedMotion)
        g.translate((random() - 0.5) * shake, (random() - 0.5) * shake);
    },
  };
}

function drawParticles(
  g: Paint,
  camX: number,
  particles: readonly Particle[],
): void {
  g.save();
  for (const p of particles) {
    const x = p.x - camX,
      k = Math.max(0, p.life / p.max);
    if (x < -120 || x > VIEW_W + 120) continue;
    switch (p.kind) {
      case "ring":
        g.globalCompositeOperation = "lighter";
        g.strokeStyle = hexA(p.color, k);
        g.lineWidth = 3 * k + 0.5;
        g.beginPath();
        g.arc(x, p.y, p.size, 0, Math.PI * 2);
        g.stroke();
        break;
      case "smoke":
        g.globalCompositeOperation = "source-over";
        g.fillStyle = hexA(p.color, 0.5 * k);
        g.beginPath();
        g.arc(x, p.y, p.size, 0, Math.PI * 2);
        g.fill();
        break;
      case "text":
        g.globalCompositeOperation = "source-over";
        g.globalAlpha = Math.min(1, k * 2);
        g.font = "11px 'Press Start 2P', monospace";
        g.textAlign = "center";
        g.lineWidth = 3;
        g.strokeStyle = "#05060f";
        g.strokeText(p.text ?? "", x, p.y);
        g.fillStyle = p.color;
        g.fillText(p.text ?? "", x, p.y);
        g.globalAlpha = 1;
        break;
      case "shard":
        g.globalCompositeOperation = "source-over";
        g.fillStyle = hexA(p.color, k);
        g.fillRect(x - p.size, p.y - p.size / 2, p.size * 2, p.size);
        break;
      default:
        g.globalCompositeOperation = "lighter";
        g.fillStyle = hexA(p.color, k);
        g.beginPath();
        g.arc(x, p.y, p.size * (0.5 + k * 0.5), 0, Math.PI * 2);
        g.fill();
    }
  }
  g.restore();
}
