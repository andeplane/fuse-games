import {
  BATTLE_MODE,
  LEAD_IN_MS,
  SCORE_MODE,
  SOLO_LEAD_IN_MS,
} from "../engine/index.js";
import type { View } from "../online/game.js";
import type { Viewer } from "./presenter.js";
import type { RankObservation } from "./ranked-run.js";
import { bestRating, createBests, type Store } from "./session.js";

type PlayMode = "solo" | "shared" | "online";

interface RoomScoreOptions {
  store: Store;
  viewer: Viewer;
  bundledLibrary: boolean;
  bestKey(song: string, chart: number): string | undefined;
  progress(): { epoch?: number; confirmed: boolean };
  observeRanked(observation: RankObservation): void;
  songFinished(properties: {
    song: string;
    chart: number;
    rating: number;
    battle: boolean;
    mode: PlayMode;
  }): void;
}

/** Reads the pre-match best until the authoritative result can be persisted. */
export function createRoomScores(options: RoomScoreOptions) {
  const bests = createBests(options.store);
  let lastFinished = "";

  return (frame: View, mode: PlayMode): number | undefined => {
    const world = frame.world;
    if (!world) return;
    const player = world.players.find((each) => each.id === options.viewer.me);
    if (!player || player.bot) return;

    const finished = frame.stage === "over";
    const { epoch, confirmed } = options.progress();
    if (!options.viewer.display) {
      options.observeRanked({
        key: `${frame.matchId}:${epoch}`,
        song: world.song,
        chart: player.chart,
        leadIn: world.players.length === 1 ? SOLO_LEAD_IN_MS : LEAD_IN_MS,
        eligible: world.mode === SCORE_MODE && options.bundledLibrary,
        beforeSong: world.ms < 0,
        finished,
        confirmed,
        rating: player.rating,
      });
    }
    if (!finished) return;

    const key = options.bestKey(world.song, player.chart);
    const bestBefore = key
      ? confirmed
        ? bests.settle(frame.matchId, key, player.rating)
        : bestRating(options.store, key)
      : undefined;
    if (lastFinished !== frame.matchId) {
      lastFinished = frame.matchId;
      options.songFinished({
        song: world.song,
        chart: player.chart,
        rating: player.rating,
        battle: world.mode === BATTLE_MODE,
        mode,
      });
    }
    return bestBefore;
  };
}
