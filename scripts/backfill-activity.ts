/**
 * Populate missing public activity from existing confirmed history, without changing match records, ratings or totals.
 * Dry run by default; --write creates missing projections only and rechecks the source inside each transaction.
 *
 * ROOM_COLLECTION_PREFIX=fuse-production pnpm exec tsx scripts/backfill-activity.ts [--write]
 *   [--page-size=200] [--after=<match-document-id>] [--max-pages=10]
 *
 * Application Default Credentials are used only when invoked as a command. GOOGLE_CLOUD_PROJECT defaults to
 * andershaf-87 and FIRESTORE_DATABASE_ID to fuse-riders, as in the existing history migration scripts.
 * Legacy records keep unknown mode and separate singleton groups; missing round relationships are not reconstructed.
 */
import { pathToFileURL } from "node:url";
import { FieldPath, Firestore, Timestamp } from "@google-cloud/firestore";
import {
  activityOf,
  parseMatchRecord,
  type Platform,
  type StoredActivity,
} from "fuse-platform";

export interface ActivityBackfillOptions {
  write: boolean;
  pageSize: number;
  after?: string;
  maxPages?: number;
}

export function activityBackfillOptions(
  args: readonly string[],
): ActivityBackfillOptions {
  const options: ActivityBackfillOptions = { write: false, pageSize: 200 };
  for (const argument of args) {
    if (argument === "--write") options.write = true;
    else if (argument.startsWith("--after=")) {
      const value = argument.slice("--after=".length);
      if (!/^[a-f0-9]{40}$/.test(value))
        throw new Error("--after must be a match document ID");
      options.after = value;
    } else if (
      argument.startsWith("--page-size=") ||
      argument.startsWith("--max-pages=")
    ) {
      const [name, raw, extra] = argument.split("=");
      const value = Number(raw);
      if (
        extra !== undefined ||
        !/^\d+$/.test(raw ?? "") ||
        !Number.isSafeInteger(value) ||
        value < 1
      )
        throw new Error(`${name} must be a positive integer`);
      if (name === "--page-size") {
        if (value > 400) throw new Error("--page-size must be at most 400");
        options.pageSize = value;
      } else options.maxPages = value;
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

export type ActivityBackfillCandidate =
  | { status: "candidate"; event: StoredActivity }
  | { status: "invalid" | "expired" | "ineligible" };

/** Pure planner: only validated, currently public history may produce a projection. Never mutates the source. */
export function activityBackfillCandidate(
  platform: Platform,
  document: { id: string; data: unknown },
  now: number,
): ActivityBackfillCandidate {
  try {
    const record = parseMatchRecord(platform, document.data);
    if (!record || record.id !== document.id) return { status: "invalid" };
    if (record.expiresAt !== undefined && record.expiresAt <= now)
      return { status: "expired" };
    const event = activityOf(platform.game(record.gameId), record);
    return event ? { status: "candidate", event } : { status: "ineligible" };
  } catch {
    return { status: "invalid" };
  }
}

export async function backfillActivity(
  firestore: Firestore,
  platform: Platform,
  prefix: string,
  options: ActivityBackfillOptions,
): Promise<void> {
  const matches = firestore.collection(`${prefix}-matches`);
  const activity = firestore.collection(`${prefix}-telemetry-activity`);
  const counts = {
    scanned: 0,
    candidates: 0,
    existing: 0,
    written: 0,
    invalid: 0,
    expired: 0,
    ineligible: 0,
    changed: 0,
  };
  let after = options.after;
  let pages = 0;
  let complete = false;
  while (options.maxPages === undefined || pages < options.maxPages) {
    let query = matches.orderBy(FieldPath.documentId()).limit(options.pageSize);
    if (after !== undefined) query = query.startAfter(after);
    const page = await query.get();
    if (page.empty) {
      complete = true;
      break;
    }
    const candidates = page.docs.flatMap((doc) => {
      counts.scanned++;
      const planned = activityBackfillCandidate(
        platform,
        { id: doc.id, data: doc.data() },
        Date.now(),
      );
      if (planned.status !== "candidate") {
        counts[planned.status]++;
        return [];
      }
      counts.candidates++;
      return [{ source: doc.ref, event: planned.event }];
    });
    if (!options.write && candidates.length) {
      const projections = await firestore.getAll(
        ...candidates.map(({ event }) => activity.doc(event.id)),
      );
      counts.existing += projections.filter((doc) => doc.exists).length;
    }
    if (options.write) {
      for (const candidate of candidates) {
        const outcome = await firestore.runTransaction(async (transaction) => {
          // A live settlement may link accounts or update metadata while this page is being processed.
          const fresh = await transaction.get(candidate.source);
          const planned = activityBackfillCandidate(
            platform,
            { id: fresh.id, data: fresh.data() },
            Date.now(),
          );
          if (planned.status !== "candidate") return "changed" as const;
          const target = activity.doc(planned.event.id);
          if ((await transaction.get(target)).exists)
            return "existing" as const;
          transaction.create(target, {
            ...planned.event,
            ...(planned.event.expiresAt === undefined
              ? {}
              : { cleanupAt: Timestamp.fromMillis(planned.event.expiresAt) }),
          });
          return "written" as const;
        });
        counts[outcome]++;
      }
    }
    pages++;
    after = page.docs.at(-1)!.id;
    console.log(
      JSON.stringify({
        mode: options.write ? "write" : "dry-run",
        pages,
        ...counts,
        after,
      }),
    );
    if (page.size < options.pageSize) {
      complete = true;
      break;
    }
  }
  console.log(
    JSON.stringify({
      complete,
      mode: options.write ? "write" : "dry-run",
      ...counts,
      ...(options.write
        ? {}
        : { missing: counts.candidates - counts.existing }),
      ...(after === undefined ? {} : { after }),
      ...(!complete && after ? { resume: `--after=${after}` } : {}),
    }),
  );
}

async function main(): Promise<void> {
  const options = activityBackfillOptions(process.argv.slice(2));
  const prefix = process.env.ROOM_COLLECTION_PREFIX;
  if (!prefix || !/^[a-z][a-z0-9-]{1,50}$/.test(prefix))
    throw new Error("Set ROOM_COLLECTION_PREFIX, e.g. fuse-production");
  const { platform } = await import("../service/history.js");
  const firestore = new Firestore({
    projectId: process.env.GOOGLE_CLOUD_PROJECT ?? "andershaf-87",
    databaseId: process.env.FIRESTORE_DATABASE_ID ?? "fuse-riders",
  });
  try {
    await backfillActivity(firestore, platform, prefix, options);
  } finally {
    await firestore.terminate();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
