/** Minimal document boundary; adapters own persistence, transactions and namespace isolation. */
export interface TelemetryTransaction {
  getMany(keys: readonly string[]): Promise<unknown[]>;
  set(key: string, value: object): void;
}
export interface TelemetryDatabase {
  transact<T>(operation: (tx: TelemetryTransaction) => Promise<T>): Promise<T>;
  readMany(keys: readonly string[]): Promise<unknown[]>;
  /** Newest first, with a stable time/id keyset; storage adapters enforce the read bound. */
  queryEvents?(query: {
    from: number;
    to: number;
    limit: number;
    after?: { time: number; id: string };
  }): Promise<unknown[]>;
}
export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
