export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };
export type RectState = Record<string, Rect>;

export const TASKBAR_HEIGHT = 28;
export const MIN_WINDOW_WIDTH = 240;
export const MIN_WINDOW_HEIGHT = 160;

/**
 * Narrower than this (a phone, a tablet held upright), windows open maximized: a draggable
 * frame on a 390px screen is all title bar and no content. The same cut-off decides where a
 * Fuse game opens by default (`settings/fuseosPrefsStore.ts`, `WINDOW_LAUNCH_MIN_WIDTH`).
 */
export const COMPACT_MAX_WIDTH = 900;

/** Whether the physical viewport is too narrow for free-floating windows. */
export function isCompactViewport(viewport: Size): boolean {
  return viewport.width < COMPACT_MAX_WIDTH;
}

/** The cascade step each open window holds, by window id. */
export type SlotState = Record<string, number>;

/**
 * The cascade step of every open window: a window keeps the step it opened on for as long as it is open, and a
 * new one takes the lowest step no open window holds. Placement must not follow the stacking order, which
 * changes on every focus and close: a window that had never been dragged used to jump a step down and right
 * the moment a press on its Close button raised it, out from under the pointer, so the click never landed.
 * Returns `slots` itself when nothing changed.
 */
export function assignSlots(
  slots: SlotState,
  openIds: readonly string[],
): SlotState {
  const kept = Object.entries(slots).filter(([id]) => openIds.includes(id));
  const added = openIds.filter((id) => !Object.hasOwn(slots, id));
  if (added.length === 0 && kept.length === Object.keys(slots).length)
    return slots;
  const next: SlotState = Object.fromEntries(kept);
  const taken = new Set(Object.values(next));
  for (const id of added) {
    let slot = 0;
    while (taken.has(slot)) slot += 1;
    taken.add(slot);
    next[id] = slot;
  }
  return next;
}

/**
 * Cascaded default placement for the n-th window, sized relative to the
 * viewport unless the window asks for a size of its own (games that need room).
 */
export function defaultRect(index: number, viewport: Size, size?: Size): Rect {
  const width =
    size?.width ??
    Math.max(MIN_WINDOW_WIDTH, Math.min(760, Math.round(viewport.width * 0.7)));
  const height =
    size?.height ??
    Math.max(
      MIN_WINDOW_HEIGHT,
      Math.min(520, Math.round((viewport.height - TASKBAR_HEIGHT) * 0.7)),
    );
  const offset = 24 * (index % 8);
  return clampRect({ x: 48 + offset, y: 32 + offset, width, height }, viewport);
}

/** Keeps a window inside the desktop area (above the taskbar). */
export function clampRect(rect: Rect, viewport: Size): Rect {
  const areaHeight = Math.max(
    MIN_WINDOW_HEIGHT,
    viewport.height - TASKBAR_HEIGHT,
  );
  const width = Math.max(
    MIN_WINDOW_WIDTH,
    Math.min(rect.width, viewport.width),
  );
  const height = Math.max(MIN_WINDOW_HEIGHT, Math.min(rect.height, areaHeight));
  const x = Math.max(0, Math.min(rect.x, viewport.width - width));
  const y = Math.max(0, Math.min(rect.y, areaHeight - height));
  return { x, y, width, height };
}
