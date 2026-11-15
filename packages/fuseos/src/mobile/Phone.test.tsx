import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createFakeWebampPlayer } from "../__mocks__/webampPlayer";
import { Phone, type PhoneProps } from "./Phone";
import type { WebampPlayer } from "../winamp/webampPlayer";
import type { PhoneNavigation } from "./phoneNavigation";

const games: PhoneProps["games"] = [
  {
    id: "fusemania",
    path: "fusemania/",
    name: "Fusemania",
    tagline: "Play the beat",
    mark: "FM",
    accent: "#16e7ff",
    order: 1,
  },
];
const props = (): PhoneProps => ({
  games,
  base: "/preview/",
  search: "?mute",
  createPlayer: async () => createFakeWebampPlayer(),
  gameLaunched: vi.fn(),
});

class Navigation implements PhoneNavigation {
  entries = ["home"];
  index = 0;
  listeners = new Set<() => void>();
  read = () => this.entries[this.index]!;
  push(value: string) {
    this.entries = [...this.entries.slice(0, this.index + 1), value];
    this.index++;
  }
  back = () => {
    this.index = Math.max(0, this.index - 1);
    this.listeners.forEach((fn) => fn());
  };
  forward = () => {
    this.index = Math.min(this.entries.length - 1, this.index + 1);
    this.listeners.forEach((fn) => fn());
  };
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
}

it("lists every game on paged Home, including games beyond the old six-icon limit", () => {
  const many = Array.from({ length: 25 }, (_, index) => ({
    ...games[0]!,
    id: `game-${index}`,
    name: `Game ${index}`,
  }));
  render(<Phone {...props()} games={many} />);
  for (const game of many)
    expect(screen.getByRole("button", { name: game.name })).toBeInTheDocument();
  expect(screen.getAllByRole("group", { name: /Apps page/ })).toHaveLength(3);
  expect(screen.getByRole("button", { name: "About" })).toBeVisible();
});

it("follows Back and Forward and restores the routed app after remount", () => {
  const navigation = new Navigation();
  const first = render(<Phone {...props()} navigation={navigation} />);
  fireEvent.click(screen.getByRole("button", { name: "Games" }));
  expect(navigation.read()).toBe("games");
  fireEvent.click(screen.getByRole("button", { name: "Play Fusemania" }));
  expect(navigation.read()).toBe("fusemania");
  act(() => navigation.back());
  expect(screen.getByRole("heading", { name: "Games" })).toBeVisible();
  act(() => navigation.forward());
  expect(screen.getByTitle("Fusemania")).not.toHaveAttribute("hidden");
  first.unmount();
  render(<Phone {...props()} navigation={navigation} />);
  expect(screen.getByTitle("Fusemania")).not.toHaveAttribute("hidden");
});

it("offers only the classic Home button on every phone screen without adding history on Home", async () => {
  const navigation = new Navigation();
  render(<Phone {...props()} navigation={navigation} />);
  const expectHomeOnly = () => {
    const controls = within(
      screen.getByRole("navigation", { name: "Phone navigation" }),
    );
    expect(controls.getAllByRole("button")).toHaveLength(1);
    expect(controls.getByRole("button", { name: "Home" })).toBeVisible();
    expect(controls.queryByText("Home")).toBeNull();
  };
  expectHomeOnly();
  fireEvent.click(screen.getByRole("button", { name: "Home" }));
  expect(navigation.entries).toEqual(["home"]);
  for (const app of ["Games", "About", "Fusemania", "Winamp"]) {
    fireEvent.click(screen.getByRole("button", { name: app }));
    if (app === "Winamp")
      await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expectHomeOnly();
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(navigation.read()).toBe("home");
  }
});

it("browses large screenshots and handles missing images", () => {
  render(
    <Phone
      {...props()}
      games={[
        { ...games[0]!, screenshot: "gallery/fusemania.jpg" },
        { ...games[0]!, id: "second", name: "Second" },
      ]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Games" }));
  expect(
    screen.getByRole("img", { name: "Fusemania gameplay" }),
  ).toHaveAttribute("src", "/preview/gallery/fusemania.jpg");
  fireEvent.error(screen.getByRole("img", { name: "Fusemania gameplay" }));
  expect(screen.getAllByText("Screenshot unavailable")).toHaveLength(2);
  expect(screen.queryByRole("button", { name: "Next game" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Previous game" })).toBeNull();
  const dots = screen.getByRole("navigation", { name: "Game pages" });
  expect(within(dots).getAllByRole("button")).toHaveLength(2);
  expect(
    within(dots).getByRole("button", { name: "Show Fusemania" }),
  ).toHaveAttribute("aria-current", "page");
  expect(screen.queryByRole("button", { name: "Play Second" })).toBeNull();
});

it("dismisses first-visit welcome durably and makes it available in About", () => {
  let seen = false;
  const preference = {
    seen: () => seen,
    dismiss: () => {
      seen = true;
    },
  };
  const first = render(<Phone {...props()} welcomePreference={preference} />);
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(screen.getByText(/collection of vibe-coded games/)).toBeVisible();
  const announcement = screen
    .getByText(/collection of vibe-coded games/)
    .closest("[aria-live]");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByText(/Shared libraries power multiplayer/)).toBeVisible();
  expect(
    screen
      .getByText(/Shared libraries power multiplayer/)
      .closest("[aria-live]"),
  ).toBe(announcement);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Let’s play" }));
  expect(seen).toBe(true);
  first.unmount();
  render(<Phone {...props()} welcomePreference={preference} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "About" }));
  fireEvent.click(screen.getByRole("button", { name: "Show welcome again" }));
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(screen.getByRole("button", { name: "Highlight 1" })).toHaveAttribute(
    "aria-current",
    "step",
  );
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("swipes welcome highlights without dismissing or treating vertical scrolling as a swipe", () => {
  const dismiss = vi.fn();
  render(
    <Phone {...props()} welcomePreference={{ seen: () => false, dismiss }} />,
  );
  const content = screen
    .getByText(/collection of vibe-coded games/)
    .closest(".welcome-content")!;
  fireEvent.touchStart(content, { touches: [{ clientX: 280, clientY: 200 }] });
  fireEvent.touchEnd(content, {
    changedTouches: [{ clientX: 80, clientY: 210 }],
  });
  expect(screen.getByText(/Shared libraries power multiplayer/)).toBeVisible();
  fireEvent.touchStart(content, { touches: [{ clientX: 280, clientY: 200 }] });
  fireEvent.touchEnd(content, {
    changedTouches: [{ clientX: 220, clientY: 350 }],
  });
  expect(screen.getByRole("button", { name: "Highlight 2" })).toHaveAttribute(
    "aria-current",
    "step",
  );
  expect(dismiss).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Highlight 3" }));
  fireEvent.click(screen.getByRole("button", { name: "Let’s play" }));
  expect(dismiss).toHaveBeenCalledOnce();
});

it("opens Winamp directly from its URL and retains it through browser navigation", async () => {
  const navigation = new Navigation();
  navigation.push("winamp");
  const player = createFakeWebampPlayer();
  render(
    <Phone
      {...props()}
      navigation={navigation}
      createPlayer={async () => player}
    />,
  );
  await waitFor(() => expect(player.renderedInto).toHaveLength(1));
  act(() => navigation.back());
  expect(screen.getByRole("heading", { name: "Fuse Games" })).toBeVisible();
  act(() => navigation.forward());
  expect(screen.getByRole("region", { name: "Winamp" })).toBeVisible();
  expect(player.disposed).toBe(false);
});

it("opens the scrollable catalogue and launches the game inside the phone with mute and site base", () => {
  const options = props();
  render(<Phone {...options} />);
  fireEvent.click(screen.getByRole("button", { name: "Games" }));
  expect(screen.getByRole("heading", { name: "Games" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Play Fusemania" }));
  expect(screen.getByTitle("Fusemania")).toHaveAttribute(
    "src",
    "/preview/fusemania/?mute",
  );
  expect(options.gameLaunched).toHaveBeenCalledWith("fusemania");
  fireEvent.click(screen.getByRole("button", { name: "Home" }));
  expect(screen.getByRole("heading", { name: "Fuse Games" })).toBeVisible();
});

it("retains one playing Winamp through minimize, game launch and restore, then disposes on unmount", async () => {
  const player = createFakeWebampPlayer();
  const createPlayer = vi.fn(async () => player);
  const { unmount } = render(
    <Phone {...props()} createPlayer={createPlayer} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Winamp" }));
  await waitFor(() => expect(player.renderedInto).toHaveLength(1));
  expect(player.volume).toBe(0);
  act(() => {
    player.play();
    player.pressMinimize();
  });
  expect(screen.getByRole("heading", { name: "Fuse Games" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Fusemania" }));
  expect(player.getMediaStatus()).toBe("PLAYING");
  expect(player.disposed).toBe(false);
  const gameFrame = screen.getByTitle("Fusemania");
  fireEvent.click(screen.getByRole("button", { name: "Home" }));
  fireEvent.click(screen.getByRole("button", { name: "Winamp" }));
  expect(screen.getByTitle("Fusemania")).toBe(gameFrame);
  expect(gameFrame).toHaveAttribute("hidden");
  fireEvent.click(screen.getByRole("button", { name: "Home" }));
  fireEvent.click(screen.getByRole("button", { name: "Fusemania" }));
  expect(screen.getByTitle("Fusemania")).toBe(gameFrame);
  expect(gameFrame).not.toHaveAttribute("hidden");
  fireEvent.click(screen.getByRole("button", { name: "Home" }));
  fireEvent.click(screen.getByRole("button", { name: "Winamp" }));
  expect(screen.getByRole("region", { name: "Winamp" })).toBeVisible();
  expect(createPlayer).toHaveBeenCalledTimes(1);
  expect(player.getMediaStatus()).toBe("PLAYING");
  unmount();
  expect(player.disposed).toBe(true);
});

it("offers a retry after a failed Winamp load", async () => {
  const createPlayer = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(createFakeWebampPlayer());
  render(<Phone {...props()} createPlayer={createPlayer} />);
  fireEvent.click(screen.getByRole("button", { name: "Winamp" }));
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  expect(createPlayer).toHaveBeenCalledTimes(2);
});

it("supports game deep links and an empty catalogue", () => {
  const { unmount } = render(<Phone {...props()} search="?open=fusemania" />);
  expect(screen.getByTitle("Fusemania")).toHaveAttribute(
    "src",
    "/preview/fusemania/",
  );
  unmount();
  render(<Phone {...props()} games={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "Games" }));
  expect(screen.getByText("No games are available yet.")).toBeVisible();
});

it("keeps a laid-out mount while Winamp loads after returning Home", async () => {
  let finish: (player: WebampPlayer) => void = () => {
    throw new Error("loader not called");
  };
  const player = createFakeWebampPlayer();
  const createPlayer = () =>
    new Promise<WebampPlayer>((resolve) => {
      finish = resolve;
    });
  render(<Phone {...props()} createPlayer={createPlayer} />);
  fireEvent.click(screen.getByRole("button", { name: "Winamp" }));
  fireEvent.click(screen.getByRole("button", { name: "Home" }));
  const background = screen.getByLabelText("Winamp", { selector: "section" });
  expect(background).not.toHaveAttribute("hidden");
  expect(background).toHaveAttribute("data-background-loading", "true");
  await act(async () => {
    finish(player);
  });
  expect(player.renderedInto).toHaveLength(1);
  expect(background).toHaveAttribute("hidden");
});
