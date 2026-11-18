import Phaser from "phaser";
import { config, TICK_RATE } from "../../game/sim/config.js";
import {
  FONT as BASE_FONT,
  FRAMES,
  HUD_CELL,
  SPONSORS,
  TRUCK_COLORS,
} from "./assets.js";
import type { ArenaFrame } from "./frame.js";
import { courseLabel } from "../course-label.js";
import { raceViewport } from "./race-scene.js";
import { buildFuseTimingBoard } from "./fuse-hud.js";
import type { StadiumTheme } from "./theme.js";

const FONT: Phaser.Types.GameObjects.Text.TextStyle = {
  ...BASE_FONT,
  fontSize: "30px",
  fontStyle: "bold",
  strokeThickness: 5,
};
const LABEL: Phaser.Types.GameObjects.Text.TextStyle = {
  ...FONT,
  fontSize: "18px",
  color: "#c8c8d0",
  strokeThickness: 0,
};
/** Big centre messages styled like the countdown cells: yellow, red outline, black drop shadow. */
const BIG: Phaser.Types.GameObjects.Text.TextStyle = {
  ...FONT,
  fontSize: "96px",
  color: "#ffe600",
  stroke: "#e01010",
  strokeThickness: 12,
  shadow: {
    offsetX: 8,
    offsetY: 8,
    color: "#000000",
    fill: true,
    stroke: true,
  },
};
/** Corner insets of the 9-slice panels at their half-size cut. */
const INSET = 24;
const TOP = 6,
  TOP_H = 64;

/** A centre message: a countdown cell (frame index) or a line of text, and how opaque to draw it. */
interface Flash {
  what: number | string;
  alpha: number;
}

/** A message holds, then fades. Ages are in simulated ticks. */
function flash(
  what: number | string,
  age: number,
  hold = 15,
  out = 12,
): Flash | undefined {
  if (age < 0 || age >= hold + out) return undefined;
  return { what, alpha: age < hold ? 1 : 1 - (age - hold) / out };
}

/**
 * The stadium and the panels, drawn in screen pixels over the race view. Every number comes from the view;
 * the lap banner is the only thing that remembers anything, and it forgets whenever the clock moves back.
 */
export class HudScene extends Phaser.Scene {
  static readonly KEY = "fd-hud";

  private readonly onReady: () => void;

  private built = "";
  private theme: StadiumTheme = "classic";
  private clock?: Phaser.GameObjects.Text;
  private course?: Phaser.GameObjects.Text;
  private bigImage?: Phaser.GameObjects.Image;
  private bigText?: Phaser.GameObjects.Text;
  private badge?: Phaser.GameObjects.Image;
  private chipNames: Phaser.GameObjects.Text[] = [];
  private chipStats: Phaser.GameObjects.Text[] = [];
  /** The lap each truck was last seen on, and the tick it changed, for the LAP banner. */
  private laps: number[] = [];
  private lapTick: number[] = [];
  private lastTick = -1;

  constructor(onReady: () => void) {
    super(HudScene.KEY);
    this.onReady = onReady;
  }

  create(): void {
    this.onReady();
  }

  private panel(
    color: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ): Phaser.GameObjects.NineSlice {
    return this.add
      .nineslice(
        x,
        y,
        `panel-${color}`,
        undefined,
        w,
        h,
        INSET,
        INSET,
        INSET,
        INSET,
      )
      .setOrigin(0)
      .setAlpha(0.9);
  }

  /**
   * The stadium around the race view: a grandstand band between the HUD strip and the track with the fence
   * and its sponsor boards along the bottom, and crowd strips down both sides.
   */
  private drawStands(frame: ArenaFrame, width: number, height: number): void {
    const cam = raceViewport(
      frame.track,
      import.meta.env.DEV && import.meta.env.VITE_OFFROAD_REFERENCE === "1",
    );
    const top = TOP + TOP_H + 2,
      bottom = cam.y;
    if (this.textures.exists("grandstand")) {
      const crowd = (x: number, y: number, w: number, h: number): void => {
        if (w > 0 && h > 0)
          this.add
            .tileSprite(x, y, w, h, "grandstand")
            .setOrigin(0)
            .setTileScale(0.55)
            .setDepth(-10);
      };
      crowd(0, top, width, bottom - top);
      crowd(0, bottom, cam.x, height - bottom);
      crowd(
        cam.x + cam.width,
        bottom,
        width - cam.x - cam.width,
        height - bottom,
      );
    }
    if (!this.textures.exists("fence")) return;
    const img = this.textures.get("fence").getSourceImage();
    const scale = 0.62,
      fh = img.height * scale,
      fw = img.width * scale;
    this.add
      .tileSprite(0, bottom - fh, width, fh, "fence")
      .setOrigin(0)
      .setTileScale(scale)
      .setDepth(-9);
    // Board centres and width as fractions of one fence tile; names shrink to fit their board.
    const boards = [0.086, 0.238, 0.396, 0.557, 0.721, 0.902],
      boardW = 0.11 * fw;
    let k = 0;
    for (let x = 0; x < width; x += fw) {
      for (const f of boards) {
        const sponsor = SPONSORS[k++ % SPONSORS.length]!;
        const label = this.add
          .text(x + f * fw, bottom - fh * 0.52, sponsor[0], {
            ...LABEL,
            fontSize: "16px",
            fontStyle: "italic bold",
            color: "#ffffff",
            stroke: "#000000",
            strokeThickness: 4,
          })
          .setOrigin(0.5)
          .setDepth(-8);
        label.setScale(Math.min(1, boardW / label.width));
      }
    }
  }

  /** Everything whose shape depends on the grid rather than on the tick. */
  private build(frame: ArenaFrame): void {
    for (const child of [...this.children.list]) child.destroy();
    this.chipStats = [];
    this.chipNames = [];
    const { width, height } = config.screen;
    const trucks = frame.race.trucks;
    if (this.theme === "fuse") {
      const board = buildFuseTimingBoard(this, frame);
      this.clock = board.clock;
      this.course = board.course;
      this.chipNames = board.names;
      this.chipStats = board.stats;
      this.badge = undefined;
      this.bigImage = undefined;
      this.bigText = this.add
        .text(width / 2, height * 0.38, "", {
          ...BIG,
          fontStyle: "bold italic",
          color: "#f4ffea",
          stroke: "#13293a",
          strokeThickness: 7,
          shadow: {
            offsetX: 4,
            offsetY: 5,
            color: "#0c6267",
            fill: true,
            stroke: true,
          },
        })
        .setOrigin(0.5)
        .setVisible(false);
      return;
    }
    this.drawStands(frame, width, height);

    // One scoreboard across the top leaves the entire course visible, including the start line.
    this.add
      .image(10, TOP + TOP_H / 2, "logo", 0)
      .setOrigin(0, 0.5)
      .setScale(TOP_H / 380);
    const start = 176;
    const clockWidth = 160;
    const chipW = Math.floor((width - start - clockWidth - 12) / trucks.length);
    trucks.forEach((_, i) => {
      const x = start + i * chipW;
      this.panel(
        TRUCK_COLORS[i % TRUCK_COLORS.length]!,
        x,
        TOP,
        chipW - 5,
        TOP_H,
      );
      this.add
        .image(x + 31, TOP + TOP_H / 2, "portraits", i)
        .setScale(44 / HUD_CELL.portraits);
      this.chipNames.push(
        this.add.text(x + 56, TOP + 9, "", {
          ...LABEL,
          color: "#ffffff",
          fontSize: "21px",
        }),
      );
      this.chipStats.push(
        this.add.text(x + 56, TOP + 36, "", { ...LABEL, color: "#ffe5aa" }),
      );
    });
    const timeX = width - clockWidth / 2 - 6;
    this.panel("grey", width - clockWidth - 6, TOP, clockWidth, TOP_H);
    this.add.text(timeX, TOP + 16, "RACE TIME", LABEL).setOrigin(0.5);
    this.clock = this.add.text(timeX, TOP + 43, "", FONT).setOrigin(0.5);

    this.course = this.add
      .text(width - 12, height - 10, "", { ...FONT, fontSize: "20px" })
      .setOrigin(1, 1);

    this.bigImage = this.add
      .image(width / 2, height * 0.42, "countdown", 0)
      .setVisible(false);
    this.bigText = this.add
      .text(width / 2, height * 0.42, "", BIG)
      .setOrigin(0.5)
      .setVisible(false);
    this.badge = this.add
      .image(width / 2, height * 0.64, "placements", 0)
      .setScale(1.1)
      .setVisible(false);
  }

  /** The one message on show, worked out from the view alone except for the lap the banner remembers. */
  private message(frame: ArenaFrame): Flash | undefined {
    const { race, focus } = frame;
    const me = race.trucks[focus];
    if (!me) return undefined;
    if (race.phase === "countdown") {
      const left = Math.ceil((race.countdownEndTick - race.tick) / TICK_RATE);
      return { what: Math.max(0, Math.min(2, 3 - left)), alpha: 1 };
    }
    if (me.finishedTick)
      return flash(
        FRAMES.countdown.finish,
        race.tick - me.finishedTick,
        45,
        20,
      );
    const lapTick = this.lapTick[focus];
    if (lapTick !== undefined && me.laps > 0)
      return (
        flash(
          `LAP ${Math.min(me.laps + 1, config.laps)}`,
          race.tick - lapTick,
        ) ?? this.startOrWarning(frame, me.wrongWayTicks)
      );
    return this.startOrWarning(frame, me.wrongWayTicks);
  }

  private startOrWarning(
    frame: ArenaFrame,
    wrongWayTicks: number,
  ): Flash | undefined {
    const { race } = frame;
    if (wrongWayTicks >= config.truck.wrongWayTicks)
      return { what: "WRONG WAY", alpha: 1 };
    return flash(FRAMES.countdown.go, race.tick - race.countdownEndTick);
  }

  /** Show a countdown cell (a frame index) or a line of text, or hide both. */
  private show(flashed: Flash | undefined): void {
    const image = this.bigImage,
      text = this.bigText;
    if (!text) return;
    if (this.theme === "fuse") {
      text.setVisible(!!flashed);
      if (flashed) {
        const what = flashed.what;
        text
          .setText(
            typeof what === "string"
              ? what
              : (["3", "2", "1", "GO", "FINISH"][what] ?? ""),
          )
          .setAlpha(flashed.alpha);
      }
      return;
    }
    if (!image) return;
    if (!flashed) {
      image.setVisible(false);
      text.setVisible(false);
      return;
    }
    const { what, alpha } = flashed;
    image.setVisible(typeof what === "number");
    text.setVisible(typeof what === "string");
    if (typeof what === "string") {
      text.setText(what).setAlpha(alpha);
      return;
    }
    // Digits are tall cells, GO! and FINISH are wide; scale each to a couch-readable size.
    const scale =
      what < FRAMES.countdown.go ? 0.4 : what === FRAMES.countdown.go ? 0.6 : 1;
    image.setFrame(what).setScale(scale).setAlpha(alpha);
  }

  /** Remember each truck's lap and when it changed; a clock that moved back forgets rather than banners. */
  private trackLaps(frame: ArenaFrame): void {
    const { race } = frame;
    if (race.tick < this.lastTick || this.laps.length !== race.trucks.length) {
      this.laps = race.trucks.map((t) => t.laps);
      this.lapTick = race.trucks.map(() => Number.NEGATIVE_INFINITY);
    } else
      race.trucks.forEach((t, slot) => {
        if (t.laps !== this.laps[slot]) {
          this.laps[slot] = t.laps;
          this.lapTick[slot] = race.tick;
        }
      });
    this.lastTick = race.tick;
  }

  paint(frame: ArenaFrame, theme: StadiumTheme): void {
    this.theme = theme;
    const shape = `${frame.track.name}:${frame.race.trucks.length}:${theme}`;
    if (this.built !== shape) {
      this.build(frame);
      this.built = shape;
    }
    this.trackLaps(frame);
    const { race, focus } = frame;
    const me = race.trucks[focus];
    if (!me) return;
    const secs = Math.max(0, (race.tick - race.countdownEndTick) / TICK_RATE);
    this.clock?.setText(
      `${Math.floor(secs / 60)}:${(secs % 60).toFixed(1).padStart(4, "0")}`,
    );
    race.trucks.forEach((t, i) => {
      const position = race.placements.indexOf(i) + 1;
      this.chipNames[i]?.setText(`${position}. ${frame.names[i] ?? ""}`);
      this.chipStats[i]?.setText(
        `LAP ${Math.min(config.laps, t.laps + 1)}   NITRO ${t.nitros}`,
      );
    });
    this.course?.setText(courseLabel(frame.track.name).toUpperCase());
    this.show(this.message(frame));
    this.badge
      ?.setFrame(Math.max(0, race.placements.indexOf(focus)))
      .setVisible(me.laps >= config.laps);
  }
}
