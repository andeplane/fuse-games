import ReactDOM from "react-dom/client";
import { PORTAL_GAMES } from "fuse-ui/portal";
import { createBrowserAnalytics } from "fuse-ui/analytics";
import { WEBAMP_OPTIONS } from "../winamp/webampLayout";
import { Phone } from "./Phone";
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
      createPlayer={async () => {
        const { default: Webamp } = await import("webamp");
        return new Webamp(WEBAMP_OPTIONS);
      }}
      gameLaunched={(game) =>
        analytics.track("Game Launched", { game, launch: "phone" })
      }
    />,
  );
}
