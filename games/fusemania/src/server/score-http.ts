import type { IncomingMessage } from "node:http";
import {
  RoomError,
  rateLimitAddress,
  type HttpExtension,
} from "fuse-network-be";
import type { IdentityVerifier } from "fuse-platform";
import { TelemetryAdmission, type TelemetryQuota } from "fuse-telemetry/limits";
import type { SongScores } from "./song-scores.js";

export const MAX_SONG_SCORE_BODY_BYTES = 1_500_000;

async function body(req: IncomingMessage): Promise<unknown> {
  if (req.headers["content-type"]?.split(";")[0]?.trim() !== "application/json")
    throw new RoomError(415, "Expected application/json");
  const chunks: Buffer[] = [];
  let bytes = 0;
  const timeout = setTimeout(
    () => req.destroy(new RoomError(408, "Request too slow")),
    10_000,
  );
  timeout.unref();
  try {
    for await (const chunk of req as AsyncIterable<Buffer>) {
      bytes += chunk.length;
      if (bytes > MAX_SONG_SCORE_BODY_BYTES)
        throw new RoomError(413, "Input log too large");
      chunks.push(chunk);
    }
  } finally {
    clearTimeout(timeout);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RoomError(400, "Invalid JSON");
  }
}

export function createSongScoresHttp(options: {
  scores: SongScores;
  identity: IdentityVerifier;
  quota: TelemetryQuota;
  now(): number;
}): HttpExtension {
  // Larger replay bodies have a tighter concurrent memory budget than the small analytics batches.
  const admission = new TelemetryAdmission(options.now, 16, 4);
  return {
    async handle(req, res, address) {
      const url = new URL(req.url ?? "/", "http://scores");
      const root = "/api/games/fusemania/song-scores";
      if (url.pathname !== root && !url.pathname.startsWith(root + "/"))
        return false;
      await admission.run(address, async () => {
        const read = req.method === "GET" && url.pathname === root;
        const write =
          req.method === "POST" &&
          (url.pathname === root + "/runs" ||
            /^\/runs\/[a-f0-9]{32}$/.test(url.pathname.slice(root.length)));
        if (!read && !write)
          throw new RoomError(405, "Use GET for scores or POST for runs");
        await options.quota.consume([
          {
            dimension: "song-scores-address",
            identity: rateLimitAddress(address),
            cost: 1,
            limit: read ? 300 : 240,
            windowMs: 3_600_000,
          },
        ]);
        let value: unknown;
        if (read) {
          const song = url.searchParams.get("song"),
            chart = url.searchParams.get("chart");
          if (song !== null || chart !== null) {
            if (!song || chart === null || !/^\d{1,2}$/.test(chart))
              throw new RoomError(400, "Choose a song and chart");
            value = {
              players: await options.scores.leaderboard(song, Number(chart)),
            };
          } else value = { songs: await options.scores.catalog() };
        } else {
          const token =
            req.headers.authorization?.replace(/^Bearer /, "") ?? "";
          const uid = token ? await options.identity(token) : undefined;
          if (!uid) throw new RoomError(401, "Sign in to save highscores");
          await options.quota.consume([
            {
              dimension: "song-scores-account",
              identity: uid,
              cost: 1,
              limit: 120,
              windowMs: 3_600_000,
            },
          ]);
          const data = await body(req);
          value =
            url.pathname === root + "/runs"
              ? await options.scores.start(uid, data)
              : await options.scores.complete(
                  uid,
                  url.pathname.slice(root.length + 6),
                  data,
                );
        }
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify(value));
      });
      return true;
    },
  };
}
