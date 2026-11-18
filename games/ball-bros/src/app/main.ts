import "fuse-ui/tokens.css";
import "fuse-ui/components.css";
import "fuse-ui/portal.css";
import "fuse-ui/social.css";
import "fuse-ui/results.css";
import { createTopBar } from "fuse-ui";
import { createGameSocial } from "fuse-ui/social";
import { createPlayMetrics, startGameAnalytics } from "fuse-ui/play-metrics";
import "./style.css";
import QRCode from "qrcode";
import {
  createEndpoints,
  createRoom,
  memberToken,
  PeerTransport,
} from "fuse-network-fe";
import { MAX_PACKET_BYTES } from "fuse-netcode";
import { BallRuntime } from "../online/runtime.js";
import { createRenderer } from "../render/arena.js";
import { Audio } from "./audio.js";
import { mountGame } from "./game-screen.js";
import { landing } from "./landing.js";
import { chosenMap, safeStore, session, NAME_KEY } from "./session.js";
import { installLifecycle } from "./lifecycle.js";
import { chosenAvatar } from "./avatars.js";
import { createRadio } from "./radio.js";
import { createResultsHistory } from "fuse-ui/results-history";

const root = document.querySelector<HTMLElement>("#app")!;
const analytics = startGameAnalytics("ball-bros");
const observePlay = createPlayMetrics(analytics.track, () => performance.now());
const endpoints = createEndpoints(
  {
    basePath: `${import.meta.env.BASE_URL}ballbros/`,
    apiOrigin: import.meta.env.VITE_API_ORIGIN,
  },
  location.origin,
);
const store = safeStore(() => localStorage);
const social = createGameSocial({
  gameId: "ball-bros",
  base: import.meta.env.BASE_URL,
  apiOrigin: import.meta.env.VITE_API_ORIGIN,
  document,
  window,
  fetch: (input, init) => fetch(input, init),
  track: analytics.track,
});
const playerStore = {
  getItem: (key: string) =>
    key === NAME_KEY
      ? (social.playerName(store.getItem(key)) ?? null)
      : store.getItem(key),
  setItem: (key: string, value: string) => store.setItem(key, value),
};
const muted = new URLSearchParams(location.search).has("mute");
const soundKey = "ball-bros-sound";
let soundEnabled = !muted && store.getItem(soundKey) !== "off";
let activeAudio: Audio | undefined;
let activeRadio: ReturnType<typeof createRadio> | undefined;
const sound = {
  forcedMute: muted,
  enabled: () => soundEnabled,
  setEnabled(on: boolean) {
    if (muted) return;
    soundEnabled = on;
    store.setItem(soundKey, on ? "on" : "off");
    if (activeAudio) {
      activeAudio.setMuted(!on);
    }
    activeRadio?.setMuted(!on);
  },
};
const link = (query = "") =>
  endpoints.appUrl(`${query}${muted ? (query ? "&mute" : "?mute") : ""}`);
const navigate = (query = "") => {
  history.pushState(null, "", link(query));
  render();
};
let destroy = () => {};
let generation = 0;
function render() {
  const mounted = ++generation;
  destroy();
  activeAudio = undefined;
  const radio = createRadio(
    document,
    import.meta.env.BASE_URL,
    new window.Audio(),
    { store, preview: muted },
  );
  activeRadio = radio;
  radio.setMuted(!soundEnabled);
  destroy = radio.destroy;
  root.replaceChildren();
  root.className = "";
  delete root.dataset.phase;
  const attachHeader = (
    top: HTMLElement,
    onOpenChange?: (open: boolean) => void,
  ) => {
    top.append(social.element());
    const brand =
      ([...top.children].find((node) => node.tagName === "A") as
        HTMLElement | undefined) ??
      top.querySelector<HTMLElement>(".fui-top-bar-brand");
    if (brand) brand.textContent = "BALL BROS";
    createTopBar({
      ...(onOpenChange ? { onOpenChange } : {}),
      music: false,
      radioControls: radio.element,
      playerOptions: () => radio.volumeControl,
      element: top,
      brand: brand ?? undefined,
      gameId: "ball-bros",
      sound,
    });
  };
  const mode = session(location.search, store, memberToken);
  if (mode.kind === "landing" || mode.kind === "invalid") {
    const screen = landing(root, {
      base: import.meta.env.BASE_URL,
      search: location.search,
      store: playerStore,
      create: () => createRoom(endpoints.apiUrl, fetch, "ball-bros"),
      navigate,
      active: () => generation === mounted,
    });
    const top = root.querySelector<HTMLElement>("header");
    if (top) attachHeader(top);
    if (mode.kind === "invalid")
      screen.error.textContent =
        "Invalid room code. Check your invite or create a new room.";
  } else {
    const online = mode.kind === "room" ? mode : undefined;
    const settings = {
      display: online?.shared ?? false,
      mapId: chosenMap(store),
    };
    let historyPlayer = "";
    const history = createResultsHistory({
      fetch: social.reportFetch,
      apiUrl: endpoints.apiUrl,
      gameId: "ball-bros",
      ...(online ? { room: { code: online.code, token: online.token } } : {}),
      signedIn: social.isSignedIn,
      playerId: () => historyPlayer,
      now: () => performance.now(),
    });
    const stop = mountGame(root, {
      attachHeader,
      online: online && {
        ...online,
        link: link(`?room=${online.code}`),
        displayLink: link(`?room=${online.code}&display=1`),
      },
      store: playerStore,
      ...(online
        ? { friends: social.friends, roomFriends: social.friends }
        : {}),
      settings,
      qr: (text) => QRCode.toDataURL(text, { margin: 1, width: 240 }),
      audio: (activeAudio = new Audio(!soundEnabled)),
      radio: activeRadio,
      renderer: (parent) => createRenderer(parent, import.meta.env.BASE_URL),
      runtime: (callbacks) =>
        new BallRuntime(
          {
            ...callbacks,
            ready(id, hostId) {
              historyPlayer = id;
              callbacks.ready(id, hostId);
            },
          },
          online
            ? {
                displayOnly: online.display,
                transport: (events) =>
                  social.transport(
                    online.code,
                    online.token,
                    events,
                    (events) =>
                      new PeerTransport(online.code, online.token, events, {
                        apiUrl: endpoints.apiUrl,
                        gameId: "ball-bros",
                        maxFastBytes: MAX_PACKET_BYTES,
                      }),
                  ),
              }
            : {},
          online?.code,
          settings,
          chosenAvatar(store),
        ),
      now: () => performance.now(),
      frame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (id) => cancelAnimationFrame(id),
      events: window,
      home: () => navigate(),
      retry: render,
      base: import.meta.env.BASE_URL,
      search: location.search,
      observePlay,
      history(snapshot) {
        if (online?.display) return;
        history.observe(snapshot.receipts, snapshot.confirmedTick);
      },
      closeHistory: history.close,
    });
    destroy = () => {
      stop();
      history.dispose();
    };
    activeRadio?.setMuted(!soundEnabled);
  }
}
window.addEventListener("popstate", render);
installLifecycle(window, {
  dispose: () => {
    generation++;
    destroy();
  },
  restore: render,
});
render();
