import test from "node:test";
import assert from "node:assert/strict";
import type { FieldPath } from "@google-cloud/firestore";
import { readFeedPage, type FeedQuery } from "../src/firestore.js";
import { platform } from "../../../service/history.js";

interface Document {
  id: string;
  gameId: string;
  feedAt: number;
}

/** A typed query fake that applies the same bounds and ordering to stored documents. */
class Query implements FeedQuery {
  private predicates: Array<(row: Document) => boolean> = [];
  private count = Infinity;
  constructor(private readonly rows: Document[]) {}
  where(
    field: string,
    operation: "==" | ">=" | "<=" | "<",
    value: string | number,
  ): FeedQuery {
    this.predicates.push((row) => {
      const current = field === "gameId" ? row.gameId : row.feedAt;
      if (operation === "==") return current === value;
      if (typeof current !== "number" || typeof value !== "number")
        return false;
      if (operation === ">=") return current >= value;
      if (operation === "<=") return current <= value;
      return current < value;
    });
    return this;
  }
  orderBy(_field: string | FieldPath, _direction: "desc"): FeedQuery {
    return this;
  }
  startAfter(...values: (number | string)[]): FeedQuery {
    const [at, id] = values;
    if (typeof at !== "number" || typeof id !== "string")
      throw new Error("Invalid cursor");
    this.predicates.push(
      (row) => row.feedAt < at || (row.feedAt === at && row.id < id),
    );
    return this;
  }
  limit(count: number): FeedQuery {
    this.count = count;
    return this;
  }
  async get() {
    return {
      docs: this.rows
        .filter((row) => this.predicates.every((predicate) => predicate(row)))
        .sort((a, b) => b.feedAt - a.feedAt || b.id.localeCompare(a.id))
        .slice(0, this.count)
        .map((row) => ({
          id: row.id,
          get: (_field: string): unknown => row.feedAt,
          data: (): unknown => ({}),
        })),
    };
  }
}

test("F-05 query excludes nonfinite feed times without hiding healthy stored rows", async () => {
  const gameId = "fuse-riders";
  const rows = [
    { id: "infinite", gameId, feedAt: Infinity },
    { id: "nan", gameId, feedAt: NaN },
    { id: "negative", gameId, feedAt: -1 },
    { id: "healthy-b", gameId, feedAt: 100 },
    { id: "healthy-a", gameId, feedAt: 100 },
  ];
  const first = await readFeedPage(
    new Query(rows),
    platform,
    gameId,
    undefined,
    1,
  );
  assert.deepEqual(
    first.map((row) => row.cursor),
    [{ at: 100, id: "healthy-b" }],
  );
  const second = await readFeedPage(
    new Query(rows),
    platform,
    gameId,
    first[0]!.cursor,
    1,
  );
  assert.deepEqual(
    second.map((row) => row.cursor),
    [{ at: 100, id: "healthy-a" }],
  );
});
