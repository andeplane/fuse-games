import ReactDOM from "react-dom/client";
import { PORTAL_GAMES } from "fuse-ui/portal";
import { createBrowserAnalytics } from "fuse-ui/analytics";
import { WEBAMP_OPTIONS } from "../winamp/webampLayout";
import { Phone } from "./Phone";
import {
  browserPhoneNavigation,
  browserWelcomePreference,
} from "./phoneNavigation";
import "./phone.css";

const analytics = createBrowserAnalytics("fuseos");
analytics.start({ role: "phone" });
analytics.track("App Opened", { embedded: false });
document.title = "Fuse Games";
const container = document.getElementById("app");
if (container) {
  ReactDOM.createRoot(container).render(
    <Phone
      games={PORTAL_GAMES}
      base={import.meta.env.BASE_URL}
      search={location.search}
      navigation={browserPhoneNavigation(window)}
      welcomePreference={browserWelcomePreference(window)}
      createPlayer={async () => {
        const { default: Webamp } = await import("webamp");
        const player = new Webamp(WEBAMP_OPTIONS);
        const render = player.renderInto.bind(player);
        const dispose = player.dispose.bind(player);
        let observer: ResizeObserver | undefined;
        player.renderInto = async (node) => {
          const parent = node.parentElement!;
          const fit = () => {
            // A minimized player remains mounted for audio but has no layout box.
            if (!parent.clientWidth || !parent.clientHeight) return;
            const landscape = parent.clientWidth > parent.clientHeight;
            const scale = landscape
              ? Math.min(parent.clientWidth / 550, parent.clientHeight / 232)
              : parent.clientWidth / 275;
            node.style.zoom = String(scale);
            node.dataset.landscape = String(landscape);
            node.style.width = `${landscape ? 550 : 275}px`;
            node.style.height = `${Math.max(landscape ? 232 : 464, parent.clientHeight / scale)}px`;
            node.style.setProperty(
              "--phone-player-height",
              `${parent.clientHeight / scale}px`,
            );
          };
          fit();
          observer = new ResizeObserver(fit);
          observer.observe(parent);
          await render(node);
        };
        player.dispose = () => {
          observer?.disconnect();
          dispose();
        };
        return player;
      }}
      gameLaunched={(game) =>
        analytics.track("Game Launched", { game, launch: "phone" })
      }
    />,
  );
}
