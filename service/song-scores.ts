import { randomBytes } from "node:crypto";
import type { HistoryDatabase, IdentityVerifier } from "fuse-platform";
import type { TelemetryDatabase } from "fuse-telemetry/metrics-database";
import { SharedTelemetryQuota } from "fuse-telemetry/limits";
import { createSongScoresHttp } from "../games/fusemania/src/server/score-http.js";
import { SongScores } from "../games/fusemania/src/server/song-scores.js";
import { LIBRARY, SONGS_DATA } from "../games/fusemania/src/songs.js";
import { RULES } from "../games/fusemania/src/engine/index.js";
import { RoomError, type HttpExtension } from "fuse-network-be";

export function songScoresHttp(
  database: TelemetryDatabase,
  accounts: Pick<HistoryDatabase, "accounts">,
  identity: IdentityVerifier,
  rateLimitKey: string | undefined,
  now: () => number,
): HttpExtension {
  if (!rateLimitKey)
    return {
      async handle(req) {
        const path = new URL(req.url ?? "/", "http://scores").pathname;
        if (
          path === "/api/games/fusemania/song-scores" ||
          path.startsWith("/api/games/fusemania/song-scores/")
        )
          throw new RoomError(
            503,
            "Song scores are not configured on this service",
          );
        return false;
      },
    };
  return createSongScoresHttp({
    scores: new SongScores({
      database,
      accounts,
      library: LIBRARY,
      sources: SONGS_DATA,
      rules: RULES,
      now,
      id: () => randomBytes(16).toString("hex"),
    }),
    identity,
    now,
    quota: new SharedTelemetryQuota(database, rateLimitKey, now),
  });
}
