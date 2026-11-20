import type {
  ActionItem,
  ActionsPage,
  ActionsQuery,
} from "./action-contracts.js";
import type { ActionState } from "./action-store.js";

export interface ActionCursor {
  recording: string;
  action: string;
}

export const RECORDINGS_PER_ACTION_PAGE = 20;

export function visible(item: ActionItem, now: number): ActionItem;
export function visible(
  item: ActionItem,
  now: number,
  query: ActionsQuery,
): ActionItem | undefined;
export function visible(
  item: ActionItem,
  now: number,
  query?: ActionsQuery,
): ActionItem | undefined {
  const lease =
    item.status === "claimed" && item.lease && item.lease.expiresAt <= now
      ? item.lease
      : null;
  let { status, updatedAt } = item;
  if (lease) {
    status = item.retraction ? "retracted" : "proposed";
    updatedAt = Math.max(updatedAt, lease.expiresAt);
  }
  if (
    query &&
    ((query.gameId && item.gameId !== query.gameId) ||
      (query.since !== undefined && updatedAt < query.since) ||
      (query.status && status !== query.status))
  )
    return;
  return lease
    ? {
        ...item,
        status,
        title: item.correction?.title ?? item.title,
        detail: item.correction?.detail ?? item.detail,
        updatedAt,
        lease: null,
      }
    : structuredClone(item);
}

function pageResult(
  actions: ActionItem[],
  scannedRecordings: number,
  next?: ActionCursor,
): ActionsPage {
  return {
    actions,
    ...(next
      ? { nextCursor: Buffer.from(JSON.stringify(next)).toString("base64url") }
      : {}),
    scannedRecordings,
  };
}

/** Build one page from a bounded recording scan, including a cursor for an empty page. */
export function selectActionPage(
  states: readonly ActionState[],
  query: ActionsQuery,
  cursor: ActionCursor | undefined,
  at: number,
): ActionsPage {
  const limit = query.limit ?? 50;
  const actions: ActionItem[] = [];
  let last: ActionCursor | undefined;
  for (const state of states) {
    last = { recording: state.recordingId, action: "~" };
    if (state.expiresAt <= at) continue;
    const from =
      cursor?.recording === state.recordingId ? cursor.action : undefined;
    for (const original of [...state.items].sort((a, b) =>
      a.id < b.id ? -1 : 1,
    )) {
      if (from !== undefined && original.id <= from) continue;
      const item = visible(original, at, query);
      if (!item) continue;
      actions.push(item);
      if (actions.length === limit)
        return pageResult(actions, states.indexOf(state) + 1, {
          recording: state.recordingId,
          action: original.id,
        });
    }
  }
  const next =
    states.length >= RECORDINGS_PER_ACTION_PAGE && !query.recordingId
      ? last
      : undefined;
  return pageResult(actions, states.length, next);
}
