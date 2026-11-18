import type Phaser from "phaser";
import { config } from "../../game/sim/config.js";
import type { ArenaFrame } from "./frame.js";
import { STADIUM_LIVERIES } from "./fuse-truck.js";
import { courseLabel } from "../course-label.js";

/** Flat LED timing tower. The colored bib and roof carry the same slot number. */
export function buildFuseTimingBoard(scene: Phaser.Scene, frame: ArenaFrame) {
  const width = config.screen.width;
  const g = scene.add.graphics();
  const label = (
    x: number,
    y: number,
    value: string,
    size: number,
    color: string,
    bold = false,
  ) =>
    scene.add
      .text(x, y, value, {
        fontFamily: "monospace",
        fontSize: `${size}px`,
        color,
        fontStyle: bold ? "bold" : "normal",
        strokeThickness: 0,
      })
      .setOrigin(0, 0.5);
  g.fillStyle(0x0d182b).fillRect(0, 0, width, 99);
  g.fillStyle(0x203247).fillRect(0, 83, width, 14);
  for (let x = 4; x < width; x += 8) {
    g.fillStyle(x % 40 === 4 ? 0xf5c685 : 0x536876).fillRect(x, 88, 3, 3);
  }
  g.fillStyle(0x28e5d4).fillRect(0, 96, width, 2);
  // The slash-and-fuse insignia reads at couch distance.
  g.fillStyle(0x29f5dc).fillTriangle(15, 26, 39, 26, 15, 57);
  g.fillStyle(0xffa454).fillTriangle(31, 52, 48, 52, 31, 72);
  label(52, 31, "FUSE", 36, "#f3fffa", true);
  label(53, 61, "DRIVERS", 18, "#2af0d9", true);
  const x0 = 207,
    clockWidth = 174,
    w = (width - x0 - clockWidth - 12) / frame.race.trucks.length;
  const names: Phaser.GameObjects.Text[] = [],
    stats: Phaser.GameObjects.Text[] = [];
  frame.race.trucks.forEach((_, slot) => {
    const x = x0 + slot * w;
    const hex = STADIUM_LIVERIES[slot % STADIUM_LIVERIES.length]!;
    const color = Number.parseInt(hex.slice(1), 16);
    g.fillStyle(0x18263a).fillRect(x, 10, w - 5, 63);
    g.fillStyle(color).fillRect(x, 10, 4, 63);
    label(x + 13, 42, String(slot + 1).padStart(2, "0"), 31, hex, true);
    names.push(label(x + 62, 29, "", 20, "#f3f8f7", true));
    stats.push(label(x + 62, 55, "", 17, "#a4bcc5"));
  });
  const x = width - clockWidth;
  label(x + 12, 22, "RACE TIME", 16, "#7d9ba7");
  const clock = label(x + 10, 52, "", 32, "#e4fff6", true);
  const course = label(
    width - 17,
    config.screen.height - 16,
    courseLabel(frame.track.name).toUpperCase(),
    18,
    "#eafffa",
    true,
  )
    .setOrigin(1, 0.5)
    .setBackgroundColor("#172336")
    .setPadding(8, 4, 8, 4);
  return { names, stats, clock, course };
}
