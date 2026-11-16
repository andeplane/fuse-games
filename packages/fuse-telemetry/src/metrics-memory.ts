import type {
  TelemetryDatabase,
  TelemetryTransaction,
} from "./metrics-database.js";

/** Serialized, rollback-safe transactions; the same interface used by the production adapter. */
export class MemoryTelemetryDatabase implements TelemetryDatabase {
  private documents = new Map<string, object>();
  private pending: Promise<void> = Promise.resolve();
  async transact<T>(
    operation: (tx: TelemetryTransaction) => Promise<T>,
  ): Promise<T> {
    const before = this.pending;
    let release!: () => void;
    this.pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await before;
    const writes = new Map<string, object>();
    try {
      const result = await operation({
        getMany: async (keys) =>
          keys.map((key) => structuredClone(this.documents.get(key))),
        set: (key, value) => {
          writes.set(key, structuredClone(value));
        },
      });
      for (const [key, value] of writes) this.documents.set(key, value);
      return result;
    } finally {
      release();
    }
  }
  async readMany(keys: readonly string[]): Promise<unknown[]> {
    await this.pending;
    return keys.map((key) => structuredClone(this.documents.get(key)));
  }
  async queryEvents(query: {
    from: number;
    to: number;
    limit: number;
    after?: { time: number; id: string };
  }): Promise<unknown[]> {
    await this.pending;
    return [...this.documents.entries()]
      .filter(([key]) => key.startsWith("telemetry-events/"))
      .map(([, value]) => value as { occurredAt: number; id: string })
      .filter(
        (value) =>
          value.occurredAt >= query.from &&
          value.occurredAt < query.to &&
          (!query.after ||
            value.occurredAt < query.after.time ||
            (value.occurredAt === query.after.time &&
              value.id < query.after.id)),
      )
      .sort((a, b) => b.occurredAt - a.occurredAt || b.id.localeCompare(a.id))
      .slice(0, Math.min(2001, Math.max(1, query.limit)))
      .map((value) => structuredClone(value));
  }
}
