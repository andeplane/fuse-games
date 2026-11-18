import { loadCyberArt } from "../art/sprites.js";
import {
  DOGFIGHTS,
  KEY_SPRITES,
  PROP_DEFS,
  getMission,
  getCampaignForMission,
} from "../campaign/index.js";
import type { MissionState } from "../sim/index.js";
import { visibleTile } from "../sim/space.js";
import { TILE_H, TILE_W, followedActors, frameCamera } from "./camera.js";
import {
  drawDeck,
  drawDeckLight,
  drawHelmetLight,
  drawStructure,
  lightPool,
  type Art,
} from "./deck.js";
import { drawOperator, drawPickup, drawShot } from "./subjects.js";
import { Materials } from "./materials.js";

interface Drawable {
  x: number;
  y: number;
  paint(): void;
}

function paintWorld(
  ctx: CanvasRenderingContext2D,
  art: Art,
  materials: Materials,
  width: number,
  height: number,
  world: MissionState,
  me?: string,
): void {
  const party = followedActors(world, me);
  const camera = frameCamera(world, party, width, height);
  const zoom = camera.zoom;
  const x0 = Math.max(0, Math.floor(camera.left / TILE_W) - 1);
  const y0 = Math.max(0, Math.floor(camera.top / TILE_H) - 1);
  const x1 = Math.min(
    world.width,
    Math.ceil((camera.left + camera.width) / TILE_W) + 1,
  );
  const y1 = Math.min(
    world.height,
    Math.ceil((camera.top + camera.height) / TILE_H) + 3,
  );
  const cols = x1 - x0;
  const visible = new Uint8Array(cols * (y1 - y0));
  const campaign = world.campaign < 0 ? undefined : world.campaign;
  const spec =
    world.mode === "dogfight"
      ? DOGFIGHTS[world.mission % DOGFIGHTS.length]!
      : getMission(world.mission, campaign);
  const characters =
    world.mode === "campaign"
      ? getCampaignForMission(world.mission, campaign).characters
      : [];
  const rowObjects = Array.from({ length: y1 - y0 }, (): Drawable[] => []);
  const ground = new Path2D();
  ctx.save();
  ctx.scale(zoom, zoom);
  ctx.translate(-camera.left, -camera.top);
  ctx.imageSmoothingEnabled = true;
  for (let row = y0; row < y1; row++) {
    for (let col = x0; col < x1; col++) {
      const sight = party.some((eye) => visibleTile(world, eye, col, row));
      if (!sight || world.decor[row]?.[col] === " ") continue;
      visible[(row - y0) * cols + col - x0] = 1;
      drawDeck(ctx, art, materials, world, spec, col, row);
      if (world.tiles[row]?.[col] !== "#")
        ground.rect(col * TILE_W, row * TILE_H, TILE_W, TILE_H);
    }
  }
  ctx.save();
  ctx.clip(ground);
  for (let row = y0; row < y1; row++)
    for (let col = x0; col < x1; col++)
      if (visible[(row - y0) * cols + col - x0])
        drawDeckLight(ctx, world, spec.altRange, col, row);
  for (const eye of party)
    if (eye.hp > 0) drawHelmetLight(ctx, eye.x, eye.y - 1.5, eye.dir);
  ctx.restore();
  const add = (x: number, y: number, paint: () => void) => {
    const col = Math.floor(x / TILE_W);
    const row = Math.floor(y / TILE_H);
    if (
      col < x0 ||
      col >= x1 ||
      row < y0 ||
      row >= y1 ||
      !visible[(row - y0) * cols + col - x0]
    )
      return;
    rowObjects[row - y0]!.push({ x, y, paint });
  };
  const seats = world.actors
    .filter((actor) => actor.seat !== null)
    .map((actor) => actor.id);
  for (const prop of world.props) {
    const def = PROP_DEFS[prop.objectIndex];
    const frame = prop.hp > 0 || def?.hp === 0 ? def?.sprite : def?.wreck;
    if (frame)
      add(prop.x, prop.y, () =>
        art.drawSprite(ctx, frame.id, prop.x + frame.dx, prop.y + frame.dy),
      );
  }
  for (const key of world.keys) {
    const colors = { yellow: 0, green: 1, blue: 2, red: 3 };
    const frame =
      KEY_SPRITES[Math.abs(spec.keyStyle) % KEY_SPRITES.length]?.[
        colors[key.color]
      ];
    if (!frame) continue;
    add(key.x, key.y, () => {
      lightPool(ctx, key.x, key.y, 6, 3.5, "rgba(248,214,136,.24)");
      art.drawSprite(ctx, frame.id, key.x + frame.dx, key.y + frame.dy);
    });
  }
  for (const item of world.items)
    add(item.x, item.y, () => drawPickup(ctx, art, item, world));
  for (const actor of world.actors)
    add(actor.x, actor.y, () =>
      drawOperator(
        ctx,
        art,
        actor,
        world.tick,
        seats.indexOf(actor.id),
        characters[actor.characterIndex],
        me,
      ),
    );
  for (const shot of world.shots)
    add(shot.x, shot.y, () => drawShot(ctx, art, shot));
  for (let row = y0; row < y1; row++) {
    for (let col = x0; col < x1; col++) {
      if (visible[(row - y0) * cols + col - x0])
        drawStructure(ctx, art, materials, world, spec, col, row);
    }
    // Sorting at the floor contact point keeps nearer actors and equipment in front.
    rowObjects[row - y0]!.sort((a, b) => a.y - b.y || a.x - b.x).forEach(
      (item) => item.paint(),
    );
  }
  ctx.restore();
}

/** The renderer reads the most recent simulation view. Resize and atlas completion may redraw that view. */
export function createScene(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d", { alpha: false })!;
  const doc = canvas.ownerDocument;
  const window = doc.defaultView!;
  const materials = new Materials(doc);
  let art: Art | undefined;
  let latest: MissionState | undefined;
  let previous: MissionState | undefined;
  let changedAt = 0;
  let blendMs = 0;
  let requested = 0;
  let onscreen = true;
  let local: string | undefined;
  let loading = false;
  let stopped = false;

  function schedule(): void {
    if (!stopped && !requested && onscreen && !doc.hidden)
      requested = window.requestAnimationFrame(paint);
  }

  function paint(now: number): void {
    requested = 0;
    if (stopped || !onscreen || doc.hidden) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width < 1 || height < 1) return;
    const ratio = Math.max(
      1,
      Math.min(
        window.devicePixelRatio,
        3,
        Math.sqrt(8300000 / (width * height)),
      ),
    );
    const w = Math.max(1, Math.round(width * ratio));
    const h = Math.max(1, Math.round(height * ratio));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    ctx.setTransform(w / width, 0, 0, h / height, 0, 0);
    ctx.fillStyle = "#0b141d";
    ctx.fillRect(0, 0, width, height);
    if (art && latest) {
      let view = latest;
      const t = blendMs > 0 ? Math.max(0, (now - changedAt) / blendMs) : 1;
      if (previous && t < 1) {
        const source = new Map(
          previous.actors.map((actor) => [actor.id, actor]),
        );
        view = {
          ...latest,
          actors: latest.actors.map((actor) => {
            const old = source.get(actor.id);
            if (
              !old ||
              old.hp <= 0 ||
              actor.hp <= 0 ||
              Math.hypot(actor.x - old.x, actor.y - old.y) > 24
            )
              return actor;
            return {
              ...actor,
              x: old.x + (actor.x - old.x) * t,
              y: old.y + (actor.y - old.y) * t,
            };
          }),
        };
        schedule();
      }
      paintWorld(ctx, art, materials, width, height, view, local);
    } else {
      ctx.fillStyle = "#b3d3d3";
      ctx.font = "13px monospace";
      ctx.textAlign = "center";
      ctx.fillText(
        loading
          ? "Loading mission art…"
          : "Mission art unavailable · tap to retry",
        width / 2,
        height / 2,
      );
    }
  }

  function load(): void {
    if (loading || art || stopped) return;
    loading = true;
    void loadCyberArt()
      .then((loaded) => {
        if (!stopped) art = loaded;
      })
      .catch(() => {
        // The original world remains authoritative while the player retries the atlas.
      })
      .finally(() => {
        loading = false;
        schedule();
      });
  }
  canvas.addEventListener("click", load);
  const observer = new ResizeObserver(schedule);
  observer.observe(canvas);
  const visibility = new IntersectionObserver(([entry]) => {
    onscreen = entry?.isIntersecting ?? false;
    if (onscreen) schedule();
  });
  visibility.observe(canvas);
  doc.addEventListener("visibilitychange", schedule);
  load();
  return {
    draw(world: MissionState, me?: string) {
      if (latest !== world) {
        const elapsed = latest ? world.tick - latest.tick : 0;
        const continuous =
          latest &&
          world.seed === latest.seed &&
          world.mission === latest.mission &&
          world.mode === latest.mode &&
          world.campaign === latest.campaign &&
          elapsed > 0 &&
          elapsed <= 8;
        previous = continuous ? latest : undefined;
        blendMs = previous ? Math.min(38, (elapsed * 1000) / 70) : 0;
        changedAt = window.performance.now();
      }
      latest = world;
      local = me;
      schedule();
    },
    dispose() {
      stopped = true;
      latest = undefined;
      previous = undefined;
      window.cancelAnimationFrame(requested);
      observer.disconnect();
      visibility.disconnect();
      doc.removeEventListener("visibilitychange", schedule);
      canvas.removeEventListener("click", load);
    },
  };
}
