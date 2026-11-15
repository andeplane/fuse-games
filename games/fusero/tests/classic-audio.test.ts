import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CLASSIC_SOUND_ASSETS,
  classicSoundFile,
  createFuseroAudio,
  type FuseroAudioDependencies,
  type FuseroAudioSurface,
  type FuseroVoice,
} from "../src/app/audio.js";
import {
  CLASSIC_PROJECTILES,
  CLASSIC_WEAPONS,
} from "../src/engine/classic/catalog.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
class FakeVoice implements FuseroVoice {
  stopped = false;
  constructor(private readonly ended: () => void) {}
  stop(): void {
    if (!this.stopped) {
      this.stopped = true;
      this.ended();
    }
  }
}
class FakeSurface implements FuseroAudioSurface<string> {
  resumes = 0;
  suspends = 0;
  closes = 0;
  decodes = 0;
  resumeFails = false;
  readonly played: string[] = [];
  readonly voices: FakeVoice[] = [];
  async resume(): Promise<void> {
    this.resumes++;
    if (this.resumeFails) throw new Error("gesture needed");
  }
  async suspend(): Promise<void> {
    this.suspends++;
  }
  async close(): Promise<void> {
    this.closes++;
  }
  async decode(_bytes: ArrayBuffer): Promise<string> {
    return `buffer-${++this.decodes}`;
  }
  play(buffer: string, ended: () => void): FuseroVoice {
    this.played.push(buffer);
    const voice = new FakeVoice(ended);
    this.voices.push(voice);
    return voice;
  }
}
type FetchResult = Awaited<
  ReturnType<FuseroAudioDependencies<string>["fetch"]>
>;
const reply = (): FetchResult => ({
  ok: true,
  arrayBuffer: async () => new Uint8Array([1, 2]).buffer,
});
function harness(
  options: {
    forcedMute?: boolean;
    initiallyEnabled?: boolean;
    hold?: boolean;
  } = {},
) {
  const surface = new FakeSurface(),
    fetched = deferred<void>(),
    pending = deferred<FetchResult>();
  const requests: { url: string; signal: AbortSignal }[] = [];
  let time = 0,
    opens = 0,
    fail = false;
  const audio = createFuseroAudio({
    base: "/preview/",
    ...options,
    now: () => time,
    open: () => {
      opens++;
      return surface;
    },
    fetch: async (url, signal) => {
      requests.push({ url, signal });
      fetched.resolve();
      if (fail) throw new Error("offline");
      return options.hold ? pending.promise : reply();
    },
  });
  return {
    audio,
    surface,
    requests,
    fetched,
    pending,
    opens: () => opens,
    advance: (ms: number) => {
      time += ms;
    },
    fail: (value: boolean) => {
      fail = value;
    },
  };
}

test("all native weapon/action samples resolve to exact pinned Ogg bytes, including case aliases", () => {
  const references = new Set<string>();
  for (const value of CLASSIC_WEAPONS)
    if (value.type === "projectile" && value.useSound && value.sound)
      references.add(value.sound);
  for (const value of CLASSIC_PROJECTILES)
    for (const action of [
      value.hit,
      value.timer,
      value.playerHit,
      value.explode,
      value.touch,
    ])
      if (action?.useSound && action.sound) references.add(action.sound);
  assert.equal(references.size, 13);
  assert.equal(CLASSIC_SOUND_ASSETS.length, 11);
  for (const name of references)
    assert.ok(classicSoundFile(name), `missing native sample ${name}`);
  for (const asset of CLASSIC_SOUND_ASSETS) {
    const bytes = readFileSync(
      new URL(`../../../public/fusero/audio/${asset.file}`, import.meta.url),
    );
    assert.equal(bytes.toString("ascii", 0, 4), "OggS");
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      asset.sha256,
    );
    for (const name of asset.references) assert.ok(references.has(name));
  }
  assert.equal(classicSoundFile("Exp3a.wav"), classicSoundFile("exp3a.wav"));
  assert.equal(classicSoundFile("Throw.wav"), classicSoundFile("throw.wav"));
  for (const unknown of [
    "https://example.com/x.wav",
    "../../exp2.wav",
    "missing.wav",
  ])
    assert.equal(classicSoundFile(unknown), undefined);
});

test("no sound is opened, fetched or played before gesture unlock, and old observations stay silent", async () => {
  const h = harness();
  await h.audio.observe([{ id: 1, sound: "Bazooka.wav" }], "match");
  assert.equal(h.opens(), 0);
  assert.equal(h.requests.length, 0);
  await h.audio.unlock();
  await h.audio.observe([{ id: 1, sound: "Bazooka.wav" }, { id: 2 }], "match");
  assert.equal(h.surface.played.length, 0);
  await h.audio.observe([{ id: 2, sound: "Bazooka.wav" }], "match");
  assert.equal(
    h.surface.played.length,
    1,
    "a formerly silent slot may gain corrected native sound metadata",
  );
  h.audio.dispose();
});

test("forced mute cannot be bypassed by unlock, toggles, visibility changes or live effects", async () => {
  const h = harness({ forcedMute: true });
  h.audio.setEnabled(true);
  h.audio.setVisible(false);
  h.audio.setVisible(true);
  await h.audio.unlock();
  await h.audio.observe([{ id: 1, sound: "Shot.wav" }], "match");
  assert.equal(h.audio.enabled(), false);
  assert.equal(h.opens(), 0);
  assert.equal(h.requests.length, 0);
  assert.equal(h.surface.played.length, 0);
  h.audio.dispose();
});

test("decoded buffers are cached across aliases while provisional/confirmed ids play once per match", async () => {
  const h = harness();
  await h.audio.unlock();
  await Promise.all([
    h.audio.observe(
      [
        { id: 1, sound: "Exp3a.wav" },
        { id: 2, sound: "exp3a.wav" },
      ],
      "first",
    ),
    h.audio.observe([{ id: 1, sound: "Exp3a.wav" }], "first"),
  ]);
  assert.equal(h.requests.length, 1);
  assert.equal(h.surface.decodes, 1);
  assert.equal(h.surface.played.length, 2);
  assert.equal(h.requests[0]!.url, "/preview/fusero/audio/exp3a.ogg");
  await h.audio.observe([{ id: 1, sound: "Exp3a.wav" }], "second");
  assert.equal(
    h.surface.played.length,
    3,
    "new match gets its own event scope",
  );
  assert.equal(h.surface.decodes, 1);
  h.audio.dispose();
});

test("mute and hidden tabs stop voices immediately and invalidate pending audio without replay bursts", async () => {
  for (const mode of ["mute", "hidden"] as const) {
    const h = harness({ hold: true });
    await h.audio.unlock();
    const playing = h.audio.observe([{ id: 1, sound: "Rifle.wav" }], "match");
    await h.fetched.promise;
    if (mode === "mute") h.audio.setEnabled(false);
    else h.audio.setVisible(false);
    h.pending.resolve(reply());
    await playing;
    assert.equal(h.surface.played.length, 0);
    if (mode === "mute") h.audio.setEnabled(true);
    else h.audio.setVisible(true);
    await h.audio.unlock();
    await h.audio.observe(
      [
        { id: 1, sound: "Rifle.wav" },
        { id: 2, sound: "Rifle.wav" },
      ],
      "match",
    );
    assert.equal(h.surface.played.length, 1);
    if (mode === "mute") h.audio.setEnabled(false);
    else h.audio.setVisible(false);
    assert.equal(h.audio.snapshot().voices, 0);
    assert.equal(h.surface.voices[0]!.stopped, true);
    h.audio.dispose();
  }
});

test("late decodes and old-match requests cannot play stale shots", async () => {
  for (const mode of ["late", "new match"] as const) {
    const h = harness({ hold: true });
    await h.audio.unlock();
    const playing = h.audio.observe([{ id: 1, sound: "Shotgun.wav" }], "old");
    await h.fetched.promise;
    if (mode === "late") h.advance(351);
    else await h.audio.observe([], "new");
    h.pending.resolve(reply());
    await playing;
    assert.equal(h.surface.played.length, 0);
    h.audio.dispose();
  }
});

test("failed fetches have bounded retry backoff and a later new effect can recover", async () => {
  const h = harness();
  await h.audio.unlock();
  h.fail(true);
  await h.audio.observe([{ id: 1, sound: "Shot.wav" }], "match");
  assert.deepEqual(h.audio.snapshot().failed, ["Shot.ogg"]);
  await h.audio.observe([{ id: 2, sound: "Shot.wav" }], "match");
  assert.equal(h.requests.length, 1);
  h.advance(5001);
  h.fail(false);
  await h.audio.observe([{ id: 3, sound: "Shot.wav" }], "match");
  assert.equal(h.requests.length, 2);
  assert.equal(h.surface.played.length, 1);
  assert.deepEqual(h.audio.snapshot().failed, []);
  h.audio.dispose();
});

test("native per-sample voice cap is ten and completed sources free their slots", async () => {
  const h = harness();
  await h.audio.unlock();
  await h.audio.observe(
    Array.from({ length: 11 }, (_, id) => ({ id, sound: "Shot.wav" })),
    "match",
  );
  assert.equal(h.surface.played.length, 10);
  assert.equal(h.audio.snapshot().voices, 10);
  h.surface.voices[0]!.stop();
  await h.audio.observe([{ id: 12, sound: "Shot.wav" }], "match");
  assert.equal(h.surface.played.length, 11);
  assert.equal(h.audio.snapshot().voices, 10);
  h.audio.dispose();
});

test("bounded dedupe history never permits evicted stale effects to replay", async () => {
  const h = harness({ initiallyEnabled: false });
  await h.audio.observe(
    Array.from({ length: 4100 }, (_, id) => ({ id, sound: "Shot.wav" })),
    "match",
  );
  h.audio.setEnabled(true);
  await h.audio.unlock();
  await h.audio.observe(
    [
      { id: 0, sound: "Shot.wav" },
      { id: 4101, sound: "Shot.wav" },
    ],
    "match",
  );
  assert.deepEqual(
    h.audio.snapshot().last.map((value) => value.effectId),
    [4101],
  );
  h.audio.dispose();
});

test("disposal aborts pending loads, fences their completion and closes the audio surface once", async () => {
  const h = harness({ hold: true });
  await h.audio.unlock();
  const playing = h.audio.observe([{ id: 1, sound: "Larpa.wav" }], "match");
  await h.fetched.promise;
  h.audio.dispose();
  h.audio.dispose();
  assert.equal(h.requests[0]!.signal.aborted, true);
  h.pending.resolve(reply());
  await playing;
  assert.equal(h.surface.played.length, 0);
  assert.equal(h.surface.closes, 1);
  assert.equal(h.audio.enabled(), false);
});

test("autoplay rejection stays retryable through the next explicit gesture", async () => {
  const h = harness();
  h.surface.resumeFails = true;
  await h.audio.unlock();
  assert.equal(h.audio.snapshot().unlocked, false);
  h.surface.resumeFails = false;
  await h.audio.unlock();
  await h.audio.observe([{ id: 1, sound: "Bazooka.wav" }], "match");
  assert.equal(h.surface.played.length, 1);
  assert.equal(h.opens(), 1);
  h.audio.dispose();
});
