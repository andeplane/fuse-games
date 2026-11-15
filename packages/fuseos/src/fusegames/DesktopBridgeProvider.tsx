import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { BridgeEvent, BridgeRoom } from "fuse-ui/desktop-bridge";
import { MessengerGameContext } from "../friends/MessengerGameContext";
import { useWindowCommands } from "../windows/useWindowCommands";
import { DesktopBridge } from "./desktopBridge";

export interface DesktopBridgeSurface {
  origin: string;
  subscribe(listener: (event: BridgeEvent) => void): () => void;
  schedule(callback: () => void, ms: number): () => void;
}
const browserSurface: DesktopBridgeSurface = {
  get origin() {
    return window.location.origin;
  },
  subscribe(listener) {
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  },
  schedule(callback, ms) {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  },
};
export const DesktopBridgeSurfaceContext = createContext(browserSurface);
export const DesktopBridgeContext = createContext<DesktopBridge | undefined>(
  undefined,
);

export function DesktopBridgeProvider({ children }: { children: ReactNode }) {
  const surface = useContext(DesktopBridgeSurfaceContext);
  const commands = useWindowCommands();
  const [room, setRoom] = useState<BridgeRoom>();
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  const bridge = useMemo(
    () =>
      new DesktopBridge({
        origin: surface.origin,
        schedule: surface.schedule,
        changed: setRoom,
        openFriends: () => commandsRef.current.open({ kind: "friends" }),
      }),
    [surface],
  );
  useEffect(() => {
    const stop = surface.subscribe((event) => bridge.receive(event));
    return () => {
      stop();
      bridge.dispose();
    };
  }, [bridge, surface]);
  const messenger = useMemo(
    () => ({
      currentGame: room,
      invite: (id: string, accountId: string) => bridge.invite(id, accountId),
    }),
    [room, bridge],
  );
  return (
    <DesktopBridgeContext.Provider value={bridge}>
      <MessengerGameContext.Provider value={messenger}>
        {children}
      </MessengerGameContext.Provider>
    </DesktopBridgeContext.Provider>
  );
}
