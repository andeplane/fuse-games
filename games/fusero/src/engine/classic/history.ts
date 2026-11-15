/* Altered TypeScript port of OpenLieroX src/util/VecTimeRecorder.h.
 * Created by Albert Zeyer, 16.04.10. Code under LGPL.
 * Pinned upstream: 0a20c6d0a10ed63b28a15f05c771913c294efbf6.
 * The cursor offset and stale slots are intentional native behavior.
 */
export const POSITION_RECORDS = 100;
export interface PositionRecorder {
  cursor: number;
  count: number;
  positions: { x: number; y: number }[];
}

export function createPositionRecorder(): PositionRecorder {
  return {
    cursor: 0,
    count: 0,
    positions: Array.from({ length: POSITION_RECORDS }, () => ({ x: 0, y: 0 })),
  };
}

export function recordPosition(
  recorder: PositionRecorder,
  position: { x: number; y: number },
): void {
  recorder.positions[recorder.cursor] = {
    x: Math.fround(position.x),
    y: Math.fround(position.y),
  };
  recorder.cursor = (recorder.cursor + 1) % POSITION_RECORDS;
  recorder.count = Math.min(POSITION_RECORDS, recorder.count + 1);
}

/** Native clear(position) keeps its cursor and every unused/stale backing slot. */
export function resetPositionRecorder(
  recorder: PositionRecorder,
  position: { x: number; y: number },
): void {
  recorder.count = 0;
  recordPosition(recorder, position);
}

export function recordedPosition(
  recorder: PositionRecorder,
  millisecondsBack: number,
): { x: number; y: number } {
  const requested =
    millisecondsBack < 0
      ? Number.MAX_SAFE_INTEGER
      : Math.trunc(millisecondsBack / 11);
  const framesBack =
    requested < recorder.count
      ? requested
      : recorder.count > 0
        ? recorder.count - 1
        : 1;
  return recorder.positions[
    (recorder.cursor + POSITION_RECORDS - (framesBack % POSITION_RECORDS)) %
      POSITION_RECORDS
  ]!;
}
