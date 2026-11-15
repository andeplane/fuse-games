/**
 * The host's settings choices that the room has not answered yet. A settings command carries the whole settings
 * object, built from the last frame, so two choices made within one frame would send the first one's old value
 * back with the second (tick Shared TV, then tap an AI level: the level's command unticks the TV). A choice waits
 * here until a frame shows it, or for `holdMs` when the room never takes it.
 */
export function createPendingSettings<Settings extends object>(
  now: () => number,
  holdMs = 2000,
) {
  let pending: {
    key: keyof Settings;
    value: Settings[keyof Settings];
    at: number;
  }[] = [];
  return {
    /** `settings` with the unanswered choices, then `patch`, laid over it: what the next command sends. */
    with(settings: Settings, patch: Partial<Settings>): Settings {
      const time = now();
      pending = pending.filter((entry) => time - entry.at < holdMs);
      const next = { ...settings };
      for (const entry of pending) next[entry.key] = entry.value;
      return { ...next, ...patch };
    },
    /** The room took the command that carried `patch`. */
    sent(patch: Partial<Settings>): void {
      const time = now();
      for (const key of Object.keys(patch) as (keyof Settings)[]) {
        pending = pending.filter((entry) => entry.key !== key);
        pending.push({
          key,
          value: patch[key] as Settings[keyof Settings],
          at: time,
        });
      }
    },
    /** A frame's settings: every choice it shows is answered. */
    answered(settings: Settings): void {
      pending = pending.filter((entry) => settings[entry.key] !== entry.value);
    },
  };
}
