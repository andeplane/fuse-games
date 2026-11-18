import type { RosterMember } from "fuse-ui";
import { CAPACITY, type FuseDriversView } from "../game/index.js";
import { TICK_RATE, config } from "../game/sim/config.js";

/**
 * What the screen shows, as a pure function of the view and who this device is.
 *
 * The screen renders from the view, never from events: a rollback can correct an outcome after it was
 * shown, and events are deduplicated by position, so only the view carries the correction.
 */
export interface Viewer {
  /** This device's member id ("solo" alone, "" before the room service admitted it). */
  me: string;
  /** This device created the room: it starts races and adds or removes bots. */
  host: boolean;
  solo: boolean;
  /** The shared screen (`?display=1`): it shows the race and never drives. */
  display: boolean;
  /** The room's settings make it one shared screen with phones as controllers. */
  shared: boolean;
}

export interface DriverRow {
  id: string;
  name: string;
  /** The name as the card shows it, marked when it is this device's seat. */
  label: string;
  /** Which truck this seat drives, or -1 before the grid forms. */
  truck: number;
  place: number;
  lap: number;
  laps: number;
  nitros: number;
  finished: boolean;
  you: boolean;
  bot: boolean;
  away: boolean;
}

export interface RaceModel {
  /** Lap of this driver, or the leader for a spectator. */
  lap: number;
  laps: number;
  /** This device's own place, or 0 when it is only watching. */
  place: number;
  drivers: DriverRow[];
  countdown: number;
  finished: boolean;
}

/** One driver's line of the final standings. */
export interface ResultRow {
  id: string;
  /** The grid slot, which is the truck's colour. */
  truck: number;
  name: string;
  you: boolean;
  bot: boolean;
  /** One-based DOS classification written by the core race when the first truck finishes. */
  place: number;
  /** Seconds from the start signal to the finish line, or 0 for a truck that never finished. */
  time: number;
  laps: number;
  lapsLed: number;
  nitros: number;
}

export interface ResultModel {
  title: string;
  seriesRace: number;
  seriesLength: number;
  seriesComplete: boolean;
  track: string;
  laps: number;
  rows: ResultRow[];
  /** The winner's grid slot, or -1 when the win is shared. */
  winnerTruck: number;
  /** This device may start the next race or return to the lobby. */
  host: boolean;
  waiting: string;
}

export interface LobbyModel {
  members: RosterMember[];
  /** This device's own seat, by its plain name: what a move to another seat is asked with. */
  own?: { name: string; slot: number };
  canStart: boolean;
  showStart: boolean;
  note: string;
  track: string;
}

export interface TableModel {
  screen: "lobby" | "race" | "results";
  askName: boolean;
  lobby: LobbyModel;
  race?: RaceModel;
  results?: ResultModel;
}

const marked = (name: string, you: boolean): string =>
  you ? `${name} (you)` : name;

export function presentTable(
  view: FuseDriversView,
  viewer: Viewer,
): TableModel {
  const seated = view.drivers.some((driver) => driver.id === viewer.me);
  const racing = view.phase === "running";
  const over = view.phase === "over";

  const members: RosterMember[] = view.drivers.map((driver) => ({
    id: driver.id,
    slot: driver.slot,
    name: marked(driver.name, driver.id === viewer.me),
    status: driver.bot ? "CPU" : driver.connected ? "READY" : "AWAY",
    avatar: driver.avatarId,
    host: false,
  }));

  const own = view.drivers.find((driver) => driver.id === viewer.me);
  const lobby: LobbyModel = {
    members,
    ...(own ? { own: { name: own.name, slot: own.slot } } : {}),
    canStart: view.drivers.length >= 2,
    showStart: viewer.host && !racing && !over,
    note:
      view.drivers.length >= 2
        ? ""
        : `Waiting for drivers: 2 to ${String(CAPACITY)} race.`,
    track: view.track,
  };

  const model: TableModel = {
    screen: racing ? "race" : over ? "results" : "lobby",
    askName: !seated && !viewer.display && !viewer.solo,
    lobby,
  };

  const race = view.race;
  if (race && (racing || over)) {
    const rows: DriverRow[] = view.drivers.map((driver) => {
      const car = driver.truck >= 0 ? race.trucks[driver.truck] : undefined;
      const place =
        driver.truck >= 0 ? race.placements.indexOf(driver.truck) + 1 : 0;
      return {
        id: driver.id,
        slot: driver.slot,
        name: driver.name,
        label: marked(driver.name, driver.id === viewer.me),
        truck: driver.truck,
        place,
        lap: Math.min((car?.laps ?? 0) + 1, config.laps),
        laps: config.laps,
        nitros: car?.nitros ?? 0,
        finished: (car?.finishedTick ?? 0) > 0,
        you: driver.id === viewer.me,
        bot: driver.bot,
        away: !driver.connected && !driver.bot,
      };
    });
    rows.sort((a, b) => (a.place || 99) - (b.place || 99));
    const mine = rows.find((row) => row.you);
    model.race = {
      lap: mine?.lap ?? rows[0]?.lap ?? 1,
      laps: config.laps,
      place: mine?.place ?? 0,
      drivers: rows,
      countdown: Math.max(0, race.countdownEndTick - race.tick),
      finished: over,
    };
    if (over) {
      const results: ResultRow[] = [];
      for (const row of view.finishers ?? []) {
        const car = race.trucks[row.truck];
        if (!car) continue;
        results.push({
          id: row.id,
          truck: row.truck,
          name: row.name,
          you: row.id === viewer.me,
          bot: row.bot,
          place: row.place,
          time: car.finishedTick
            ? Math.max(0, car.finishedTick - race.countdownEndTick) / TICK_RATE
            : 0,
          laps: Math.min(car.laps, config.laps),
          lapsLed: car.lapsLed,
          nitros: car.nitrosUsed,
        });
      }
      const winner = results.find((row) => row.place === 1);
      model.results = {
        seriesRace: view.seriesRace,
        seriesLength: view.seriesLength,
        seriesComplete: view.seriesComplete,
        title: winner
          ? winner.you
            ? "YOU WIN"
            : `${winner.name} WINS`
          : "RACE COMPLETE",
        track: view.track,
        laps: config.laps,
        rows: results,
        winnerTruck: winner?.truck ?? -1,
        host: viewer.host,
        waiting: viewer.host ? "" : "Waiting for the host",
      };
    }
  }

  return model;
}
