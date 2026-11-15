import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createFakeWebampPlayer } from "../__mocks__/webampPlayer";
import { Phone, type PhoneProps } from "./Phone";
import type { WebampPlayer } from "../winamp/webampPlayer";

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

it("opens the scrollable catalogue and launches the game inside the phone with mute and site base", () => {
  const options = props();
  render(<Phone {...options} />);
  fireEvent.click(screen.getByRole("button", { name: "Games" }));
  expect(screen.getByRole("heading", { name: "Games" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /Fusemania/ }));
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
  fireEvent.click(screen.getByRole("button", { name: "Winamp" }));
  expect(screen.getByTitle("Fusemania")).toBe(gameFrame);
  expect(gameFrame).toHaveAttribute("hidden");
  fireEvent.click(screen.getByRole("button", { name: "Resume game" }));
  expect(screen.getByTitle("Fusemania")).toBe(gameFrame);
  expect(gameFrame).not.toHaveAttribute("hidden");
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
