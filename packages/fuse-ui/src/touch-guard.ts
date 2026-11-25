import { isEmbeddedPage } from "./embedded.js";

/**
 * Phones play the games, not read them: on a touch screen nothing outside a text field can be selected, long-pressed
 * into a Copy/Look Up callout or double-tapped into a zoom, and the first tap takes the page full screen where the
 * browser allows it (Android Chrome; an iPhone's Safari has no full screen for a page, so it plays in the tab, or full
 * screen from the home screen through the web app manifest).
 *
 * `createTopBar` installs it once per document, so every game has it. The styles that go with it are in
 * `touch-guard.css`.
 */

/** Where text stays selectable: fields people type in. */
const EDITABLE =
  "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

/** The parts of a browser the guard uses; the page adapts a window, a test supplies a fake. */
export interface TouchGuardDevice {
  /** The primary pointer is a finger. */
  touch(): boolean;
  /** Both sides fit a phone. */
  phone(): boolean;
  /** The page runs inside another page's frame (a FuseOS window): full screen belongs to that page. */
  embedded(): boolean;
  fullscreen(): boolean;
  /** Asks for full screen; the browser may refuse, which is not an error. */
  enterFullscreen(): Promise<void>;
}

const installedOn = new WeakSet<Document>();

export function browserTouchDevice(win: Window): TouchGuardDevice {
  const doc = win.document;
  return {
    // A window without media queries (a bare DOM) is not a phone.
    touch: () => win.matchMedia?.("(pointer: coarse)").matches ?? false,
    phone: () => Math.min(win.innerWidth, win.innerHeight) <= 540,
    embedded: () => isEmbeddedPage(win),
    fullscreen: () => !!doc.fullscreenElement,
    async enterFullscreen() {
      const root = doc.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => void;
      };
      if (root.requestFullscreen)
        await root.requestFullscreen({ navigationUI: "hide" });
      else root.webkitRequestFullscreen?.();
    },
  };
}

/** Installs the guard on `doc` once; later calls do nothing. */
export function installTouchGuard(
  doc: Document,
  device: TouchGuardDevice | undefined = doc.defaultView
    ? browserTouchDevice(doc.defaultView)
    : undefined,
): void {
  if (!device || installedOn.has(doc)) return;
  installedOn.add(doc);
  doc.documentElement.classList.add("fui-touch-guard");
  const closest = (target: EventTarget | null, selector: string) => {
    const node = target as Node | null;
    const element =
      node?.nodeType === 1 ? (node as Element) : node?.parentElement;
    return !!element?.closest?.(selector);
  };
  const editable = (target: EventTarget | null) => closest(target, EDITABLE);
  // Selection and callouts: CSS does most of it, these catch what Safari still starts (a double tap on a label). A
  // link keeps its long press (copy or share an invite); a double tap never zooms because of `touch-action` in the CSS.
  doc.addEventListener(
    "selectstart",
    (event) => {
      if (device.touch() && !editable(event.target)) event.preventDefault();
    },
    { capture: true },
  );
  doc.addEventListener(
    "contextmenu",
    (event) => {
      if (
        device.touch() &&
        !editable(event.target) &&
        !closest(event.target, "a[href]")
      )
        event.preventDefault();
    },
    { capture: true },
  );
  // Full screen on the first tap: a click is what every browser counts as the player's own gesture (a touch that
  // ended a scroll is not). A refusal asks again on the next one.
  let asking = false;
  doc.addEventListener(
    "click",
    () => {
      if (
        asking ||
        !device.touch() ||
        !device.phone() ||
        device.embedded() ||
        device.fullscreen()
      )
        return;
      asking = true;
      device.enterFullscreen().then(
        () => undefined,
        () => {
          asking = false;
        },
      );
    },
    { capture: true, passive: true },
  );
}
