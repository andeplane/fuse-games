import type { GameAudio, NoiseOptions, ToneOptions } from "fuse-ui/game-audio";
import type { MissionState } from "../sim/index.js";

type Bus = Pick<GameAudio, "tone" | "noise" | "jingle">;

type Layer = (NoiseOptions | ToneOptions) & { volume: number };

function gunshot(duration: number, cutoff: number, frequency: number): Layer[] {
  return [
    { duration, cutoff, volume: 0.18 },
    { frequency, duration: 0.1, slide: 0.25, type: "triangle", volume: 0.12 },
  ];
}

const spray = (cutoff: number): Layer[] => [
  { duration: 0.14, cutoff, volume: 0.12 },
];

const zap = (frequency: number): Layer[] => [
  { frequency, duration: 0.125, type: "sawtooth", slide: 0.22, volume: 0.055 },
];

const LOW_ZAP = zap(510);
/** Voice layers in playback order, keyed by the campaign weapon index. */
const WEAPON_LAYERS = new Map<number, readonly Layer[]>([
  [0, [{ duration: 0.065, cutoff: 2300, volume: 0.11 }]], // knife
  [1, gunshot(0.06, 4300, 153)], // machine gun
  [3, spray(1900)], // flamer
  [4, gunshot(0.15, 4300, 104)], // shotgun
  [5, LOW_ZAP], // powergun
  [8, gunshot(0.06, 6400, 153)], // sniper
  [12, zap(870)], // petrify gun
  [13, LOW_ZAP], // browny gun
  [15, spray(3600)], // chemo gun
]);
const DEFAULT_LAYERS: readonly Layer[] = [
  {
    frequency: 275,
    duration: 0.065,
    type: "triangle",
    slide: 0.46,
    volume: 0.1,
  },
  { duration: 0.045, cutoff: 2100, volume: 0.06 },
];

/** Short procedural voices; the shared effects bus controls volume, gesture unlock and mute. */
function weaponSound(bus: Bus, weapon: number, gain: number): void {
  for (const layer of WEAPON_LAYERS.get(weapon) ?? DEFAULT_LAYERS) {
    const volume = layer.volume * gain;
    if ("frequency" in layer) bus.tone({ ...layer, volume });
    else bus.noise({ ...layer, volume });
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
