import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ProviderOptions } from "../__mocks__/renderWithProviders";
import {
  PHONE_DEVICE,
  FIXTURE_GAMES,
  renderWithProviders,
} from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import type { StartMenuRegistration } from "../desktop/startMenuRegistry";
import {
  START_MENU_REGISTRATIONS,
  StartMenuRegistryContext,
} from "../desktop/startMenuRegistry";
import { MemoryFuseOsPrefsStore } from "../settings/fuseosPrefsStore";
import { MemoryDialUpSession } from "../sounds/dialup/dialUpSession";

import { MemoryLastPlayedStore } from "./lastPlayedStore";
import { LAUNCHER_WINDOW_ID } from "./launcherFacts";
import {
  ADD_GAME_MESSAGE,
  HALL_OF_FAME_REGISTRATION_IDS,
} from "./useLauncherViewModel";

/** The Start menu of a build the Hall of Fame is not in. */
const WITHOUT_HALL_OF_FAME = START_MENU_REGISTRATIONS.filter(
  (entry) => !HALL_OF_FAME_REGISTRATION_IDS.includes(entry.id),
);

/** The desktop with the launcher open, as every boot has it. */
function renderLauncher(
  options: ProviderOptions = {},
  registrations: readonly StartMenuRegistration[] = START_MENU_REGISTRATIONS,
) {
  const result = renderWithProviders(
    <StartMenuRegistryContext.Provider value={registrations}>
      <Desktop />
    </StartMenuRegistryContext.Provider>,
    {
      initialState: {
        version: 1,
        windows: [
          {
            id: LAUNCHER_WINDOW_ID,
            kind: "launcher",
            minimized: false,
            maximized: false,
          },
        ],
      },
      ...options,
    },
  );
  const launcher = screen.getByRole("dialog", { name: "Fusteam" });
  return { ...result, launcher, inside: within(launcher) };
}

describe("LauncherWindow", () => {
  it("browses distinct screenshots with image, thumbnails and previous/next, resetting on game change", async () => {
    const user = userEvent.setup();
    const games = FIXTURE_GAMES.map((game) => ({
      ...game,
      screenshots: [
        `gallery/${game.id}.jpg`,
        `gallery/${game.id}-menu.jpg`,
        `gallery/${game.id}-controls.jpg`,
      ],
    }));
    const { inside } = renderLauncher({ games });
    const image = () =>
      inside.getByRole("img", { name: /Fuseball screenshot \d of 3/ });
    expect(image()).toHaveAttribute("src", "/fuse-riders/gallery/fuseball.jpg");
    await user.click(
      inside.getByRole("button", { name: "Next Fuseball screenshot" }),
    );
    expect(image()).toHaveAttribute(
      "src",
      "/fuse-riders/gallery/fuseball-menu.jpg",
    );
    await user.click(
      inside.getByRole("button", { name: "Show Fuseball screenshot 3" }),
    );
    expect(image()).toHaveAttribute(
      "src",
      "/fuse-riders/gallery/fuseball-controls.jpg",
    );
    await user.click(inside.getByRole("button", { name: "Next screenshot" }));
    expect(image()).toHaveAttribute("src", "/fuse-riders/gallery/fuseball.jpg");
    await user.click(
      inside.getByRole("button", { name: "Previous screenshot" }),
    );
    expect(image()).toHaveAttribute(
      "src",
      "/fuse-riders/gallery/fuseball-controls.jpg",
    );
    await user.click(inside.getByRole("option", { name: "Fuse Birds" }));
    expect(
      inside.getByRole("img", { name: "Fuse Birds screenshot 1 of 3" }),
    ).toHaveAttribute("src", "/fuse-riders/gallery/fuse-birds.jpg");
  });

  it("opens the selected game's leaderboard, including when the Hall of Fame is already open", async () => {
    const user = userEvent.setup();
    const { inside } = renderLauncher();
    await user.click(inside.getByRole("button", { name: "Leaderboard" }));
    const board = await screen.findByRole("dialog", { name: "Hall of Fame" });
    expect(within(board).getByRole("combobox")).toHaveValue("fuseball");
    await user.click(inside.getByRole("option", { name: "Fuse Birds" }));
    await user.click(inside.getByRole("button", { name: "Leaderboard" }));
    expect(within(board).getByRole("combobox")).toHaveValue("fuse-birds");
    expect(
      screen.getAllByRole("dialog", { name: "Hall of Fame" }),
    ).toHaveLength(1);
  });
  it("lists every game under MY GAMES with the first selected, its screenshot, tagline and facts", () => {
    const { inside } = renderLauncher();
    expect(inside.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "My Games",
      "Friends",
      "Servers",
      "News",
    ]);
    expect(inside.getByRole("tab", { name: "My Games" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const list = inside.getByRole("listbox", { name: "My Games" });
    const rows = within(list).getAllByRole("option");
    expect(
      rows.map((row) => row.querySelector(".fst-row-name")?.textContent),
    ).toEqual(["Fuseball", "Fuse Riders", "Fuse Birds"]);
    expect(rows[0]).toHaveAccessibleDescription("Never");
    expect(inside.getByRole("option", { name: "Fuseball" })).toBe(rows[0]);
    expect(rows[0]).toHaveAttribute("aria-selected", "true");
    expect(rows[0]?.querySelector("img")).toHaveAttribute(
      "src",
      "/fuse-riders/fuseos/game-icons/fuseball-16.png",
    );
    expect(rows[1]?.querySelector("[data-icon='tile']")).not.toBeNull();
    // The list has keyboard focus, so the arrows work right after boot.
    expect(list).toHaveFocus();

    const details = inside.getByRole("region", { name: "Fuseball details" });
    expect(
      within(details).getByRole("img", { name: "Fuseball screenshot 1 of 1" }),
    ).toHaveAttribute("src", "/fuse-riders/gallery/fuseball.jpg");
    expect(details).toHaveTextContent("Five-a-side with rockets");
    expect(details).toHaveTextContent("Status:Ready to play");
    expect(details).toHaveTextContent(/Disk usage:\d+ MB/);
    expect(details).toHaveTextContent("Last played:Never");
    const links = within(details).getByRole("navigation", { name: "Links" });
    expect(within(links).queryByText("Open in new tab")).toBeNull();
    expect(
      within(links).getByRole("button", { name: "Leaderboard" }),
    ).toBeInTheDocument();
    expect(inside.getByText("FUSTEAM")).toBeInTheDocument();
  });

  it("selects a row on click and shows a placeholder for a game without a screenshot", async () => {
    const user = userEvent.setup();
    const { inside } = renderLauncher();
    await user.click(inside.getByRole("option", { name: "Fuse Riders" }));
    expect(inside.getByRole("option", { name: "Fuse Riders" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const details = inside.getByRole("region", { name: "Fuse Riders details" });
    expect(
      within(details).getByRole("img", {
        name: "Fuse Riders has no screenshot yet",
      }),
    ).toHaveTextContent("FR");
    expect(screen.queryByRole("dialog", { name: "Fuse Riders" })).toBeNull();
  });

  it("walks the list with the arrow keys, stopping at the ends, and plays with Enter", async () => {
    const user = userEvent.setup();
    const { inside } = renderLauncher();
    const list = inside.getByRole("listbox", { name: "My Games" });
    list.focus();
    await user.keyboard("{ArrowUp}");
    expect(inside.getByRole("option", { name: "Fuseball" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(inside.getByRole("option", { name: "Fuse Birds" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(list).toHaveAttribute(
      "aria-activedescendant",
      "fst-game-fuse-birds",
    );
    await user.keyboard("{ArrowUp}{Enter}");
    expect(
      await screen.findByRole("dialog", { name: "Fuse Riders" }),
    ).toBeInTheDocument();
    expect(screen.getByTitle("Fuse Riders")).toHaveAttribute(
      "src",
      "/fuse-riders/fuse-riders/",
    );
  });

  it("plays the selected game from PLAY, focusing its window when it is already open, and records when", async () => {
    const user = userEvent.setup();
    const lastPlayed = new MemoryLastPlayedStore();
    const { inside, launcher, desktopDeps } = renderLauncher({
      launcherDeps: { lastPlayed },
    });
    await user.click(inside.getByRole("option", { name: "Fuseball" }));
    await user.click(inside.getByRole("button", { name: "Play Fuseball" }));
    const game = await screen.findByRole("dialog", { name: "Fuseball" });
    expect(game).toHaveAttribute("data-active", "true");
    expect(lastPlayed.get()).toEqual({ fuseball: desktopDeps.now() });
    expect(
      inside.getByRole("region", { name: "Fuseball details" }),
    ).toHaveTextContent("Last played:Today, 12:34");

    fireEvent.mouseDown(launcher);
    expect(game).toHaveAttribute("data-active", "false");
    await user.click(inside.getByRole("button", { name: "Play Fuseball" }));
    expect(screen.getAllByRole("dialog", { name: "Fuseball" })).toHaveLength(1);
    expect(game).toHaveAttribute("data-active", "true");
  });

  it("opens the game's own page in a new tab from PLAY IN NEW TAB and records when, even when windows are the preference", async () => {
    const user = userEvent.setup();
    const lastPlayed = new MemoryLastPlayedStore();
    const { inside, desktopDeps } = renderLauncher({
      launcherDeps: { lastPlayed },
    });
    await user.click(
      inside.getByRole("button", { name: "Play Fuseball in new tab" }),
    );
    expect(desktopDeps.openExternal).toHaveBeenCalledTimes(1);
    expect(desktopDeps.openExternal).toHaveBeenCalledWith(
      "/fuse-riders/fuseball/",
    );
    expect(screen.queryByRole("dialog", { name: "Fuseball" })).toBeNull();
    expect(lastPlayed.get()).toEqual({ fuseball: desktopDeps.now() });
    expect(
      inside.getByRole("region", { name: "Fuseball details" }),
    ).toHaveTextContent("Last played:Today, 12:34");
  });

  it("plays the selected row in a new tab with Shift+Enter", async () => {
    const user = userEvent.setup();
    const lastPlayed = new MemoryLastPlayedStore();
    const { inside, desktopDeps } = renderLauncher({
      launcherDeps: { lastPlayed },
    });
    inside.getByRole("listbox", { name: "My Games" }).focus();
    await user.keyboard("{ArrowDown}{Shift>}{Enter}{/Shift}");
    expect(desktopDeps.openExternal).toHaveBeenCalledWith(
      "/fuse-riders/fuse-riders/",
    );
    expect(screen.queryByRole("dialog", { name: "Fuse Riders" })).toBeNull();
    expect(lastPlayed.get()).toEqual({ "fuse-riders": desktopDeps.now() });
  });

  it("plays on a double click of a row", async () => {
    const user = userEvent.setup();
    const { inside } = renderLauncher();
    await user.dblClick(inside.getByRole("option", { name: "Fuse Birds" }));
    expect(
      await screen.findByRole("dialog", { name: "Fuse Birds" }),
    ).toBeInTheDocument();
  });

  it("opens the game in a browser tab when that is the launch preference", async () => {
    const user = userEvent.setup();
    const { inside, desktopDeps } = renderLauncher({
      prefsStore: new MemoryFuseOsPrefsStore({ gameLaunch: "tab" }),
    });
    await user.click(inside.getByRole("button", { name: "Play Fuseball" }));
    expect(desktopDeps.openExternal).toHaveBeenCalledWith(
      "/fuse-riders/fuseball/",
    );
    expect(screen.queryByRole("dialog", { name: "Fuseball" })).toBeNull();
  });

  it("launches in a tab on a touch device when nothing is chosen, and in a window with a mouse", async () => {
    const user = userEvent.setup();
    const touch = renderLauncher({ launchDevice: PHONE_DEVICE });
    await user.click(
      touch.inside.getByRole("button", { name: "Play Fuseball" }),
    );
    expect(touch.desktopDeps.openExternal).toHaveBeenCalledWith(
      "/fuse-riders/fuseball/",
    );
    touch.unmount();

    const mouse = renderLauncher();
    await user.click(
      mouse.inside.getByRole("button", { name: "Play Fuseball" }),
    );
    expect(mouse.desktopDeps.openExternal).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "Fuseball" }),
    ).toBeInTheDocument();
  });

  it("sorts My Games by most recent launch and lets the player switch to name order", async () => {
    const user = userEvent.setup();
    let now = Date.UTC(1998, 5, 25, 12, 34);
    const { inside } = renderLauncher({
      desktopDeps: { now: () => now },
      launcherDeps: {
        lastPlayed: new MemoryLastPlayedStore({
          fuseball: Date.UTC(1998, 5, 24, 8, 0),
          "fuse-riders": Date.UTC(1998, 5, 25, 8, 0),
        }),
      },
    });
    const list = inside.getByRole("listbox", { name: "My Games" });
    const birds = within(list).getByRole("option", { name: "Fuse Birds" });
    const riders = within(list).getByRole("option", { name: "Fuse Riders" });
    const ball = within(list).getByRole("option", { name: "Fuseball" });
    const rows = () => within(list).getAllByRole("option");
    const byDate = inside.getByRole("button", { name: "Sort by last played" });
    const byName = inside.getByRole("button", { name: "Sort by game name" });

    expect(rows()).toEqual([riders, ball, birds]);
    expect(byDate).toHaveAttribute("aria-pressed", "true");
    expect(riders).toHaveAttribute("aria-selected", "true");
    expect(riders).toHaveAccessibleDescription("Today, 08:00");
    expect(ball).toHaveAccessibleDescription("Yesterday");
    expect(birds).toHaveAccessibleDescription("Never");

    expect(byDate).toHaveAccessibleDescription("Newest first");
    await user.click(byDate);
    expect(rows()).toEqual([ball, riders, birds]);
    expect(byDate).toHaveAccessibleDescription("Oldest first");
    expect(riders).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Enter}");
    expect(rows()).toEqual([riders, ball, birds]);
    expect(byDate).toHaveAccessibleDescription("Newest first");

    byName.focus();
    await user.keyboard("{Enter}");
    expect(rows()).toEqual([birds, riders, ball]);
    expect(byName).toHaveAttribute("aria-pressed", "true");
    expect(riders).toHaveAttribute("aria-selected", "true");
    expect(byName).toHaveFocus();

    await user.click(byDate);
    expect(rows()).toEqual([riders, ball, birds]);
    list.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}{Shift>}{Enter}{/Shift}");
    expect(rows()).toEqual([birds, riders, ball]);
    expect(birds).toHaveAttribute("aria-selected", "true");
    expect(birds).toHaveAccessibleDescription("Today, 12:34");

    now = Date.UTC(1998, 5, 26);
    await user.click(ball);
    expect(birds).toHaveAccessibleDescription("Yesterday");
  });

  it("opens Fuse Messenger and Network Neighborhood from their tabs, dialling in first, and stays on My Games", async () => {
    const user = userEvent.setup();
    const { inside, dialUpSession } = renderLauncher();
    await user.click(inside.getByRole("tab", { name: "Friends" }));
    // Nothing has connected yet this session: Dial-Up Networking comes first; Cancel skips the modem.
    await user.click(
      within(screen.getByRole("dialog", { name: "Connect To" })).getByRole(
        "button",
        { name: "Cancel" },
      ),
    );
    expect(dialUpSession.connected).toBe(true);
    expect(
      await screen.findByRole("dialog", { name: "Fuse Messenger" }),
    ).toBeInTheDocument();
    await user.click(inside.getByRole("tab", { name: "Servers" }));
    expect(
      await screen.findByRole("dialog", { name: "Network Neighborhood" }),
    ).toBeInTheDocument();
    expect(inside.getByRole("tab", { name: "My Games" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      inside.getByRole("listbox", { name: "My Games" }),
    ).toBeInTheDocument();
  });

  it("opens the Hall of Fame from News, as its own window, and stays on My Games", async () => {
    const user = userEvent.setup();
    const { inside, store } = renderLauncher();
    await user.click(inside.getByRole("tab", { name: "News" }));
    expect(
      screen.getByRole("dialog", { name: "Hall of Fame" }),
    ).toBeInTheDocument();
    expect(inside.getByRole("tab", { name: "My Games" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    // One Hall of Fame, however often the tab is pressed.
    await user.click(inside.getByRole("tab", { name: "News" }));
    expect(
      store.load().windows.filter((window) => window.kind === "halloffame"),
    ).toHaveLength(1);
  });

  it("shows its own News page in a build without the Hall of Fame, and back", async () => {
    const user = userEvent.setup();
    const { inside } = renderLauncher({}, WITHOUT_HALL_OF_FAME);
    await user.click(inside.getByRole("tab", { name: "News" }));
    expect(inside.getByRole("tab", { name: "News" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(inside.getByRole("tabpanel")).toHaveTextContent(
      "Fusteam launcher released",
    );
    expect(inside.queryByRole("listbox")).toBeNull();
    await user.click(inside.getByRole("tab", { name: "My Games" }));
    expect(
      inside.getByRole("listbox", { name: "My Games" }),
    ).toBeInTheDocument();
  });

  it("opens the Hall of Fame from News when the build registers one", async () => {
    const user = userEvent.setup();
    const opened: string[] = [];
    const registrations: StartMenuRegistration[] = [
      ...WITHOUT_HALL_OF_FAME,
      {
        slot: "programs",
        id: HALL_OF_FAME_REGISTRATION_IDS[0] ?? "halloffame",
        label: "Hall of Fame",
        icon: "games",
        open: (_commands, viewport) =>
          opened.push(`${viewport.width}x${viewport.height}`),
      },
    ];
    const { inside } = renderLauncher({}, registrations);
    await user.click(inside.getByRole("tab", { name: "News" }));
    expect(opened).toHaveLength(1);
    expect(inside.getByRole("tab", { name: "My Games" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("FRIENDS & CHAT and the Friends link open Fuse Messenger, ADD A GAME... a message box", async () => {
    const user = userEvent.setup();
    const dialUpSession = new MemoryDialUpSession();
    dialUpSession.markConnected();
    const { inside } = renderLauncher({ dialUpSession });
    await user.click(inside.getByRole("button", { name: "FRIENDS & CHAT" }));
    const messenger = await screen.findByRole("dialog", {
      name: "Fuse Messenger",
    });
    await user.click(within(messenger).getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("dialog", { name: "Fuse Messenger" })).toBeNull();
    await user.click(
      within(inside.getByRole("navigation", { name: "Links" })).getByRole(
        "button",
        { name: "Friends" },
      ),
    );
    expect(
      await screen.findByRole("dialog", { name: "Fuse Messenger" }),
    ).toBeInTheDocument();
    await user.click(inside.getByRole("button", { name: "ADD A GAME..." }));
    // The message box is titled after the launcher, so two dialogs carry the name.
    const boxes = await screen.findAllByRole("dialog", { name: "Fusteam" });
    expect(boxes).toHaveLength(2);
    const message = screen
      .getByText(
        (_content, element) =>
          element?.tagName === "P" && element.textContent === ADD_GAME_MESSAGE,
      )
      .closest("section");
    expect(message).not.toBeNull();
    if (!message) return;
    expect(message.querySelector("svg[data-icon='info']")).not.toBeNull();
    await user.click(within(message).getByRole("button", { name: "OK" }));
    expect(screen.getAllByRole("dialog", { name: "Fusteam" })).toHaveLength(1);
  });

  it("says so when no Fuse games are installed", () => {
    const { inside } = renderLauncher({ games: [] });
    expect(inside.getByRole("listbox", { name: "My Games" })).toHaveTextContent(
      "No games installed",
    );
    expect(
      inside.getByRole("region", { name: "No game selected" }),
    ).toHaveTextContent("No Fuse games are installed on this desktop.");
    expect(inside.queryByRole("button", { name: /^Play/ })).toBeNull();
  });

  it("is reached from Start > Programs > Fusteam and from ?open=fusteam", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Desktop />, { initialOpen: [{ kind: "launcher" }] });
    expect(screen.getByRole("dialog", { name: "Fusteam" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Start/ }));
    const menu = screen.getByRole("menu", { name: "Start menu" });
    await user.click(within(menu).getByRole("menuitem", { name: "Programs" }));
    const item = within(menu).getByRole("menuitem", { name: "Fusteam" });
    expect(item.querySelector("svg[data-icon='fusteam']")).not.toBeNull();
    await user.click(item);
    expect(screen.getAllByRole("dialog", { name: "Fusteam" })).toHaveLength(1);
  });
});
