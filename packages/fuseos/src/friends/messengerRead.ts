import { createContext } from "react";

/**
 * Which of a buddy's messages this browser has already shown, so an incoming message opens its chat once and a
 * reload does not pop old ones up again. Keyed by both public ids (two accounts can share a browser), bounded.
 */
export interface MessengerReadStore {
  /** The newest message time shown in that conversation, or undefined when this browser never showed it. */
  lastRead(me: string, buddy: string): number | undefined;
  markRead(me: string, buddy: string, at: number): void;
}

/** The slice of `Storage` the store needs; tests hand in a Map-backed one. */
export interface ReadStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const READ_STORAGE_KEY = "fuseos.messenger.read";
/** Conversations remembered at most; the oldest marks go first. */
export const MAX_READ_MARKS = 200;

export function createMessengerReadStore(
  storage: ReadStorage | undefined,
): MessengerReadStore {
  let marks: Record<string, number> = {};
  try {
    const parsed: unknown = JSON.parse(
      storage?.getItem(READ_STORAGE_KEY) ?? "{}",
    );
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed))
      for (const [key, value] of Object.entries(parsed))
        if (
          /^[0-9a-f]{20}:[0-9a-f]{20}$/.test(key) &&
          Number.isSafeInteger(value)
        )
          marks[key] = value as number;
  } catch {
    marks = {};
  }
  const save = () => {
    try {
      storage?.setItem(READ_STORAGE_KEY, JSON.stringify(marks));
    } catch {
      // Private mode or a full quota: the marks still hold for this page.
    }
  };
  return {
    lastRead: (me, buddy) => marks[`${me}:${buddy}`],
    markRead(me, buddy, at) {
      const key = `${me}:${buddy}`;
      if ((marks[key] ?? -1) >= at) return;
      const { [key]: _old, ...rest } = marks;
      const entries = Object.entries(rest).sort((a, b) => a[1] - b[1]);
      marks = Object.fromEntries([
        ...entries.slice(Math.max(0, entries.length - MAX_READ_MARKS + 1)),
        [key, at],
      ]);
      save();
    },
  };
}

function browserStorage(): ReadStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export const MessengerReadContext = createContext<MessengerReadStore>(
  createMessengerReadStore(browserStorage()),
);
