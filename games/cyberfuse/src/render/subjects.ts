import type { MissionState } from "../sim/index.js";
import {
  PICKUP_SPRITES,
  PROP_DEFS,
  type Character,
} from "../campaign/index.js";
import type { Actor } from "./camera.js";
import { lightPool, type Art } from "./deck.js";

type Context = CanvasRenderingContext2D;
type Item = MissionState["items"][number];
type Shot = MissionState["shots"][number];

const TEAM = ["#4bf3cb", "#ffb753", "#96baff", "#d7a2ff", "#ff8ea5"] as const;
// Classic loadouts carry either a blade, a visible blaster, or a thrown/placed weapon.
const GUNS = [1, 0, -1, 0, 0, 0, -1, -1, 0, -1, -1, -1, 0, 0, -1, 0] as const;
const SUITS = [
  "#b78769",
  "#95afb6",
  "#f1bb8b",
  "#e88e62",
  "#768b9b",
  "#b5b764",
  "#ee7659",
  "#d5a15d",
  "#74b39d",
  "#82a8e4",
  "#cf94d5",
  "#d897ae",
  "#aab8cd",
  "#789888",
];

const sprites = new Map(
  [...PICKUP_SPRITES, ...PROP_DEFS.map((prop) => prop.sprite)].map((sprite) => [
    sprite.id,
    sprite,
  ]),
);

function shadow(ctx: Context, x: number, y: number, width: number): void {
  ctx.fillStyle = "rgba(3,9,16,.5)";
  ctx.beginPath();
  ctx.ellipse(x + 0.7, y + 0.4, width, width * 0.36, 0, 0, Math.PI * 2);
  ctx.fill();
}

export function drawOperator(
  ctx: Context,
  art: Art,
  actor: Actor,
  tick: number,
  seatIndex: number,
  character: Character | undefined,
  me?: string,
): void {
  const own = actor.seat !== null && actor.seat === me;
  const allied = actor.seat !== null;
  const team = allied
    ? TEAM[Math.max(0, seatIndex) % TEAM.length]!
    : (SUITS[character?.body ?? -1] ?? "#fa7181");
  const down = actor.hp <= 0;
  const death = down ? Math.floor((tick - actor.deathTick) / 4) + 1 : 0;
  if (death > 9) return;
  const fired = actor.lastShot >= 0 ? tick - actor.lastShot : Infinity;
  const walk = (Math.floor(tick / 8) + Math.max(0, seatIndex)) % 4;
  const pose = fired < 6 ? 7 : fired < 12 ? 8 : actor.walking ? 3 + walk : 0;
  shadow(ctx, actor.x, actor.y, 5.7);
  if (allied && !down) {
    ctx.strokeStyle = team;
    ctx.lineWidth = own ? 0.65 : 0.4;
    ctx.globalAlpha = own ? 0.85 : 0.62;
    ctx.beginPath();
    ctx.ellipse(actor.x, actor.y + 0.6, 5.7, 2.1, 0, 0.05, Math.PI - 0.05);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  const face = allied
    ? [0, 1, 8, 12, 16][Math.max(0, seatIndex) % 5]
    : (character?.face ?? 6);
  const effect = actor.flamed
    ? "#ff854e"
    : actor.poisoned
      ? "#afdc59"
      : actor.petrified
        ? "#a4b6bd"
        : actor.confused
          ? "#cf97ff"
          : team;
  if (actor.skill.flags & (1 << 11)) ctx.globalAlpha = 0.47;
  art.drawActor(ctx, actor.x, actor.y, {
    dir: actor.dir,
    state: pose,
    face,
    gun: GUNS[actor.weapon] ?? 0,
    team: effect,
    death,
  });
  ctx.globalAlpha = 1;
  if (down || fired > 2 || GUNS[actor.weapon] !== 0) return;
  const angle = (actor.dir * Math.PI) / 4 - Math.PI / 2;
  const x = actor.x + Math.cos(angle) * 6;
  const y = actor.y - 9 + Math.sin(angle) * 3;
  lightPool(ctx, x, y, 6.8, 5.5, "rgba(255,204,114,.36)");
}

export function drawPickup(
  ctx: Context,
  art: Art,
  item: Item,
  world: MissionState,
): void {
  const { x, y } = item;
  const objective =
    item.objectiveIndex !== null &&
    !((world.objectives[item.objectiveIndex]?.flags ?? 0) & 1);
  const pulse = (1 + Math.sin(world.tick * 0.075 + x)) / 2;
  if (objective) {
    lightPool(ctx, x, y, 8, 4, "rgba(255,193,89,.26)");
    ctx.strokeStyle = "#ffd88a";
    ctx.lineWidth = 0.45;
    ctx.globalAlpha = 0.45 + pulse * 0.3;
    ctx.beginPath();
    ctx.ellipse(x, y, 5.6, 2.2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  shadow(ctx, x, y, 3.5);
  if (item.kind === "hostage") {
    const escort =
      item.escort === null
        ? undefined
        : world.actors.find((actor) => actor.id === item.escort);
    art.drawActor(ctx, x, y, {
      dir: escort?.dir ?? 4,
      face: item.sprite,
      state: escort?.walking ? 3 + ((world.tick >> 3) % 4) : 0,
      gun: -1,
      team: "#f4d39b",
    });
  } else if (item.kind === "medkit") art.prop(ctx, "bag", x, y);
  else {
    const sprite = sprites.get(item.sprite);
    if (sprite) art.drawSprite(ctx, sprite.id, x + sprite.dx, y + sprite.dy);
  }
  if (objective) {
    const markerY =
      y -
      (item.kind === "hostage" || item.kind === "reactor" ? 24 : 10) -
      pulse;
    ctx.beginPath();
    ctx.moveTo(x - 1.6, markerY);
    ctx.lineTo(x, markerY + 1.35);
    ctx.lineTo(x + 1.6, markerY);
    ctx.strokeStyle = "#ffdc9c";
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }
}

export function drawShot(ctx: Context, art: Art, shot: Shot): void {
  const { x, y, z, kind } = shot;
  if (kind === "fireball" && shot.age < 0) return;
  if (kind === "fireball") {
    const at = y - Math.max(0, z) / 4;
    lightPool(ctx, x, at, 12, 10, "rgba(255,146,61,.25)");
    art.effect(ctx, "fireball", Math.min(15, shot.age >> 2), x, at);
  } else if (kind === "gas") {
    return;
  } else if (kind === "grenade" || kind === "molotov") {
    shadow(ctx, x, y, 2.6);
    const at = y - Math.max(0, z) / 16;
    if (kind === "molotov") art.prop(ctx, "molotov", x, at);
    else art.effect(ctx, "grenade", (shot.age >> 1) & 3, x, at);
  } else if (kind === "firePatch" || kind === "flame") {
    art.effect(ctx, "flame", shot.frame & 3, x, y - z);
  } else if (kind === "bolt") {
    art.effect(ctx, "beam", shot.frame & 7, x, y - z);
  } else if (kind === "spark") {
    art.prop(ctx, "spark", x, y - z);
  } else if (kind === "dynamite") {
    art.prop(ctx, "dynamite", x, y - z);
  } else if (
    kind === "mine" ||
    kind === "armedMine" ||
    kind === "triggeredMine"
  ) {
    art.prop(ctx, "mine", x, y - z);
    if (kind !== "mine" && shot.age % (kind === "armedMine" ? 16 : 5) < 3) {
      ctx.fillStyle = "#ff7a73";
      ctx.fillRect(x - 0.6, y - z - 1.7, 1.2, 0.65);
    }
  } else {
    const speed = Math.hypot(shot.dx, shot.dy) || 1;
    const at = y - z;
    ctx.strokeStyle =
      kind === "petrifier"
        ? "#c8b3ff"
        : kind === "brown"
          ? "#f39564"
          : "#fee085";
    ctx.lineWidth = 0.65;
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.moveTo(x - (3.5 * shot.dx) / speed, at - (3.5 * shot.dy) / speed);
    ctx.lineTo(x, at);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = kind === "petrifier" ? "#ede1ff" : "#fff3c2";
    ctx.beginPath();
    ctx.arc(x, at, kind === "sniper" ? 0.72 : 0.48, 0, Math.PI * 2);
    ctx.fill();
  }
}
