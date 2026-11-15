import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PortalGame } from "fuse-ui/portal";
import { fuseSoundtrack } from "../winamp/fuseTracks";
import type { WebampPlayer } from "../winamp/webampPlayer";
import type { PhoneNavigation, WelcomePreference } from "./phoneNavigation";
import { PhoneWelcome } from "./PhoneWelcome";

export interface PhoneProps {
  games: readonly PortalGame[];
  base: string;
  search: string;
  createPlayer: () => Promise<WebampPlayer>;
  gameLaunched: (id: string) => void;
  navigation?: PhoneNavigation;
  welcomePreference?: WelcomePreference;
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
  navigation,
  welcomePreference,
}: PhoneProps) {
  const initial =
    navigation?.read() ??
    new URLSearchParams(search).get("open")?.split(",")[0];
  const validScreen = (value: string | undefined) =>
    value &&
    (["home", "games", "winamp", "about"].includes(value) ||
      games.some((game) => game.id === value))
      ? value
      : "home";
  const [screen, setScreen] = useState<Screen>(validScreen(initial));
  const [musicOpened, setMusicOpened] = useState(initial === "winamp");
  const [welcome, setWelcome] = useState(() =>
    welcomePreference ? !welcomePreference.seen() : false,
  );
  const pages = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  useLayoutEffect(() => {
    if (screen === "home" && pages.current)
      pages.current.scrollLeft = page * pages.current.clientWidth;
  }, [screen]);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const navigate = (value: string) => {
    navigation?.push(value);
    setScreen(value);
    if (value === "winamp") setMusicOpened(true);
    const game = games.find((entry) => entry.id === value);
    if (game) setActiveGame(game);
  };
  const [activeGame, setActiveGame] = useState(() =>
    games.find((game) => game.id === initial),
  );
  const [attempt, setAttempt] = useState(0);
  const [musicState, setMusicState] = useState("loading");
  const mount = useRef<HTMLDivElement>(null);
  const selected = games.find((game) => game.id === screen);
  const muted = new URLSearchParams(search).has("mute");
  const home = () => navigate("home");
  const dismissWelcome = () => {
    welcomePreference?.dismiss();
    setWelcome(false);
  };
  useEffect(
    () =>
      navigation?.subscribe(() => {
        const next = validScreen(navigation.read());
        setScreen(next);
        if (next === "winamp") setMusicOpened(true);
        const game = games.find((entry) => entry.id === next);
        if (game) setActiveGame(game);
      }),
    [navigation, games],
  );

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
    navigate(game.id);
  };
  return (
    <div className={`phone-shell ${screen === "home" ? "phone-home" : ""}`}>
      <header className="phone-status" hidden={screen !== "home"}>
        <span>Fuse</span>
        <span>Games & music</span>
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
          <div
            className="phone-pages"
            ref={pages}
            onScroll={(event) => {
              const el = event.currentTarget;
              setPage(Math.round(el.scrollLeft / el.clientWidth));
            }}
          >
            {Array.from(
              { length: Math.ceil((games.length + 3) / 12) },
              (_, index) => (
                <div
                  className="phone-apps"
                  key={index}
                  role="group"
                  aria-label={`Apps page ${index + 1}`}
                >
                  {index === 0 ? (
                    <>
                      <button
                        className="phone-app"
                        onClick={() => navigate("games")}
                      >
                        <span
                          className="phone-folder phone-app-icon"
                          aria-hidden="true"
                        >
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
                          navigate("winamp");
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
                      <button
                        className="phone-app"
                        onClick={() => navigate("about")}
                      >
                        <span
                          className="phone-app-icon phone-about-icon"
                          aria-hidden="true"
                        >
                          <svg
                            viewBox="0 0 48 48"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                          >
                            <circle cx="24" cy="24" r="17" />
                            <path d="M24 21v13m0-21v3" />
                          </svg>
                        </span>
                        About
                      </button>
                    </>
                  ) : null}
                  {games
                    .slice(
                      index === 0 ? 0 : index * 12 - 3,
                      (index + 1) * 12 - 3,
                    )
                    .map((game) => (
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
              ),
            )}
          </div>
          <nav className="phone-page-dots" aria-label="App pages">
            {Array.from(
              { length: Math.ceil((games.length + 3) / 12) },
              (_, index) => (
                <button
                  key={index}
                  aria-label={`Go to page ${index + 1}`}
                  aria-current={page === index ? "page" : undefined}
                  onClick={() =>
                    pages.current?.scrollTo({
                      left: index * pages.current.clientWidth,
                      behavior: "smooth",
                    })
                  }
                >
                  <span />
                </button>
              ),
            )}
          </nav>
          <p className="phone-home-hint">Swipe for more apps</p>
        </main>
      ) : null}
      {screen === "games" ? (
        <main className="phone-games">
          <h1>Games</h1>
          {games.length > 0 ? (
            <>
              <div className="phone-carousel-controls">
                <button
                  disabled={carouselIndex === 0}
                  onClick={() => setCarouselIndex(carouselIndex - 1)}
                  aria-label="Previous game"
                >
                  ←
                </button>
                <span>
                  {carouselIndex + 1} / {games.length}
                </span>
                <button
                  disabled={carouselIndex === games.length - 1}
                  onClick={() => setCarouselIndex(carouselIndex + 1)}
                  aria-label="Next game"
                >
                  →
                </button>
              </div>
              <GameCard
                game={games[carouselIndex]!}
                base={base}
                launch={launch}
                previous={() =>
                  setCarouselIndex(Math.max(0, carouselIndex - 1))
                }
                next={() =>
                  setCarouselIndex(
                    Math.min(games.length - 1, carouselIndex + 1),
                  )
                }
              />
            </>
          ) : null}
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
          key={activeGame.id}
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
              else navigate("games");
            });
          }}
        />
      ) : null}
      {screen === "about" ? (
        <main className="phone-about">
          <h1>About Fuse Games</h1>
          <p>
            A collection of vibe-coded games, built on shared libraries for
            multiplayer, rooms and accounts.
          </p>
          <h2>Every game on Home</h2>
          <p>
            Swipe between app pages, or open Games to browse screenshots and
            pick something to play.
          </p>
          <h2>Your music comes along</h2>
          <p>
            Open Winamp to play Fuse Radio. Use Home or Back to keep listening
            while you browse and play.
          </p>
          <h2>Find your way back</h2>
          <p>
            Each app has its own link. Browser Back and Forward work, and
            refreshing reopens the same app. A live game or music playback may
            need to reconnect or restart after refreshing.
          </p>
          <button onClick={() => setWelcome(true)}>Show welcome again</button>
        </main>
      ) : null}
      <nav className="phone-navigation" aria-label="Phone navigation">
        {screen !== "home" ? (
          <button onClick={() => (navigation ? navigation.back() : home())}>
            Back
          </button>
        ) : null}
        {activeGame && !selected ? (
          <button
            className="phone-return"
            onClick={() => navigate(activeGame.id)}
          >
            Resume game
          </button>
        ) : null}
        {screen !== "home" ? (
          <button onClick={home} aria-label="Home">
            Home
          </button>
        ) : (
          <span className="phone-home-bar" />
        )}
        {musicOpened && screen !== "winamp" && screen !== "home" ? (
          <button
            className="phone-music-shortcut"
            onClick={() => navigate("winamp")}
          >
            Winamp
          </button>
        ) : null}
      </nav>
      {welcome ? <PhoneWelcome dismiss={dismissWelcome} /> : null}
    </div>
  );
}

function GameCard({
  game,
  base,
  launch,
  previous,
  next,
}: {
  game: PortalGame;
  base: string;
  launch: (game: PortalGame) => void;
  previous: () => void;
  next: () => void;
}) {
  const touch = useRef<number | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [game.id]);
  return (
    <article
      className="phone-game-card"
      onTouchStart={(event) => {
        touch.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        if (touch.current !== null) {
          const delta =
            (event.changedTouches[0]?.clientX ?? touch.current) - touch.current;
          if (delta > 50) previous();
          else if (delta < -50) next();
        }
        touch.current = null;
      }}
    >
      {game.screenshot && !failed ? (
        <img
          className="phone-game-shot"
          src={`${base}${game.screenshot}`}
          alt={`${game.name} gameplay`}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="phone-game-shot phone-shot-fallback">
          <AppIcon game={game} base={base} />
          <span>Screenshot unavailable</span>
        </div>
      )}
      <h2>{game.name}</h2>
      <p>{game.tagline}</p>
      <button className="phone-play" onClick={() => launch(game)}>
        Play {game.name}
      </button>
    </article>
  );
}
