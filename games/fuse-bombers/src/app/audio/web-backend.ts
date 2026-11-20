import type { Cue } from "./cues.js";
import { MUSIC_FILES, type AudioBackend, type MusicKind } from "./director.js";

const MASTER = 0.7;
const MUSIC_VOLUME = 0.35;
const FADE_MS = 1200;
const FADE_TICK_MS = 50;

interface ToneRecipe {
  wave: OscillatorType;
  from: number;
  to?: number;
  duration: number;
  level: number;
  delay?: number;
}

interface BurstRecipe {
  filter: BiquadFilterType;
  from: number;
  to: number;
  duration: number;
  level: number;
  q?: number;
}

function chime(
  notes: readonly number[],
  recipe: Pick<ToneRecipe, "wave" | "duration" | "level"> & {
    gap: number;
    tail?: number;
  },
): ToneRecipe[] {
  const { wave, duration, level, gap, tail = duration } = recipe;
  return notes.map((from, index) => ({
    wave,
    from,
    duration: index === notes.length - 1 ? tail : duration,
    level,
    delay: index * gap,
  }));
}

const CHIMES = {
  crate: chime([660, 880, 1320], {
    wave: "square",
    duration: 0.12,
    level: 0.07,
    gap: 0.07,
  }),
  alarm: chime(
    Array.from({ length: 8 }, (_, index) => (index % 2 ? 660 : 880)),
    {
      wave: "square",
      duration: 0.2,
      level: 0.07,
      gap: 0.22,
    },
  ),
  win: chime([523, 659, 784, 1047], {
    wave: "square",
    duration: 0.14,
    level: 0.09,
    gap: 0.13,
    tail: 0.8,
  }),
  loss: chime([523, 440, 349], {
    wave: "triangle",
    duration: 0.14,
    level: 0.09,
    gap: 0.13,
    tail: 0.8,
  }),
};

type Layer = ToneRecipe | BurstRecipe;
const FIXED_CUES: Record<"shield" | "shield-pop" | "ghost", readonly Layer[]> =
  {
    shield: [
      { wave: "triangle", from: 1400, to: 1100, duration: 0.3, level: 0.1 },
      { wave: "sine", from: 2130, to: 1700, duration: 0.2, level: 0.05 },
    ],
    "shield-pop": [
      { wave: "triangle", from: 1600, to: 180, duration: 0.5, level: 0.14 },
      { filter: "highpass", from: 3000, to: 1500, duration: 0.3, level: 0.12 },
    ],
    // A rising "wooo" as the blimp appears.
    ghost: [
      { wave: "triangle", from: 330, to: 660, duration: 0.8, level: 0.1 },
      {
        wave: "sine",
        from: 495,
        to: 990,
        duration: 0.7,
        level: 0.05,
        delay: 0.08,
      },
    ],
  };

const HEAVY_LAUNCH: ToneRecipe = {
  wave: "square",
  from: 110,
  to: 330,
  duration: 0.3,
  level: 0.08,
};
const DESTROYED: ToneRecipe = {
  wave: "sawtooth",
  from: 440,
  to: 55,
  duration: 1.2,
  level: 0.1,
};

/**
 * Effects are synthesized on a Web Audio graph (voices → master gain → compressor), created on the first user
 * gesture since browsers keep audio blocked until then. Music streams through media elements that crossfade.
 */
export class WebAudioBackend implements AudioBackend {
  private context?: AudioContext;
  private master?: GainNode;
  private noise?: AudioBuffer;
  private hiss?: GainNode;
  private muted = false;
  private readonly elements = new Map<MusicKind, HTMLAudioElement>();
  private current: HTMLAudioElement | null = null;
  private fadeTimer: ReturnType<typeof setInterval> | undefined;

  /** `base` is the site's base URL, so tracks load under the Pages sub-path too. */
  constructor(
    private readonly base: string,
    private readonly externalMusic = false,
  ) {}

  now(): number {
    return performance.now() / 1000;
  }

  unlock(): void {
    try {
      if (!this.context) this.build(new AudioContext());
      this.resume(); // also iOS's "interrupted" after a call or a lock
    } catch {
      // No Web Audio here: music can still play through its media element.
    }
    if (this.current) this.start(this.current);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    const context = this.context;
    if (context && this.master)
      this.master.gain.setTargetAtTime(
        muted ? 0 : MASTER,
        context.currentTime,
        0.02,
      );
    if (muted) this.pauseMusic();
  }

  suspend(): void {
    this.pauseMusic();
    this.context?.suspend().catch(() => {
      // Already closed: nothing is sounding.
    });
  }

  resume(): void {
    const state = this.context?.state;
    if (state && state !== "running" && state !== "closed")
      this.context!.resume().catch(() => {
        // Not a gesture the browser accepts; the next one tries again.
      });
  }

  music(kind: MusicKind | null): void {
    if (this.externalMusic) return; // fuse-music owns the soundtrack.
    const next = kind ? this.element(kind) : null;
    // A track still fading out fades back in from where it is, without a restart.
    if (next && next !== this.current && next.paused) {
      next.currentTime = 0;
      next.volume = 0;
    }
    this.current = next;
    if (next) this.start(next);
    if (this.fadeTimer === undefined)
      this.fadeTimer = setInterval(() => this.fade(), FADE_TICK_MS);
  }

  sizzle(level: number): void {
    const context = this.context;
    if (!context || !this.master || !this.noise) return;
    if (!this.hiss) {
      if (level <= 0) return;
      const source = context.createBufferSource();
      source.buffer = this.noise;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = 4000;
      this.hiss = context.createGain();
      this.hiss.gain.value = 0;
      source.connect(filter).connect(this.hiss).connect(this.master);
      source.start();
    }
    this.hiss.gain.setTargetAtTime(level * 0.06, context.currentTime, 0.1);
  }

  play(cue: Cue): void {
    if (this.context?.state !== "running" || this.muted) return;
    const s = cue.size;
    switch (cue.kind) {
      case "launch":
        this.burst({
          filter: "bandpass",
          from: 300,
          to: 1800,
          duration: 0.2 + 0.15 * s,
          level: 0.12 + 0.18 * s,
          q: 1.5,
        });
        if (s >= 1) this.tone(HEAVY_LAUNCH);
        break;
      case "split": {
        // ×2, ×3, ×5, ×10 ring a root, third, fifth and octave.
        const p = cue.pitch;
        const semitones = p >= 10 ? 12 : p >= 5 ? 7 : p >= 3 ? 4 : 0;
        const freq = 660 * 2 ** (semitones / 12);
        this.tone({ wave: "triangle", from: freq, duration: 0.4, level: 0.16 });
        this.tone({
          wave: "sine",
          from: freq * 2,
          duration: 0.25,
          level: 0.07,
        });
        break;
      }
      case "explosion":
        this.boom(s);
        break;
      case "hit":
        this.tone({
          wave: "square",
          from: 220,
          to: 80,
          duration: 0.15,
          level: 0.08 + 0.08 * s,
        });
        break;
      case "shield":
      case "shield-pop":
      case "ghost":
        for (const layer of FIXED_CUES[cue.kind]) {
          if ("wave" in layer) this.tone(layer);
          else this.burst(layer);
        }
        break;
      case "crate":
      case "alarm":
        for (const recipe of CHIMES[cue.kind]) this.tone(recipe);
        break;
      case "destroyed":
        this.boom(1);
        this.tone(DESTROYED);
        break;
      case "drop":
        // The classic falling-bomb whistle.
        this.tone({
          wave: "sine",
          from: 1500,
          to: 600,
          duration: 0.45,
          level: 0.06 + 0.04 * s,
        });
        break;
      case "fanfare":
        for (const recipe of CHIMES[cue.pitch > 0 ? "win" : "loss"])
          this.tone(recipe);
        break;
    }
  }

  private build(context: AudioContext): void {
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    compressor.connect(context.destination);
    const master = context.createGain();
    master.gain.value = this.muted ? 0 : MASTER;
    master.connect(compressor);
    const rate = context.sampleRate;
    const noise = context.createBuffer(1, rate, rate); // one second, looped by the hiss
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    this.context = context;
    this.master = master;
    this.noise = noise;
  }

  /** A low thump under a lowpassed noise burst; bigger sounds longer, brighter and louder. */
  private boom(s: number): void {
    this.burst({
      filter: "lowpass",
      from: 1200 + 2400 * s,
      to: 90,
      duration: 0.25 + 0.6 * s,
      level: 0.2 + 0.3 * s,
    });
    this.tone({
      wave: "sine",
      from: 130,
      to: 38,
      duration: 0.2 + 0.35 * s,
      level: 0.12 + 0.3 * s,
    });
  }

  /** An oscillator with an optional glide. */
  private tone({
    wave,
    from,
    to,
    duration,
    level,
    delay = 0,
  }: ToneRecipe): void {
    const context = this.context!;
    const osc = context.createOscillator();
    const t = context.currentTime + delay;
    osc.type = wave;
    osc.frequency.setValueAtTime(from, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + duration);
    this.voice(osc, t, duration, level);
  }

  /** White noise through a filter with a sweeping cutoff. */
  private burst({
    filter,
    from,
    to,
    duration,
    level,
    q = 1,
  }: BurstRecipe): void {
    const context = this.context!;
    const source = context.createBufferSource();
    source.buffer = this.noise!;
    const t = context.currentTime;
    const biquad = context.createBiquadFilter();
    biquad.type = filter;
    biquad.Q.value = q;
    biquad.frequency.setValueAtTime(from, t);
    biquad.frequency.exponentialRampToValueAtTime(to, t + duration);
    source.connect(biquad);
    this.voice(source, t, duration, level, biquad);
  }

  /** Envelopes `source` (through `via`, if any) into the master bus and frees the nodes once it ends. */
  private voice(
    source: AudioScheduledSourceNode,
    t: number,
    dur: number,
    level: number,
    via: AudioNode = source,
  ): void {
    const context = this.context!;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, t);
    envelope.gain.linearRampToValueAtTime(level, t + 0.005);
    envelope.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    via.connect(envelope).connect(this.master!);
    source.onended = () => {
      source.disconnect();
      if (via !== source) via.disconnect();
      envelope.disconnect();
    };
    source.start(t);
    source.stop(t + dur + 0.02);
  }

  private element(kind: MusicKind): HTMLAudioElement {
    let element = this.elements.get(kind);
    if (!element) {
      element = new Audio(`${this.base}${MUSIC_FILES[kind]}`);
      element.loop = true;
      element.volume = 0;
      this.elements.set(kind, element);
    }
    return element;
  }

  private pauseMusic(): void {
    clearInterval(this.fadeTimer);
    this.fadeTimer = undefined;
    for (const element of this.elements.values()) element.pause();
  }

  private start(element: HTMLAudioElement): void {
    if (this.muted || !element.paused) return;
    element.play().catch(() => {
      // Autoplay blocked until a gesture; `unlock` starts it then.
    });
  }

  /** Moves every track one step toward its target volume: the current one up, the rest down and then paused. */
  private fade(): void {
    const step = (MUSIC_VOLUME * FADE_TICK_MS) / FADE_MS;
    let done = true;
    for (const element of this.elements.values()) {
      const target = element === this.current ? MUSIC_VOLUME : 0;
      const volume = element.volume;
      const next =
        volume < target
          ? Math.min(target, volume + step)
          : Math.max(target, volume - step);
      element.volume = next;
      if (next === 0 && element !== this.current) element.pause();
      if (next !== target) done = false;
    }
    if (!done) return;
    clearInterval(this.fadeTimer);
    this.fadeTimer = undefined;
  }
}
