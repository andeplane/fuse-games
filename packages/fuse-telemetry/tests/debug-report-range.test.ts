import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { FieldPath, type WhereFilterOp } from "@google-cloud/firestore";
import {
  debugListQuery,
  queryRecordingReports,
  type DebugListQuery,
  type DebugReportQuery,
} from "../src/debug-firestore.js";

class ReportQuery implements DebugReportQuery {
  operations: unknown[][] = [];
  where(field: string, operation: WhereFilterOp, value: unknown) {
    this.operations.push(["where", field, operation, value]);
    return this;
  }
  orderBy(field: string | FieldPath) {
    this.operations.push([
      "orderBy",
      typeof field === "string"
        ? field
        : field.isEqual(FieldPath.documentId())
          ? "__name__"
          : "unknown",
    ]);
    return this;
  }
  limit(count: number) {
    this.operations.push(["limit", count]);
    return this;
  }
  async get() {
    this.operations.push(["get"]);
    return { docs: [] };
  }
}

class ListQuery implements DebugListQuery<string[]> {
  operations: string[] = [];
  private cursor = false;
  where(field: string, operation: WhereFilterOp, value: unknown) {
    // Mirrors the SDK, which throws here once any cursor has been set.
    assert.equal(this.cursor, false, "where() after a cursor");
    this.operations.push(`where ${field} ${operation} ${String(value)}`);
    return this;
  }
  orderBy(field: string | FieldPath) {
    this.operations.push(`orderBy ${typeof field === "string" ? field : "id"}`);
    return this;
  }
  startAt(value: string) {
    this.cursor = true;
    this.operations.push(`startAt ${value}`);
    return this;
  }
  startAfter(value: string) {
    this.cursor = true;
    this.operations.push(`startAfter ${value}`);
    return this;
  }
  endAt(value: string) {
    this.cursor = true;
    this.operations.push(`endAt ${value}`);
    return this;
  }
  limit(count: number) {
    return [...this.operations, `limit ${count}`];
  }
}

test("Firestore listings filter before setting a cursor", () => {
  assert.deepEqual(
    debugListQuery(
      new ListQuery(),
      "report:",
      undefined,
      "recording-one",
    ).limit(51),
    [
      "where recordingId == recording-one",
      "orderBy id",
      "startAt report:",
      "endAt report:",
      "limit 51",
    ],
  );
  assert.deepEqual(
    debugListQuery(new ListQuery(), "report:", "report:abc", undefined).limit(
      26,
    ),
    ["orderBy id", "startAfter report:abc", "endAt report:", "limit 26"],
  );
});

test("Firestore report links query only ready/live reports within the chunk, with a matching production index", async () => {
  const query = new ReportQuery();
  assert.deepEqual(
    await queryRecordingReports(
      query,
      "recording-one",
      10000,
      20000,
      50000,
      20,
    ),
    [],
  );
  assert.deepEqual(query.operations, [
    ["where", "recordingId", "==", "recording-one"],
    ["where", "ready", "==", true],
    ["where", "offsetMs", ">=", 10000],
    ["where", "offsetMs", "<=", 20000],
    ["where", "expiresAt", ">", 50000],
    ["orderBy", "offsetMs"],
    ["orderBy", "expiresAt"],
    ["orderBy", "__name__"],
    ["limit", 20],
    ["get"],
  ]);
  const indexes = JSON.parse(
    await readFile(
      new URL("../../../firestore.indexes.json", import.meta.url),
      "utf8",
    ),
  );
  assert.ok(
    indexes.indexes.some(
      (index: {
        collectionGroup: string;
        fields: { fieldPath: string; order: string }[];
      }) =>
        index.collectionGroup === "fuse-production-telemetry-reports" &&
        JSON.stringify(index.fields) ===
          JSON.stringify([
            { fieldPath: "recordingId", order: "ASCENDING" },
            { fieldPath: "ready", order: "ASCENDING" },
            { fieldPath: "offsetMs", order: "ASCENDING" },
            { fieldPath: "expiresAt", order: "ASCENDING" },
          ]),
    ),
  );
});
