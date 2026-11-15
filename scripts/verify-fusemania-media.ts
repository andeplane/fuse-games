/** Verify public external song audio: CORS, content type, complete bytes and SHA-256.
 * Run explicitly after an upload; not a network dependency of tests or builds.
 */
import { createHash } from "node:crypto";
import { SONGS } from "./lib/fusemania/songs.js";

const songs = SONGS.filter((song) => !song.file);
for (let at = 0; at < songs.length; at += 4) {
  await Promise.all(
    songs.slice(at, at + 4).map(async (song) => {
      const url = new URL(song.audio);
      if (url.protocol !== "https:" || !/\.(ogg|mp3)$/i.test(url.pathname))
        throw new Error(`${song.id}: expected an HTTPS OGG/MP3 URL`);
      const response = await fetch(url, {
        headers: { Origin: "https://fusegames.ai" },
      });
      if (!response.ok) throw new Error(`${song.id}: HTTP ${response.status}`);
      const origin = response.headers.get("access-control-allow-origin");
      if (origin !== "*" && origin !== "https://fusegames.ai")
        throw new Error(`${song.id}: missing browser CORS access`);
      const type = response.headers.get("content-type")?.split(";")[0];
      const expected = /\.mp3$/i.test(url.pathname)
        ? ["audio/mpeg"]
        : ["audio/ogg", "application/ogg"];
      if (!type || !expected.includes(type))
        throw new Error(`${song.id}: unexpected content type ${type}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (
        bytes.length !== song.audioIntegrity?.bytes ||
        sha256 !== song.audioIntegrity.sha256
      )
        throw new Error(`${song.id}: uploaded bytes differ from the source`);
      console.log(
        `verified ${song.id}: ${bytes.length} bytes, CORS and SHA-256`,
      );
    }),
  );
}
console.log(`Verified ${songs.length} external songs.`);
