import type { GameAudio } from "fuse-ui/game-audio";
import type { MissionState } from "../sim/index.js";

type Bus = Pick<GameAudio, "tone" | "noise" | "jingle">;

/** Short procedural voices; the shared effects bus controls volume, gesture unlock and mute. */
function weaponSound(bus: Bus, weapon: number, gain: number): void {
  switch (weapon) {
    case 0:
      bus.noise({ duration: 0.065, cutoff: 2300, volume: 0.11 * gain });
      break;
    case 1:
    case 4:
    case 8:
      bus.noise({
        duration: weapon === 4 ? 0.15 : 0.06,
        cutoff: weapon === 8 ? 6400 : 4300,
        volume: 0.18 * gain,
      });
      bus.tone({
        frequency: weapon === 4 ? 104 : 153,
        duration: 0.1,
        slide: 0.25,
        type: "triangle",
        volume: 0.12 * gain,
      });
      break;
    case 3:
    case 15:
      bus.noise({
        duration: 0.14,
        cutoff: weapon === 3 ? 1900 : 3600,
        volume: 0.12 * gain,
      });
      break;
    case 5:
    case 12:
    case 13:
      bus.tone({
        frequency: weapon === 12 ? 870 : 510,
        duration: 0.125,
        type: "sawtooth",
        slide: 0.22,
        volume: 0.055 * gain,
      });
      break;
    default:
      bus.tone({
        frequency: 275,
        duration: 0.065,
        type: "triangle",
        slide: 0.46,
        volume: 0.1 * gain,
      });
      bus.noise({ duration: 0.045, cutoff: 2100, volume: 0.06 * gain });
  }
}

export function createMissionSounds(bus: Bus) {
  let mission = "";
  let heardTick = -1;
  let progress = 0;
  let keys = 0;
  let exit = false;
  let outcome = "";
  let health = new Map<string, number>();
  return {
    reset() {
      mission = "";
      heardTick = -1;
      health.clear();
    },
    observe(world: MissionState, me?: string) {
      const identity = [
        world.mode,
        world.campaign,
        world.mission,
        world.seed,
      ].join("/");
      const done = world.objectives.reduce((n, item) => n + item.done, 0);
      const entering = mission !== identity;
      // Repeated presentation frames, rollback, and joining from a snapshot must not replay old sounds.
      if (!entering && world.tick <= heardTick) return;
      const listener = world.actors.find(
        (actor) => actor.seat === me && actor.hp > 0,
      );
      if (!entering && world.tick - heardTick < 20) {
        const shooters = world.actors
          .filter((actor) => actor.lastShot > heardTick)
          .map((actor) => ({
            actor,
            distance: listener
              ? Math.hypot(actor.x - listener.x, actor.y - listener.y)
              : 0,
          }))
          .filter(({ distance }) => distance < 175)
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 4);
        for (const { actor, distance } of shooters)
          weaponSound(
            bus,
            actor.weapon,
            actor.seat === me ? 1 : 0.52 * (1 - distance / 190),
          );
        if (
          world.shots.some(
            (shot) =>
              shot.kind === "fireball" &&
              shot.age >= 0 &&
              shot.age < world.tick - heardTick &&
              (!listener ||
                Math.hypot(listener.x - shot.x, listener.y - shot.y) < 110),
          )
        ) {
          bus.noise({ duration: 0.21, cutoff: 1800, volume: 0.15 });
          bus.tone({
            frequency: 110,
            duration: 0.24,
            slide: 0.24,
            type: "triangle",
            volume: 0.13,
          });
        }
        const own = world.actors.find((actor) => actor.seat === me);
        if (own && own.hp < (health.get(own.id) ?? own.hp))
          bus.tone({
            frequency: own.hp ? 155 : 115,
            duration: 0.16,
            slide: 0.48,
            type: "square",
            volume: 0.035,
          });
        if (world.outcome !== outcome && world.outcome !== "playing")
          bus.jingle(
            world.outcome === "victory"
              ? [440, 554, 659, 880]
              : [330, 277, 220],
            75,
            { volume: 0.07, type: "triangle" },
          );
        else if (world.extraction > 0 && !exit)
          bus.jingle([440, 660, 880], 75, { volume: 0.05, type: "triangle" });
        else if (done > progress || world.keyring.length > keys)
          bus.jingle([710, 944], 48, { volume: 0.045, type: "triangle" });
      }
      mission = identity;
      heardTick = world.tick;
      progress = done;
      keys = world.keyring.length;
      exit = world.extraction > 0;
      outcome = world.outcome;
      health = new Map(
        world.actors
          .filter((actor) => actor.seat !== null)
          .map((actor) => [actor.id, actor.hp]),
      );
    },
  };
}
