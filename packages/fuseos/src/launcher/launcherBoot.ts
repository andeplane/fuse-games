import type { AppState } from "../state/appState";
import { appStateReducer } from "../state/appState";
import type { StateStore } from "../state/stateStore";
import type { Size } from "../windows/windowManager";
import type { DialUpSession } from "../sounds/dialup/dialUpSession";
import { FRIENDS_WINDOW_ID } from "../desktop/startMenuRegistry";

import { LAUNCHER_WINDOW_ID, shouldMaximizeLauncher } from "./launcherFacts";

/**
 * The state as the desktop boots it: the one launcher window on top, restored, not minimized. A stored launcher
 * (by kind, whatever id a `?open=fusteam` link once gave it) keeps its size state; a new one opens maximized on a
 * display it would not fit. The reducer's own `open` does both.
 */
export function withLauncherOnTop(state: AppState, viewport: Size): AppState {
  return appStateReducer(state, {
    type: "open",
    content: { kind: "launcher" },
    options: {
      id: LAUNCHER_WINDOW_ID,
      maximized: shouldMaximizeLauncher(viewport),
    },
  });
}

/**
 * Startup opens Winamp (queued and silent), Fusteam and Messenger, including on a phone.
 * Single-instance apps are focused rather than doubled. First-run dial-up sits above Messenger
 * until a completed connection is remembered. Deep links open above this startup stack.
 */
export function withBootWindows(
  state: AppState,
  viewport: Size,
  session?: DialUpSession,
): AppState {
  const withWinamp = appStateReducer(state, {
    type: "open",
    content: { kind: "winamp" },
  });
  const withLauncher = withLauncherOnTop(withWinamp, viewport);
  const withMessenger = appStateReducer(withLauncher, {
    type: "open",
    content: { kind: "friends" },
    options: { id: FRIENDS_WINDOW_ID },
  });
  return session && !session.connected
    ? appStateReducer(withMessenger, {
        type: "open",
        content: { kind: "dialup", then: { kind: "friends" } },
      })
    : withMessenger;
}

/**
 * Wraps the desktop store with the three startup programs and the first-run connection dialog.
 * Saves pass straight through; `?open=` windows are opened above this stack.
 */
export function withLauncherOnBoot(
  store: StateStore,
  viewport: () => Size,
  session?: DialUpSession,
): StateStore {
  return {
    load: () => withBootWindows(store.load(), viewport(), session),
    save: (state) => store.save(state),
  };
}
