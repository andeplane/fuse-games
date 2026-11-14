import { legacyRidersLink } from "./routes.js";

if (legacyRidersLink(location.search)) {
  location.replace(
    `${import.meta.env.BASE_URL}fuse-riders/${location.search}${location.hash}`,
  );
} else {
  // A single top-level microphone owner keeps a playtest alive while FuseOS game windows change.
  // It is tooling: a failed chunk or install must never keep the desktop from mounting.
  void Promise.all([import("fuse-ui/playtest"), import("fuse-ui/playtest.css")])
    .then(([{ installBrowserPlaytest }]) =>
      installBrowserPlaytest({
        document,
        window,
        gameId: "fuseos",
        recordingOnly: true,
      }),
    )
    .catch(() => undefined);
  // FuseOS: the Windows 95 desktop that fronts every game (packages/fuseos). It mounts itself into #app.
  await import("../packages/fuseos/src/main.tsx");
}
