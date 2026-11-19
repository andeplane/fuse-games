import type { GameAudio } from "fuse-ui/game-audio";
import type { RaceState } from "../game/sim/race.js";

/** Pitches measured from GAME.EXE's PC-speaker PIT table. Web Audio supplies the envelopes. */
const C2 = 65.4;
type RaceSpeaker = Pick<GameAudio, "hum" | "tone" | "jingle">;
type TruckAudio = Pick<
  RaceState["trucks"][number],
  | "motion"
  | "slot"
  | "nitrosUsed"
  | "cash"
  | "wallTicks"
  | "contactMask"
  | "finishedTick"
  | "laps"
>;
interface AudioRace {
  battle?: RaceState["battle"];
  tick: number;
  phase: RaceState["phase"];
  pickups: Pick<RaceState["pickups"], "active">;
  trucks: readonly TruckAudio[];
}

/** Use the folded view for the motor. Ignore replayed ticks and rebaseline discrete cues after recovery. */
export function createOffroadAudio(bus: RaceSpeaker) {
  const motor = bus.hum({ type: "sawtooth", sub: "triangle", cutoff: 310 });
  let match = "",
    revision = -1,
    latest = -1,
    previous: AudioRace | undefined;
  let motorPitch = 0,
    motorVolume = 0;
  function engine(pitch: number, volume: number) {
    motorPitch = pitch;
    motorVolume = volume;
    // Even an unchanged target must be re-applied after audio unlock or tab visibility changes.
    motor.set(pitch, volume);
  }
  const beep = (
    frequency: number,
    duration: number,
    volume = 0.12,
    slide = 1,
  ) => bus.tone({ type: "square", frequency, duration, volume, slide });
  const notes = (tones: number[], gap: number) =>
    bus.jingle(tones, gap, {
      type: "square",
      volume: 0.12,
      duration: gap / 1000 + 0.012,
    });

  function observe(
    scope: string,
    race: AudioRace | undefined,
    focus: number,
    version: number,
  ) {
    if (!race) {
      if (motorVolume) engine(motorPitch, 0);
      return;
    }
    const truck = race.trucks[focus];
    if (race.phase === "racing" && truck && !truck.finishedTick) {
      // The continuous motor is a Fuse mix: revs follow the selected truck's integer speed and pedal.
      const speed = Math.min(240, truck.motion.speed) / 240,
        gas = truck.motion.throttle / 256;
      engine(38 + speed * 85 + gas * 8, 0.018 + speed * 0.02 + gas * 0.01);
    } else if (motorVolume) engine(motorPitch, 0);

    if (match !== scope) {
      match = scope;
      revision = version;
      latest = race.tick;
      previous = race;
      return;
    }
    if (revision !== version) {
      revision = version;
      latest = Math.max(latest, race.tick);
      previous = undefined;
      return;
    }
    if (race.tick <= latest) return;
    const last = previous;
    const elapsed = race.tick - latest;
    previous = race;
    latest = race.tick;
    if (!last || elapsed > 5) return;
    if (last.phase === "countdown" && race.phase === "racing")
      notes([C2, C2 * 2], 32);
    if (last.phase !== "finished" && race.phase === "finished") {
      notes([C2, C2 * 1.5, C2 * 2, C2 * 4, C2 * 6, C2 * 8], 38);
      return;
    }
    if (last.phase !== "racing" || race.phase !== "racing") return;
    if (race.battle && last.battle) {
      if (
        race.battle.bombs.some(
          (bomb) => last.tick < bomb.detonateAt && bomb.detonateAt <= race.tick,
        )
      )
        beep(144, 0.19, 0.13, 0.15);
      else if (
        (race.battle.slots[focus]?.shieldUntil ?? 0) >
        (last.battle.slots[focus]?.shieldUntil ?? 0)
      )
        notes([262, 392, 524], 32);
    }
    let impact = false,
      wall = false,
      nitro = false,
      finalLap = false,
      pickupSlot = -1;
    for (const now of race.trucks) {
      const then = last.trucks[now.slot];
      if (!then) continue;
      const fired = now.nitrosUsed - then.nitrosUsed;
      nitro ||= fired > 0;
      finalLap ||= then.laps < 3 && now.laps === 3;
      impact ||= Boolean(
        now.contactMask & ~then.contactMask & ~(1 << now.slot),
      );
      wall ||= now.wallTicks > 0 && now.wallTicks <= elapsed;
      // Nitro inventory may go down and up in one delivered frame.
      if (
        now.slot !== 3 &&
        (now.cash !== then.cash ||
          now.motion.nitros + fired > then.motion.nitros)
      )
        pickupSlot = now.slot;
    }
    // The DOS speaker is monophonic; a busier corner should not multiply the sound level.
    if (finalLap) notes([C2, C2 * 1.122, C2, C2 * 1.122], 42);
    else if (pickupSlot >= 0)
      beep([C2 * 2, C2 * 4, C2 * 0.5, C2, C2 * 3][pickupSlot] ?? C2 * 2, 0.15);
    else if (race.pickups.active && !last.pickups.active)
      notes([C2, C2 * 16, C2 * 8], 28);
    else if (nitro) beep(C2 * 8, 0.16, 0.14, 0.09);
    else if (impact) beep(C2, 0.065, 0.14);
    else if (wall) beep(C2 / 2, 0.045, 0.09);
  }
  return {
    observe,
    stop() {
      if (motorVolume) engine(motorPitch, 0);
      previous = undefined;
    },
  };
}
