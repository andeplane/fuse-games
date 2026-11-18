/** Run after deploying search support; dry-run unless --apply is present. Never prints player data. */
import { FieldPath, Firestore } from "@google-cloud/firestore";
import { friendDisplayName, storedPresence } from "fuse-platform";
import { FirestoreHistoryDatabase } from "fuse-platform/firestore";
import { platform } from "../service/history.js";

const [projectId, databaseId, prefix, ...flags] = process.argv.slice(2);
if (
  !projectId ||
  projectId.startsWith("-") ||
  !databaseId ||
  databaseId.startsWith("-") ||
  !prefix ||
  prefix.startsWith("-") ||
  flags.length > 1 ||
  flags.some((flag) => flag !== "--apply")
)
  throw new Error(
    "Usage: pnpm exec tsx scripts/backfill-friend-search.ts PROJECT_ID DATABASE_ID PREFIX [--apply]",
  );
const firestore = new Firestore({ projectId, databaseId });
const history = new FirestoreHistoryDatabase(platform, firestore, prefix);
const collection = firestore.collection(`${prefix}-presence`);
const apply = flags.includes("--apply");
let cursor: string | undefined;
let scanned = 0;
let changed = 0;
let stale = 0;
try {
  for (;;) {
    let query = collection.orderBy(FieldPath.documentId()).limit(100);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (!page.size) break;
    scanned += page.size;
    const records = page.docs.flatMap((doc) => {
      const presence = storedPresence(doc.data());
      return presence?.uid === doc.id ? [{ doc, presence }] : [];
    });
    const accounts = await history.accounts(records.map(({ doc }) => doc.id));
    for (const { doc, presence } of records) {
      const searchName = friendDisplayName(
        platform.account.fallbackName,
        accounts.get(doc.id),
        presence,
      ).toLowerCase();
      if (presence.searchName === searchName) continue;
      if (apply) {
        // A concurrent heartbeat wins; rerunning the migration handles skipped records.
        try {
          await doc.ref.update(
            { searchName },
            { lastUpdateTime: doc.updateTime! },
          );
        } catch (error) {
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            (error.code === 5 || error.code === 9)
          ) {
            stale++;
            continue;
          }
          throw error;
        }
      }
      changed++;
    }
    cursor = page.docs.at(-1)!.id;
  }
  console.log(
    JSON.stringify({
      apply,
      scanned,
      [apply ? "updated" : "wouldUpdate"]: changed,
      ...(apply ? { skippedConcurrent: stale } : {}),
    }),
  );
} finally {
  await firestore.terminate();
}
