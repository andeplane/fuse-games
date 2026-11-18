import type Phaser from "phaser";
import { projectOffroad } from "../../game/offroad/course.js";
import { getOffroadTerrain } from "../../game/offroad/courses.js";
import { BATTLE } from "../../game/sim/battle.js";
import type { ArenaFrame } from "./frame.js";

/** Battle objects use the same ground projection and folded clock as the trucks. */
export function paintBattleArt(
  g: Phaser.GameObjects.Graphics,
  frame: ArenaFrame,
): void {
  g.clear();
  const { battle, tick } = frame.view.race ?? frame.race;
  if (!battle) return;
  const terrain = getOffroadTerrain(frame.track.name)!;
  const ground = (x: number, y: number) =>
    projectOffroad(
      frame.track.name,
      x,
      y,
      terrain.sample(Math.round(x), Math.round(y))?.height ?? 0x8000,
    );
  for (const crate of battle.crates) {
    if (crate.readyAt > tick) continue;
    const { x, y } = ground(crate.x, crate.y);
    const shield = crate.kind === "shield";
    const glow = shield ? 0x61f7fc : 0xffa750;
    g.fillStyle(0x080d20, 0.65).fillEllipse(x, y + 4, 39, 12);
    g.fillStyle(0x12182b).fillRoundedRect(x - 16, y - 24, 32, 30, 4);
    g.lineStyle(3, glow).strokeRoundedRect(x - 16, y - 24, 32, 30, 4);
    if (shield) {
      g.fillStyle(glow).fillTriangle(x - 9, y - 15, x + 9, y - 15, x, y + 1);
    } else {
      g.fillStyle(glow).fillCircle(x, y - 7, 7);
      g.lineStyle(3, 0xffebae).lineBetween(x + 3, y - 13, x + 7, y - 18);
    }
  }
  for (const bomb of battle.bombs) {
    const { x, y } = ground(bomb.x, bomb.y);
    const outline = Array.from({ length: 24 }, (_, i) => {
      const angle = (i * Math.PI) / 12;
      return ground(
        bomb.x + BATTLE.blastRadius * Math.cos(angle),
        bomb.y + BATTLE.blastRadius * Math.sin(angle),
      );
    });
    if (tick < bomb.detonateAt) {
      const pulse = 0.5 + 0.5 * Math.cos((bomb.detonateAt - tick) * 0.75);
      g.lineStyle(3, 0xffb148, 0.55 + 0.45 * pulse).strokePoints(outline, true);
      g.fillStyle(0x30162a).fillCircle(x, y - 5, 9);
      g.lineStyle(3, 0xff773d).strokeCircle(x, y - 5, 9);
      g.fillStyle(0xffefae).fillCircle(x + 6, y - 15, 3);
    } else {
      const life =
        (bomb.expiresAt - tick) / Math.max(1, bomb.expiresAt - bomb.detonateAt);
      g.fillStyle(0xff4534, 0.42 * life).fillPoints(outline, true);
      g.lineStyle(4, 0xffbc58, life).strokePoints(outline, true);
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
