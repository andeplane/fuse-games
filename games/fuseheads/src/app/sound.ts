import { readPrefs, AUDIO_KEY } from "fuse-ui/game-audio";
import type { SafeStorage } from "fuse-ui/safe-storage";
import { hazardDelay } from "../game/hazards.js";
import { getLevel } from "../levels/index.js";
import type { World } from "../game/simulation.js";

type Cue = "bonk" | "tnt" | "kick" | "hurt" | "jump" | "gem" | "flap" | "tire";
type Voice = Pick<
  HTMLAudioElement,
  "src" | "volume" | "pause" | "play" | "currentTime"
>;
export function createSounds(
  store: SafeStorage,
  forcedMute: boolean,
  voice: () => Voice,
) {
  const prefs = readPrefs(store);
  const samples = new Map<Cue, Voice>();
  let scope = "";
  let lastTick = -1;
  let previous:
    | {
        batClock: number;
        tireClock: number;
        tnt: number;
        bump: number;
        players: {
          slot: number;
          score: number;
          lives: number;
          grounded: boolean;
        }[];
        gems: number;
      }
    | undefined;
  const stop = () => samples.forEach((sample) => sample.pause());
  const play = (cue: Cue) => {
    if (forcedMute || prefs.muted || !prefs.effects) return;
    let sample = samples.get(cue);
    if (!sample) {
      sample = voice();
      sample.src = new URL(`./sounds/${cue}.wav`, import.meta.url).href;
      samples.set(cue, sample);
    }
    sample.volume = prefs.effects;
    sample.currentTime = 0;
    void sample.play().catch(() => {});
  };
  return {
    master: {
      enabled: () => !forcedMute && !prefs.muted,
      forcedMute,
      setEnabled(enabled: boolean) {
        if (forcedMute) return;
        prefs.muted = !enabled;
        store.setItem(AUDIO_KEY, JSON.stringify(prefs));
        if (!enabled) stop();
      },
    },
    stop,
    observe(match: string, world: World) {
      if (forcedMute) return;
      const key = match + "/" + world.levelIndex;
      if (scope !== key) {
        previous = undefined;
        lastTick = -1;
        scope = key;
      }
      if (world.tick <= lastTick) return;
      const next = {
        batClock: world.hazards.batClock,
        tireClock: world.hazards.tireClock,
        tnt: world.tnt,
        bump: world.bumps.reduce(
          (latest, bump) => Math.max(latest, bump.until),
          0,
        ),
        players: world.players.map(({ slot, score, lives, grounded }) => ({
          slot,
          score,
          lives,
          grounded,
        })),
        gems: world.pickups.length,
      };
      if (previous) {
        const level = getLevel(world.levelIndex + 1, world.pack);
        const tireWarning = hazardDelay(level.tireFrequency) - 80;
        const batWarning = hazardDelay(level.batFrequency) - 9;
        if (previous.tireClock < tireWarning && next.tireClock >= tireWarning)
          play("tire");
        if (previous.batClock < batWarning && next.batClock >= batWarning)
          play("flap");
        if (next.tnt < previous.tnt) play("tnt");
        else if (next.bump > previous.bump) play("bonk");
        if (next.gems < previous.gems) play("gem");
        for (const player of next.players) {
          const old = previous.players.find(
            (other) => player.slot === other.slot,
          );
          if (!old) continue;
          if (player.lives < old.lives) play("hurt");
          else if (player.score > old.score && next.gems >= previous.gems)
            play("kick");
          else if (
            old.grounded &&
            !player.grounded &&
            world.players.find((p) => p.slot === player.slot)!.vy < 0
          )
            play("jump");
        }
      }
      lastTick = world.tick;
      previous = next;
    },
  };
}
