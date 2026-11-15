import { useEffect, useRef, useState } from "react";
import type { PortalGame } from "fuse-ui/portal";
import { fuseSoundtrack } from "../winamp/fuseTracks";
import type { WebampPlayer } from "../winamp/webampPlayer";

export interface PhoneProps {
  games: readonly PortalGame[];
  base: string;
  search: string;
  createPlayer: () => Promise<WebampPlayer>;
  gameLaunched: (id: string) => void;
}
type Screen = "home" | "games" | "winamp" | string;

function AppIcon({ game, base }: { game: PortalGame; base: string }) {
  return (
    <span
      aria-hidden="true"
      className="phone-app-icon"
      style={{ background: game.accent }}
    >
      {game.icon ? <img src={`${base}${game.icon}`} alt="" /> : game.mark}
    </span>
  );
}

/** A single player lives above navigation: minimizing or opening a game never disposes its audio. */
export function Phone({
  games,
  base,
  search,
  createPlayer,
  gameLaunched,
}: PhoneProps) {
  const initial = new URLSearchParams(search).get("open")?.split(",")[0];
  const [screen, setScreen] = useState<Screen>(
    games.some((game) => game.id === initial) ? initial! : "home",
  );
  const [musicOpened, setMusicOpened] = useState(false);
  const [activeGame, setActiveGame] = useState(() =>
    games.find((game) => game.id === initial),
  );
  const [attempt, setAttempt] = useState(0);
  const [musicState, setMusicState] = useState("loading");
  const mount = useRef<HTMLDivElement>(null);
  const selected = games.find((game) => game.id === screen);
  const muted = new URLSearchParams(search).has("mute");
  const home = () => setScreen("home");

  useEffect(() => {
    if (!musicOpened) return;
    let cancelled = false;
    let player: WebampPlayer | undefined;
    const subscriptions: (() => void)[] = [];
    setMusicState("loading");
    void createPlayer()
      .then(async (created) => {
        if (cancelled) {
          created.dispose();
          return;
        }
        player = created;
        if (created.onWillClose)
          subscriptions.push(
            created.onWillClose((cancel) => {
              cancel();
              home();
            }),
          );
        subscriptions.push(
          created.onMinimize(home),
          created.onClose(() => {
            created.reopen?.();
            home();
          }),
        );
        if (muted) created.setVolume?.(0);
        created.appendTracks(fuseSoundtrack(base).map(({ track }) => track));
        if (mount.current) await created.renderInto(mount.current);
        if (!cancelled) setMusicState("ready");
      })
      .catch(() => {
        if (!cancelled) setMusicState("error");
      });
    return () => {
      cancelled = true;
      subscriptions.forEach((unsubscribe) => unsubscribe());
      player?.dispose();
    };
  }, [musicOpened, attempt, createPlayer, base, muted]);

  const launch = (game: PortalGame) => {
    gameLaunched(game.id);
    setActiveGame(game);
    setScreen(game.id);
  };
  return (
    <div className={`phone-shell ${screen === "home" ? "phone-home" : ""}`}>
      <header className="phone-status">
        <span>Fuse</span>
        <span className="phone-island" aria-hidden="true" />
        <svg
          width="47"
          height="14"
          viewBox="0 0 47 14"
          fill="currentColor"
          aria-label="Connected"
        >
          <path d="M0 10h3v4H0zm5-3h3v7H5zm5-3h3v10h-3zm5-3h3v13h-3z" />
          <rect
            x="25"
            y="2"
            width="18"
            height="10"
            rx="3"
            fill="none"
            stroke="currentColor"
          />
          <path d="M28 5h12v4H28zm16 0h3v4h-3z" />
        </svg>
      </header>
      {screen === "home" ? (
        <main className="phone-homescreen">
          <h1>Fuse Games</h1>
          <div className="phone-apps">
            <button className="phone-app" onClick={() => setScreen("games")}>
              <span className="phone-folder phone-app-icon" aria-hidden="true">
                {games.slice(0, 9).map((game) => (
                  <AppIcon key={game.id} game={game} base={base} />
                ))}
              </span>
              Games
            </button>
            <button
              className="phone-app"
              onClick={() => {
                setMusicOpened(true);
                setScreen("winamp");
              }}
            >
              <span
                className="phone-app-icon phone-winamp-icon"
                aria-hidden="true"
              >
                <svg viewBox="0 0 64 64">
                  <path
                    d="M35 5 13 36h17l-4 23 25-34H33z"
                    fill="#ffcf44"
                    stroke="#fff2b9"
                    strokeWidth="2"
                  />
                </svg>
              </span>
              Winamp
            </button>
            {games.slice(0, 6).map((game) => (
              <button
                key={game.id}
                className="phone-app"
                onClick={() => launch(game)}
              >
                <AppIcon game={game} base={base} />
                {game.name}
              </button>
            ))}
          </div>
          <p className="phone-home-hint">Your next game is one tap away.</p>
        </main>
      ) : null}
      {screen === "games" ? (
        <main className="phone-games">
          <h1>Games</h1>
          <p>Pick something to play.</p>
          <ul>
            {games.map((game) => (
              <li key={game.id}>
                <button onClick={() => launch(game)}>
                  <AppIcon game={game} base={base} />
                  <span>
                    <strong>{game.name}</strong>
                    <span>{game.tagline}</span>
                  </span>
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 18 18"
                    fill="none"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path d="m6 3 6 6-6 6" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
          {games.length === 0 ? <p>No games are available yet.</p> : null}
        </main>
      ) : null}
      {musicOpened ? (
        <section
          className="phone-music"
          hidden={screen !== "winamp" && musicState !== "loading"}
          data-background-loading={
            screen !== "winamp" && musicState === "loading"
          }
          aria-hidden={screen !== "winamp"}
          aria-label="Winamp"
        >
          <h1>Winamp</h1>
          <p>Music keeps playing when you go Home.</p>
          {musicState !== "ready" ? (
            <div role="status">
              {musicState === "error" ? (
                <>
                  <p>Winamp could not start.</p>
                  <button onClick={() => setAttempt(attempt + 1)}>
                    Try again
                  </button>
                </>
              ) : (
                "Starting Winamp…"
              )}
            </div>
          ) : null}
          <div className="phone-webamp" ref={mount} />
        </section>
      ) : null}
      {activeGame ? (
        <iframe
          className="phone-game"
          hidden={!selected}
          title={activeGame.name}
          src={`${base}${activeGame.path}${muted ? "?mute" : ""}`}
          allow="autoplay; fullscreen; gamepad"
          onLoad={(event) => {
            // Games share our origin. Keep their portal's top-level links inside
            // the phone so opening the catalogue never tears down the player.
            const page = event.currentTarget.contentDocument;
            const root = new URL(base, event.currentTarget.ownerDocument.URL);
            page?.addEventListener("click", (click) => {
              const anchor = (click.target as Element | null)?.closest?.("a");
              if (!anchor || anchor.target !== "_top") return;
              const destination = new URL(anchor.href);
              if (
                destination.origin !== root.origin ||
                destination.pathname !== root.pathname
              )
                return;
              const game = games.find(
                (entry) => entry.id === destination.searchParams.get("open"),
              );
              click.preventDefault();
              if (game) launch(game);
              else setScreen("games");
            });
          }}
        />
      ) : null}
      <nav className="phone-navigation" aria-label="Phone navigation">
        {activeGame && !selected ? (
          <button
            className="phone-return"
            onClick={() => setScreen(activeGame.id)}
          >
            Resume game
          </button>
        ) : null}
        {screen !== "home" ? (
          <button onClick={home} aria-label="Home">
            <span className="phone-home-bar" />
          </button>
        ) : (
          <span className="phone-home-bar" />
        )}
        {musicOpened && screen !== "winamp" && screen !== "home" ? (
          <button
            className="phone-music-shortcut"
            onClick={() => setScreen("winamp")}
          >
            Winamp
          </button>
        ) : null}
      </nav>
    </div>
  );
}
