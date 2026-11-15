import {
  CELL,
  WIDTH,
  HEIGHT,
  COLS,
  ROWS,
  direction,
  type WorldView,
} from "../engine/index.js";

export const COLORS = ["#b6ff4d", "#16e7ff", "#ff2e9d", "#ffe46b", "#a78bfa"];

/** Presentation only. Every crater and projectile comes from the checkpointed world. */
export function createArena(canvas: HTMLCanvasElement) {
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d")!;
  const terrain = document.createElement("canvas");
  terrain.width = WIDTH;
  terrain.height = HEIGHT;
  const ground = terrain.getContext("2d")!;
  let oldRows: string[] = [];
  return {
    draw(world: WorldView, names: ReadonlyMap<string, string>, self: string) {
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#080917";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      // A distant crystal field gives empty tunnels depth without concealing terrain.
      for (let i = 0; i < 75; i++) {
        const x = (i * 163 + 37) % WIDTH,
          y = (i * 79 + 29) % HEIGHT;
        ctx.fillStyle = i % 3 ? "#172238" : "#233b46";
        ctx.fillRect(x, y, 2, i % 3 ? 2 : 5);
      }
      for (let y = 0; y < ROWS; y++) {
        const row = world.terrain[y]!;
        // Neighbour changes can expose an edge in an otherwise unchanged row.
        if (
          row === oldRows[y] &&
          world.terrain[y - 1] === oldRows[y - 1] &&
          world.terrain[y + 1] === oldRows[y + 1]
        )
          continue;
        ground.clearRect(0, y * CELL, WIDTH, CELL);
        for (let x = 0; x < COLS; x++) {
          const cell = row[x];
          if (cell === "0") continue;
          const edge =
            (x > 0 && row[x - 1] === "0") ||
            row[x + 1] === "0" ||
            world.terrain[y - 1]?.[x] === "0" ||
            world.terrain[y + 1]?.[x] === "0";
          ground.fillStyle =
            cell === "2"
              ? "#456078"
              : edge
                ? "#5c3891"
                : (x * 7 + y * 11) % 13 < 3
                  ? "#302044"
                  : "#231831";
          ground.fillRect(x * CELL, y * CELL, CELL, CELL);
          if (edge && cell !== "2") {
            ground.fillStyle = (x + y) % 9 === 0 ? "#8de66b" : "#9663bf";
            ground.fillRect(x * CELL, y * CELL, CELL, 1);
          }
        }
      }
      oldRows = world.terrain.slice();
      ctx.drawImage(terrain, 0, 0);
      for (const shot of world.projectiles) {
        ctx.fillStyle =
          shot.weapon === 1
            ? "#b6ff4d"
            : shot.weapon === 2
              ? "#ffffff"
              : "#ffb34d";
        ctx.fillRect(
          Math.round(shot.x) - 2,
          Math.round(shot.y) - 2,
          shot.weapon === 2 ? 2 : 5,
          3,
        );
        ctx.fillStyle = "#ff4e7055";
        ctx.fillRect(
          Math.round(shot.x - shot.vx),
          Math.round(shot.y - shot.vy),
          3,
          2,
        );
      }
      for (const effect of world.effects) {
        ctx.strokeStyle = effect.kind === "spawn" ? "#16e7ff" : "#ffe46b";
        ctx.lineWidth = effect.kind === "blast" ? 3 : 1;
        ctx.beginPath();
        ctx.arc(effect.x, effect.y, Math.max(1, effect.radius), 0, Math.PI * 2);
        ctx.stroke();
      }
      for (const worm of world.worms) {
        if (worm.health <= 0) continue;
        const x = Math.round(worm.x),
          y = Math.round(worm.y),
          color = COLORS[worm.slot % COLORS.length]!;
        if (worm.rope) {
          ctx.strokeStyle = "#b6d6f0";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(worm.rope.x, worm.rope.y);
          ctx.stroke();
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(worm.rope.x - 2, worm.rope.y - 2, 4, 4);
        }
        ctx.fillStyle = "#02040a";
        ctx.fillRect(x - 7, y - 6, 14, 14);
        ctx.fillStyle = color;
        ctx.fillRect(x - 5, y - 5, 10, 10);
        ctx.fillRect(x - 7, y + 3, 12, 3);
        ctx.fillStyle = "#f5fff5";
        const dir = direction(worm.aim);
        ctx.fillRect(x + (dir.x >= 0 ? 1 : -4), y - 3, 4, 3);
        ctx.fillStyle = "#111620";
        ctx.fillRect(x + (dir.x >= 0 ? 3 : -4), y - 3, 1, 2);
        ctx.strokeStyle = "#dee8f7";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + dir.x * 12, y + dir.y * 12);
        ctx.stroke();
        if (worm.id === self) {
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          const ax = x + dir.x * 28,
            ay = y + dir.y * 28;
          ctx.beginPath();
          ctx.moveTo(ax - 3, ay);
          ctx.lineTo(ax + 3, ay);
          ctx.moveTo(ax, ay - 3);
          ctx.lineTo(ax, ay + 3);
          ctx.stroke();
        }
        ctx.font = "bold 9px monospace";
        ctx.textAlign = "center";
        const label = names.get(worm.id) ?? "Worm";
        const labelY = Math.max(13, y - 15);
        ctx.fillStyle = "#080917";
        ctx.fillRect(
          x - ctx.measureText(label).width / 2 - 3,
          labelY - 9,
          ctx.measureText(label).width + 6,
          11,
        );
        ctx.fillStyle = color;
        ctx.fillText(label, x, labelY);
        ctx.fillStyle = "#111620";
        ctx.fillRect(x - 10, y - 12, 20, 2);
        ctx.fillStyle = color;
        ctx.fillRect(x - 10, y - 12, worm.health / 5, 2);
      }
    },
  };
}
