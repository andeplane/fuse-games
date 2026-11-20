import {
  playerResultRows,
  roomResultsBar,
  type ResultsBar,
  type ResultsHighlight,
  type ResultsReport,
} from "fuse-ui";
import { clockText } from "../render/hud.js";
import type { Model, ResultRow } from "./presenter.js";

type Result = NonNullable<Model["result"]>;

/** What the page lends the report: a slot's colour and the friend buttons. */
export interface ReportParts {
  color(slot: number): string;
  /** FRIENDS or + ADD FRIEND for another rider whose account is known. */
  friend?(id: string): HTMLElement | undefined;
}

const NONE = "—";
const count = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;
const time = (row: ResultRow) =>
  row.time === null ? "DNF" : clockText(row.time);

/** A solo ride: the time against the best for the map. */
function soloReport(result: Result, parts: ReportParts): ResultsReport {
  const me = result.rows[0],
    ridden = me?.time ?? null,
    color = parts.color(me?.slot ?? 0),
    winners = me ? [{ name: me.name, color }] : [];
  const fresh =
    ridden !== null && (result.best === null || ridden < result.best);
  // The best as it stands after this ride.
  const best = fresh ? ridden : result.best;
  const cards: ResultsHighlight[] = [];
  if (fresh && ridden !== null)
    cards.push({
      icon: "▲",
      title: "New best",
      winners,
      detail:
        result.best === null
          ? "Your first time home on this map."
          : `${clockText(result.best - ridden)} faster than your best before.`,
    });
  if (me && ridden !== null && me.crashes === 0)
    cards.push({
      icon: "◆",
      title: "Clean ride",
      winners,
      detail: "Home without a single crash.",
    });
  return {
    game: "ELASTO FUSE",
    kicker: ridden === null ? "RIDE OVER" : "MAP COMPLETE",
    context: `${result.level} · solo ride`,
    headline: result.title,
    summary:
      ridden === null
        ? "The race closed before you reached the flower."
        : fresh
          ? `${clockText(ridden)} · NEW BEST!`
          : `${clockText(ridden)} · best ${clockText(best ?? ridden)}`,
    ...(ridden !== null ? { accent: color } : {}),
    standings: {
      title: "YOUR RIDE",
      nameLabel: "RIDER",
      columns: ["TIME", "BEST", "CRASHES"],
      rows: me
        ? [
            {
              id: me.id,
              placement: 1,
              name: me.name,
              color,
              you: true,
              values: [
                time(me),
                best === null ? NONE : clockText(best),
                String(me.crashes),
              ],
            },
          ]
        : [],
    },
    highlights: {
      title: "RIDE HIGHLIGHTS",
      cards,
      empty: "The clock tells the story this time.",
    },
  };
}

/** A finished race, tour or solo ride as the shared results screen shows it. */
export function resultReport(
  result: Result,
  parts: ReportParts,
): ResultsReport {
  if (result.solo) return soloReport(result, parts);
  const tour = result.rounds > 1,
    winner = result.rows.find((row) => row.slot === result.winnerSlot),
    lead = winner?.time ?? null;
  const rows = playerResultRows(result.rows, parts, {
    colorKey: (row) => row.slot,
    values: (row) =>
      tour
        ? [
            String(row.points),
            `${row.maps} / ${result.rounds}`,
            row.time === null ? NONE : clockText(row.time),
            String(row.crashes),
          ]
        : [
            time(row),
            // How far behind the winner's time.
            row.time === null || lead === null || row === winner
              ? NONE
              : `+${clockText(row.time - lead)}`,
            String(row.crashes),
          ],
  });
  const cards: ResultsHighlight[] = [];
  const card = (
    earned: readonly ResultRow[],
    highlight: Omit<ResultsHighlight, "winners">,
  ) => {
    if (earned.length)
      cards.push({
        ...highlight,
        winners: earned.map((row) => ({
          name: row.name,
          color: parts.color(row.slot),
        })),
      });
  };
  /** Whoever has the most of something, when anybody has any. */
  const most = (pick: (row: ResultRow) => number) => {
    const best = Math.max(0, ...result.rows.map(pick));
    return {
      best,
      rows: best > 0 ? result.rows.filter((row) => pick(row) === best) : [],
    };
  };
  if (tour) {
    const wins = most((row) => row.wins);
    card(wins.rows, {
      icon: "▲",
      title: "Map winner",
      detail: `First home on ${count(wins.best, "map")}.`,
    });
  }
  card(
    result.rows.filter((row) => row.time !== null && row.crashes === 0),
    {
      icon: "◆",
      title: "Clean ride",
      detail: tour
        ? "Every map ridden home without a crash."
        : "Home without a single crash.",
    },
  );
  const crashes = most((row) => row.crashes);
  card(crashes.rows, {
    icon: "✕",
    title: "Crash magnet",
    detail: `${count(crashes.best, "crash", "crashes")}.`,
  });
  return {
    game: "ELASTO FUSE",
    context: `${tour ? count(result.rounds, "map") : result.level} · ${count(result.rows.length, "rider")}`,
    headline: result.title,
    ...(winner
      ? {
          summary: tour
            ? `${count(winner.points, "point")} · ${winner.maps} / ${result.rounds} maps`
            : `Home in ${time(winner)}`,
          accent: parts.color(winner.slot),
        }
      : {}),
    standings: {
      nameLabel: "RIDER",
      columns: tour
        ? ["POINTS", "MAPS", "TIME", "CRASHES"]
        : ["TIME", "GAP", "CRASHES"],
      rows,
    },
    highlights: { cards },
  };
}

/** The bar under the report: the host's next steps, a solo ride's own, and what everybody else waits for. */
export function resultBar(result: Result): ResultsBar {
  if (result.solo) {
    // A map ridden home goes on to the next: NEXT MAP leads then, and RETRY otherwise.
    const onward = result.solo.finished;
    const retry = { id: "rematch", label: onward ? "Retry" : "RETRY" },
      next = { id: "next", label: onward ? "NEXT MAP" : "Next map" };
    return {
      // Alone, MENU in the bar is the way out.
      back: false,
      actions: [
        { id: "menu", label: "Menu" },
        ...(onward
          ? [retry, { ...next, primary: true }]
          : [next, { ...retry, primary: true }]),
      ],
    };
  }
  return roomResultsBar(result);
}
