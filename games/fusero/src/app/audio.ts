/** Original Classic samples. Source bytes and native aliases are documented in upstream/SOUNDS.md. */
export const CLASSIC_SOUND_ASSETS = [
  {
    file: "Bazooka.ogg",
    references: ["Bazooka.wav"],
    sha256: "411a1c331d6324ec6af8112d0efc20851ba1edf849484ddfd5ff16ffb50f6d78",
  },
  {
    file: "Larpa.ogg",
    references: ["Larpa.wav"],
    sha256: "6979ba297e360803a633b03613537217cee2a481a3821fe422e943dc95402920",
  },
  {
    file: "Shot.ogg",
    references: ["Shot.wav"],
    sha256: "d24d415c8eaa38035c4730335e73574cf082b1d5d1dfc9c5c748c3037a1cde92",
  },
  {
    file: "Shotgun.ogg",
    references: ["Shotgun.wav"],
    sha256: "76dca73e416d2d33e5f7fb8495a2f1a51d719c70766026cf959ede4f9cf966c3",
  },
  {
    file: "blaster.ogg",
    references: ["Blaster.wav"],
    sha256: "0c462a2bf2c27a54ad6dec6539787205f62c66fa38e9c2fc5a0ed8b6fc5bfb3d",
  },
  {
    file: "exp2.ogg",
    references: ["Exp2.wav"],
    sha256: "334ad9c4f904cad04fe994f902030a971521b6d95f2724ba967b21d08e8ec1e6",
  },
  {
    file: "exp3.ogg",
    references: ["Exp3.wav"],
    sha256: "d6b256f0e7e9e3930224442d5e7a3255e361b3d5b2b9bc69516be4dffa077d20",
  },
  {
    file: "exp3a.ogg",
    references: ["Exp3a.wav", "exp3a.wav"],
    sha256: "df3e65c56cc8c185955b27ba9ff8b2301dd06b1dc74ae0363ce393a570ae91eb",
  },
  {
    file: "rifle.ogg",
    references: ["Rifle.wav"],
    sha256: "f5be2aa40a2ae3539b87fe64be65bdc095b027545eda1a95fb71c171b3563cd7",
  },
  {
    file: "sm_explode.ogg",
    references: ["sm_explode.wav"],
    sha256: "8e240547d81353abd46bf6ce1912337b38e13efbb9cec8e5796e7a6e2b007d3c",
  },
  {
    file: "throw.ogg",
    references: ["Throw.wav", "throw.wav"],
    sha256: "08f3a84e17e7e7623d8eb75e5569d745240ea9a06c08b5f649c157a2baf755b8",
  },
] as const;

const sounds = new Map<string, string>();
for (const asset of CLASSIC_SOUND_ASSETS) {
  sounds.set(asset.file.toLowerCase(), asset.file);
  for (const reference of asset.references)
    sounds.set(reference.toLowerCase(), asset.file);
}
/** Only bundled mod references resolve. Network-provided strings cannot become arbitrary fetch URLs. */
export const classicSoundFile = (reference: string): string | undefined =>
  sounds.get(reference.toLowerCase());

export interface SoundEffect {
  readonly id: number;
  readonly sound?: string;
}
export interface FuseroVoice {
  stop(): void;
}
export interface FuseroAudioSurface<Buffer> {
  resume(): Promise<void>;
  suspend(): Promise<void>;
  decode(bytes: ArrayBuffer): Promise<Buffer>;
  play(buffer: Buffer, ended: () => void): FuseroVoice;
  close(): Promise<void>;
}
export interface FuseroAudioDependencies<Buffer> {
  readonly base: string;
  readonly forcedMute?: boolean;
  readonly initiallyEnabled?: boolean;
  now(): number;
  open(): FuseroAudioSurface<Buffer> | undefined;
  fetch(
    url: string,
    signal: AbortSignal,
  ): Promise<{ readonly ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }>;
}
export interface FuseroAudioSnapshot {
  readonly enabled: boolean;
  readonly unlocked: boolean;
  readonly visible: boolean;
  readonly loaded: number;
  readonly loading: number;
  readonly voices: number;
  readonly last: readonly {
    readonly effectId: number;
    readonly sound: string;
  }[];
  readonly failed: readonly string[];
}
export interface FuseroAudio {
  readonly forcedMute: boolean;
  enabled(): boolean;
  setEnabled(enabled: boolean): void;
  onChange(changed: () => void): () => void;
  unlock(): Promise<void>;
  observe(effects: readonly SoundEffect[], matchId: string): Promise<void>;
  setVisible(visible: boolean): void;
  snapshot(): FuseroAudioSnapshot;
  dispose(): void;
}

/**
 * Presentation only: effects already name the native UseSound branch. Speculative and confirmed
 * observations share (match,id), so rollback never plays a shot twice. No gameplay state is changed.
 */
export function createFuseroAudio<Buffer>(
  deps: FuseroAudioDependencies<Buffer>,
): FuseroAudio {
  const forcedMute = deps.forcedMute === true;
  let wanted = deps.initiallyEnabled !== false,
    visible = true,
    unlocked = false,
    disposed = false;
  let surface: FuseroAudioSurface<Buffer> | undefined,
    unlocking: Promise<void> | undefined;
  let match = "",
    epoch = 0,
    activation = 0,
    unlockingActivation = -1,
    seenFloor = -1;
  const seen = new Set<number>(),
    buffers = new Map<string, Buffer>();
  const loads = new Map<string, Promise<Buffer | undefined>>(),
    failures = new Map<string, number>();
  const requests = new Set<AbortController>(),
    voices = new Map<FuseroVoice, string>();
  const listeners = new Set<() => void>(),
    last: { effectId: number; sound: string }[] = [];
  const enabled = () => !disposed && !forcedMute && wanted;
  const active = () => enabled() && visible && unlocked;
  const stopVoices = () => {
    for (const voice of voices.keys()) voice.stop();
    voices.clear();
  };
  const suspend = () => {
    epoch++;
    activation++;
    unlocked = false;
    stopVoices();
    void surface?.suspend().catch(() => {});
  };
  const load = (file: string): Promise<Buffer | undefined> => {
    const cached = buffers.get(file);
    if (cached !== undefined) return Promise.resolve(cached);
    const pending = loads.get(file);
    if (pending) return pending;
    const failed = failures.get(file);
    if (failed !== undefined && deps.now() - failed < 5000)
      return Promise.resolve(undefined);
    const audio = surface;
    if (!audio) return Promise.resolve(undefined);
    const controller = new AbortController();
    requests.add(controller);
    const base = deps.base.endsWith("/") ? deps.base : `${deps.base}/`;
    const next = Promise.resolve()
      .then(() => deps.fetch(`${base}fusero/audio/${file}`, controller.signal))
      .then((response) => {
        if (!response.ok) throw new Error("Sample fetch failed");
        return response.arrayBuffer();
      })
      .then((bytes) => audio.decode(bytes))
      .then((buffer) => {
        if (!disposed) {
          buffers.set(file, buffer);
          failures.delete(file);
        }
        return buffer;
      })
      .catch(() => {
        if (!disposed && !controller.signal.aborted)
          failures.set(file, deps.now());
        return undefined;
      })
      .finally(() => {
        requests.delete(controller);
        loads.delete(file);
      });
    loads.set(file, next);
    return next;
  };
  const api: FuseroAudio = {
    forcedMute,
    enabled,
    setEnabled(value) {
      if (disposed || forcedMute || value === wanted) return;
      wanted = value;
      if (!value) suspend();
      else void api.unlock();
      for (const changed of listeners) changed();
    },
    onChange(changed) {
      listeners.add(changed);
      return () => listeners.delete(changed);
    },
    unlock() {
      if (!enabled() || !visible) return Promise.resolve();
      if (unlocked) return Promise.resolve();
      if (unlocking)
        return unlockingActivation === activation
          ? unlocking
          : unlocking.then(() => api.unlock());
      try {
        surface ??= deps.open();
      } catch {
        return Promise.resolve();
      }
      const audio = surface;
      if (!audio) return Promise.resolve();
      const currentActivation = activation;
      unlockingActivation = activation;
      unlocking = audio
        .resume()
        .then(() => {
          if (currentActivation === activation && enabled() && visible)
            unlocked = true;
        })
        .catch(() => {})
        .finally(() => {
          unlocking = undefined;
        });
      return unlocking;
    },
    async observe(effects, matchId) {
      if (disposed || !matchId) return;
      if (match !== matchId) {
        match = matchId;
        seen.clear();
        seenFloor = -1;
        epoch++;
        stopVoices();
      }
      const currentEpoch = epoch,
        now = deps.now();
      const due: Promise<void>[] = [];
      for (const effect of effects) {
        if (
          !Number.isSafeInteger(effect.id) ||
          effect.id <= seenFloor ||
          effect.id < 0 ||
          seen.has(effect.id)
        )
          continue;
        // Some effect slots gain their final metadata on correction. Do not consume a silent slot.
        if (effect.sound === undefined) continue;
        seen.add(effect.id);
        if (seen.size > 4096) {
          const oldest = seen.values().next().value!;
          seen.delete(oldest);
          seenFloor = Math.max(seenFloor, oldest);
        }
        const file = classicSoundFile(effect.sound);
        if (!file || !active()) continue;
        due.push(
          load(file)
            .then((buffer) => {
              // Old fetch/decode work cannot make a burst after mute, a hidden tab, resync or a new match.
              if (
                buffer === undefined ||
                !surface ||
                currentEpoch !== epoch ||
                match !== matchId ||
                !active() ||
                deps.now() - now > 350
              )
                return;
              // CGameScript::LoadGSSample requests maxplaying=10 for each original sample.
              if (
                [...voices.values()].filter((value) => value === file).length >=
                10
              )
                return;
              let voice: FuseroVoice | undefined,
                ended = false;
              voice = surface.play(buffer, () => {
                ended = true;
                if (voice) voices.delete(voice);
              });
              if (!ended) voices.set(voice, file);
              last.push({ effectId: effect.id, sound: file });
              if (last.length > 16) last.shift();
            })
            .catch(() => {}),
        );
      }
      await Promise.all(due);
    },
    setVisible(value) {
      if (disposed || visible === value) return;
      visible = value;
      if (!visible) suspend();
      else if (surface) void api.unlock();
    },
    snapshot: () => ({
      enabled: enabled(),
      unlocked,
      visible,
      loaded: buffers.size,
      loading: loads.size,
      voices: voices.size,
      last: last.map((value) => ({ ...value })),
      failed: [...failures.keys()],
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      epoch++;
      unlocked = false;
      stopVoices();
      for (const request of requests) request.abort();
      requests.clear();
      buffers.clear();
      loads.clear();
      listeners.clear();
      seen.clear();
      void surface?.close().catch(() => {});
    },
  };
  return api;
}

/** Browser capability supplied explicitly by the composition root; tests use the same small public interface. */
export function createWebAudioSurface(
  open: () => AudioContext | undefined,
): FuseroAudioSurface<AudioBuffer> | undefined {
  const context = open();
  if (!context) return undefined;
  return {
    resume: () => context.resume(),
    suspend: () => context.suspend(),
    decode: (bytes) => context.decodeAudioData(bytes),
    close: () => context.close(),
    play(buffer, ended) {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => {
        source.disconnect();
        ended();
      };
      source.start();
      let stopped = false;
      return {
        stop() {
          if (stopped) return;
          stopped = true;
          try {
            source.stop();
          } catch {
            /* already ended */
          }
        },
      };
    },
  };
}
