import { createOptionsMenu, type OptionsMenu } from "./options.js";

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
