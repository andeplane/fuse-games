import {
  ACTIVE_SAVE,
  loadCampaign,
  parseSave,
  type Campaign,
  type Result,
  type StoragePort,
} from "./campaign.js";
export const SLOT_COUNT = 15;
const RECOVERY = "fuserod.garage.before-load";
interface Slot {
  current: string;
  previous?: string;
}
const slotKey = (n: number) => {
  if (!Number.isInteger(n) || n < 1 || n > SLOT_COUNT)
    throw new Error("Choose a slot between 1 and 15.");
  return "fuserod.garage.slot." + n;
};
function readSlot(storage: StoragePort, n: number): Slot | null {
  const raw = storage.getItem(slotKey(n));
  if (raw === null) return null;
  if (raw.length > 250000) throw new Error("This slot exceeds the save limit.");
  const data: unknown = JSON.parse(raw);
  if (
    !data ||
    typeof data !== "object" ||
    !("current" in data) ||
    typeof data.current !== "string"
  )
    throw new Error("Unreadable save slot.");
  const previous = "previous" in data ? data.previous : undefined;
  if (previous !== undefined && typeof previous !== "string")
    throw new Error("Unreadable slot backup.");
  parseSave(data.current);
  return { current: data.current, previous };
}
export function slotSummary(storage: StoragePort, n: number) {
  try {
    const slot = readSlot(storage, n);
    if (!slot)
      return { label: "Empty", occupied: false, backup: false, valid: true };
    const s = parseSave(slot.current);
    return {
      label: `${s.driver} · Day ${s.day} · $${s.cash}`,
      occupied: true,
      backup: !!slot.previous,
      valid: true,
    };
  } catch {
    return { label: "Unreadable", occupied: true, backup: false, valid: false };
  }
}
export function saveSlot(
  storage: StoragePort,
  n: number,
  replace: boolean,
): Result {
  try {
    const state = loadCampaign(storage),
      slot = readSlot(storage, n);
    if (state.pending)
      return {
        ok: false,
        error: "Complete the active race before writing a slot.",
      };
    if (slot && !replace)
      return {
        ok: false,
        error: "Choose Replace to overwrite this occupied slot.",
      };
    const current = JSON.stringify(state);
    if (slot?.current !== current)
      storage.setItem(
        slotKey(n),
        JSON.stringify({ current, previous: slot?.current }),
      );
    return { ok: true, state };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Save failed.",
    };
  }
}
export function restoreSlot(
  storage: StoragePort,
  n: number,
  source: "current" | "previous" | "recovery",
): Result {
  try {
    const raw =
      source === "recovery"
        ? storage.getItem(RECOVERY)
        : readSlot(storage, n)?.[source];
    if (!raw) throw new Error("No saved garage is available here.");
    const incoming = parseSave(raw);
    if (incoming.pending)
      throw new Error("Only garages between races can be loaded.");
    const current = storage.getItem(ACTIVE_SAVE);
    let prior: Campaign | undefined;
    if (current !== null) {
      try {
        prior = parseSave(current);
      } catch {
        /* Preserve unreadable bytes in the recovery key before replacing them. */
      }
      if (prior?.pending)
        throw new Error("Finish the current race before loading a slot.");
      storage.setItem(RECOVERY, current);
    }
    const state = {
      ...incoming,
      next: Math.max(incoming.next, prior?.next ?? 0) + 1,
    };
    storage.setItem(ACTIVE_SAVE, JSON.stringify(state));
    return { ok: true, state };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Load failed.",
    };
  }
}
export function hasRecovery(storage: StoragePort) {
  try {
    const raw = storage.getItem(RECOVERY);
    if (!raw) return false;
    parseSave(raw);
    return true;
  } catch {
    return false;
  }
}
