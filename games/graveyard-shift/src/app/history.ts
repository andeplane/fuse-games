import type { HistorySnapshot } from "fuse-ui/results-history";
import type { Room } from "../online/game.js";
import { shiftReceipts } from "../online/result.js";

export interface ShiftHistoryRuntime {
  roomState(): Room | undefined;
  confirmedFrame(): { logTick: number } | undefined;
}

/** Only a closed log snapshot proves old outcomes, including after a reporting peer leaves. */
export function readShiftHistory(
  runtime: ShiftHistoryRuntime | undefined,
): HistorySnapshot {
  const room = runtime?.roomState();
  return {
    receipts: room ? shiftReceipts(room) : [],
    confirmedTick: runtime?.confirmedFrame()?.logTick ?? -1,
  };
}
