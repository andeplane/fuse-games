import { seekDelta, type TransportKey } from "./playback.js";
import { tapColumn } from "./taps.js";

type LabShortcut =
  | { type: "play" | "delete" | "undo" | "record" | "record-from" }
  | { type: "mark" | "clear-selection" }
  | { type: "return-to-marker"; time: number }
  | { type: "seek"; seconds: number }
  | { type: "nudge"; direction: -1 | 1; fine: boolean }
  | { type: "tap"; column: number }
  | { type: "zoom"; factor: number }
  | { type: "scroll"; direction: -1 | 1 };

interface ShortcutState {
  readonly canNudge: boolean;
  readonly recording: boolean;
  readonly marker: number | undefined;
}

const PAGE_SHORTCUTS = new Map<string, LabShortcut>([
  ["Backspace", { type: "delete" }],
  ["Delete", { type: "delete" }],
  ["+", { type: "zoom", factor: 1.25 }],
  ["=", { type: "zoom", factor: 1.25 }],
  ["-", { type: "zoom", factor: 0.8 }],
  ["ArrowUp", { type: "scroll", direction: -1 }],
  ["ArrowDown", { type: "scroll", direction: 1 }],
  ["Escape", { type: "clear-selection" }],
]);

/** Resolve a shortcut after the page has given text inputs first use of the key. */
export function labShortcut(
  event: TransportKey,
  state: ShortcutState,
): LabShortcut | undefined {
  if (event.key === " ") return { type: "play" };
  const seconds = seekDelta(event);
  if (seconds !== undefined) return { type: "seek", seconds };
  if (event.key === "Enter")
    return state.marker === undefined
      ? undefined
      : { type: "return-to-marker", time: state.marker };
  const pageShortcut = PAGE_SHORTCUTS.get(event.key);
  if (pageShortcut) return pageShortcut;
  const key = event.key.toLowerCase();
  if (event.metaKey || event.ctrlKey)
    return key === "z" && !event.shiftKey && !event.altKey
      ? { type: "undo" }
      : undefined;
  if (event.altKey) return;
  if (key === "r") return { type: event.shiftKey ? "record-from" : "record" };
  if (key === "x") return { type: "mark" };
  if (state.canNudge && (key === "w" || key === "s"))
    return {
      type: "nudge",
      direction: key === "s" ? 1 : -1,
      fine: event.shiftKey,
    };
  if (!state.recording) return;
  const column = tapColumn(key);
  if (typeof column === "number") return { type: "tap", column };
}
