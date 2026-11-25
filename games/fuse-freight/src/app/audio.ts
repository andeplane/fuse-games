import type { FxKind } from "../engine/view.js";
import type { Store } from "fuse-ui/room-session";

/**
 * Fuse Freight's sound: effects and a little chiptune soundtrack, all synthesised here, so there are no audio files
 * and nothing to license. Music and effects follow the preference every Fuse page shares (`fuse-riders-audio`: mute
 * and volume for each channel), start only after the first tap or key the browser allows, and a page opened with
 * `?mute` makes no sound and stores nothing.
 */
export const AUDIO_KEY = "fuse-riders-audio";
export const DEFAULT_VOLUME = { music: 0.22, effects: 0.45 };
export type Channel = "music" | "effects";
export interface AudioPrefs {
  muted: Record<Channel, boolean>;
  volume: Record<Channel, number>;
}
const CHANNELS: readonly Channel[] = ["music", "effects"];

/** `?mute` (any value but `0` or `false`) silences this load only, without touching the stored choice. */
export function mutedByQuery(search: string): boolean {
  const value = new URLSearchParams(search).get("mute");
  return value !== null && value !== "0" && value !== "false";
}

const volumeOf = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;

function stored(store: Store): Record<string, unknown> | undefined {
  try {
    const raw: unknown = JSON.parse(store.getItem(AUDIO_KEY) ?? "null");
    return raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** The stored choice, or the first-visit default: music off on a phone or tablet (as in Fuse Riders), effects on. */
export function loadPrefs(
  store: Store,
  musicOffByDefault: boolean,
): AudioPrefs {
  const prefs: AudioPrefs = {
    muted: { music: musicOffByDefault, effects: false },
    volume: { ...DEFAULT_VOLUME },
  };
  const raw = stored(store);
  if (!raw) return prefs;
  const { muted, volume } = raw;
  for (const channel of CHANNELS) {
    if (muted && typeof muted === "object")
      prefs.muted[channel] =
        (muted as Record<string, unknown>)[channel] === true;
    if (volume && typeof volume === "object")
      prefs.volume[channel] = volumeOf(
        (volume as Record<string, unknown>)[channel],
        DEFAULT_VOLUME[channel],
      );
  }
  return prefs;
}

/** Writes the mute and volume choice back, keeping whatever else another Fuse page keeps under the same key. */
export function savePrefs(store: Store, prefs: AudioPrefs): void {
  store.setItem(
    AUDIO_KEY,
    JSON.stringify({
      ...stored(store),
      muted: { ...prefs.muted },
      volume: { ...prefs.volume },
    }),
  );
}

export type Cue =
  FxKind | "count" | "go" | "whistle" | "win" | "final" | "full";
/** How busy the soundtrack is: the menus, a round, its last stretch, or silence. */
export type Mood = "off" | "menu" | "round" | "final";

export interface AudioDependencies {
  open(): AudioContext | undefined;
  later(run: () => void, ms: number): void;
  every(run: () => void, ms: number): () => void;
  /** For the noise buffer only. */
  random(): number;
}
const browser: AudioDependencies = {
  open: () =>
    typeof AudioContext === "undefined" ? undefined : new AudioContext(),
  later: (run, ms) => void setTimeout(run, ms),
  every: (run, ms) => {
    const id = setInterval(run, ms);
    return () => clearInterval(id);
  },
  random: Math.random,
};

const midi = (note: number) => 440 * Math.pow(2, (note - 69) / 12);

/** Four bars, C – Am – F – G: the bass's root for each, and the tune in eighths (null rests). */
const ROOTS = [48, 45, 41, 43];
const TUNE: readonly (readonly (number | null)[])[] = [
  [76, 79, 84, 79, 76, 74, 72, null],
  [69, 72, 76, 72, 69, 71, 72, null],
  [65, 69, 72, 77, 76, 74, 72, 69],
  [67, 71, 74, 79, 77, 76, 74, null],
];
const ANSWER: readonly (readonly (number | null)[])[] = [
  [72, null, 76, 79, 81, 79, 76, null],
  [72, null, 69, 72, 76, 74, 72, null],
  [69, 72, 77, 81, 79, 77, 76, 74],
  [74, 79, 83, 86, 84, 83, 79, null],
];
const TEMPO: Record<Exclude<Mood, "off">, number> = {
  menu: 108,
  round: 128,
  final: 146,
};

type Layer =
  | {
      kind: "tone";
      frequency: number;
      duration: number;
      type: OscillatorType;
      volume: number;
      slide?: number;
      offset?: number;
    }
  | {
      kind: "noise";
      frequency: number;
      duration: number;
      type: BiquadFilterType;
      volume: number;
      q?: number;
      offset?: number;
    };

const CHUG_ACCENTS = [1, 0.3, 0.55, 0.3];
const BAR_STEPS = 16;
const THEME_STEPS = BAR_STEPS * ROOTS.length;
const SONG_STEPS = 2 * THEME_STEPS;

function compileBeat(
  mood: Exclude<Mood, "off">,
  index: number,
): readonly Layer[] {
  const bar = Math.floor(index / BAR_STEPS) % ROOTS.length;
  const sixteenth = index % BAR_STEPS;
  const busy = mood !== "menu";
  const accent = CHUG_ACCENTS[sixteenth % CHUG_ACCENTS.length]!;
  // Steam accents mark the rail joints.
  const layers: Layer[] = [
    {
      kind: "noise",
      duration: 0.05,
      volume: (busy ? 0.18 : 0.1) * accent,
      type: "bandpass",
      frequency: 2200,
      q: 1.2,
    },
  ];
  if (sixteenth % 8 === 0)
    layers.push({
      kind: "tone",
      frequency: 120,
      duration: 0.22,
      type: "sine",
      volume: busy ? 0.5 : 0.3,
      slide: 0.35,
    });
  if (busy && sixteenth % 8 === 4)
    layers.push({
      kind: "noise",
      duration: 0.12,
      volume: 0.16,
      type: "highpass",
      frequency: 2400,
    });
  if (mood === "final" && sixteenth % 2 === 1)
    layers.push({
      kind: "noise",
      duration: 0.03,
      volume: 0.08,
      type: "highpass",
      frequency: 7000,
    });
  if (sixteenth % 2 === 0) {
    const root = ROOTS[bar]!;
    const bass = sixteenth % 4 === 0 ? root : root + 7;
    layers.push({
      kind: "tone",
      frequency: midi(bass - 12),
      duration: 0.2,
      type: "triangle",
      volume: 0.34,
    });
    // The answer comes in every other repeat in a round.
    const tune = busy && index >= THEME_STEPS ? ANSWER : TUNE;
    const note = tune[bar]![sixteenth / 2];
    if (note !== null && note !== undefined)
      layers.push({
        kind: "tone",
        frequency: midi(note),
        duration: 0.16,
        type: busy ? "square" : "triangle",
        volume: busy ? 0.07 : 0.1,
      });
  }
  if (mood === "final" && sixteenth === 0)
    layers.push(
      {
        kind: "tone",
        frequency: 880,
        duration: 0.18,
        type: "sine",
        volume: 0.08,
      },
      {
        kind: "tone",
        frequency: 1109,
        duration: 0.18,
        type: "sine",
        volume: 0.06,
      },
    );
  return layers;
}

const SOUNDTRACK = {
  menu: Array.from({ length: THEME_STEPS }, (_, index) =>
    compileBeat("menu", index),
  ),
  round: Array.from({ length: SONG_STEPS }, (_, index) =>
    compileBeat("round", index),
  ),
  final: Array.from({ length: SONG_STEPS }, (_, index) =>
    compileBeat("final", index),
  ),
};

const EFFECTS: Record<
  Exclude<Cue, "go" | "whistle" | "win">,
  readonly Layer[]
> = {
  collect: [
    {
      kind: "tone",
      frequency: 784,
      duration: 0.08,
      type: "triangle",
      volume: 0.28,
    },
    {
      kind: "tone",
      frequency: 1175,
      duration: 0.12,
      type: "triangle",
      volume: 0.24,
      offset: 0.06,
    },
  ],
  // The coupling snaps with a metal clank and a spark of hiss.
  cut: [
    {
      kind: "tone",
      frequency: 330,
      duration: 0.18,
      type: "square",
      volume: 0.16,
      slide: 0.45,
    },
    {
      kind: "tone",
      frequency: 1560,
      duration: 0.09,
      type: "square",
      volume: 0.08,
      slide: 0.7,
    },
    {
      kind: "noise",
      duration: 0.22,
      volume: 0.35,
      type: "bandpass",
      frequency: 2600,
      q: 2,
    },
  ],
  deliver: [
    ...[72, 76, 79, 84].map((note, i) => ({
      kind: "tone" as const,
      frequency: midi(note),
      duration: 0.3,
      type: "square" as const,
      volume: 0.1,
      offset: i * 0.07,
    })),
    {
      kind: "tone",
      frequency: midi(96),
      duration: 0.5,
      type: "sine",
      volume: 0.14,
      offset: 0.3,
    },
    {
      kind: "noise",
      duration: 0.12,
      volume: 0.12,
      type: "highpass",
      frequency: 6000,
      offset: 0.28,
    },
  ],
  bump: [
    {
      kind: "tone",
      frequency: 150,
      duration: 0.16,
      type: "sine",
      volume: 0.4,
      slide: 0.5,
    },
    {
      kind: "noise",
      duration: 0.1,
      volume: 0.2,
      type: "lowpass",
      frequency: 900,
    },
    {
      kind: "tone",
      frequency: 620,
      duration: 0.06,
      type: "square",
      volume: 0.05,
    },
  ],
  wall: [
    {
      kind: "tone",
      frequency: 110,
      duration: 0.12,
      type: "sine",
      volume: 0.28,
      slide: 0.6,
    },
    {
      kind: "noise",
      duration: 0.08,
      volume: 0.12,
      type: "lowpass",
      frequency: 700,
    },
  ],
  spawn: [
    {
      kind: "tone",
      frequency: 523,
      duration: 0.05,
      type: "triangle",
      volume: 0.06,
    },
  ],
  scrap: [
    {
      kind: "noise",
      duration: 0.3,
      volume: 0.2,
      type: "bandpass",
      frequency: 1200,
      q: 3,
    },
  ],
  full: [
    {
      kind: "tone",
      frequency: 392,
      duration: 0.1,
      type: "square",
      volume: 0.08,
    },
    {
      kind: "tone",
      frequency: 392,
      duration: 0.1,
      type: "square",
      volume: 0.08,
      offset: 0.1,
    },
  ],
  count: [
    {
      kind: "tone",
      frequency: 660,
      duration: 0.12,
      type: "square",
      volume: 0.1,
    },
  ],
  final: [
    {
      kind: "tone",
      frequency: 1318,
      duration: 0.5,
      type: "sine",
      volume: 0.18,
    },
    {
      kind: "tone",
      frequency: 1318,
      duration: 0.5,
      type: "sine",
      volume: 0.14,
      offset: 0.25,
    },
  ],
};

export interface GameAudio {
  /** A gesture happened: open or wake the audio, and start the music if it is due. */
  resume(): void;
  play(cue: Cue): void;
  mood(next: Mood): void;
  setMuted(channel: Channel, muted: boolean): void;
  readonly prefs: AudioPrefs;
  /** The query muted this page: nothing plays and nothing may be stored. */
  readonly silenced: boolean;
  /** The browser lets this page make sound now (it has had its gesture). */
  running(): boolean;
}

export function createAudio(
  silenced: boolean,
  prefs: AudioPrefs,
  deps: AudioDependencies = browser,
): GameAudio {
  let context: AudioContext | undefined,
    musicBus: GainNode | undefined,
    effectsBus: GainNode | undefined,
    noiseBuffer: AudioBuffer | undefined,
    stopClock: (() => void) | undefined,
    mood: Mood = "off",
    step = 0,
    nextAt = 0,
    unavailable = false;
  const open = () => {
    if (silenced || unavailable) return undefined;
    if (!context) {
      // A browser that refuses an audio context is asked once, not on every key press.
      try {
        context = deps.open();
      } catch {
        context = undefined;
      }
      if (!context) {
        unavailable = true;
        return undefined;
      }
      musicBus = context.createGain();
      effectsBus = context.createGain();
      musicBus.connect(context.destination);
      effectsBus.connect(context.destination);
      levels();
      const length = context.sampleRate;
      noiseBuffer = context.createBuffer(1, length, context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = deps.random() * 2 - 1;
    }
    return context;
  };
  const levels = () => {
    if (musicBus)
      musicBus.gain.value = prefs.muted.music ? 0 : prefs.volume.music * 1.1;
    if (effectsBus)
      effectsBus.gain.value = prefs.muted.effects
        ? 0
        : prefs.volume.effects * 1.2;
  };
  const live = () =>
    context && context.state === "running" ? context : undefined;

  const tone = (
    bus: GainNode | undefined,
    at: number,
    frequency: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    slide = 1,
  ) => {
    const audio = live();
    if (!audio || !bus) return;
    const osc = audio.createOscillator(),
      gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, at);
    if (slide !== 1)
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(30, frequency * slide),
        at + duration,
      );
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(volume, at + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain).connect(bus);
    osc.start(at);
    osc.stop(at + duration + 0.03);
  };
  const noise = (
    bus: GainNode | undefined,
    at: number,
    duration: number,
    volume: number,
    type: BiquadFilterType,
    frequency: number,
    q = 1,
  ) => {
    const audio = live();
    if (!audio || !bus || !noiseBuffer) return;
    const source = audio.createBufferSource(),
      filter = audio.createBiquadFilter(),
      gain = audio.createGain();
    source.buffer = noiseBuffer;
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter).connect(gain).connect(bus);
    source.start(at, (step * 0.137) % 0.5);
    source.stop(at + duration + 0.02);
  };

  const playLayers = (
    bus: GainNode | undefined,
    at: number,
    layers: readonly Layer[],
  ) => {
    for (const layer of layers) {
      const start = layer.offset === undefined ? at : at + layer.offset;
      if (layer.kind === "tone")
        tone(
          bus,
          start,
          layer.frequency,
          layer.duration,
          layer.type,
          layer.volume,
          layer.slide,
        );
      else
        noise(
          bus,
          start,
          layer.duration,
          layer.volume,
          layer.type,
          layer.frequency,
          layer.q,
        );
    }
  };
  /** One sixteenth of the soundtrack at `at`. */
  const beat = (at: number, index: number) => {
    if (mood === "off") return;
    const track = SOUNDTRACK[mood];
    playLayers(musicBus, at, track[index % track.length]!);
  };
  const schedule = () => {
    const audio = live();
    if (!audio || mood === "off" || prefs.muted.music) return;
    if (nextAt < audio.currentTime) nextAt = audio.currentTime + 0.05;
    const sixteenth = 60 / TEMPO[mood] / 4;
    while (nextAt < audio.currentTime + 0.14) {
      beat(nextAt, step++);
      nextAt += sixteenth;
    }
  };
  const clock = () => {
    const due = mood !== "off" && !prefs.muted.music && !!live();
    if (due && !stopClock) stopClock = deps.every(schedule, 25);
    if (!due && stopClock) {
      stopClock();
      stopClock = undefined;
    }
  };

  const whistle = (at: number, length: number) => {
    // A steam whistle: a bright chord bent up into pitch, over a hiss.
    for (const [f, v] of [
      [587, 0.09],
      [740, 0.07],
      [880, 0.05],
    ] as const) {
      const audio = live();
      if (!audio || !effectsBus) return;
      const osc = audio.createOscillator(),
        gain = audio.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(f * 0.94, at);
      osc.frequency.linearRampToValueAtTime(f, at + 0.08);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.linearRampToValueAtTime(v, at + 0.05);
      gain.gain.setValueAtTime(v, at + length - 0.1);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
      const filter = audio.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 2400;
      osc.connect(filter).connect(gain).connect(effectsBus);
      osc.start(at);
      osc.stop(at + length + 0.05);
    }
    noise(effectsBus, at, length, 0.08, "bandpass", 3200, 0.8);
  };

  return {
    prefs,
    silenced,
    running: () => !!live(),
    resume() {
      const audio = open();
      if (!audio) return;
      if (audio.state !== "running") void audio.resume().then(clock, () => {});
      else clock();
    },
    mood(next) {
      if (next === mood) return;
      mood = next;
      clock();
    },
    setMuted(channel, muted) {
      prefs.muted[channel] = muted;
      levels();
      clock();
    },
    play(cue) {
      const audio = live();
      if (!audio || prefs.muted.effects) return;
      const at = audio.currentTime,
        fx = effectsBus;
      switch (cue) {
        case "go":
          whistle(at, 0.6);
          break;
        case "whistle":
          whistle(at, 1.1);
          break;
        case "win":
          [72, 76, 79, 84, 79, 84].forEach((note, i) =>
            deps.later(
              () =>
                tone(
                  fx,
                  live()?.currentTime ?? at,
                  midi(note),
                  0.2,
                  "square",
                  0.1,
                ),
              i * 110,
            ),
          );
          break;
        default:
          if (Object.hasOwn(EFFECTS, cue)) playLayers(fx, at, EFFECTS[cue]);
      }
    },
  };
}
