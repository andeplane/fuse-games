# Lightweight song previews

`scripts/fusemania-previews.ts` makes one menu clip for every bundled song. It reads the original simfile's `SAMPLESTART`, clamping it so a 20-second section fits the source when possible. Clips fade in briefly, fade out from 18.5 to 20 seconds, then contain two seconds of silence. The shared music player's ordinary single-song loop repeats this 22-second clip without a competing game clock or repeating client timer.

Clips are stereo MP3 at 64 kbps / 22.05 kHz, about 177 KB each. Full gameplay audio, charts, offsets and scoring do not change. Generated audio stays in ignored `artifacts/`, outside Git. Only `src/app/previews-data.ts` is committed; its metadata records each immutable public GCS URL, SHA-256, size and source start.

```sh
pnpm exec tsx scripts/fusemania-previews.ts
# Optional: reuse an existing ignored source-media staging folder instead of downloading it again.
pnpm exec tsx scripts/fusemania-previews.ts --source-cache /path/to/artifacts/dukamok-media
gcloud storage rsync artifacts/fusemania-previews/ gs://andershaf-87-fuse-media --recursive --cache-control='public,max-age=31536000,immutable' --account=andershaf@gmail.com --project=andershaf-87
pnpm exec tsx scripts/verify-fusemania-previews.ts
```

Generation needs ffmpeg and ffprobe. Existing repository audio is read locally; externally hosted originals are checksum-verified and cached under ignored `artifacts/fusemania-preview-sources/`. Upload uses the same dedicated public media bucket and CORS policy as the original DukAmok songs. Regenerate after adding a song, then verify the upload explicitly. Unit tests and builds stay offline.

The app waits 350 ms after a selection settles, loads that clip through `SongStore`, and gives a single object URL to the shared preview audio bus. Persisted preview bytes survive new controllers and page visits; full-song download indicators continue to describe full gameplay audio, not preview clips. Stale downloads may complete into persistent cache but cannot take over a later selection. Repeated views of one selection share pending work, failed fetches do not retry every render, and stop releases the object URL. Cache availability and writes remain best effort; private browsing or a full disk still permits ordinary network playback.

Menu previews retain shared mute and volume controls, and forced `?mute` skips preview fetches entirely. Device-loaded simfiles have no bundled clip and remain excluded. Preview metadata is presentation only and does not change the deterministic library or `RULES`.
