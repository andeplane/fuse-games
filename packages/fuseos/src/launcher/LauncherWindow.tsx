import type { KeyboardEvent } from "react";
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { AppIcon } from "../ui/icons";
import { WindowManagerContext } from "../windows/windowManagerContext";

import { centeredLauncherRect, formatLastPlayed } from "./launcherFacts";
import type { LauncherGame, LauncherViewModel } from "./useLauncherViewModel";
import { LAUNCHER_TABS, useLauncherViewModel } from "./useLauncherViewModel";

import "./launcher.css";

export type LauncherWindowProps = {
  windowId: string;
  active: boolean;
};

function GameRowIcon({ game }: { game: LauncherGame }) {
  if (game.icon) return <AppIcon icon={game.icon} size={16} />;
  return (
    <span
      className="fst-tile"
      style={{ background: game.accent }}
      aria-hidden
      data-icon="tile"
    />
  );
}

function Screenshot({ game }: { game: LauncherGame }) {
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const images = game.screenshotUrls;
  const url = images[index];
  const move = (direction: number) =>
    setIndex(
      (current) => (current + direction + images.length) % images.length,
    );
  if (url)
    return (
      <div
        className="fst-carousel"
        role="region"
        aria-label={`${game.name} screenshots`}
        aria-roledescription="carousel"
      >
        <button
          type="button"
          className="fst-shot"
          aria-label={`Next ${game.name} screenshot`}
          onClick={() => move(1)}
        >
          {failed.includes(url) ? (
            <span className="fst-shot-error">
              Screenshot unavailable. Choose another below.
            </span>
          ) : (
            <img
              className="fst-shot-image"
              src={url}
              alt={`${game.name} screenshot ${index + 1} of ${images.length}`}
              draggable={false}
              onError={() => setFailed((current) => [...current, url])}
            />
          )}
        </button>
        {images.length > 1 ? (
          <div className="fst-carousel-controls">
            <button
              type="button"
              className="fst-button"
              aria-label="Previous screenshot"
              onClick={() => move(-1)}
            >
              ‹
            </button>
            <div className="fst-thumbnails" aria-label="Choose screenshot">
              {images.map((image, number) => (
                <button
                  type="button"
                  key={image}
                  className="fst-thumbnail"
                  aria-label={`Show ${game.name} screenshot ${number + 1}`}
                  aria-pressed={index === number}
                  onClick={() => setIndex(number)}
                >
                  <img src={image} alt="" loading="lazy" draggable={false} />
                </button>
              ))}
            </div>
            <span className="fst-shot-count" role="status">
              {index + 1} / {images.length}
            </span>
            <button
              type="button"
              className="fst-button"
              aria-label="Next screenshot"
              onClick={() => move(1)}
            >
              ›
            </button>
          </div>
        ) : null}
      </div>
    );
  return (
    <div
      className="fst-shot-missing"
      role="img"
      aria-label={`${game.name} has no screenshot yet`}
    >
      <span style={{ color: game.accent }}>{game.mark}</span>
    </div>
  );
}

function GamesPage({ vm, active }: { vm: LauncherViewModel; active: boolean }) {
  const list = useRef<HTMLDivElement>(null);
  // The window that boots focused answers the arrow keys at once, like the old client's list.
  useEffect(() => {
    if (active) list.current?.focus();
  }, [active]);
  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>(
      '[aria-selected="true"]',
    );
    if (row && typeof row.scrollIntoView === "function")
      row.scrollIntoView({ block: "nearest" });
  }, [vm.selected?.id, vm.groups]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowDown":
        vm.selectNext();
        break;
      case "ArrowUp":
        vm.selectPrevious();
        break;
      case "Enter":
        if (event.shiftKey) vm.playInNewTab();
        else vm.play();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const { selected, details } = vm;
  return (
    <div className="fst-games">
      <section className="fst-list-col" aria-labelledby="fst-my-games">
        <h2 className="fst-heading" id="fst-my-games">
          My Games
        </h2>
        <div className="fst-list-head" role="group" aria-label="Sort games">
          <button
            type="button"
            aria-label="Sort by game name"
            aria-pressed={vm.sort === "name"}
            onClick={vm.sortByName}
          >
            Game
          </button>
          <button
            type="button"
            className="fst-last-played"
            aria-label="Sort by last played"
            aria-pressed={vm.sort !== "name"}
            aria-description={
              vm.sort === "name"
                ? undefined
                : vm.sort === "oldest"
                  ? "Oldest first"
                  : "Newest first"
            }
            data-sort-direction={
              vm.sort === "newest" ? "descending" : undefined
            }
            onClick={vm.toggleLastPlayedSort}
          >
            Last played
          </button>
        </div>
        <div
          ref={list}
          className="fst-list"
          role="listbox"
          aria-labelledby="fst-my-games"
          tabIndex={0}
          aria-activedescendant={
            selected ? `fst-game-${selected.id}` : undefined
          }
          onKeyDown={onKeyDown}
        >
          {vm.groups.map(({ tier, games }) => (
            <div key={tier} role="group" aria-label={tier}>
              <div className="fst-tier" aria-hidden>
                {tier}
              </div>
              {games.map((game) => {
                const isSelected = game.id === selected?.id;
                return (
                  <div
                    key={game.id}
                    id={`fst-game-${game.id}`}
                    role="option"
                    aria-labelledby={`fst-game-name-${game.id}`}
                    aria-describedby={`fst-game-played-${game.id}`}
                    aria-selected={isSelected}
                    className={`fst-row ${isSelected ? "selected" : ""}`}
                    onClick={() => vm.select(game.id)}
                    onDoubleClick={() => vm.playGame(game.id)}
                  >
                    <GameRowIcon game={game} />
                    <span
                      id={`fst-game-name-${game.id}`}
                      className="fst-row-name"
                    >
                      {game.name}
                    </span>
                    <span
                      id={`fst-game-played-${game.id}`}
                      className="fst-row-date fst-last-played"
                    >
                      {formatLastPlayed(game.lastPlayed, vm.now)}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
          {vm.groups.length === 0 ? (
            <div className="fst-row fst-muted" role="option" aria-disabled>
              No games installed
            </div>
          ) : null}
        </div>
      </section>
      {selected && details ? (
        <section className="fst-detail" aria-label={`${selected.name} details`}>
          <Screenshot key={selected.id} game={selected} />
          <h3 className="fst-name">{selected.name}</h3>
          <p className="fst-tagline">{selected.tagline}</p>
          <div className="fst-detail-row">
            <div className="fst-facts">
              <div className="fst-actions">
                <button
                  type="button"
                  className="fst-play"
                  onClick={vm.play}
                  aria-label={`Play ${selected.name}`}
                >
                  <span aria-hidden>▶</span> PLAY
                </button>
                <button
                  type="button"
                  className="fst-play fst-play-tab"
                  onClick={vm.playInNewTab}
                  aria-label={`Play ${selected.name} in new tab`}
                >
                  <span aria-hidden>↗</span> PLAY IN NEW TAB
                </button>
              </div>
              <dl className="fst-dl">
                <dt>Status:</dt>
                <dd className="fst-status">{details.status}</dd>
                <dt>Disk usage:</dt>
                <dd>{details.diskUsage}</dd>
                <dt>Last played:</dt>
                <dd>{formatLastPlayed(selected.lastPlayed, vm.now)}</dd>
              </dl>
            </div>
            <nav className="fst-links" aria-label="Links">
              <h4 className="fst-heading">Links</h4>
              <button
                type="button"
                className="fst-link"
                onClick={vm.openLeaderboard}
              >
                Leaderboard
              </button>
              <button
                type="button"
                className="fst-link"
                onClick={vm.openFriends}
              >
                Friends
              </button>
            </nav>
          </div>
        </section>
      ) : (
        <section className="fst-detail fst-empty" aria-label="No game selected">
          <p className="fst-muted">
            No Fuse games are installed on this desktop.
          </p>
        </section>
      )}
    </div>
  );
}

const NEWS_LINES = [
  "Fusteam launcher released: pick a game from MY GAMES and press PLAY.",
  "Every game on this desktop updates itself; there is nothing to download.",
];

/** Fusteam's own News page, for a build without the Hall of Fame. */
function NewsPage() {
  return (
    <div className="fst-placeholder">
      <h2 className="fst-heading">News</h2>
      <div className="fst-panel">
        {NEWS_LINES.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </div>
  );
}

/**
 * Body of the Fusteam window, after the 2004 Steam client's Games window: tabs across the top, MY GAMES on the
 * left, the selected game's screenshot and PLAY on the right, ADD A GAME... and FRIENDS & CHAT along the bottom.
 * The olive skin, including this window's own title bar, is `launcher.css`.
 */
export function LauncherWindow({ windowId, active }: LauncherWindowProps) {
  const vm = useLauncherViewModel();
  const { rects, viewport, setRect } = useContext(WindowManagerContext);
  // Opens centred on the desktop rather than in the cascade; only the first time, a moved window stays put.
  const placed = useRef(windowId in rects);
  useLayoutEffect(() => {
    if (placed.current) return;
    placed.current = true;
    setRect(windowId, centeredLauncherRect(viewport));
  }, [windowId, viewport, setRect]);

  return (
    <div className="fst-root" data-tab={vm.tab}>
      <div className="fst-tabs" role="tablist" aria-label="Fusteam">
        {LAUNCHER_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`fst-tab-${tab.id}`}
            aria-selected={vm.tab === tab.id}
            aria-controls="fst-page"
            className={`fst-tab ${vm.tab === tab.id ? "selected" : ""}`}
            onClick={() => vm.openTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        className="fst-page"
        id="fst-page"
        role="tabpanel"
        aria-labelledby={`fst-tab-${vm.tab}`}
      >
        {vm.tab === "games" ? (
          <GamesPage vm={vm} active={active} />
        ) : (
          <NewsPage />
        )}
      </div>
      <div className="fst-footer">
        <span className="fst-wordmark" aria-label="Fusteam">
          FUSTEAM
        </span>
        <span className="fst-spacer" />
        <button type="button" className="fst-button" onClick={vm.addGame}>
          ADD A GAME...
        </button>
        <button type="button" className="fst-button" onClick={vm.openFriends}>
          FRIENDS &amp; CHAT
        </button>
      </div>
    </div>
  );
}
