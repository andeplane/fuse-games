import {
  simulationTileAt,
  type Enemy,
  type World,
} from "../game/simulation.js";
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
  66: [6000, 6008, 6000, 6016],
  74: [6025, 6033, 6025, 6041],
};

const specialTiles: Readonly<Record<number, number>> = {
  2: 2900,
  4: 2901,
  5: 2902,
  6: 2903,
  7: 2904,
  8: 2905,
  9: 2906,
  24: 2814,
  25: 2815,
  26: 2816,
};
const BOARD_WIDTH = 640;
const BOARD_HEIGHT = 480;
const PLAY_HEIGHT = FLOOR_ROW * TILE_HEIGHT;

/** The one presentation clock is the current authoritative/predicted world tick. */
export function createArena(canvas: HTMLCanvasElement): {
  draw(world: World, fullScreen?: boolean): void;
} {
  canvas.width = BOARD_WIDTH;
  canvas.height = BOARD_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Fuseheads requires a 2D canvas");
  const ctx = context;
  ctx.imageSmoothingEnabled = false;
  const images = new Map<string, HTMLImageElement>();
  let current: World | undefined;
  let fullScreen = false;
  let scenerySource: HTMLImageElement | undefined;
  let scenery: CanvasPattern | null = null;

  function load(url: string) {
    const cached = images.get(url);
    if (cached) return cached;
    const image = canvas.ownerDocument.createElement("img");
    images.set(url, image);
    image.onload = () => {
      if (current) draw(current, fullScreen);
    };
    image.onerror = () => {
      canvas.dataset.ready = "error";
    };
    image.src = url;
    return image;
  }

  const atlas = load(atlasUrl);
  const panels = load(new URL("./panels.png", import.meta.url).href);

  function mirroredScenery(background: HTMLImageElement) {
    if (scenerySource === background) return scenery;
    scenerySource = background;
    const tile = canvas.ownerDocument.createElement("canvas");
    tile.width = BOARD_WIDTH * 2;
    tile.height = PLAY_HEIGHT * 2;
    const paint = tile.getContext("2d")!;
    for (const x of [1, -1])
      for (const y of [1, -1]) {
        paint.setTransform(
          x,
          0,
          0,
          y,
          x === 1 ? 0 : tile.width,
          y === 1 ? 0 : tile.height,
        );
        paint.drawImage(
          background,
          0,
          0,
          BOARD_WIDTH,
          PLAY_HEIGHT,
          0,
          0,
          BOARD_WIDTH,
          PLAY_HEIGHT,
        );
      }
    scenery = ctx.createPattern(tile, "repeat");
    return scenery;
  }

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
      // SynchAnims applies a separate pair of offsets to the torso and tail for every head pose.
      const ys = [-3, -3, -3, -3, -4, 0, -4, 3, -4, -4, -3, -1, -3, 0, -4, 2];
      const leftOffsets = [
        67, 150, 75, 141, 78, 128, 73, 138, 66, 150, 76, 139, 78, 128, 73, 138,
      ];
      const rightOffsets = [
        -83, -133, -66, -125, -50, -122, -65, -127, -84, -134, -63, -124, -50,
        -122, -65, -127,
      ];
      const left = enemy.facing === -1;
      const head = (left ? 3500 : 3552) + 3 * pose,
        stride = left ? 1 : -1;
      const x = left ? enemy.x - 100 : enemy.x + 100 - spriteFrame(head)!.width;
      const y = enemy.y - 56,
        offsets = left ? leftOffsets : rightOffsets;
      sprite(head, x, y);
      sprite(head + stride, x + offsets[2 * pose]!, y + ys[2 * pose]!);
      sprite(
        head + 2 * stride,
        x + offsets[2 * pose + 1]!,
        y + ys[2 * pose + 1]!,
      );
    } else {
      const facing = enemy.facing === -1 && id === 3000 ? 8 : 0;
      sprite(id + facing + pose, enemy.x, enemy.y, true);
    }
  }

  function draw(world: World, expand = false) {
    current = world;
    fullScreen = expand;
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
    const ratio = Math.min(
      2,
      canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1,
    );
    const width = expand
      ? Math.max(1, Math.round(canvas.clientWidth * ratio))
      : BOARD_WIDTH;
    const height = expand
      ? Math.max(1, Math.round(canvas.clientHeight * ratio))
      : BOARD_HEIGHT;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    ctx.imageSmoothingEnabled = false;
    const scale = Math.min(width / BOARD_WIDTH, height / BOARD_HEIGHT);
    const x = (width - BOARD_WIDTH * scale) / 2;
    const y = (height - BOARD_HEIGHT * scale) / 2;
    ctx.setTransform(scale, 0, 0, scale, x, y);
    if (expand) {
      // Continue the artwork at the same scale across each edge. Only the central board has a HUD and actors.
      ctx.fillStyle = mirroredScenery(background) ?? "#171520";
      ctx.fillRect(-x / scale, -y / scale, width / scale, height / scale);
      ctx.fillStyle = "rgb(5 9 17 / 48%)";
      ctx.fillRect(-x / scale, -y / scale, width / scale, height / scale);
    }
    ctx.drawImage(background, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, BOARD_WIDTH, PLAY_HEIGHT);
    ctx.clip();
    for (let cell = 0; cell < FLOOR_ROW * COLUMNS; cell++) {
      const column = cell % COLUMNS,
        row = Math.floor(cell / COLUMNS);
      const tile = simulationTileAt(world, level, column, row);
      if (tile === 0 || tile === 1 || tile === 51 || tile === 10) continue;
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
        if (world.tnt > 0 && level.tiles[cell] === 50)
          ctx.drawImage(panels, (3 - world.tnt) * 64, 48, 64, 32, x, y, 64, 32);
      } else {
        // The editor marks gem-bearing tiles. In play their contents stay hidden until a bonk.
        sprite(specialTiles[tile] ?? level.platformId, x, y);
      }
    }
    const phase = Math.floor(world.tick / 4) % 8;
    const { bat, tire } = world.hazards;
    if (bat) sprite(2500 + (Math.floor(world.tick / 3) % 6), bat.x, bat.y);
    if (tire) sprite(128 + (Math.floor(world.tick / 2) % 12), tire.x, tire.y);
    for (const gem of world.pickups) {
      sprite(700 + gem.type - 11, (gem.column + 0.5) * TILE_WIDTH, gem.y, true);
    }
    for (const bomb of world.explosions) {
      const x = bomb.column * TILE_WIDTH,
        y = bomb.row * TILE_HEIGHT;
      if (bomb.age < 32) sprite(200 + Math.floor(bomb.age / 4), x, y);
      else sprite(208 + bomb.age - 32, x - 10, y - 18);
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
        const shake =
          enemy.stun > 0 &&
          enemy.stun <= 250 &&
          !enemy.kicked &&
          world.tick % 4 < 2
            ? 1
            : 0;
        sprite(base + pose, enemy.x + shake, enemy.y, true);
      } else if (level.boss && enemy.id === -1) {
        const state = enemy.ruler;
        if (state) {
          for (const shot of state.shots) {
            const spriteId =
              shot.kind === "fire"
                ? 970 + (phase % 4)
                : 950 + (phase % 4) + (shot.vx < 0 ? 4 : 0);
            sprite(spriteId, shot.x, shot.y, true);
          }
        }
        if (state?.flash) {
          const progress = state.flash > 9 ? 18 - state.flash : state.flash - 1;
          sprite(3120 + Math.min(7, progress), enemy.x, enemy.y, true);
        } else if (!state?.guard || world.tick % 4 < 2)
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
    for (const slot of [0, 1]) {
      const player = world.players.find((p) => p.slot === slot);
      const left = slot === 0;
      numberPanel(player?.score ?? 0, 16, left ? 240 : 512, 432, 7);
      numberPanel(
        Math.max(0, (player?.lives ?? 0) - 1),
        16,
        left ? 160 : 512,
        450,
        2,
      );
    }
    numberPanel(world.levelIndex + 1, 32, 368, 432, 3);
    canvas.dataset.ready = "true";
  }
  return { draw };
}
