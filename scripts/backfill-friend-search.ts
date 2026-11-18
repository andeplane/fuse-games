/** Run after deploying search support; dry-run unless --apply is present. Never prints player data. */
import { FieldPath, Firestore } from "@google-cloud/firestore";
import { storedPresence } from "fuse-platform";
import { platform } from "../service/history.js";

const [projectId, prefix, ...flags] = process.argv.slice(2);
if (!projectId || !prefix || flags.some((flag) => flag !== "--apply"))
  throw new Error(
    "Usage: pnpm exec tsx scripts/backfill-friend-search.ts PROJECT_ID PREFIX [--apply]",
  );
const firestore = new Firestore({ projectId });
const collection = firestore.collection(`${prefix}-presence`);
const apply = flags.includes("--apply");
let cursor: string | undefined;
let scanned = 0;
let changed = 0;
try {
  for (;;) {
    let query = collection.orderBy(FieldPath.documentId()).limit(100);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (!page.size) break;
    for (const doc of page.docs) {
      scanned++;
      const presence = storedPresence(doc.data());
      if (!presence || presence.uid !== doc.id) continue;
      const account = (
        await firestore.collection(`${prefix}-users`).doc(doc.id).get()
      ).data();
      const name =
        typeof account?.username === "string"
          ? account.username
          : (presence.name ??
            (typeof account?.name === "string"
              ? account.name
              : platform.account.fallbackName));
      const searchName = name.toLowerCase();
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
            error.code === 9
          )
            continue;
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
    }),
  );
} finally {
  await firestore.terminate();
}
