import { button, copyText } from "fuse-ui";

/**
 * The query that addresses one song at one level. The song select keeps the address bar on it, so the page's
 * address is always a link to what is selected, and a page opened on it opens the select on that song.
 */
export function songQuery(song: string, chart: number): string {
  return `?song=${encodeURIComponent(song)}&chart=${chart}`;
}

/**
 * A link that opens the game's song select on one song at one level. The page's developer flags (`mute`,
 * `debugtiming`) stay out of it: a link is for someone else's device.
 */
export function songLink(
  appUrl: (query: string) => string,
  song: string,
  chart: number,
): string {
  return appUrl(songQuery(song, chart));
}

export interface SongLinkButtonOptions {
  document: Document;
  /** The link for what the select shows now, or undefined when it has none (a player's own file). */
  link(): string | undefined;
  /** Writes the link to the clipboard; resolves false when it could not. Default: the kit's `copyText`. */
  copy?(text: string): Promise<boolean>;
  /** Runs `run` after `ms`; returns its cancel. Default: the page's timer. */
  later?(run: () => void, ms: number): () => void;
}
export interface SongLinkButton {
  /** SHARE: it acts on the selected song, so it belongs with the carousel (the picker's `tools`). */
  element: HTMLButtonElement;
  dispose(): void;
}

const LABEL = "SHARE";
/** How long the button says what happened before it reads SHARE again. */
export const SAID_MS = 1600;

/** The song select's SHARE button: copies a link to the selected song and level, and says so for a moment. */
export function createSongLinkButton(
  options: SongLinkButtonOptions,
): SongLinkButton {
  const element = button(LABEL, "fm-option fm-option-link", options.document);
  element.setAttribute("aria-label", "Copy a link to this song");
  // What happened is said to a screen reader too, without moving focus.
  element.setAttribute("aria-live", "polite");
  const copy = options.copy ?? ((text: string) => copyText(text));
  const later =
    options.later ??
    ((run: () => void, ms: number) => {
      const id = setTimeout(run, ms);
      return () => clearTimeout(id);
    });
  let cancel: (() => void) | undefined;
  const say = (text: string) => {
    cancel?.();
    element.textContent = text;
    cancel = later(() => {
      cancel = undefined;
      element.textContent = LABEL;
    }, SAID_MS);
  };
  element.onclick = async () => {
    const link = options.link();
    if (!link) return;
    const copied = await copy(link).catch(() => false);
    say(copied ? "COPIED" : "NO COPY");
  };
  return {
    element,
    dispose() {
      cancel?.();
      cancel = undefined;
    },
  };
}
