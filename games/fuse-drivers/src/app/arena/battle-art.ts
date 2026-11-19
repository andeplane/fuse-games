import type Phaser from "phaser";
import { projectOffroad } from "../../game/offroad/course.js";
import { getOffroadTerrain } from "../../game/offroad/courses.js";
import { BATTLE } from "../../game/sim/battle.js";
import type { ArenaFrame } from "./frame.js";

const blastRing = Array.from({ length: 24 }, (_, i) => ({
  x: BATTLE.blastRadius * Math.cos((i * Math.PI) / 12),
  y: BATTLE.blastRadius * Math.sin((i * Math.PI) / 12),
}));

type Graphics = Phaser.GameObjects.Graphics;

/** Prize bag, nitrous bottle and stamped steel cases sit on the same ground plane as the tires. */
function drawProp(
  g: Graphics,
  x: number,
  y: number,
  kind: "cash" | "nitro" | "shield" | "firebomb",
) {
  g.fillStyle(0x101827, 0.44).fillEllipse(x + 3, y + 1, 30, 10);
  if (kind === "cash") {
    g.fillStyle(0x633725).fillEllipse(x, y - 7, 26, 16);
    g.fillStyle(0xd69647).fillEllipse(x - 2, y - 9, 23, 15);
    g.fillStyle(0xf4c277).fillTriangle(
      x - 8,
      y - 16,
      x - 2,
      y - 22,
      x + 3,
      y - 14,
    );
    g.fillStyle(0x82452c).fillRect(x - 7, y - 16, 11, 3);
    g.lineStyle(2, 0x275539)
      .lineBetween(x - 5, y - 10, x + 1, y - 11)
      .lineBetween(x - 5, y - 10, x + 1, y - 7)
      .lineBetween(x + 1, y - 7, x - 5, y - 6)
      .lineBetween(x - 2, y - 13, x - 2, y - 4);
    return;
  }
  if (kind === "nitro") {
    g.fillStyle(0x103654).fillRoundedRect(x - 7, y - 23, 15, 23, 5);
    g.fillStyle(0x20a9dd).fillRoundedRect(x - 6, y - 23, 10, 21, 4);
    g.fillStyle(0xacecf1).fillRect(x - 5, y - 18, 2, 12);
    g.fillStyle(0xffc550).fillRect(x - 4, y - 26, 8, 4);
    g.fillStyle(0xeaffef).fillTriangle(
      x + 2,
      y - 18,
      x - 2,
      y - 11,
      x + 3,
      y - 12,
    );
    return;
  }
  const shield = kind === "shield";
  g.fillStyle(shield ? 0x147985 : 0xae5027).fillRect(x - 14, y - 15, 21, 15);
  g.fillStyle(shield ? 0x10515e : 0x793723)
    .fillTriangle(x + 7, y, x + 14, y - 5, x + 7, y - 15)
    .fillTriangle(x + 14, y - 5, x + 14, y - 20, x + 7, y - 15);
  g.fillStyle(shield ? 0x70e5d1 : 0xffbd61)
    .fillTriangle(x - 14, y - 15, x - 6, y - 20, x + 14, y - 20)
    .fillTriangle(x - 14, y - 15, x + 14, y - 20, x + 7, y - 15);
  g.lineStyle(2, 0xc5c6b4)
    .lineBetween(x - 10, y - 14, x - 10, y - 2)
    .lineBetween(x + 4, y - 14, x + 4, y - 2);
  if (shield)
    g.fillStyle(0xd9fff5).fillTriangle(
      x - 7,
      y - 11,
      x + 2,
      y - 11,
      x - 2,
      y - 4,
    );
  else
    g.fillStyle(0xffe9a6)
      .fillCircle(x - 3, y - 7, 3)
      .fillRect(x - 2, y - 12, 2, 3);
}

export function paintTrackPickups(
  g: Phaser.GameObjects.Graphics,
  frame: ArenaFrame,
  fuse: boolean,
): void {
  g.clear();
  const { battle, tick, pickups } = frame.view.race ?? frame.race;
  if (!battle && !(fuse && pickups.active)) return;
  const place = (p: {
    x: number;
    y: number;
    kind: "cash" | "nitro" | "shield" | "firebomb";
  }) => {
    const point = groundPoint(frame, p.x, p.y);
    drawProp(g, point.x, point.y, p.kind);
  };
  if (fuse && pickups.active) place(pickups.active);
  for (const crate of battle?.crates ?? [])
    if (crate.readyAt <= tick) place(crate);
}

function groundPoint(frame: ArenaFrame, x: number, y: number) {
  const terrain = getOffroadTerrain(frame.track.name)!;
  return projectOffroad(
    frame.track.name,
    x,
    y,
    terrain.sample(Math.round(x), Math.round(y))?.height ?? 0x8000,
  );
}

export function paintBattleArt(g: Graphics, frame: ArenaFrame) {
  g.clear();
  const { battle, tick } = frame.view.race ?? frame.race;
  if (!battle) return;
  const ground = (x: number, y: number) => groundPoint(frame, x, y);
  for (const bomb of battle.bombs) {
    const { x, y } = ground(bomb.x, bomb.y);
    g.beginPath();
    for (const [i, offset] of blastRing.entries()) {
      const point = ground(bomb.x + offset.x, bomb.y + offset.y);
      if (i === 0) g.moveTo(point.x, point.y);
      else g.lineTo(point.x, point.y);
    }
    g.closePath();
    if (tick < bomb.detonateAt) {
      const pulse = 0.5 + 0.5 * Math.cos((bomb.detonateAt - tick) * 0.75);
      g.lineStyle(3, 0xffb148, 0.55 + 0.45 * pulse).strokePath();
      g.fillStyle(0x30162a).fillCircle(x, y - 5, 9);
      g.lineStyle(3, 0xff773d).strokeCircle(x, y - 5, 9);
      g.fillStyle(0xffefae).fillCircle(x + 6, y - 15, 3);
    } else {
      const life =
        (bomb.expiresAt - tick) / Math.max(1, bomb.expiresAt - bomb.detonateAt);
      g.fillStyle(0xff4534, 0.42 * life).fillPath();
      g.lineStyle(4, 0xffbc58, life).strokePath();
      g.fillStyle(0xffed9a, life).fillTriangle(
        x - 13,
        y + 3,
        x + 14,
        y + 3,
        x + 3,
        y - 27 * life,
      );
    }
  }
  battle.slots.forEach((slot, i) => {
    const pose = frame.poses[i];
    if (!pose || (slot.shieldUntil <= tick && slot.hitUntil <= tick)) return;
    g.lineStyle(
      3,
      slot.shieldUntil > tick ? 0x67f4ff : 0xff7758,
      0.9,
    ).strokeEllipse(pose.x, pose.y - 3, 59, 37);
  });
}
