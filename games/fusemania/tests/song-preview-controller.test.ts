import test from "node:test";
import assert from "node:assert/strict";
import {
  createSongPreview,
  type SongPreviewDeps,
} from "../src/app/song-preview.js";
import { createSongStore, type SongCaches } from "../src/app/song-cache.js";
import { LIBRARY } from "../src/songs.js";
import { PREVIEW_CLIPS } from "../src/app/previews-data.js";

const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
const first = "pixel-sax-parade",
  second = "coin-op-swing";
function rig(fetch: SongPreviewDeps["fetch"] = async () => new ArrayBuffer(1)) {
  const pending: { run: () => void; cancelled: boolean }[] = [];
  const played: string[] = [],
    revoked: string[] = [];
  let enabled = true,
    objects = 0,
    resumes = 0,
    stops = 0;
  const deps: SongPreviewDeps = {
    clip: (id) => `https://media.example/${id}.mp3`,
    enabled: () => enabled,
    fetch,
    objectUrl: () => `blob:preview-${++objects}`,
    revoke: (url) => {
      revoked.push(url);
    },
    play: (song, url) => {
      played.push(`${song.id}:${url}`);
    },
    resume: () => {
      resumes++;
    },
    stop: () => {
      stops++;
    },
    schedule(run, ms) {
      assert.equal(ms, 350);
      const task = { run, cancelled: false };
      pending.push(task);
      return () => {
        task.cancelled = true;
      };
    },
  };
  const preview = createSongPreview(LIBRARY, deps);
  return {
    preview,
    deps,
    played,
    revoked,
    mute: () => {
      enabled = false;
    },
    flush: () => {
      for (const task of pending.splice(0)) if (!task.cancelled) task.run();
    },
    get resumes() {
      return resumes;
    },
    get stops() {
      return stops;
    },
  };
}

test("the preview catalogue covers every bundled song with a small immutable short clip", () => {
  assert.deepEqual(
    PREVIEW_CLIPS.map((clip) => clip.id).sort(),
    LIBRARY.songs.map((song) => song.id).sort(),
  );
  for (const clip of PREVIEW_CLIPS) {
    assert.equal(clip.audibleSeconds, 20);
    assert.equal(clip.silenceSeconds, 2);
    assert.ok(clip.bytes < 200_000);
    assert.match(clip.sha256, /^[a-f0-9]{64}$/);
    assert.ok(clip.url.endsWith(`/${clip.sha256}.mp3`));
    assert.ok(clip.start >= 0);
  }
});

test("quick scrolling only fetches the settled preview; forced mute fetches nothing", async () => {
  const fetched: string[] = [];
  const r = rig(async (url) => {
    fetched.push(url);
    return new ArrayBuffer(1);
  });
  r.preview.show(first);
  r.preview.show(second);
  r.flush();
  await tick();
  assert.deepEqual(fetched, [`https://media.example/${second}.mp3`]);
  assert.deepEqual(r.played, [`${second}:blob:preview-1`]);
  r.preview.show(second);
  assert.equal(r.resumes, 1);
  r.preview.stop();
  assert.deepEqual(r.revoked, ["blob:preview-1"]);
  r.mute();
  r.preview.show(first);
  r.flush();
  await tick();
  assert.equal(fetched.length, 1);
});

test("late old downloads never replace the selected song and stopping prevents late playback", async () => {
  const resolve = new Map<string, (bytes: ArrayBuffer) => void>();
  const r = rig((url) => new Promise((done) => resolve.set(url, done)));
  r.preview.show(first);
  r.flush();
  r.preview.show(second);
  r.flush();
  resolve.get(`https://media.example/${second}.mp3`)!(new ArrayBuffer(1));
  await tick();
  resolve.get(`https://media.example/${first}.mp3`)!(new ArrayBuffer(1));
  await tick();
  assert.deepEqual(r.played, [`${second}:blob:preview-1`]);
  r.preview.show(first);
  r.flush();
  r.preview.stop();
  resolve.get(`https://media.example/${first}.mp3`)!(new ArrayBuffer(1));
  await tick();
  assert.equal(r.played.length, 1);
  assert.deepEqual(r.revoked, ["blob:preview-1"]);
});

test("reselecting an in-flight preview shares its fetch; failures do not refetch every frame", async () => {
  let fetched = 0;
  let finish: ((bytes: ArrayBuffer) => void) | undefined;
  const r = rig(() => {
    fetched++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  r.preview.show(first);
  r.flush();
  r.preview.stop();
  r.preview.show(first);
  r.flush();
  assert.equal(fetched, 1);
  finish!(new ArrayBuffer(1));
  await tick();
  assert.deepEqual(r.played, [`${first}:blob:preview-1`]);
  const failure = rig(async () => {
    fetched++;
    throw new Error("offline");
  });
  failure.preview.show(first);
  failure.flush();
  await tick();
  for (let frame = 0; frame < 10; frame++) failure.preview.show(first);
  failure.flush();
  await tick();
  assert.equal(fetched, 2);
  assert.equal(failure.played.length, 0);
});

test("a preview survives a new controller and store without a second network download", async () => {
  const entries = new Map<string, Response>();
  const caches: SongCaches = {
    open: async () => ({
      match: async (url) => entries.get(url)?.clone(),
      put: async (url, response) => {
        entries.set(url, response);
      },
      keys: async () => [...entries.keys()].map((url) => ({ url })),
    }),
    keys: async () => ["previews-v1"],
    delete: async () => false,
  };
  let network = 0;
  const store = () =>
    createSongStore({
      caches,
      fetch: async () => {
        network++;
        return new Response(new Uint8Array([1, 2, 3]));
      },
      prefix: "previews-",
      version: "v1",
      absolute: (url) => url,
    });
  const one = rig(store().fetch);
  one.preview.show(first);
  one.flush();
  // The store's Response.arrayBuffer crosses asynchronous turns; wait on observable playback without sleeps.
  for (let turn = 0; turn < 20 && one.played.length === 0; turn++)
    await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(one.played.length, 1);
  one.preview.stop();
  const two = rig(store().fetch);
  two.preview.show(first);
  two.flush();
  for (let turn = 0; turn < 20 && two.played.length === 0; turn++)
    await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(two.played.length, 1);
  assert.equal(network, 1);
});
