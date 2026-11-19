import type { WorldView } from "../engine/view.js";
import { STEPS_PER_SECOND, secondsLeft } from "../engine/view-kit.js";
import type { Cue } from "./cues.js";
import {
  DANGER,
  DECK_LINE,
  GATE,
  INK,
  PIXEL_FONT,
  SURGE_HIGH,
  SURGE_LOW,
  SURGE_TALL,
  TEXT,
  TEXT_DIM,
  WHITE,
  hexA,
  laneColor,
} from "./palette.js";

export const BOARD_WIDTH = 960;
export const BOARD_HEIGHT = 540;
export const clamp01 = (value: number) =>
  value < 0 ? 0 : value > 1 ? 1 : value;

export interface BoardSkin {
  low: string;
  high: string;
  tall: string;
  flip: string;
}

const riderLabel = (names: readonly string[], slot: number) =>
  (names[slot] || `RIDER ${slot + 1}`).toUpperCase();

/** A dark plate, so the text reads on a bright sky as well as a dark one. */
const plate = (
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  alpha = 0.62,
) => {
  c.fillStyle = hexA(INK, alpha);
  c.beginPath();
  c.roundRect(x, y, w, h, 8);
  c.fill();
};
/** Text with a dark edge. */
export const ink = (
  c: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fill: string,
) => {
  c.lineJoin = "round";
  c.lineWidth = 4;
  c.strokeStyle = hexA(INK, 0.85);
  c.strokeText(text, x, y);
  c.fillStyle = fill;
  c.fillText(text, x, y);
};

export function drawBoard(
  c: CanvasRenderingContext2D,
  view: WorldView,
  now: number,
  local: number,
  names: readonly string[],
  overlay?: BoardSkin,
): void {
  // Endless rounds show elapsed time. Only the 3D overlay also labels the mode.
  const seconds = view.endless
    ? Math.floor(view.elapsed / STEPS_PER_SECOND)
    : secondsLeft(view.clock);
  const urgent = view.phase === "play" && !view.endless && seconds <= 10;
  const center = BOARD_WIDTH / 2;
  const right = BOARD_WIDTH - 24;
  if (overlay) plate(c, center - 118, 12, 236, 64);
  c.textAlign = "center";
  c.font = `28px ${PIXEL_FONT}`;
  c.fillStyle = urgent ? hexA(DANGER, 0.7 + 0.3 * Math.sin(now / 90)) : TEXT;
  c.fillText(
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
    center,
    overlay ? 50 : 46,
  );
  c.font = `9px ${PIXEL_FONT}`;
  c.fillStyle = TEXT_DIM;
  const round = `ROUND ${view.round}${view.target > 1 ? ` · FIRST TO ${view.target}` : ""}`;
  c.fillText(
    overlay && view.endless ? `${round} · ENDLESS` : round,
    center,
    overlay ? 67 : 66,
  );

  const tallWarning = view.tallSoon && Math.floor(now / 160) % 2 === 0;
  if (overlay && tallWarning) {
    c.textAlign = "right";
    ink(c, "TALL NEXT: DOUBLE JUMP", right, 96, overlay.tall);
    c.textAlign = "center";
  }

  const times = view.speedStart > 0 ? view.speed / view.speedStart : 1;
  const fill = clamp01((times - 1) / 2);
  const barY = overlay ? 40 : 38;
  if (overlay) plate(c, BOARD_WIDTH - 182, 12, 170, 64);
  c.textAlign = "right";
  c.fillStyle = TEXT_DIM;
  c.fillText("SURGE SPEED", right, barY - 8);
  c.fillStyle = overlay ? hexA(TEXT_DIM, 0.35) : hexA(DECK_LINE, 0.7);
  c.fillRect(BOARD_WIDTH - 164, barY, 140, 10);
  c.fillStyle =
    fill > 0.66 ? DANGER : fill > 0.33 ? "#ffb347" : (overlay?.flip ?? GATE);
  c.fillRect(
    BOARD_WIDTH - 164,
    barY,
    Math.round(140 * Math.max(0.04, fill)),
    10,
  );
  c.fillStyle = TEXT;
  c.fillText(`x${times.toFixed(1)}`, right, barY + 26);

  if (overlay) plate(c, 12, 12, view.tall ? 214 : 158, view.tall ? 88 : 64);
  c.textAlign = "left";
  const legend = (row: number, color: string, up: boolean, text: string) => {
    c.fillStyle = color;
    if (overlay) {
      const y = 32 + row * 24;
      c.beginPath();
      c.moveTo(31, y + (up ? -7 : 7));
      c.lineTo(39, y + (up ? 5 : -5));
      c.lineTo(23, y + (up ? 5 : -5));
      c.closePath();
      c.fill();
      c.fillStyle = TEXT;
      c.fillText(text, 48, y + 4);
    } else {
      const y = 22 + row * 18;
      c.fillRect(24, y, 14, 8);
      c.fillStyle = TEXT_DIM;
      c.fillText(text, 46, y + 8);
    }
  };
  legend(0, overlay?.low ?? SURGE_LOW, true, "LOW: JUMP");
  legend(1, overlay?.high ?? SURGE_HIGH, false, "HIGH: DUCK");
  if (view.tall)
    legend(2, overlay?.tall ?? SURGE_TALL, true, "TALL: DOUBLE JUMP");
  if (!overlay && tallWarning) {
    c.textAlign = "right";
    c.fillStyle = SURGE_TALL;
    c.fillText("TALL NEXT: DOUBLE JUMP", right, 84);
    c.textAlign = "left";
  }

  const count = view.riders.length;
  const width = Math.min(176, (BOARD_WIDTH - 48 - (count - 1) * 10) / count);
  const left = (BOARD_WIDTH - (count * width + (count - 1) * 10)) / 2;
  const top = overlay ? 474 : 470;
  for (const each of view.riders) {
    const x = left + each.slot * (width + 10);
    const textX = x + (overlay ? 16 : 14);
    const color = laneColor(each.slot);
    if (overlay) {
      plate(c, x, top, width, 56, 0.72);
      c.fillStyle = hexA(color, each.out ? 0.35 : 1);
      c.beginPath();
      c.roundRect(x, top, 6, 56, [8, 0, 0, 8]);
      c.fill();
    } else {
      c.fillStyle = hexA(INK, 0.78);
      c.fillRect(x, top, width, 56);
      c.fillStyle = hexA(color, each.out ? 0.35 : 1);
      c.fillRect(x, top, 5, 56);
    }
    if (each.slot === local) {
      c.strokeStyle = hexA(WHITE, overlay ? 0.85 : 0.8);
      c.lineWidth = 2;
      if (overlay) {
        c.beginPath();
        c.roundRect(x + 1, top + 1, width - 2, 54, 8);
        c.stroke();
      } else {
        c.strokeRect(x + 1, top + 1, width - 2, 54);
      }
    }
    c.textAlign = "left";
    c.font = `9px ${PIXEL_FONT}`;
    c.fillStyle = each.out ? TEXT_DIM : TEXT;
    const name = riderLabel(names, each.slot);
    c.fillText(
      name.length > 12 ? `${name.slice(0, 11)}…` : name,
      textX,
      top + 18,
    );
    for (let i = 0; i < view.target; i++) {
      c.fillStyle = i < each.wins ? "#ffe46b" : hexA(TEXT_DIM, 0.35);
      c.fillRect(textX + i * 12, top + 26, 9, 9);
    }
    if (each.out) {
      c.fillStyle = DANGER;
      c.fillText("OUT", textX, top + 50);
    } else {
      const hitsLeft = view.maxHits - each.hits;
      const size = view.maxHits > 6 ? 7 : 10;
      for (let i = 0; i < view.maxHits; i++) {
        c.fillStyle = i < hitsLeft ? color : hexA(DANGER, 0.3);
        c.fillRect(textX + i * (size + 3), top + 41, size, 6);
      }
    }
  }
}

interface Banner {
  text: string;
  sub: string;
  color: string;
  at: number;
  ms: number;
}

export function createRoundBanner(calm: boolean, style: "classic" | "overlay") {
  const overlay = style === "overlay";
  const neutral = overlay ? WHITE : TEXT;
  const x = BOARD_WIDTH / 2;
  const y = overlay ? 176 : 170;
  let banner: Banner | undefined;
  return {
    react(
      cues: readonly Cue[],
      round: number,
      now: number,
      names: readonly string[],
      goColor: string,
    ) {
      const say = (text: string, sub: string, color: string, ms: number) => {
        banner = { text, sub, color, at: now, ms };
      };
      for (const cue of cues) {
        switch (cue.kind) {
          case "count":
            if (cue.seconds > 0)
              say(String(cue.seconds), `ROUND ${round}`, neutral, 900);
            break;
          case "go":
            say("GO!", "", goColor, 700);
            break;
          case "round": {
            const who = cue.winners.map((slot) => riderLabel(names, slot));
            if (cue.reason === "time")
              say("TIME!", `${who.join(" · ")} DRAW THE ROUND`, neutral, 2600);
            else if (cue.reason === "wipe")
              say(
                "DOUBLE KO",
                `${who.join(" · ")} DRAW THE ROUND`,
                DANGER,
                2600,
              );
            else if (cue.winners.length === 1)
              say(
                who[0]!,
                "LAST ONE STANDING",
                laneColor(cue.winners[0]!),
                2600,
              );
            break;
          }
        }
      }
    },
    draw(c: CanvasRenderingContext2D, now: number) {
      if (!banner) return;
      const age = now - banner.at;
      if (age > banner.ms) {
        banner = undefined;
        return;
      }
      const pop = calm ? 1 : 1 + 0.5 * Math.max(0, 1 - age / 160);
      const alpha = clamp01((banner.ms - age) / 250);
      c.textAlign = "center";
      c.font = `${Math.round((banner.text.length > 9 ? 34 : 56) * pop)}px ${PIXEL_FONT}`;
      if (overlay) {
        c.globalAlpha = alpha;
        c.lineJoin = "round";
        c.lineWidth = 10;
        c.strokeStyle = hexA(INK, 0.85);
        c.strokeText(banner.text, x, y);
        c.fillStyle = banner.color;
      } else {
        c.fillStyle = hexA(INK, 0.7 * alpha);
        c.fillText(banner.text, x + 4, y + 4);
        c.fillStyle = hexA(banner.color, alpha);
      }
      c.fillText(banner.text, x, y);
      if (banner.sub) {
        c.font = `12px ${PIXEL_FONT}`;
        if (overlay) ink(c, banner.sub, x, y + 32, TEXT);
        else {
          c.fillStyle = hexA(TEXT, alpha);
          c.fillText(banner.sub, x, y + 32);
        }
      }
      if (overlay) c.globalAlpha = 1;
    },
  };
}
