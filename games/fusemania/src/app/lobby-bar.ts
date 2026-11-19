import { button } from "fuse-ui";
import { createOptionsMenu, type OptionsMenu } from "./options.js";

export type LobbyAction =
  | { kind: "start"; label: string; enabled: boolean }
  | { kind: "ready"; pressed: boolean }
  | { kind: "none" };

/** The shared room's primary slot follows this device's current role. */
export function createLobbyAction(
  document: Document,
  onStart: () => void,
  onReady: (ready: boolean) => void,
) {
  const element = button("START", "fui-button-primary fm-start", document);
  element.hidden = true;
  let current: LobbyAction = { kind: "none" };
  element.onclick = () => {
    if (current.kind === "start" && current.enabled) onStart();
    if (current.kind === "ready") onReady(!current.pressed);
  };
  return {
    element,
    update(action: LobbyAction) {
      current = action;
      element.hidden = action.kind === "none";
      element.disabled = action.kind === "start" && !action.enabled;
      if (action.kind === "ready") {
        const label = action.pressed ? "READY ✓" : "READY";
        if (element.textContent !== label) element.textContent = label;
        element.setAttribute("aria-pressed", String(action.pressed));
      } else {
        element.removeAttribute("aria-pressed");
        if (action.kind === "start" && element.textContent !== action.label)
          element.textContent = action.label;
      }
    },
  };
}

export interface LobbyBar {
  /** Contextual shortcut to this player's scroll speed. */
  menu: OptionsMenu;
  /** For the room's header, before Settings and START. */
  headerActions: readonly Node[];
  /** Under the players: the song select and what the session is at. Never the speeds. */
  modes: readonly Node[];
}

/**
 * What a Fusemania room hands the shared room layout. A room's top is Back, Scroll speed, Room settings
 * and START. The speeds are
 * never a row in the lobby, and START is never under the song select.
 */
export function createLobbyBar(parts: {
  document: Document;
  /** The song select. */
  picker: HTMLElement;
  /** `createPlayOptions().element`: this player's speeds. */
  options: HTMLElement;
  /** Where a session is at: "SONG 2 OF 5". */
  session: HTMLElement;
  onOpenChange?: (open: boolean) => void;
}): LobbyBar {
  const menu = createOptionsMenu({
    document: parts.document,
    content: [parts.options],
    onOpenChange: parts.onOpenChange,
  });
  return {
    menu,
    headerActions: [menu.element],
    modes: [parts.picker, parts.session],
  };
}
