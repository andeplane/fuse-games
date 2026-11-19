import { createLiveResults, type ResultsScreen } from "fuse-ui";
import type { World } from "../engine/types.js";
import type { RoomSnapshot } from "./contracts.js";
import { updateContent } from "./dom-update.js";
import {
  REPORT_METRICS,
  breakdownMarkup,
  chartPanelMarkup,
  findingsMarkup,
  reportPlayers,
  type ReportMetric,
  type ReportPlayer,
} from "./match-report.js";
import { matchResult, resultBar, resultReport } from "./result-report.js";

interface ResultFriends {
  publicIdOfMember(id: string): string | undefined;
  friendButton(id: string): HTMLElement;
}

/** Keeps the report, its chart selection and the live results bar in sync. */
export function createMatchResults(
  screen: ResultsScreen,
  friends?: ResultFriends,
) {
  const live = createLiveResults(screen);
  screen.element.id = "match-result";
  const document = screen.element.ownerDocument;
  const reportPart = (className: string) => {
    const part = document.createElement("div");
    part.className = className;
    return part;
  };
  const findings = reportPart("report-part");
  const chart = reportPart("report-part");
  const breakdown = reportPart("match-report");
  let metric: ReportMetric = "territory";
  let shown: {
    world: Readonly<World>;
    players: readonly ReportPlayer[];
  } | null = null;

  return {
    clear() {
      live.clear();
      shown = null;
    },
    selectMetric(id: string | undefined) {
      const choice = REPORT_METRICS.find((entry) => entry.id === id);
      if (choice) metric = choice.id;
      if (shown)
        updateContent(
          chart,
          chartPanelMarkup(shown.world, shown.players, metric),
        );
    },
    show(
      layout: Element | null,
      world: Readonly<World>,
      context: {
        self: string | null;
        room?: RoomSnapshot;
        openings: ReadonlyMap<string, string>;
      },
    ) {
      if (layout && screen.element.parentElement !== layout)
        layout.append(screen.element);
      const { self, room, openings } = context;
      const seats = new Map(room?.seats.map((seat) => [seat.id, seat]));
      const players = reportPlayers(world, self, (id) => seats.get(id)?.name);
      const result = matchResult(world, players, {
        self,
        bot: (id) => (room ? !!seats.get(id)?.bot : id !== self),
        openings,
        room: room ? { host: room.manager } : null,
      });
      live.render(result, {
        friends,
        revision: world.matchId,
        report(value, friend) {
          shown = { world, players };
          updateContent(findings, findingsMarkup(world, players, self));
          updateContent(chart, chartPanelMarkup(world, players, metric));
          updateContent(breakdown, breakdownMarkup(world, players));
          return resultReport(value, {
            friend,
            findings: [findings],
            chart: [chart],
            breakdown: [breakdown],
          });
        },
        bar: resultBar,
      });
    },
  };
}
