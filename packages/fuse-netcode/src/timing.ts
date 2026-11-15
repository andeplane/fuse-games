/** Trusted per-game cadence; incoming packets never select these limits. */
export const DEFAULT_TICK_MS = 50;

export interface LogTiming {
  readonly tickMs: number;
  readonly rollbackTicks: number;
  readonly futureTicks: number;
  readonly retainedTicks: number;
  readonly snapshotInterval: number;
  readonly hashInterval: number;
  readonly hashLag: number;
  readonly replayLeadTicks: number;
  readonly slewTicksPerSecond: number;
  readonly snapTicks: number;
}

/** Preserve duration-based windows without increasing entry, byte or allocation caps. */
export function logTiming(tickMs = DEFAULT_TICK_MS): Readonly<LogTiming> {
  if (
    !Number.isInteger(tickMs) ||
    tickMs < 10 ||
    tickMs > DEFAULT_TICK_MS ||
    200 % tickMs !== 0
  )
    throw new RangeError(
      "Game log tick duration must divide 200 ms and be between 10 and 50 ms",
    );
  return Object.freeze({
    tickMs,
    rollbackTicks: Math.ceil(2000 / tickMs),
    futureTicks: Math.ceil(20_000 / tickMs),
    retainedTicks: Math.ceil(2000 / tickMs),
    snapshotInterval: Math.ceil(200 / tickMs),
    hashInterval: Math.ceil(1000 / tickMs),
    hashLag: Math.ceil(2000 / tickMs),
    replayLeadTicks: Math.ceil(3000 / tickMs),
    slewTicksPerSecond: 50 / tickMs,
    snapTicks: 10_000 / tickMs,
  });
}

export const DEFAULT_LOG_TIMING = logTiming();
