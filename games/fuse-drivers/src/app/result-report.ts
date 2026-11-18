import type {
  ResultsBar,
  ResultsHighlight,
  ResultsReport,
  ResultsRow,
} from "fuse-ui";
import type { ResultModel, ResultRow } from "./presenter.js";
import { courseLabel } from "./course-label.js";

/** What the page lends the report: a truck's colour and the friend buttons. */
export interface ReportParts {
  color(truck: number): string;
  /** FRIENDS or + ADD FRIEND for another driver whose account is known. */
  friend?(id: string): HTMLElement | undefined;
}

const count = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;
/** Only a truck crossing the line receives a finish time. Others are classified on completed laps. */
const clock = (seconds: number) => {
  if (seconds <= 0) return "—";
  const tenths = Math.round(seconds * 10);
  return `${Math.floor(tenths / 600)}:${String(Math.floor((tenths % 600) / 10)).padStart(2, "0")}.${tenths % 10}`;
};

/** A finished race as the shared results screen shows it. */
export function resultReport(
  result: ResultModel,
  parts: ReportParts,
): ResultsReport {
  const rows: ResultsRow[] = result.rows.map((row) => ({
    id: row.id,
    placement: row.place,
    name: row.name,
    color: parts.color(row.truck),
    you: row.you,
    ...(row.bot ? { tag: "AI" } : {}),
    friend: row.you || row.bot ? undefined : parts.friend?.(row.id),
    values: [
      clock(row.time),
      `${row.laps}/${result.laps}`,
      String(row.lapsLed),
      String(row.nitros),
    ],
  }));
  const cards: ResultsHighlight[] = [];
  /** A card for whoever has the most of something, when anybody has any. */
  const most = (
    pick: (row: ResultRow) => number,
    card: (best: number) => Omit<ResultsHighlight, "winners">,
  ) => {
    const best = Math.max(0, ...result.rows.map(pick));
    if (best > 0)
      cards.push({
        ...card(best),
        winners: result.rows
          .filter((row) => pick(row) === best)
          .map((row) => ({ name: row.name, color: parts.color(row.truck) })),
      });
  };
  most(
    (row) => row.lapsLed,
    (best) => ({
      icon: "▲",
      title: "Front runner",
      detail: `Led ${count(best, "lap")}.`,
    }),
  );
  most(
    (row) => row.nitros,
    (best) => ({
      icon: "✦",
      title: "Nitro junkie",
      detail: `Fired ${count(best, "nitro")}.`,
    }),
  );
  const winner = result.rows.find((row) => row.truck === result.winnerTruck);
  return {
    game: "FUSE DRIVERS",
    kicker: "RACE COMPLETE",
    context: `${courseLabel(result.track)} · ${count(result.laps, "lap")} · ${count(result.rows.length, "driver")}`,
    headline: result.title,
    ...(winner
      ? {
          summary:
            winner.time > 0
              ? `${clock(winner.time)} over ${count(result.laps, "lap")}`
              : count(winner.laps, "lap"),
          accent: parts.color(winner.truck),
        }
      : {}),
    standings: {
      nameLabel: "DRIVER",
      columns: ["TIME", "LAPS", "LAPS LED", "NITROS USED"],
      rows,
    },
    highlights: { cards },
  };
}

/** The bar under the report: the host's next steps, and what everybody else waits for. */
export function resultBar(result: ResultModel): ResultsBar {
  return {
    ...(result.waiting ? { status: result.waiting } : {}),
    actions: result.host
      ? [
          { id: "lobby", label: "Back to lobby" },
          { id: "rematch", label: "RACE AGAIN", primary: true },
        ]
      : [],
  };
}
