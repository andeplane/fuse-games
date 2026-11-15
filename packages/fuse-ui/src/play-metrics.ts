import { createBrowserAnalytics, type Analytics } from "./analytics.js";
import { isEmbeddedPage } from "./embedded.js";

export interface PlayFrame {
  /** Game-owned bounded dimensions such as song/chart; no player names or room identifiers. */
  context?: Record<string, string | number | boolean | null>;
  /** Scope only; never transmitted. */
  matchId: string;
  active: boolean;
  ended: boolean;
  /** Omit only for games with a single continuous match. */
  round?: number;
  /** Actual active gameplay, excluding countdowns. Omitted means no round integration. */
  roundActive?: boolean;
  /** Decided completion of the current semantic round. */
  roundEnded?: boolean;
  /** Separate from `round`, which some existing match-start adapters use synthetically. */
  roundKey?: number;
  playerCount: number;
  botCount: number;
  seated: boolean;
  mode: string;
}

export interface ConfirmedRoundObservation {
  /** A final snapshot mapped independently, so a late completion keeps its own match and round. */
  frame: PlayFrame | undefined;
}

export type PlayObserver = (
  frame: PlayFrame,
  confirmedRound?: ConfirmedRoundObservation,
) => void;

/** Starts describe current participation; irreversible completion comes only from final history. */
export function observeConfirmedPlay<View>(
  observe: PlayObserver,
  current: View,
  confirmed: () => View | undefined,
  playFrame: (view: View) => PlayFrame,
): void {
  const final = confirmed();
  let frame: PlayFrame | undefined;
  if (final !== undefined) {
    // The confirmed view only changes every few ticks while this runs every
    // frame, and mapping it can be as costly as presenting the whole game.
    const last = confirmedFrames.get(observe);
    if (last && last.view === final) frame = last.frame;
    else {
      frame = playFrame(final);
      confirmedFrames.set(observe, { view: final, frame });
    }
  }
  observe(playFrame(current), { frame });
}
const confirmedFrames = new WeakMap<
  PlayObserver,
  { view: unknown; frame: PlayFrame }
>();

/** Per-device observations, just like Riders' funnel; never a second simulation or a per-tick event stream. */
export function createPlayMetrics(
  track: Analytics["track"],
  now: () => number,
): PlayObserver {
  const observeRound = createRoundMetrics(track);
  let match = "",
    started = false,
    ended = false,
    seated = false;
  let startedAt: number | undefined;
  return (frame, confirmedRound) => {
    if (!frame.matchId) return;
    if (frame.matchId !== match) {
      match = frame.matchId;
      started = ended = false;
      startedAt = undefined;
    }
    const properties = {
      ...frame.context,
      playerCount: frame.playerCount,
      botCount: frame.botCount,
      humanCount: frame.playerCount - frame.botCount,
      played: frame.seated,
      mode: frame.mode,
    };
    if (confirmedRound) {
      observeRound({ ...frame, roundEnded: false });
      if (confirmedRound.frame)
        observeRound({ ...confirmedRound.frame, roundActive: false });
    } else observeRound(frame);
    if (frame.seated && !seated) {
      seated = true;
      track("Seat Taken", properties);
    }
    // Joining midway through a multi-round match is not a new match start.
    if (
      frame.active &&
      !frame.ended &&
      (frame.round ?? 1) === 1 &&
      !started &&
      !ended
    ) {
      started = true;
      startedAt = now();
      track("Match Started", properties, {
        key: `match:${frame.matchId}`,
        match: frame.matchId,
      });
    }
    if (frame.ended && !ended) {
      ended = true;
      track(
        "Match Ended",
        {
          ...properties,
          ...(startedAt === undefined
            ? {}
            : {
                durationSeconds: Math.max(
                  0,
                  Math.round((now() - startedAt) / 1000),
                ),
              }),
        },
        { key: `match:${frame.matchId}`, match: frame.matchId },
      );
    }
  };
}

/** Round participation is independent of per-device match observation and first-round start detection. */
export function createRoundMetrics(
  track: Analytics["track"],
): (frame: PlayFrame) => void {
  const starts = new Set<string>(),
    ends = new Set<string>();
  let lastMatch: string | undefined,
    lastRound: string | number | undefined,
    lastKey = "";
  return (frame) => {
    if (!frame.matchId || !frame.seated) return;
    // Games call this every frame: do nothing between rounds, and build the
    // key and properties only for a frame that can report something.
    if (!frame.roundActive && !frame.roundEnded) return;
    const round = frame.roundKey ?? frame.round ?? 1;
    if (frame.matchId !== lastMatch || round !== lastRound) {
      lastMatch = frame.matchId;
      lastRound = round;
      lastKey = JSON.stringify([frame.matchId, round]);
    }
    const key = lastKey;
    if (
      (!frame.roundActive || starts.has(key)) &&
      (!frame.roundEnded || ends.has(key))
    )
      return;
    const properties = {
      ...frame.context,
      playerCount: frame.playerCount,
      botCount: frame.botCount,
      humanCount: frame.playerCount - frame.botCount,
      played: true,
      mode: frame.mode,
    };
    if (frame.roundActive && !starts.has(key)) {
      track("Round Started", properties, { key, match: frame.matchId, round });
      starts.add(key);
      if (starts.size > 512) starts.delete(starts.values().next().value!);
    }
    if (frame.roundEnded && !ends.has(key)) {
      track("Round Ended", properties, {
        key,
        requires: "Round Started",
        match: frame.matchId,
        round,
      });
      ends.add(key);
      if (ends.size > 512) ends.delete(ends.values().next().value!);
    }
  };
}

/** What a page is for, from its address: the `role` super property on every event. */
export type PageRole = "solo" | "display" | "joiner" | "landing";

export function pageRole(search: string): PageRole {
  const query = new URLSearchParams(search);
  if (query.has("solo")) return "solo";
  if (!query.has("room")) return "landing";
  return query.get("display") === "1" ? "display" : "joiner";
}

/** The facts about the page `startGameAnalytics` reports; read from the browser by default, given by a test. */
export interface AnalyticsPage {
  /** The page's `location.search`. */
  search: string;
  /** The page runs in a FuseOS desktop window rather than as the browser tab itself (`isEmbeddedPage`). */
  embedded: boolean;
}

export function browserAnalyticsPage(): AnalyticsPage {
  return { search: location.search, embedded: isEmbeddedPage(window) };
}

/**
 * One instance at the page's composition root. Analytics is disabled on dev addresses unless explicitly enabled.
 * `App Opened` says whether the page opened inside the FuseOS desktop (`embedded`), so a game played from a
 * desktop window and one played in its own tab can be told apart; the desktop reports its own opening as `fuseos`.
 */
export function startGameAnalytics(
  gameId: string,
  page: AnalyticsPage = browserAnalyticsPage(),
  create: (gameId: string) => Analytics = createBrowserAnalytics,
): Analytics {
  const analytics = create(gameId);
  analytics.start({ role: pageRole(page.search) });
  analytics.track("App Opened", { embedded: page.embedded });
  return analytics;
}
