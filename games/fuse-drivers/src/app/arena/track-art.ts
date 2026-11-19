import type Phaser from "phaser";
import { getOffroadTerrain } from "../../game/offroad/courses.js";
import type { Track } from "../../game/sim/track.js";
import { paintOffroadGround } from "./offroad-art.js";
import type { StadiumTheme } from "./theme.js";

/** A single immutable track texture sits beneath every truck on this client. */
export function createTrackArt(
  scene: Phaser.Scene,
  track: Track,
  theme: StadiumTheme,
): { destroy(): void } {
  const key = `fd:${track.name}:ground`;
  const terrain = getOffroadTerrain(track.name);
  if (!terrain) throw new Error(`Unrecognized off-road terrain ${track.name}`);
  const texture = scene.textures.createCanvas(
    key,
    track.cols * track.tile,
    track.rows * track.tile,
  );
  if (!texture)
    throw new Error(`Could not create the ground for ${track.name}`);
  paintOffroadGround(texture.getContext(), track, terrain, theme);
  texture.refresh();
  const image = scene.add.image(0, 0, key).setOrigin(0).setDepth(1);
  return {
    destroy() {
      image.destroy();
      scene.textures.remove(key);
    },
  };
}
