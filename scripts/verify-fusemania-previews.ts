/** Explicit post-upload verification; builds and unit tests remain offline. */
import { createHash } from "node:crypto";
import { PREVIEW_CLIPS } from "../games/fusemania/src/app/previews-data.js";

for (let at = 0; at < PREVIEW_CLIPS.length; at += 4) {
  await Promise.all(
    PREVIEW_CLIPS.slice(at, at + 4).map(async (clip) => {
      const response = await fetch(clip.url, {
        headers: { Origin: "https://fusegames.ai" },
      });
      if (!response.ok) throw new Error(`${clip.id}: HTTP ${response.status}`);
      if (
        !["*", "https://fusegames.ai"].includes(
          response.headers.get("access-control-allow-origin") ?? "",
        )
      )
        throw new Error(`${clip.id}: missing CORS`);
      if (!response.headers.get("content-type")?.startsWith("audio/mpeg"))
        throw new Error(`${clip.id}: wrong content type`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (
        bytes.length !== clip.bytes ||
        createHash("sha256").update(bytes).digest("hex") !== clip.sha256
      )
        throw new Error(`${clip.id}: checksum mismatch`);
    }),
  );
}
console.log(
  `Verified all ${PREVIEW_CLIPS.length} public previews: CORS, MIME, byte size and SHA-256.`,
);
