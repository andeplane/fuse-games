/** Read-only private operator report. Results contain linkable account pseudonyms; keep output private. */
import { Firestore } from "@google-cloud/firestore";
import { LEGACY_GAME_ID } from "../packages/fuse-platform/src/game.js";
import { ratingAnomalies } from "../packages/fuse-platform/src/rating-anomalies.js";

const prefix = process.env.ROOM_COLLECTION_PREFIX;
const projectId = process.env.GOOGLE_CLOUD_PROJECT;
const game = process.argv[2];
const limit = Number(process.argv[3] ?? 10000);
if (
  !prefix ||
  !/^[a-z][a-z0-9-]{1,50}$/.test(prefix) ||
  !projectId ||
  !game ||
  !/^[a-z0-9-]{1,32}$/.test(game) ||
  !Number.isSafeInteger(limit) ||
  limit < 1 ||
  limit > 100000
)
  throw new Error(
    "Set ROOM_COLLECTION_PREFIX and GOOGLE_CLOUD_PROJECT; pass game id and optional limit (1–100000)",
  );
const db = new Firestore({
  projectId,
  databaseId: process.env.FIRESTORE_DATABASE_ID ?? "fuse-riders",
});
const legacy = game === LEGACY_GAME_ID;
const collection = db.collection(`${prefix}-${legacy ? "users" : "ratings"}`);
const query = legacy ? collection : collection.where("gameId", "==", game);
const page = await query.limit(limit + 1).get();
const rows = page.docs.slice(0, limit).flatMap((doc) => {
  const data = doc.data();
  const uid = legacy ? doc.id : data.uid;
  return typeof uid === "string" ? [{ uid, guard: data.ratingGuard }] : [];
});
console.log(
  JSON.stringify(
    {
      game,
      scanned: rows.length,
      truncated: page.size > limit,
      ...ratingAnomalies(rows, Math.floor(Date.now() / 86_400_000)),
    },
    null,
    2,
  ),
);
await db.terminate();
