import type { Enemy, World } from "../game/simulation.js";
import {
  COLUMNS,
  FLOOR_ROW,
  TILE_HEIGHT,
  TILE_WIDTH,
  getLevel,
} from "../levels/index.js";
import { atlasUrl, backgroundUrl, spriteFrame } from "./atlas.js";

// Walk right, walk left, stunned, kicked. Each range is eight painted poses.
const pestFrames: Readonly<
  Record<number, readonly [number, number, number, number]>
> = {
  7: [750, 758, 780, 770],
  15: [1100, 1108, 1130, 1120],
  19: [1140, 1148, 1170, 1160],
  23: [1205, 1213, 1229, 1221],
  27: [1250, 1258, 1274, 1266],
  52: [4000, 4010, 4030, 4020],
  56: [4040, 4050, 4070, 4060],
};

const specialTiles: Readonly<Record<number, number>> = {
  4: 2900,
  5: 2901,
  6: 2902,
  7: 2903,
  8: 2904,
  9: 2905,
  24: 2906,
  25: 2814,
  26: 2815,
};

/** The one presentation clock is the current authoritative/predicted world tick. */
export function createArena(canvas: HTMLCanvasElement): {
  draw(world: World): void;
} {
  canvas.width = 640;
  canvas.height = 480;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Fuseheads requires a 2D canvas");
  const ctx = context;
  ctx.imageSmoothingEnabled = false;
  const images = new Map<string, HTMLImageElement>();
  let current: World | undefined;

  function load(url: string) {
    const cached = images.get(url);
    if (cached) return cached;
    const image = canvas.ownerDocument.createElement("img");
    images.set(url, image);
    image.onload = () => {
      if (current) draw(current);
    };
    image.onerror = () => {
      canvas.dataset.ready = "error";
    };
    image.src = url;
    return image;
  }

  const atlas = load(atlasUrl);
  const panels = load(new URL("./panels.png", import.meta.url).href);

  function sprite(id: number, x: number, y: number, feet = false) {
    const rect = spriteFrame(id);
    if (!rect) return;
    const { x: sx, y: sy, width, height } = rect;
    ctx.drawImage(
      atlas,
      sx,
      sy,
      width,
      height,
      Math.round(feet ? x - width / 2 : x),
      Math.round(feet ? y - height : y),
      width,
      height,
    );
  }

  function numberPanel(
    value: number,
    size: 16 | 32,
    right: number,
    y: number,
    places: number,
  ) {
    const digits = String(value).slice(-places);
    const left = right - digits.length * size;
    for (let i = 0; i < digits.length; i++) {
      ctx.drawImage(
        panels,
        Number(digits[i]) * size,
        size === 16 ? 32 : 0,
        size,
        size,
        left + i * size,
        y,
        size,
        size,
      );
    }
  }

  function boss(enemy: Enemy, id: number, pose: number) {
    if (id === 3500) {
      // Each tyrannosaur frame is three contiguous cuts of one 200 px wide drawing.
      const base = (enemy.facing === -1 ? 3500 : 3550) + 3 * pose;
      let left = Math.round(enemy.x - 100);
      for (let i = 0; i < 3; i++) {
        const part = spriteFrame(base + i)!;
        sprite(base + i, left, enemy.y - 56);
        left += part.width;
      }
    } else {
      const facing = enemy.facing === -1 && id === 3000 ? 8 : 0;
      sprite(id + facing + pose, enemy.x, enemy.y, true);
    }
  }

  function draw(world: World) {
    current = world;
    const level = getLevel(world.levelIndex + 1, world.pack);
    const background = load(backgroundUrl(level.backgroundId - 900));
    if (
      ![atlas, panels, background].every(
        (image) => image.complete && image.naturalWidth > 0,
      )
    ) {
      if (canvas.dataset.ready !== "error") canvas.dataset.ready = "false";
      return;
    }
    ctx.drawImage(background, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, FLOOR_ROW * TILE_HEIGHT);
    ctx.clip();
    for (let cell = 0; cell < FLOOR_ROW * COLUMNS; cell++) {
      const tile = level.tiles[cell]!;
      if (
        tile === 0 ||
        tile === 1 ||
        tile === 51 ||
        tile === 10 ||
        world.broken.includes(cell)
      )
        continue;
      const column = cell % COLUMNS,
        row = Math.floor(cell / COLUMNS);
      const bump = world.bumps.find(
        (b) =>
          b.row === row &&
          (b.column === column || (tile === 50 && b.column === column + 1)),
      );
      const lift = bump
        ? Math.round(Math.sin(((bump.until - world.tick) * Math.PI) / 8) * 6)
        : 0;
      const x = column * TILE_WIDTH,
        y = row * TILE_HEIGHT - lift;
      if (tile === 50) {
        if (world.tnt > 0)
          ctx.drawImage(panels, (3 - world.tnt) * 64, 48, 64, 32, x, y, 64, 32);
      } else {
        // The editor marks gem-bearing tiles. In play their contents stay hidden until a bonk.
        sprite(specialTiles[tile] ?? level.platformId, x, y);
      }
    }
    const phase = Math.floor(world.tick / 4) % 8;
    for (const gem of world.pickups) {
      const kind = gem.type >= 17 && gem.type <= 22 ? gem.type - 6 : gem.type;
      const id = kind >= 11 && kind <= 16 ? 700 + kind - 11 : 1000 + phase;
      sprite(id, (gem.column + 0.5) * TILE_WIDTH, gem.row * TILE_HEIGHT, true);
    }
    for (const enemy of world.enemies) {
      const frames = pestFrames[enemy.type];
      const pose = (phase + Math.max(0, enemy.id)) % 8;
      if (frames) {
        const base = enemy.kicked
          ? frames[3]
          : enemy.stun
            ? frames[2]
            : frames[enemy.facing > 0 ? 0 : 1];
        sprite(base + pose, enemy.x, enemy.y, true);
      } else if (level.boss && enemy.id === -1) {
        boss(enemy, enemy.type, pose);
      }
    }
    for (const player of world.players) {
      if (
        player.lives <= 0 ||
        (player.invincible && Math.floor(world.tick / 3) % 2)
      )
        continue;
      if (player.respawn === "climbing") {
        sprite(
          (player.slot === 0 ? 4500 : 4510) + phase,
          player.x,
          player.y,
          true,
        );
        continue;
      }
      const base =
        (player.slot === 0 ? 800 : 900) + (player.facing === -1 ? 20 : 0);
      const pose = !player.grounded ? 3 : player.vx !== 0 ? phase : 0;
      sprite(base + pose, player.x, player.y, true);
    }
    ctx.restore();
    for (const player of world.players) {
      const left = player.slot === 0;
      numberPanel(player.score, 16, left ? 240 : 512, 432, 7);
      numberPanel(player.lives, 16, left ? 160 : 512, 450, 2);
    }
    numberPanel(world.levelIndex + 1, 32, 368, 432, 3);
    canvas.dataset.ready = "true";
  }
  return { draw };
}
