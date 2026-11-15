# DukAmok Originals

Imported from the user's supplied **DukAmok Originals** pack. DukAmok authored the charts; the music's artists remain credited exactly as in each original simfile. This is an imported community pack, separate from Fuse's generated charts and soundtrack. The original background images provide the song-select covers, fitted inside 512×512 JPEGs.

The 43 `.sm` and four `.dwi` files here and their externally hosted audio are copied without changing their bytes. All 47 songs retain every original four-arrow difficulty, including original offsets, tempo changes, stops and holds. Non-single charts remain in the source files but do not appear as playable four-arrow charts. Generation skips imported songs so it cannot replace authored charts.

Audio is in the public **`gs://andershaf-87-fuse-media`** bucket in project **`andershaf-87`** (display name **andershaf**), region **europe-north1**. Catalogue URLs use `https://storage.googleapis.com/andershaf-87-fuse-media/fusemania/dukamok-originals/<id>/<sha256>/<original-filename>`. SHA-256 paths keep each URL immutable; imported byte sizes and complete hashes are recorded alongside the URLs. Audio is staged under ignored `artifacts/dukamok-media/`, never committed to Git. The source Downloads folder remains intact.

The dedicated public bucket grants `allUsers` only `roles/storage.objectViewer`, uses uniform bucket-level access and permits cross-origin GET/HEAD so browser fetch, decoding and caching work. It contains game media only. Do not put private recordings or credentials there. Objects have `Cache-Control: public,max-age=31536000,immutable`.

The CORS policy is recorded in `scripts/fusemania-media-cors.json`. To reapply it, run `gcloud storage buckets update gs://andershaf-87-fuse-media --cors-file=scripts/fusemania-media-cors.json --account=andershaf@gmail.com --project=andershaf-87`.

To reproduce the import from the same supplied folder:

```sh
pnpm exec tsx scripts/import-dukamok.ts '/path/to/DukAmok Originals'
gcloud storage rsync artifacts/dukamok-media/ gs://andershaf-87-fuse-media --recursive --cache-control='public,max-age=31536000,immutable' --account=andershaf@gmail.com --project=andershaf-87
pnpm exec tsx scripts/fusemania-charts.ts bundle
pnpm exec tsx scripts/verify-fusemania-media.ts
pnpm exec tsx --test games/fusemania/tests/dukamok-pack.test.ts games/fusemania/tests/charts.test.ts
```

The importer requires ffmpeg to convert artwork. The catalogue is recorded in `scripts/lib/fusemania/dukamok-songs.ts`. The explicit media verification downloads each public URL without credentials and checks browser CORS access, MIME type, byte size and SHA-256. Tests and builds require neither the source Downloads folder nor cloud credentials or live media requests. Bundling reads the original `.sm` and `.dwi` files directly through the same parser that handles player-loaded files; it does not generate replacement charts or reanalyse the music. When a folder has both formats, the importer keeps its SM chart.

The four DWI-only songs are **Big Blue**, **Presto**, **Salieri Strikes Back** and **Utopia**. Their native DWI sources preserve the pack's keypad note data and timing; Salieri Strikes Back and Utopia retain their tempo changes. They use the same GCS media path and original-byte integrity checks as the SM songs.
