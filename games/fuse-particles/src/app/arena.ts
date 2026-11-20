import {
  CORE_HP,
  CORE_RADIUS,
  DUEL_BASE_WIDTH,
  TICKS_PER_SECOND,
  type BattleState,
} from "../game/simulation.js";
import "./arena.css";

export const TEAM_COLORS = [
  "#68f0cd",
  "#ff8e73",
  "#91beff",
  "#dca9ff",
] as const;

const TILE = 32;
const MAP_BACKGROUND = "#101b19";
const SITE_INK = "#edc16a";

interface TeamReadout {
  row: HTMLElement;
  name: HTMLElement;
  health: HTMLElement;
  fill: HTMLElement;
  stats: HTMLElement;
  army: HTMLElement;
  economy: HTMLElement;
}

function canvasSurface(width: number, height: number, alpha = true) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha });
  if (!context) throw new Error("Fuseparticles requires a 2D canvas");
  return { canvas, context };
}

function strokeLine(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  endX: number,
  endY: number,
  color: string,
  width = 1,
): void {
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(endX, endY);
  context.strokeStyle = color;
  context.lineWidth = width;
  context.stroke();
}

function paintWall(
  context: CanvasRenderingContext2D,
  col: number,
  row: number,
): void {
  const x = col * TILE;
  const y = row * TILE;
  const tint = (col * 19 + row * 53) % 18;
  context.fillStyle = "#080e0ce8";
  context.fillRect(x + 3, y + 4, TILE, TILE);
  const face = context.createLinearGradient(x, y, x + TILE * 0.4, y + TILE);
  face.addColorStop(0, `rgb(${57 + tint}, ${69 + tint}, ${61 + tint})`);
  face.addColorStop(1, `rgb(${37 + tint}, ${48 + tint}, ${42 + tint})`);
  context.fillStyle = face;
  context.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
  strokeLine(context, x + 1, y + 1, x + TILE - 2, y + 1, "#889385a8", 1.7);
  strokeLine(context, x + 2, y + 2, x + 2, y + TILE - 2, "#75857570");
  for (let fleck = 0; fleck < 13; fleck += 1) {
    const u = (7 * fleck + 3 * col + 5 * row) % 27;
    const v = (17 * fleck + 13 * col + 7 * row) % 27;
    context.fillStyle = fleck % 3 ? "#e9f1dc0c" : "#0b151322";
    context.fillRect(x + 3 + u, y + 3 + v, 2, 1);
  }
}

function paintSite(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
): void {
  context.save();
  context.translate(x, y);
  context.rotate(Math.PI / 4);
  context.fillStyle = "#322c1d";
  context.fillRect(-10, -10, 20, 20);
  context.strokeStyle = SITE_INK;
  context.lineWidth = 2;
  context.strokeRect(-9, -9, 18, 18);
  context.fillStyle = "#ffd47b";
  context.fillRect(-2, -2, 4, 4);
  context.restore();
}

function paintBaseLane(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  side: number,
  color: string,
): void {
  const laneWidth = DUEL_BASE_WIDTH * TILE;
  const start = side === 0 ? 0 : width - laneWidth;
  const edge = side === 0 ? laneWidth : start;
  context.fillStyle = `${color}0a`;
  context.fillRect(start, 0, laneWidth, height);
  strokeLine(context, edge, 0, edge, height, `${color}66`, 2);
  for (let y = 0; y < height; y += TILE) {
    strokeLine(
      context,
      edge,
      y,
      edge + (side === 0 ? -7 : 7),
      y,
      `${color}99`,
      2,
    );
  }
}

function paintBaseZone(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
): void {
  context.beginPath();
  context.arc(x, y, CORE_RADIUS * TILE, 0, Math.PI * 2);
  context.fillStyle = `${color}0a`;
  context.fill();
  context.strokeStyle = `${color}66`;
  context.lineWidth = 2;
  context.stroke();
}

function paintTerrain(battle: BattleState, pixels: number): HTMLCanvasElement {
  const width = battle.cols * TILE;
  const height = battle.rows * TILE;
  const pixelHeight = Math.max(1, Math.round((pixels * height) / width));
  const { canvas, context } = canvasSurface(pixels, pixelHeight, false);
  context.setTransform(pixels / width, 0, 0, pixelHeight / height, 0, 0);
  const base = context.createLinearGradient(0, 0, width, height);
  base.addColorStop(0, "#142520");
  base.addColorStop(0.45, MAP_BACKGROUND);
  base.addColorStop(1, "#211e1a");
  context.fillStyle = base;
  context.fillRect(0, 0, width, height);
  for (let row = 0; row < battle.rows; row += 1) {
    for (let col = 0; col < battle.cols; col += 1) {
      const variation = ((col * 349 + row * 89 + col * row * 17) % 19) / 19;
      context.fillStyle = `rgba(181, 205, 172, ${0.024 * variation})`;
      context.fillRect(col * TILE + 1, row * TILE + 1, TILE - 2, TILE - 2);
      context.fillStyle = "#324038";
      context.fillRect(col * TILE, row * TILE, 1.6, 1.6);
    }
  }
  battle.cores.forEach((core, owner) => {
    const color = TEAM_COLORS[owner];
    if (!color) return;
    if (battle.cores.length === 2)
      paintBaseLane(context, width, height, owner, color);
    else paintBaseZone(context, core.x * TILE, core.y * TILE, color);
  });
  battle.walls.forEach((wall, index) => {
    if (wall)
      paintWall(context, index % battle.cols, Math.floor(index / battle.cols));
  });
  battle.sites.forEach(({ x, y }) => paintSite(context, x * TILE, y * TILE));
  return canvas;
}

function paintMote(color: string): HTMLCanvasElement {
  const { canvas, context } = canvasSurface(40, 40);
  const glow = context.createRadialGradient(20, 20, 0, 20, 20, 20);
  glow.addColorStop(0, "#f3fff0");
  glow.addColorStop(0.17, color);
  glow.addColorStop(0.29, `${color}99`);
  glow.addColorStop(0.54, `${color}27`);
  glow.addColorStop(1, `${color}00`);
  context.fillStyle = glow;
  context.fillRect(0, 0, 40, 40);
  return canvas;
}

function paintTeamMark(context: CanvasRenderingContext2D, owner: number): void {
  context.beginPath();
  switch (owner) {
    case 0:
      context.arc(0, 0, 4.5, 0, Math.PI * 2);
      break;
    case 1:
      context.rect(-4, -4, 8, 8);
      break;
    case 2:
      context.moveTo(0, -5);
      context.lineTo(5, 4);
      context.lineTo(-5, 4);
      break;
    case 3:
      context.moveTo(0, -5.5);
      context.lineTo(5.5, 0);
      context.lineTo(0, 5.5);
      context.lineTo(-5.5, 0);
      break;
  }
  context.closePath();
  context.fill();
}

function paintCore(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  owner: number,
  color: string,
  alive: boolean,
): void {
  context.save();
  context.translate(x, y);
  context.rotate(angle);
  context.globalAlpha = alive ? 1 : 0.3;
  context.fillStyle = "#0d1917";
  context.strokeStyle = color;
  context.lineWidth = 2.5;
  context.beginPath();
  context.moveTo(-14, -12);
  context.lineTo(5, -12);
  context.lineTo(17, 0);
  context.lineTo(5, 12);
  context.lineTo(-14, 12);
  context.closePath();
  context.fill();
  context.stroke();
  context.rotate(-angle);
  context.fillStyle = color;
  paintTeamMark(context, owner);
  context.restore();
}

function paintTowers(
  context: CanvasRenderingContext2D,
  battle: BattleState,
): void {
  for (const tower of battle.towers) {
    const site = battle.sites[tower.site];
    const color = TEAM_COLORS[tower.owner];
    if (!site || !color) continue;
    const x = site.x * TILE;
    const y = site.y * TILE;
    context.fillStyle = "#0d1917";
    context.fillRect(x - 10, y - 10, 20, 20);
    context.strokeStyle = color;
    context.lineWidth = 2.5;
    context.strokeRect(x - 9, y - 9, 18, 18);
    if (tower.kind === "laser") {
      strokeLine(context, x - 4, y + 4, x + 4, y - 4, color, 2);
    } else {
      context.fillStyle = color;
      context.fillRect(x - 4, y - 1, 8, 2);
    }
  }
}

function paintParticles(
  context: CanvasRenderingContext2D,
  particles: BattleState["particles"],
  motes: readonly HTMLCanvasElement[],
  counts: number[],
): void {
  for (const particle of particles) {
    const { x, y, vx, vy, owner, radius } = particle;
    const color = TEAM_COLORS[owner];
    const mote = motes[owner];
    if (!color || !mote) continue;
    counts[owner] = (counts[owner] ?? 0) + 1;
    const px = x * TILE;
    const py = y * TILE;
    const speed = Math.hypot(vx, vy);
    if (speed > 0) {
      const tailScale = Math.min(TILE * 0.013, 14 / speed);
      strokeLine(
        context,
        px - vx * tailScale,
        py - vy * tailScale,
        px,
        py,
        `${color}a8`,
        Math.max(1, radius * TILE * 0.65),
      );
    }
    const size = Math.max(15, Math.min(35, radius * TILE * 5));
    context.drawImage(mote, px - size / 2, py - size / 2, size, size);
  }
}

function div(className: string): HTMLDivElement {
  const node = document.createElement("div");
  node.className = className;
  return node;
}

function readout(color: string, owner: number): TeamReadout {
  const row = div("fp-arena__team");
  row.style.setProperty("--fp-team-color", color);
  row.dataset.team = String(owner);
  const name = document.createElement("strong");
  const health = document.createElement("span");
  health.className = "fp-arena__hp";
  const mark = document.createElement("span");
  mark.className = "fp-arena__mark";
  mark.setAttribute("aria-hidden", "true");
  const bar = div("fp-arena__health");
  bar.setAttribute("aria-hidden", "true");
  const fill = document.createElement("span");
  bar.append(fill);
  const stats = document.createElement("div");
  const army = document.createElement("span");
  const economy = document.createElement("span");
  stats.append(army, economy);
  row.append(mark, name, health, bar);
  return { row, name, health, fill, stats, army, economy };
}

function setText(element: HTMLElement, value: string): void {
  if (element.textContent !== value) element.textContent = value;
}

export function createArena() {
  const element = div("fp-arena");
  const hud = div("fp-arena__hud");
  const clock = document.createElement("time");
  const stats = div("fp-arena__stats");
  hud.hidden = stats.hidden = true;
  const { canvas, context } = canvasSurface(2, 1, false);
  canvas.className = "fp-arena__field";
  canvas.setAttribute("aria-label", "Particle battlefield");
  hud.append(clock);
  const teams = TEAM_COLORS.map((color, owner) => readout(color, owner));
  for (const { row, stats: summary } of teams) {
    hud.append(row);
    stats.append(summary);
  }
  element.append(hud, canvas, stats);

  const motes = TEAM_COLORS.map(paintMote);
  let terrain: HTMLCanvasElement | undefined;
  let terrainKey = "";
  let hudSecond = -1;

  function render(battle: BattleState, names: readonly string[]): void {
    const width = battle.cols * TILE;
    const height = battle.rows * TILE;
    const ratio = `${battle.cols} / ${battle.rows}`;
    const shape = battle.cols === battle.rows ? "square" : "wide";
    if (canvas.style.aspectRatio !== ratio) canvas.style.aspectRatio = ratio;
    if (element.dataset.shape !== shape) element.dataset.shape = shape;
    const dpr = Math.min(2, globalThis.devicePixelRatio ?? 1);
    const pixels = Math.max(
      2,
      Math.round((canvas.clientWidth || width / 4) * dpr),
    );
    const pixelHeight = Math.max(1, Math.round((pixels * height) / width));
    const terrainPixels = Math.min(width, pixels);
    const corePositions = battle.cores.map(({ x, y }) => `${x},${y}`);
    const sitePositions = battle.sites.map(({ x, y }) => `${x},${y}`);
    const key = `${ratio}:${terrainPixels}:${corePositions.join(";")}:${sitePositions.join(";")}:${battle.walls.map(Number).join("")}`;
    if (!terrain || terrainKey !== key) {
      terrain = paintTerrain(battle, terrainPixels);
      terrainKey = key;
    }
    if (canvas.width !== pixels || canvas.height !== pixelHeight) {
      canvas.width = pixels;
      canvas.height = pixelHeight;
    }
    context.setTransform(pixels / width, 0, 0, pixelHeight / height, 0, 0);
    context.drawImage(terrain, 0, 0, width, height);

    const teamCount = names.length === 0 ? 0 : battle.cores.length;
    hud.hidden = stats.hidden = teamCount === 0;
    element.dataset.teams = String(teamCount);
    const counts = Array<number>(teamCount).fill(0);
    if (teamCount) {
      battle.ownership.forEach((owner, index) => {
        const color = TEAM_COLORS[owner];
        if (!color || battle.walls[index]) return;
        context.fillStyle = `${color}21`;
        context.fillRect(
          (index % battle.cols) * TILE,
          Math.floor(index / battle.cols) * TILE,
          TILE,
          TILE,
        );
      });
      paintParticles(context, battle.particles, motes, counts);
      paintTowers(context, battle);
    }
    battle.cores.forEach((core, owner) => {
      const color = TEAM_COLORS[owner];
      if (!color) return;
      const x = core.x * TILE;
      const y = core.y * TILE;
      const angle = Math.atan2(height / 2 - y, width / 2 - x);
      paintCore(context, x, y, angle, owner, color, core.hp > 0);
    });
    if (!teamCount) return;

    element.style.setProperty("--fp-team-count", String(teamCount));
    const seconds = Math.floor(battle.tick / TICKS_PER_SECOND);
    if (seconds !== hudSecond) {
      hudSecond = seconds;
      clock.dateTime = `PT${seconds}S`;
      clock.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    }
    teams.forEach((team, index) => {
      const core = battle.cores[index];
      team.row.hidden = team.stats.hidden = !core;
      if (!core) return;
      setText(team.name, names[index] ?? `Team ${index + 1}`);
      setText(team.health, `${Math.max(0, Math.ceil(core.hp))} HP`);
      team.fill.style.width = `${Math.max(0, Math.min(1, core.hp / CORE_HP)) * 100}%`;
      setText(team.army, `${counts[index] ?? 0} particles`);
      setText(
        team.economy,
        `${Math.floor(core.gold)} gold · ${core.kills} kills`,
      );
    });
  }

  return { element, canvas, render };
}
