import {
  playerResultRows,
  createTopResultHighlight,
  type ResultsBar,
  type ResultsHighlight,
  type ResultsReport,
} from "fuse-ui";
import type { ResultModel } from "./presenter.js";
import { courseLabel } from "./course-label.js";

/** What the page lends the report: a truck's colour and the friend buttons. */
export interface ReportParts {
  color(truck: number): string;
  shop?: HTMLElement;
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
  const rows = playerResultRows(result.rows, parts, {
    colorKey: (row) => row.truck,
    values: (row) => [
      clock(row.time),
      `${row.laps}/${result.laps}`,
      String(row.lapsLed),
      String(row.nitros),
    ],
  });
  const cards: ResultsHighlight[] = [];
  const most = createTopResultHighlight(
    result.rows,
    (row) => parts.color(row.truck),
    cards,
  );
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
    kicker: result.seriesComplete
      ? `SERIES COMPLETE · ${result.seriesLength} OF ${result.seriesLength}`
      : `RACE ${result.seriesRace}${result.seriesLength ? ` OF ${result.seriesLength}` : ""} COMPLETE`,
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
    ...(parts.shop && !result.seriesComplete
      ? { sections: [{ title: "Speed shop", content: [parts.shop] }] }
      : {}),
  };
}

/** The bar under the report: the host's next steps, and what everybody else waits for. */
export function resultBar(result: ResultModel, hasShop = false): ResultsBar {
  return {
    ...(result.waiting ? { status: result.waiting } : {}),
    actions: [
      ...(hasShop && !result.seriesComplete
        ? [{ id: "shop", label: "Speed shop" }]
        : []),
      ...(result.host
        ? [
            ...(result.seriesComplete
              ? [{ id: "lobby", label: "Back to lobby", primary: true }]
              : [
                  { id: "lobby", label: "Back to lobby" },
                  { id: "rematch", label: "NEXT RACE", primary: true },
                ]),
          ]
        : []),
    ],
  };
}
