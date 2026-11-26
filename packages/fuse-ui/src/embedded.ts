/** The two window references the embedding test reads; a real `Window`, or a fake in a test. */
export type EmbeddingView = { readonly self: unknown; readonly top: unknown };

/**
 * Whether the page runs inside another page's frame — a Fuse game in a FuseOS desktop window — rather than as
 * the browser tab itself. Reading `top` never throws, even across origins (its properties would); a view that
 * has no `top` at all (a bare DOM in a test) is not embedded.
 */
export function isEmbeddedPage(
  view: EmbeddingView | null | undefined,
): boolean {
  if (!view) return false;
  try {
    return (
      view.top !== undefined && view.top !== null && view.top !== view.self
    );
  } catch {
    return false;
  }
}

/** FuseOS marks only its phone shell's game iframe. An ordinary desktop window keeps its own frame. */
export function phoneGameFrame(doc: Document): Element | undefined {
  const frame = doc.defaultView?.frameElement;
  return frame?.hasAttribute("data-fui-phone-game") ? frame : undefined;
}

export const PHONE_GAME_PLAYING = "data-fui-phone-playing";
export const PHONE_GAME_HOME = "fui-phone-home";

/** A menu action that minimizes the current game without replacing its iframe. */
export function createPhoneGameHome(doc: Document, close?: () => void) {
  if (!phoneGameFrame(doc)) return;
  const home = doc.createElement("button");
  home.type = "button";
  home.textContent = "FuseOS Home";
  home.className = "fui-phone-home";
  home.dataset.fuiMenuDismiss = "";
  home.onclick = () => {
    close?.();
    doc.dispatchEvent(new Event(PHONE_GAME_HOME));
  };
  return home;
}

/** Mirror the live game's own phase onto its same-origin frame so the shell can give it the entire viewport. */
export function setPhoneGamePlaying(doc: Document, playing: boolean): void {
  const frame = phoneGameFrame(doc);
  if (!frame) return;
  doc.documentElement.toggleAttribute(PHONE_GAME_PLAYING, playing);
  frame.toggleAttribute(PHONE_GAME_PLAYING, playing);
}
