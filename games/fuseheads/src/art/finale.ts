import {
  COLUMNS,
  FLOOR_ROW,
  TILE_HEIGHT,
  TILE_WIDTH,
  getFinale,
} from "../levels/index.js";
import { atlasUrl, backgroundUrl, spriteFrame } from "./atlas.js";

// The finale uses STR# 1000 entries 5–23 for its cast, then STR# 15000.
const castNames = [
  "Bull Dog",
  "Raccoon",
  "Killer Bee",
  "Spider",
  "King Cobra",
  "Baby Raptor",
  "Demon",
  "Mystery Gem",
  "Shrew Man-Chew",
  "T. Wrecks",
  "D. Evil",
  "Bat Tee",
  "Tranquilium",
  "Adrenalide",
  "Densidian",
  "Moolamite",
  "Resurrectite",
  "Blastidian",
  "Grag & Thog Bonkheads",
];
const ending = [
  "Congratulations!",
  "You’ve defeated all the beasts",
  "and Rulers and singlehandedly",
  "saved the underworlds.",
  "Trollsville thanks you!",
];

/** MoveEnemies, BringInPlayers and DropTire, CODE 2 in the Deluxe Mac application.
 * The recording stores successive painted poses from the original 68k routines.
 * Each 9-byte record holds little-endian tick:u16, actor:u8, x:i16, y:i16,
 * sprite:u16. Actor 255 changes the caption. Ticks are sixtieths of a second.
 * Only pose and title changes are stored; an actor stays in place when its walk ends.
 */
const posesUrl = new URL("./finale-poses.bin", import.meta.url).href;
const LAST_TICK = 4520 + 100;

export function createFinale(host: HTMLElement): () => void {
  const doc = host.ownerDocument,
    win = doc.defaultView;
  if (!win) return () => {};
  const section = doc.createElement("section");
  section.setAttribute("aria-label", "Grand Finale");
  const canvas = doc.createElement("canvas");
  canvas.width = 640;
  canvas.height = 480;
  canvas.style.cssText =
    "display:block;width:min(100%,640px);height:auto;margin-inline:auto;image-rendering:pixelated";
  canvas.setAttribute("role", "img");
  canvas.setAttribute(
    "aria-label",
    "The cast of Bonkheads Deluxe returns to Trollsville",
  );
  const skip = doc.createElement("button");
  skip.type = "button";
  skip.textContent = "Skip finale";
  section.append(canvas, skip);
  host.prepend(section);
  const ctx = canvas.getContext("2d");
  const abort = new AbortController();
  let frame = 0,
    closed = false;

  function close() {
    if (closed) return;
    closed = true;
    abort.abort();
    win!.cancelAnimationFrame(frame);
    win!.removeEventListener("keydown", key, true);
    section.remove();
  }
  function key(event: KeyboardEvent) {
    if (event.key === "Escape" && !event.repeat) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }
  skip.addEventListener("click", close, { signal: abort.signal });
  win.addEventListener("keydown", key, true);
  if (!ctx) {
    close();
    return close;
  }

  function image(url: string): Promise<HTMLImageElement> {
    const element = doc.createElement("img");
    element.src = url;
    return element.decode().then(() => element);
  }
  const level = getFinale();
  const sheet = image(atlasUrl);
  const background = image(backgroundUrl(level.backgroundId - 900));
  const panels = image(new URL("./panels.png", import.meta.url).href);
  const poses = win
    .fetch(posesUrl, { signal: abort.signal })
    .then(async (response) => {
      if (!response.ok) throw new Error("Finale poses unavailable");
      return new DataView(await response.arrayBuffer());
    });
  void Promise.all([sheet, background, panels, poses])
    .then(([atlas, back, crate, track]) => {
      if (closed) return;
      if (!track.byteLength || track.byteLength % 9 !== 0) {
        close();
        return;
      }
      ctx.imageSmoothingEnabled = false;
      const scene = doc.createElement("canvas");
      scene.width = 640;
      scene.height = 480;
      const scenery = scene.getContext("2d");
      if (!scenery) {
        close();
        return;
      }
      scenery.drawImage(back, 0, 0);
      const platform = spriteFrame(level.platformId)!;
      for (let i = 0; i < FLOOR_ROW * COLUMNS; i++) {
        const tile = level.tiles[i],
          x = (i % COLUMNS) * TILE_WIDTH,
          y = Math.floor(i / COLUMNS) * TILE_HEIGHT;
        if (tile === 3)
          scenery.drawImage(
            atlas,
            platform.x,
            platform.y,
            platform.width,
            platform.height,
            x,
            y,
            platform.width,
            platform.height,
          );
        if (tile === 50) scenery.drawImage(crate, 0, 48, 64, 32, x, y, 64, 32);
      }
      const actors = new Map<
        number,
        { x: number; y: number; sprite: number }
      >();
      let offset = 0,
        caption = 0,
        start: number | undefined;
      const reduced = win.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      function draw(time: number) {
        if (closed) return;
        start ??= time;
        // Reduced motion keeps the trophy tableau on screen for the same final hold.
        const tick = reduced ? 3916 : Math.floor(((time - start) * 60) / 1000);
        while (
          offset < track.byteLength &&
          track.getUint16(offset, true) <= tick
        ) {
          const actor = track.getUint8(offset + 2),
            id = track.getUint16(offset + 7, true);
          if (actor === 255) {
            caption = id;
            canvas.setAttribute(
              "aria-label",
              id === 24
                ? ending.join(" ")
                : (castNames[id - 5] ?? "Grand Finale"),
            );
          } else {
            actors.set(actor, {
              x: track.getInt16(offset + 3, true),
              y: track.getInt16(offset + 5, true),
              sprite: id,
            });
          }
          offset += 9;
        }
        ctx!.drawImage(scene, 0, 0);
        for (const actor of actors.values()) {
          const cell = spriteFrame(actor.sprite);
          if (cell)
            ctx!.drawImage(
              atlas,
              cell.x,
              cell.y,
              cell.width,
              cell.height,
              actor.x,
              actor.y,
              cell.width,
              cell.height,
            );
        }
        const lines = caption === 24 ? ending : [castNames[caption - 5] ?? ""];
        const top = caption === 24 ? 232 : 252;
        ctx!.font = "bold 15px Georgia, serif";
        ctx!.textAlign = "center";
        ctx!.textBaseline = "top";
        ctx!.lineWidth = 3;
        ctx!.lineJoin = "round";
        ctx!.strokeStyle = "#17110c";
        ctx!.fillStyle = "#fff1ba";
        lines.forEach((line, i) => {
          ctx!.strokeText(line, 320, top + i * 16);
          ctx!.fillText(line, 320, top + i * 16);
        });
        canvas.dataset.ready = "true";
        if (reduced) {
          skip.textContent = "Continue";
          return;
        }
        if (tick >= LAST_TICK) {
          close();
          return;
        }
        frame = win!.requestAnimationFrame(draw);
      }
      frame = win.requestAnimationFrame(draw);
    })
    .catch(close);
  return close;
}
