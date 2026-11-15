import { button, createJoinByCode, el } from "fuse-ui";
import { AVATARS, isAvatar } from "../game/index.js";
import type { Store } from "./session.js";

/**
 * The menu's PLAY ONLINE side, the way Fuse Riders does rooms: CREATE ROOM, a code to join, and REJOIN for the last
 * room. Everything else is the room's: it asks for your name and face, and how it is played (each on their own
 * device, or a Shared TV with phones as the controllers) is ticked there.
 */
export interface OnlineKeys {
  last: string;
}

export interface OnlineOptions {
  store: Store;
  keys: OnlineKeys;
  valid(code: string): boolean;
  /** Creates a room and goes to it; a rejection's message is shown and CREATE ROOM comes back. */
  onCreate(): Promise<void>;
  onJoin(code: string): void;
}

/** The face remembered for rooms, or the first one. */
export function storedFace(store: Store, key: string): string {
  const value = safeGet(store, key);
  return isAvatar(value) ? value : "fox";
}
/** The face after `avatar` in the picker's order. */
export function nextFace(avatar: string): string {
  const at = (AVATARS as readonly string[]).indexOf(avatar);
  return AVATARS[(at + 1) % AVATARS.length]!;
}
/** The remembered room code, when it still looks like one. */
export function lastRoom(
  store: Store,
  key: string,
  valid: (code: string) => boolean,
): string | undefined {
  const code = safeGet(store, key)?.trim().toUpperCase();
  return code && valid(code) ? code : undefined;
}

export function createOnlineSheet(options: OnlineOptions): HTMLElement {
  const { store, keys } = options;
  const sheet = el("section", "", "fl-sheet fl-online");
  const field = (title: string, hint: string, ...body: HTMLElement[]) => {
    const block = el("div", "", "fl-field");
    block.append(el("h2", title, "fl-menu-title"));
    if (hint) block.append(el("p", hint, "fl-hint"));
    block.append(...body);
    return block;
  };

  const error = el("p", "", "fl-online-error");
  error.setAttribute("role", "alert");
  error.hidden = true;
  const fail = (message: string) => {
    error.textContent = message;
    error.hidden = false;
  };
  const create = button("CREATE ROOM", "fui-button-primary fl-create-room");
  create.onclick = async () => {
    error.hidden = true;
    create.disabled = true;
    create.textContent = "CREATING ROOM…";
    try {
      await options.onCreate();
    } catch (reason) {
      fail(reason instanceof Error ? reason.message : String(reason));
      create.disabled = false;
      create.textContent = "CREATE ROOM";
    }
  };

  const last = lastRoom(store, keys.last, options.valid);
  const join = createJoinByCode({
    valid: options.valid,
    onJoin: (code) => options.onJoin(code),
    onInvalid: fail,
    buttonText: "JOIN",
    placeholder: "Room code",
    invalidMessage: "Type the room's code, for example AB42XY",
    ...(last
      ? {
          rejoin: {
            code: last,
            title: "Back to the room you were in last",
            onRejoin: (code: string) => options.onJoin(code),
          },
        }
      : {}),
    classes: { root: "fl-join", input: "", button: "", rejoin: "fl-rejoin" },
  });

  sheet.append(
    field(
      "START A ROOM",
      "Everyone plays the same week at the same time, on their own device or around a Shared TV. Jobs and shelves are shared: first come, first served.",
      create,
    ),
    field("GOT A CODE?", "", join.row),
    error,
  );
  return sheet;
}

function safeGet(store: Store, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}
