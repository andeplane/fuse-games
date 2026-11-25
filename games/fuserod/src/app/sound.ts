import type { GameAudio } from "fuse-ui/game-audio";
import type { FuserodView } from "../game/index.js";

/** Continuous voices follow the displayed car. Discrete cues play once per advancing log tick. */
export function raceSound(audio: GameAudio) {
  const engine = audio.hum({ type: "sawtooth", sub: "triangle", cutoff: 440 });
  const siren = audio.hum({ type: "sine", cutoff: 1700 });
  let scope = "",
    latest = -1,
    lastGear = 0,
    lastLight = 0,
    retired = false;
  const silence = () => {
    engine.set(40, 0);
    siren.set(600, 0);
  };
  return {
    silence,
    update(frame: FuserodView, me: string) {
      const driver = frame.racers.find((r) => r.id === me) ?? frame.racers[0];
      if (!driver || frame.phase === "lobby") {
        silence();
        return;
      }
      const stopped =
        driver.broken ||
        driver.crashed ||
        driver.falseStart ||
        driver.laneFault;
      const driving = frame.phase === "running" && !stopped;
      engine.set(Math.max(28, driver.rpm / 45), driving ? 0.038 : 0);
      siren.set(
        590 + 185 * (1 + Math.sin(frame.tick * 0.22)),
        driving && frame.policePhase === 3 ? 0.042 : 0,
      );
      const light = Math.ceil(driver.countdown / 20);
      if (frame.matchId !== scope) {
        scope = frame.matchId;
        latest = -1;
        lastGear = driver.gear;
        lastLight = light;
        retired = stopped;
      }
      if (frame.tick <= latest) return;
      if (driver.gear !== lastGear)
        audio.noise({ duration: 0.07, cutoff: 540, volume: 0.09 });
      if (light < lastLight)
        audio.tone({
          frequency: light ? 380 : 760,
          type: "sine",
          duration: light ? 0.1 : 0.26,
          volume: 0.1,
        });
      if (!retired && stopped)
        audio.noise({ duration: 0.28, cutoff: 800, volume: 0.15 });
      latest = frame.tick;
      lastGear = driver.gear;
      lastLight = light;
      retired = stopped;
    },
  };
}
