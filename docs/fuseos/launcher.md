# Fusteam

Fusteam is FuseOS's game launcher: a window in the olive "green skin" of the 2003–2006 Steam client. Every Windows desktop boot opens Winamp (queued and silent), Fusteam and MSN Messenger, in that order, including when that desktop is resized to phone width. The site's separate phone launcher remains unchanged. The first visit adds Dial-Up Networking above Messenger; a completed handshake is remembered in `fuseos.network.connected`. Fusteam lives under `packages/fuseos/src/launcher/` and is reached again from its desktop icon, Start > Programs > Fusteam, or `?open=fusteam`.

## What it shows

- **Tabs** across the top: My Games, Friends, Servers, News. My Games is the launcher's own page; Friends opens MSN Messenger, Servers opens Network Neighborhood, and News opens the Hall of Fame through its Start menu registration (a build without one keeps Fusteam's own News page). FRIENDS & CHAT in the bottom bar also opens MSN Messenger.
- **MY GAMES**: every game the portal lists (`FuseGamesContext`, from `games/*/portal.json`), each with its 16px icon (`public/fuseos/game-icons/<id>-16.png`, or an accent tile without one), name and last launch from Fusteam in this browser. **Last played** sorts newest first by default. Click the active header to switch between newest and oldest first. Unplayed games show as **Never** at the bottom in both directions. **Game** sorts by name A–Z. The first game is selected at open. Click selects, double click plays; with the list focused (it is, when the window is active), Up and Down move the selection and Enter plays.
- **Details** for the selected game: a carousel of three real captures (gameplay, menu and controls), name, tagline, **PLAY**, **PLAY IN NEW TAB**, "Status: Ready to play", a fake "Disk usage" (a stable hash of the id, `fakeDiskUsage`) and "Last played" (local to the browser, `lastPlayedStore.ts`). Click the main image to advance, pick a thumbnail, or use Previous/Next. Switching games resets to the first image. `portal.json` supplies `screenshots` (up to five unique gallery paths); `screenshot` remains the window loading backdrop. See `public/gallery/README.md` for capture commands. The LINKS column opens the selected game's **Leaderboard** in the Hall of Fame and **Friends** in MSN Messenger; there is no duplicate new-tab text link.
- **Bottom bar**: the embossed FUSTEAM wordmark where the old client had its publisher logo, **ADD A GAME...** (a Windows 98 message box explaining that games arrive through pull requests) and **FRIENDS & CHAT**.

**Release date** sorts within each tier, newest first on the first click. Games without a date show an em dash and sort below dated games in either direction. Set `releaseDate` in the game's `portal.json` as `YYYY-MM-DD` once its first playable PR has landed. The catalog uses the Oslo date of that merge as a release estimate. Fuse Riders uses the date of its [public beta](../online/PUBLIC-BETA-2026-09-14.md), and Fuse Craft uses its [first playable merge under the Neural Defence URL](https://github.com/andeplane/fuse-games/pull/417).

PLAY goes through the desktop's own launch path, `useFuseGameLauncher` (`fusegames/useFuseGameLauncher.ts`), like a desktop icon or the Start menu: the game opens in a window on the desktop, or is focused if its window is already open. When the launch preference (`settings/fuseosPrefsStore.ts`, the Games applet) is "tab", or it is unset on a touch or narrow device (`effectiveGameLaunch` over `LaunchDeviceContext`), the game opens in a browser tab instead through `DesktopDeps.openExternal`. The launch is reported to analytics there, so the launcher adds nothing of its own beyond the last-played record.

## Opening

The launcher is a single-instance window: `sameInstance` in `state/appState.ts` treats every `launcher` as the same window, so `open` focuses the one already open whatever asked, including a `?open=fusteam` deep link over a booted desktop. `openLauncher(commands, viewport)` (`useOpenLauncher.ts`) is the one way in: `commands.open({ kind: "launcher" }, { id: "launcher", maximized })`, maximized when the display is narrower than 960px or shorter than 700px (`shouldMaximizeLauncher`). The desktop icon calls it through `useOpenLauncher`; the Start menu through its registration (`startMenuRegistry.ts`, slot `programs`, so Fusteam sits under Programs after Accessories and Games); `useDesktopViewModel().openLauncher` serves the assistant and the rest.

## Boot

`withLauncherOnBoot` (`launcherBoot.ts`) wraps the desktop's `StateStore` in `main.tsx`: every `load()` restores Winamp, Fusteam and Messenger through the reducer's single-instance `open`. A stored launcher keeps its maximized state; a new one opens maximized on a small display. `LocalStorageDialUpSession` adds the first-run connection dialog until its handshake completes. `?open=` windows are reduced above this stack, so a deep link still lands on top.

The window is 900x600 (`LAUNCHER_WINDOW_SIZE`) and places itself centred on the desktop the first time it mounts (`centeredLauncherRect`); once moved, it stays where it was put for the session. At 720px of window width or less, the list stacks above the details (`@container` rules in `launcher.css`).

## Skin

`launcher.css` carries the look: the window background is the original client's GreenBG (#4c5844), inset panes DarkGreenBG (#3e4637), text DullGreen (#d8ded3), headings and hover Maize (#c4b550), the selected row MaizeBG (#91863c), bevels #7f8c75 over #282e22, Tahoma 11px with Arial for the game name. The launcher's title bar is restyled through `.window:has(.fst-root)` so `WindowChrome` is untouched: olive like the body, the title in plain weight, and only the minimize and close boxes (a double click on the title still maximizes). The icon is `FusteamLogo.tsx`, registered as `fusteam` in `ui/icons.tsx`.

## Dependencies

`LauncherDepsContext` supplies the last-played store; `DesktopDepsContext` supplies the clock and `openExternal`, and `LaunchDeviceContext` with `FuseOsPrefsStoreContext` decide window or tab. Tests get `createTestLauncherDeps` from `__mocks__/renderWithProviders.tsx` (an in-memory store), choose the device with `launchDevice: PHONE_DEVICE`, and can pass their own `store` to boot through the decorator.
