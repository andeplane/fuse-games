import { createContext } from "react";
import { safeStorage, type SafeStorage } from "fuse-ui/safe-storage";

import type { WindowContent } from "../../state/appState";

/**
 * Whether the cosmetic connection has completed. Production remembers success across reloads;
 * Cancel only skips the dialog for this page. This is independent of account authentication.
 */
export interface DialUpSession {
  readonly connected: boolean;
  markConnected(remember?: boolean): void;
}

export const DIAL_UP_CONNECTED_KEY = "fuseos.network.connected";

/** The remembered handshake is cosmetic; account sign-in remains Firebase's responsibility. */
export class LocalStorageDialUpSession implements DialUpSession {
  private skipped = false;
  constructor(
    private readonly storage: SafeStorage = safeStorage(() => localStorage),
  ) {}
  get connected(): boolean {
    return this.skipped || this.storage.getItem(DIAL_UP_CONNECTED_KEY) === "1";
  }
  markConnected(remember = true): void {
    this.skipped = true;
    if (remember) this.storage.setItem(DIAL_UP_CONNECTED_KEY, "1");
  }
}

export class MemoryDialUpSession implements DialUpSession {
  connected = false;
  markConnected(): void {
    this.connected = true;
  }
}

/** Tests use memory; the composition root provides the remembered browser session. */
export const DialUpSessionContext = createContext<DialUpSession>(
  new MemoryDialUpSession(),
);

/**
 * The window to open for `content` behind the dial-up gate: the dialog that opens `content`
 * on connect while the session is offline, `content` itself afterwards. The integrator wraps
 * Network Neighborhood and Friends with this:
 *
 *     commands.open(withDialUp({ kind: "network" }, session));
 */
export function withDialUp(
  content: WindowContent,
  session: DialUpSession,
): WindowContent {
  return session.connected ? content : { kind: "dialup", then: content };
}
