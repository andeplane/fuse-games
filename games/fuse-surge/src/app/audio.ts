import type { GameAudio, ToneOptions } from "fuse-ui/game-audio";
import type { Cue } from "../render/cues.js";

/** The local rider's jump and stance changes. Spectators hear every rider. */
const MOVES = {
  jump: {
    frequency: 300,
    duration: 0.11,
    type: "square",
    volume: 0.035,
    slide: 1.9,
  },
  duck: {
    frequency: 240,
    duration: 0.08,
    type: "square",
    volume: 0.03,
    slide: 0.55,
  },
  double: {
    frequency: 620,
    duration: 0.1,
    type: "square",
    volume: 0.045,
    slide: 1.5,
  },
  land: { frequency: 95, duration: 0.07, volume: 0.05, slide: 0.7 },
} satisfies Record<"jump" | "duck" | "double" | "land", ToneOptions>;

const SIGNALS = {
  flip: {
    frequency: 880,
    duration: 0.07,
    type: "square",
    volume: 0.03,
    slide: 0.7,
  },
  count: { frequency: 440, duration: 0.12, type: "square", volume: 0.05 },
  go: { frequency: 880, duration: 0.3, type: "square", volume: 0.06 },
  tick: { frequency: 660, duration: 0.05, type: "square", volume: 0.04 },
  volley: {
    frequency: 300,
    duration: 0.16,
    type: "sawtooth",
    volume: 0.05,
    slide: 0.5,
  },
} satisfies Record<"flip" | "count" | "go" | "tick" | "volley", ToneOptions>;

const HIT = {
  stumble: {
    frequency: 140,
    duration: 0.2,
    type: "sawtooth",
    volume: 0.09,
    slide: 0.5,
  },
  out: {
    frequency: 180,
    duration: 0.5,
    type: "sawtooth",
    volume: 0.09,
    slide: 0.25,
  },
} satisfies Record<"stumble" | "out", ToneOptions>;

const JINGLES = {
  tall: [[392, 587], 90, { type: "square", volume: 0.045 }],
  recover: [[523, 659, 784], 70, { type: "triangle", volume: 0.05 }],
  last: [[523, 659, 784, 1046], 90, { volume: 0.06 }],
  round: [[659, 587, 659], 110, { type: "triangle", volume: 0.05 }],
  over: [[523, 659, 784, 1046, 1318], 110, { volume: 0.06 }],
  encore: [[392, 523, 659, 784, 1046], 110, { type: "triangle", volume: 0.05 }],
} satisfies Record<
  "tall" | "recover" | "last" | "round" | "over" | "encore",
  Parameters<GameAudio["jingle"]>
>;

const NOISE = {
  volley: { duration: 0.09, volume: 0.07, cutoff: 5200 },
  hit: { duration: 0.18, volume: 0.16, cutoff: 2600 },
};
const DUCK = {
  out: { keep: 0.4, hold: 600 },
  round: { keep: 0.3, hold: 900 },
  over: { keep: 0.2, hold: 2200 },
};

/** Sounds are synthesised through the shared audio bus. */
export interface Sfx {
  /** Sounds `cue`; `local` is this device's rider slot, or −1 when it has none. */
  play(cue: Cue, local: number): void;
}

export function createSfx(audio: GameAudio): Sfx {
  const { tone, noise } = audio;
  function jingle([
    notes,
    gap,
    options,
  ]: (typeof JINGLES)[keyof typeof JINGLES]) {
    audio.jingle([...notes], gap, { ...options });
  }
  return {
    play(cue, local) {
      switch (cue.kind) {
        case "jump":
        case "duck":
        case "double":
        case "land":
          if (local < 0 || cue.slot === local) tone({ ...MOVES[cue.kind] });
          return;
        case "count":
          if (cue.seconds > 0) tone({ ...SIGNALS.count });
          return;
        case "flip":
        case "go":
        case "tick":
          tone({ ...SIGNALS[cue.kind] });
          return;
        case "volley":
          noise({ ...NOISE.volley });
          tone({ ...SIGNALS.volley });
          return;
        case "tall":
        case "recover":
          jingle(JINGLES[cue.kind]);
          return;
        case "dodge":
          // A clean dodge chimes, a step higher for every one in the streak.
          if (cue.slot === local && cue.streak > 0)
            tone({
              frequency: 520 * 2 ** (Math.min(cue.streak, 5) / 12),
              duration: 0.06,
              type: "triangle",
              volume: 0.03,
            });
          return;
        case "hit":
          noise({ ...NOISE.hit });
          tone({ ...HIT[cue.out ? "out" : "stumble"] });
          if (cue.out) audio.duck({ ...DUCK.out });
          return;
        case "round":
          audio.duck({ ...DUCK.round });
          jingle(JINGLES[cue.reason === "last" ? "last" : "round"]);
          return;
        case "over":
          audio.duck({ ...DUCK.over });
          jingle(JINGLES.over);
          jingle(JINGLES.encore);
      }
    },
  };
}
