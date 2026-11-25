import { PLACE_POINTS } from "../basics.js";
import { LEVELS, STEPS_PER_SECOND, centiseconds } from "../engine/index.js";
import type { View } from "../online/game.js";
import { clockText, ordinal } from "../render/hud.js";

/**
 * What the page shows, decided from one frame: the screen (lobby, the race, or a phone controller for a shared
 * screen), the lobby's roster and level choice, whom the canvas follows, the line a controller reads, the table
 * between two races of a tour and the result. Pure, so the decisions are unit-tested; `main.ts` only puts them on
 * the page.
 */
export interface Viewer {
  me: string;
  host: boolean;
  solo: boolean;
  /** This page is the shared TV: it shows the race and never rides. */
  display: boolean;
}

/** The starting-level choices, in campaign then external-track order. */
export const LEVEL_CHOICES: readonly { level: number; title: string }[] =
  LEVELS.map((level, index) => ({
    level: index,
    title: level.name.toUpperCase(),
  }));
/** A level index for anything a query or storage holds, or `fallback`. */
export function levelFrom(raw: string | null, fallback: number): number {
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 && value < LEVELS.length
    ? value
    : fallback;
}

/** One line of a standings table. */
export interface Row {
  place: number;
  slot: number;
  name: string;
  you: boolean;
  /** The race's time, "DNF", or in a tour's final table the maps finished. */
  detail: string;
  /** Points, as the table words them; "" where a single race gives none worth showing. */
  points: string;
}
/** One rider of a finished match. */
export interface ResultRow {
  id: string;
  slot: number;
  name: string;
  you: boolean;
  bot: boolean;
  /** 1 for the winner; riders a tour could not part share a place. */
  place: number;
  /** Hundredths: the race's time, or a tour's whole clock when every map was ridden home; null otherwise. */
  time: number | null;
  points: number;
  /** Maps won, and maps ridden home at all. */
  wins: number;
  maps: number;
  crashes: number;
}
export interface Model {
  screen: "lobby" | "play" | "controller";
  askName: boolean;
  seated: boolean;
  /** This device has a bike in the match being raced: its controls are live. */
  riding: boolean;
  /** This device's rider slot in the match, or −1. */
  localSlot: number;
  /** The rider slots the canvas follows, one pane each: this device's own, or everyone for a watcher or the TV. */
  follow: number[];
  /** The control guide shows for a match's first countdown; `guideKey` names that match. */
  controlsVisible: boolean;
  guideKey: string;
  lobby: {
    members: {
      id: string;
      name: string;
      slot: number;
      connected: boolean;
      you: boolean;
    }[];
    watchers: number;
    showStart: boolean;
    canStart: boolean;
    editable: boolean;
    note: string;
  };
  /** Each rider's name by slot, for ghost tags and pane labels. */
  tags: string[];
  /** The level being raced and, in a tour, which race it is: "ROLLERS · 2 / 503". */
  title: string;
  /** One line for a phone controller. */
  status: string;
  /** A line under the race for a device that is not riding. */
  note: string;
  /** Between two races of a tour: the race just finished and the running points. */
  table: { title: string; rows: Row[]; next: string } | null;
  result: {
    title: string;
    /** The level raced, or the last one of a tour. */
    level: string;
    /** Maps the match raced: more than one is a tour. */
    rounds: number;
    rows: ResultRow[];
    /** The winner's slot, or −1 when nobody reached a flower. */
    winnerSlot: number;
    /** A solo ride: the level's best before it, in hundredths, if there was one. */
    best: number | null;
    host: boolean;
    waiting: string;
    /** A solo ride: the level it rode and the one NEXT MAP goes to. */
    solo: {
      level: number;
      next: number;
      finished: boolean;
      random?: true;
    } | null;
  } | null;
}

const seconds = (steps: number) => Math.ceil(steps / STEPS_PER_SECOND);

/** The finished race as rows, in finishing order, with what each place earned and the total after it. */
function raceRows(view: View, me: string, withPoints: boolean): Row[] {
  const world = view.world;
  if (!world) return [];
  let home = 0;
  return [...world.riders]
    .sort((a, b) => a.place - b.place)
    .map((rider) => {
      const finished = rider.status === "finished";
      const gained = finished ? (PLACE_POINTS[home++] ?? 0) : 0;
      const total = view.standings[rider.slot]?.points ?? 0;
      return {
        place: rider.place,
        slot: rider.slot,
        name: view.roster[rider.slot]?.name ?? "",
        you: rider.id === me,
        detail: finished ? clockText(centiseconds(rider.run)) : "DNF",
        points: withPoints ? `+${gained} · ${total}` : "",
      };
    });
}

/** The finished match's riders from the winner down. */
function resultRows(view: View, me: string, tour: boolean): ResultRow[] {
  const world = view.world;
  if (!world) return [];
  const slots = tour
    ? view.order
    : [...world.riders].sort((a, b) => a.place - b.place).map((r) => r.slot);
  const rows: ResultRow[] = [];
  slots.forEach((slot, index) => {
    const entrant = view.roster[slot],
      standing = view.standings[slot],
      rider = world.riders[slot],
      before = rows[index - 1],
      prior = view.standings[slots[index - 1] ?? -1];
    // What the order sorts by, all equal: nothing parted the two.
    const tied =
      tour &&
      !!standing &&
      !!prior &&
      prior.points === standing.points &&
      prior.wins === standing.wins &&
      prior.clock === standing.clock;
    const home = tour
      ? !!standing && standing.finishes === view.rounds
      : rider?.status === "finished";
    rows.push({
      id: entrant?.id ?? `slot:${slot}`,
      slot,
      name: entrant?.name ?? "",
      you: entrant?.id === me,
      bot: entrant?.bot ?? false,
      place:
        tied && before
          ? before.place
          : tour
            ? index + 1
            : (rider?.place ?? index + 1),
      time: !home
        ? null
        : tour
          ? centiseconds(standing?.clock ?? 0)
          : centiseconds(rider?.run ?? 0),
      points: standing?.points ?? 0,
      wins: standing?.wins ?? 0,
      maps: standing?.finishes ?? 0,
      crashes: standing?.deaths ?? 0,
    });
  });
  return rows;
}

export function present(
  view: View,
  viewer: Viewer,
  /** Solo: the level's best time before this ride, in hundredths, if there was one. */
  bestBefore?: number,
): Model {
  const seats = view.seats.filter((seat) => !seat.watcher);
  const mine = view.seats.find((seat) => seat.id === viewer.me);
  const seated = !!mine && !mine.watcher;
  const world = view.world;
  const inMatch = view.stage !== "lobby" && !!world;
  const localSlot =
    inMatch && world
      ? world.riders.findIndex((each) => each.id === viewer.me)
      : -1;
  const rider = world?.riders[localSlot];
  const riding =
    (view.stage === "running" || view.stage === "between") && localSlot !== -1;
  const shared = view.settings.display || view.play.display;
  const screen: Model["screen"] = !inMatch
    ? "lobby"
    : shared && !viewer.display && localSlot !== -1
      ? "controller"
      : "play";
  const tour = view.rounds > 1;
  const levelName = world
    ? (LEVELS[world.level]?.name ?? "").toUpperCase()
    : "";
  const title =
    inMatch && world
      ? tour
        ? `${levelName} · ${view.round + 1} / ${view.rounds}`
        : levelName
      : "";

  let status = "";
  if (inMatch && world) {
    if (view.stage === "over")
      status = !rider
        ? "RACE OVER"
        : view.winner === viewer.me
          ? "YOU WIN!"
          : `${ordinal(view.order.indexOf(localSlot) + 1)} PLACE`;
    else if (view.stage === "between")
      status = `NEXT MAP IN ${seconds(view.pause)}`;
    else if (world.phase === "countdown") status = "GET READY";
    else if (!rider) status = title;
    else if (rider.status === "finished")
      status = `FINISHED ${clockText(centiseconds(rider.run))}`;
    else if (rider.status === "dead") status = "CRASHED";
    else
      status = `APPLES ${rider.apples} / ${world.apples}${world.riders.length > 1 ? ` · ${ordinal(rider.place)}` : ""}`;
  }

  let note = "";
  if (inMatch && !viewer.display && localSlot === -1 && view.stage !== "over")
    note = seated
      ? "You ride in the next match"
      : mine
        ? "Watching"
        : "Pick a name to ride in the next match";

  const table: Model["table"] =
    view.stage === "between" && world
      ? {
          title: `${levelName} · RACE ${view.round + 1} OF ${view.rounds}`,
          rows: raceRows(view, viewer.me, true),
          next: `NEXT MAP IN ${seconds(view.pause)}`,
        }
      : null;

  let result: Model["result"] = null;
  if (view.stage === "over" && world) {
    const alone = viewer.solo && view.roster.length === 1;
    const winner = view.roster.find((entrant) => entrant.id === view.winner);
    const won = winner && (view.standings[winner.slot]?.finishes ?? 0) > 0;
    const base = {
      level: levelName,
      rounds: view.rounds,
      rows: resultRows(view, viewer.me, tour),
    };
    if (alone) {
      const finished = world.riders[0]?.status === "finished";
      result = {
        ...base,
        title: finished ? levelName : "TIME IS UP",
        winnerSlot: finished ? 0 : -1,
        best: bestBefore ?? null,
        host: true,
        waiting: "",
        solo: {
          ...(view.play.order === "random" ? ({ random: true } as const) : {}),
          level: world.level,
          next: (world.level + 1) % LEVELS.length,
          finished,
        },
      };
    } else
      result = {
        ...base,
        title: !won
          ? "RACE OVER"
          : winner.id === viewer.me
            ? "YOU WIN!"
            : `${winner.name.toUpperCase()} WINS`,
        winnerSlot: won ? winner.slot : -1,
        best: null,
        host: viewer.host,
        waiting: viewer.host ? "" : "Waiting for the host to start a rematch",
        solo: null,
      };
  }

  const lobbyNote = !seats.length
    ? "Pick a name to take a seat"
    : viewer.host
      ? view.settings.display
        ? "Shared screen: open the TV screen, then every rider uses a phone"
        : seats.length === 1
          ? "Start alone, or invite up to four friends to race you."
          : ""
      : "Waiting for the host to start";
  return {
    screen,
    askName: !seated && !viewer.display && !viewer.solo && !mine,
    seated,
    riding,
    localSlot,
    follow:
      localSlot !== -1
        ? [localSlot]
        : view.roster.map((entrant) => entrant.slot),
    controlsVisible:
      view.stage === "running" &&
      world?.phase === "countdown" &&
      view.round === 0,
    guideKey: view.matchId,
    lobby: {
      members: seats.map((seat) => ({
        id: seat.id,
        name: seat.name,
        slot: seat.slot,
        connected: seat.connected,
        you: seat.id === viewer.me,
      })),
      watchers: view.seats.length - seats.length,
      showStart: viewer.host,
      canStart: seats.length >= 1,
      editable: viewer.host,
      note: lobbyNote,
    },
    tags: inMatch ? view.roster.map((entrant) => entrant.name) : [],
    title,
    status,
    note,
    table,
    result,
  };
}

/** One finished run as the metrics report it: nothing here names a player or a room. */
export interface FinishReport {
  /** The level's id. */
  level: string;
  centiseconds: number;
  /** Crashes and restarts before the run that got home. */
  deaths: number;
  place: number;
  riders: number;
  tour: boolean;
}

/**
 * Finds this device's own finishes, once each: a rider's run home is reported by the device that rode it, when the
 * race it was in is over (so a rollback can no longer take it back), once per match and race.
 */
export function createFinishWatch(): (
  view: View,
  me: string,
) => FinishReport[] {
  const told = new Set<string>();
  return (view, me) => {
    const world = view.world;
    if (!world || !view.matchId || world.phase !== "over") return [];
    const rider = world.riders.find((each) => each.id === me);
    const key = `${view.matchId}:${view.round}`;
    if (!rider || rider.status !== "finished" || told.has(key)) return [];
    told.add(key);
    // One device rides a bounded number of races; the set never needs more than the latest few.
    if (told.size > 64) told.delete(told.values().next().value ?? key);
    return [
      {
        level: LEVELS[world.level]?.id ?? "",
        centiseconds: centiseconds(rider.run),
        deaths: rider.deaths,
        place: rider.place,
        riders: world.riders.length,
        tour: view.rounds > 1,
      },
    ];
  };
}

/** One death of this device's own rider as the metrics report it: nothing here names a player or a room. */
export interface DeathReport {
  /** The level's id. */
  level: string;
  /** A crash (head or body on the ground) or the rider's own restart. */
  cause: "crash" | "restart";
  /** This death's count in the race, from 1. */
  death: number;
  /** How far into the race (the rider's own clock) it was seen. */
  centiseconds: number;
  riders: number;
  tour: boolean;
}

/**
 * Finds this device's own deaths, once each, solo and in a room: the rider's death count only grows within a race, so
 * each new count is one death, reported by the device that rode it.
 */
export function createDeathWatch(): (view: View, me: string) => DeathReport[] {
  const told = new Map<string, number>();
  return (view, me) => {
    const world = view.world;
    if (!world || !view.matchId) return [];
    const rider = world.riders.find((each) => each.id === me);
    if (!rider) return [];
    const key = `${view.matchId}:${view.round}`;
    const before = told.get(key);
    // A page that first sees a race already under way (a reload, a world recovered from a peer) did not see its earlier
    // deaths: the page that did reported them.
    if (before === undefined) {
      told.set(key, rider.deaths);
      if (told.size > 64) told.delete(told.keys().next().value ?? key);
      return [];
    }
    if (rider.deaths <= before) return [];
    told.delete(key);
    told.set(key, rider.deaths);
    // One device rides a bounded number of races; the map never needs more than the latest few.
    if (told.size > 64) told.delete(told.keys().next().value ?? key);
    const reports: DeathReport[] = [];
    for (let death = before + 1; death <= rider.deaths; death++)
      reports.push({
        level: LEVELS[world.level]?.id ?? "",
        // Only the latest death's cause can still be seen; one a frame is the rule.
        cause:
          death === rider.deaths && rider.status === "dead"
            ? "crash"
            : "restart",
        death,
        centiseconds: centiseconds(rider.step),
        riders: world.riders.length,
        tour: view.rounds > 1,
      });
    return reports;
  };
}
