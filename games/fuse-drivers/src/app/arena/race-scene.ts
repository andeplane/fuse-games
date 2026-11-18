import Phaser from "phaser";
import { projectOffroad } from "../../game/offroad/course.js";
import { getOffroadTerrain } from "../../game/offroad/courses.js";
import { config } from "../../game/sim/config.js";
import type { Track } from "../../game/sim/track.js";
import {
  FRAMES,
  SPRITE_CELL,
  TRUCK_CELL,
  TRUCK_COLORS,
  queueArenaAssets,
} from "./assets.js";
import type { ArenaFrame } from "./frame.js";
import { createReferenceArt, type ReferenceArt } from "./reference-art.js";
import { createTrackArt } from "./track-art.js";

const TRUCK_SCALE = 44 / (TRUCK_CELL * 0.92);
export const TILT = 0.72;
const SIDE_LAYERS = 4;
export const STANDS = { top: 100, side: 16 } as const;

const localReference =
  import.meta.env.DEV && import.meta.env.VITE_OFFROAD_REFERENCE === "1";

export function raceViewport(track: Track): {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
  zoomY: number;
} {
  const worldW = track.cols * config.tile,
    worldH = track.rows * config.tile;
  const aspect = localReference ? worldW / 320 / (worldH / 200) : 1;
  const zoom = Math.min(
    (config.screen.width - 2 * STANDS.side) / worldW,
    (config.screen.height - STANDS.top) / (worldH * aspect),
  );
  return {
    x: (config.screen.width - worldW * zoom) / 2,
    y: config.screen.height - worldH * zoom * aspect,
    width: worldW * zoom,
    height: worldH * zoom * aspect,
    zoomY: zoom * aspect,
    zoom,
  };
}

interface TruckSprite {
  truck: Phaser.GameObjects.Container;
  shadow: Phaser.GameObjects.Container;
  shadowBody: Phaser.GameObjects.Image;
  layers: Phaser.GameObjects.Image[];
}

/** Draw exactly the pose the race supplies. Phaser has neither a second terrain nor a simulation clock. */
export class RaceScene extends Phaser.Scene {
  static readonly KEY = "fd-race";
  private art?: ReturnType<typeof createTrackArt>;
  private artTrack?: string;
  private trucks: TruckSprite[] = [];
  private dust?: Phaser.GameObjects.Particles.ParticleEmitter;
  private reference?: ReferenceArt;
  private pickup?: Phaser.GameObjects.Image;

  constructor(
    private readonly assetBase: string,
    private readonly onReady: () => void,
  ) {
    super(RaceScene.KEY);
  }

  preload(): void {
    queueArenaAssets(this.load, this.assetBase);
    if (localReference)
      this.load.json("fd-local-reference-pack", "/__offroad-reference.json");
  }

  create(): void {
    if (localReference)
      this.reference = createReferenceArt(
        this,
        this.cache.json.get("fd-local-reference-pack"),
      );
    const money = this.make.graphics({}, false);
    money.fillStyle(0x221b13).fillRect(0, 2, 13, 8);
    money.fillStyle(0x356139).fillRect(1, 2, 11, 6);
    money.fillStyle(0x9df082).fillRect(1, 1, 11, 5);
    money.fillStyle(0x468354).fillRect(2, 2, 9, 3);
    money.fillStyle(0xffdf75).fillRect(5, 1, 3, 7);
    money.generateTexture("fd-bills", 13, 10).destroy();
    this.pickup = this.add
      .image(0, 0, "fd-bills")
      .setVisible(false)
      .setDepth(6);
    this.dust = this.add
      .particles(0, 0, "dust", {
        frame: [...FRAMES.dust],
        lifespan: 350,
        speed: { min: 5, max: 18 },
        scale: { start: 14 / SPRITE_CELL, end: 22 / SPRITE_CELL },
        alpha: { start: 0.55, end: 0 },
        emitting: false,
      })
      .setDepth(8);
    this.onReady();
  }

  private buildTrack(track: Track): void {
    this.art?.destroy();
    if (!this.reference) this.art = createTrackArt(this, track);
    this.artTrack = track.name;
    const view = raceViewport(track);
    this.cameras.main
      .setViewport(view.x, view.y, view.width, view.height)
      .setZoom(view.zoom, view.zoomY)
      .centerOn((track.cols * track.tile) / 2, (track.rows * track.tile) / 2);
  }

  private buildTrucks(count: number): void {
    for (const sprite of this.trucks) {
      sprite.truck.destroy();
      sprite.shadow.destroy();
    }
    this.trucks = Array.from({ length: count }, (_, slot) => {
      const key = `truck-${TRUCK_COLORS[slot % TRUCK_COLORS.length]!}`;
      const copy = () => this.add.image(0, 0, key).setScale(TRUCK_SCALE);
      const shadowBody = copy().setTint(0x201008).setAlpha(0.42);
      const shadow = this.add
        .container(0, 0, [shadowBody])
        .setScale(1, TILT)
        .setDepth(9);
      const layers = Array.from({ length: SIDE_LAYERS }, (_, i) =>
        copy()
          .setTint(
            i === SIDE_LAYERS - 1 ? 0xffffff : i === 0 ? 0x282128 : 0x5d5654,
          )
          .setY(-i),
      );
      const truck = this.add.container(0, 0, layers).setScale(1, TILT);
      return { truck, shadow, shadowBody, layers };
    });
  }

  paint(frame: ArenaFrame): void {
    const { race, track, poses, newTick } = frame;
    if (this.artTrack !== track.name) this.buildTrack(track);
    if (!this.reference && this.trucks.length !== race.trucks.length)
      this.buildTrucks(race.trucks.length);
    const active = race.pickups.active;
    this.pickup?.setVisible(!!active);
    if (active && this.pickup) {
      const terrain = getOffroadTerrain(track.name)!;
      const p = projectOffroad(
        track.name,
        active.x,
        active.y,
        terrain.sample(active.x, active.y)?.height ?? 0x8000,
      );
      this.pickup
        .setTexture(
          active.kind === "cash" ? "fd-bills" : "bars",
          active.kind === "nitro" ? FRAMES.bars.nitro : undefined,
        )
        .setDisplaySize(active.kind === "cash" ? 27 : 21, 21)
        .setPosition(p.x, p.y);
    }
    if (this.reference) {
      this.reference.paint(frame);
      return;
    }
    race.trucks.forEach((truck, slot) => {
      const p = poses[slot];
      const sprite = this.trucks[slot];
      if (!p || !sprite) return;
      // The projected body pose already includes suspension travel. Use the contact plane to place the shadow.
      const ground = projectOffroad(
        track.name,
        truck.motion.x,
        truck.motion.y,
        truck.suspension.groundHeight,
      );
      sprite.shadow.setPosition(
        p.x + (ground.x - truck.x) + 2,
        p.y + (ground.y - truck.y) + 3,
      );
      sprite.truck.setPosition(p.x, p.y).setDepth(10 + truck.motion.y / 16384);
      const rotation = p.heading + Math.PI / 2;
      sprite.shadowBody.setRotation(rotation);
      for (const layer of sprite.layers) layer.setRotation(rotation);
      if (
        newTick &&
        Math.abs(truck.suspension.bodyHeight - truck.suspension.groundHeight) <
          256 &&
        truck.speed > 60
      )
        this.dust?.emitParticleAt(
          p.x - Math.cos(p.heading) * 15,
          p.y - Math.sin(p.heading) * 15,
        );
    });
  }

  reset(): void {
    this.pickup?.setVisible(false);
    this.dust?.killAll();
  }
}
