import {
  FieldPath,
  Timestamp,
  type Firestore,
  type Transaction,
} from "@google-cloud/firestore";
import type {
  ActivityQuery,
  ActivityPage,
  GameActivity,
} from "./activity-api.js";
import {
  activityScope,
  parseActivity,
  type ActivityDatabase,
  type StoredActivity,
} from "./activity.js";
import { plain } from "./result.js";

export interface ActivityDocument {
  id: string;
  data: unknown;
}
export interface ActivityDocumentQuery {
  scope?: string;
  groupId?: string;
  before?: { at: unknown; id: string };
  limit: number;
}
/** Read boundary shared by the production SDK adapter and strongly typed test stores. */
export interface ActivityDocumentReader {
  query(request: ActivityDocumentQuery): Promise<readonly ActivityDocument[]>;
  read(id: string): Promise<ActivityDocument>;
}

function firestoreReader(
  firestore: Firestore,
  collectionName: string,
): ActivityDocumentReader {
  const collection = firestore.collection(collectionName);
  return {
    async query(request) {
      let query =
        request.scope === undefined
          ? collection.where("groupId", "==", request.groupId)
          : collection.where("scopes", "array-contains", request.scope);
      query = query
        .orderBy("endedAt", "desc")
        .orderBy(FieldPath.documentId(), "desc");
      if (request.before)
        query = query.startAfter(request.before.at, request.before.id);
      return (await query.limit(request.limit).get()).docs.map((doc) => ({
        id: doc.id,
        data: doc.data(),
      }));
    },
    async read(id) {
      const doc = await collection.doc(id).get();
      return { id: doc.id, data: doc.data() };
    },
  };
}

/** One indexed projection collection for all games and source types. Each source writes inside its own transaction. */
export class FirestoreActivityDatabase implements ActivityDatabase {
  private reader: ActivityDocumentReader;
  private now: () => number;
  constructor(
    private firestore: Firestore,
    private prefix: string,
    options: { reader?: ActivityDocumentReader; now?: () => number } = {},
  ) {
    this.reader =
      options.reader ??
      firestoreReader(firestore, `${prefix}-telemetry-activity`);
    this.now = options.now ?? Date.now;
  }
  private collection() {
    return this.firestore.collection(`${this.prefix}-telemetry-activity`);
  }
  write(transaction: Transaction, event: StoredActivity) {
    transaction.set(this.collection().doc(event.id), {
      ...event,
      ...(event.expiresAt === undefined
        ? {}
        : { cleanupAt: Timestamp.fromMillis(event.expiresAt) }),
    });
  }
  private parse(doc: ActivityDocument) {
    const event = parseActivity(doc.data, this.now());
    return event?.id === doc.id ? event : undefined;
  }
  async listActivity(
    query: ActivityQuery,
    limit: number,
  ): Promise<ActivityPage> {
    const events: GameActivity[] = [];
    let before: ActivityDocumentQuery["before"] = query.before,
      scanned = 0,
      more = true;
    // Corrupt/expired rows must not supply public cursors or cause unbounded reads.
    const scanLimit = Math.max(100, limit + 1);
    while (events.length <= limit && more && scanned < scanLimit) {
      const size = Math.min(limit + 1, scanLimit - scanned);
      const docs = await this.reader.query({
        scope: activityScope(query),
        before,
        limit: size,
      });
      scanned += docs.length;
      more = docs.length === size;
      for (const doc of docs) {
        const event = this.parse(doc);
        if (event) events.push(event);
      }
      const last = docs.at(-1);
      if (last) {
        if (!plain(last.data) || last.data.endedAt === undefined)
          throw new Error("Stored activity ordering is invalid");
        before = { at: last.data.endedAt, id: last.id };
      }
    }
    if (!events.length && more)
      throw new Error("Stored activity scan limit exceeded");
    const page = events.slice(0, limit),
      last = page.at(-1);
    return {
      events: page,
      ...((events.length > limit || more) && last
        ? { next: { at: last.endedAt, id: last.id } }
        : {}),
    };
  }
  async readActivity(id: string) {
    return this.parse(await this.reader.read(id));
  }
  async groupActivity(id: string, limit: number) {
    return (await this.reader.query({ groupId: id, limit })).flatMap((doc) => {
      const event = this.parse(doc);
      return event?.groupId === id ? [event] : [];
    });
  }
}
