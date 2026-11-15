import {
  elementsFor,
  renderResults,
  type ResultsHighlight,
  type ResultsReport,
} from "fuse-ui";
import type { MatchPlayerStats } from "../engine/match-stats.js";
import type { Moment } from "../engine/moments.js";
import {
  COMPARISON_COLUMNS,
  COMPARISON_KEY,
  HIGHLIGHTS_TITLE,
  RECAP_EMPTY_MESSAGE,
  buildMatchRecap,
} from "../engine/match-recap.js";

/**
 * Presentation only: placements, points, awards and moments come from the recorded match. The report is the shared
 * results report (`fuse-ui`), with the full statistics as its details.
 */
export function renderMatchRecap(
  stats: ReadonlyArray<MatchPlayerStats>,
  moments: ReadonlyArray<Moment>,
  options: {
    playerId: string;
    canWatch(key: string): boolean;
    watch(key: string): void;
    /** Replaces "MATCH COMPLETE", e.g. when and where a past match was played. */
    kicker?: string;
    /** Open with the full stats showing, for a view that has no toggle of its own. */
    expanded?: boolean;
    /** ADD FRIEND beside a rider's name, for the seats whose account is known. */
    friendButton?: (playerId: string) => HTMLElement | undefined;
  },
  document: Document = window.document,
): HTMLElement {
  const node = elementsFor(document);

  const recap = buildMatchRecap(stats, moments);
  const rounds = Math.max(0, ...stats.map((entry) => entry.roundsPlayed));
  const masthead = {
    game: "FUSE RIDERS",
    kicker: options.kicker ?? "MATCH COMPLETE",
    context: `${rounds} ${rounds === 1 ? "round" : "rounds"} / ${stats.length} ${stats.length === 1 ? "rider" : "riders"}`,
  };
  const finish = (report: ResultsReport): HTMLElement => {
    const root = renderResults(report, document);
    root.classList.add("match-recap-report");
    const details = root.querySelector<HTMLElement>(".fui-results-details");
    if (details) details.id = "match-full-stats";
    return root;
  };
  if (!recap.comparison.length)
    return finish({ ...masthead, headline: "", empty: RECAP_EMPTY_MESSAGE });
  const champions = recap.comparison.filter((entry) => entry.placement === 1);
  const champion = champions[0];
  const tiedPoints = recap.comparison.some((entry, index, entries) =>
    entries
      .slice(index + 1)
      .some(
        (other) => other.points === entry.points && other.wins !== entry.wins,
      ),
  );
  const note =
    champions.length > 1
      ? "Equal points and round wins · shared victory"
      : tiedPoints
        ? "Tied on points · decided by round wins"
        : undefined;
  const cards: ResultsHighlight[] = [];
  const moment = recap.highlights[0];
  if (moment)
    cards.push({
      icon: moment.icon,
      title: moment.title,
      winners: [moment],
      detail: moment.copy,
    });
  const travel = recap.awards.find((award) => award.id === "trailblazer");
  const award = travel ?? recap.awards[0];
  if (award)
    cards.push({
      icon: award.icon,
      title: award.title,
      winners: award.winners,
      detail: award.detail,
    });
  const totals = node("div", "", "recap-totals");
  for (const total of recap.totals) {
    const cell = node("div", "", "recap-total");
    cell.append(node("strong", total.value), node("small", total.label));
    totals.append(cell);
  }
  const reel = node("div", "", "recap-highlights");
  reel.append(node("p", HIGHLIGHTS_TITLE, "reel-title"));
  for (const entry of recap.highlights) {
    const card = node("article", "", "award-card highlight-card");
    card.style.setProperty("--player-color", entry.color);
    card.append(
      node("span", entry.icon, "award-icon"),
      node("small", entry.when),
      node("strong", entry.title),
      node("em", entry.copy),
    );
    if (options.canWatch(entry.key)) {
      const watch = node("button", "▶ WATCH", "watch-again");
      watch.type = "button";
      watch.title = "Replay this moment";
      watch.onclick = () => options.watch(entry.key);
      card.append(watch);
    }
    reel.append(card);
  }
  const awards = node("div", "", "recap-awards");
  for (const award of recap.awards) {
    const card = node("article", "", "award-card");
    card.append(
      node("span", award.icon, "award-icon"),
      node("small", award.title),
      node("strong", award.winnerText),
      node("em", award.detail),
    );
    awards.append(card);
  }
  const comparison = node("div", "", "recap-comparison");
  comparison.append(node("p", COMPARISON_KEY, "comparison-key"));
  const columns = node("div", "", "comparison-row comparison-header");
  for (const label of [
    "RIDER",
    ...COMPARISON_COLUMNS.map((column) => column.label),
  ])
    columns.append(node("span", label));
  comparison.append(columns);
  for (const entry of recap.comparison) {
    const row = node(
      "div",
      "",
      `comparison-row${entry.playerId === options.playerId ? " is-you" : ""}`,
    );
    row.style.setProperty("--player-color", entry.color);
    const rider = node("span", "", "comparison-rider"),
      riderCopy = node("span");
    riderCopy.append(
      node("b", entry.riderLabel),
      node("small", entry.riderNote),
    );
    rider.append(node("i"), riderCopy);
    row.append(rider);
    for (const column of COMPARISON_COLUMNS)
      row.append(
        node(
          column.key === "wins" ? "strong" : "span",
          entry[column.key],
          column.key === "pickups"
            ? "pickup-counts"
            : column.key === "deaths"
              ? "death-counts"
              : "",
        ),
      );
    comparison.append(row);
  }
  return finish({
    ...masthead,
    headline:
      champions.length === 1 ? `${champion!.name} WINS` : "SHARED VICTORY",
    summary:
      champions.length === 1
        ? `${champion!.points} points · ${champion!.wins} round ${champion!.wins === "1" ? "win" : "wins"}`
        : champions.map((entry) => entry.name).join(" + "),
    ...(champions.length === 1 ? { accent: champion!.color } : {}),
    standings: {
      nameLabel: "RIDER",
      columns: ["POINTS", "WINS"],
      rows: recap.comparison.map((entry) => ({
        id: entry.playerId,
        placement: entry.placement,
        name: entry.name,
        color: entry.color,
        you: entry.playerId === options.playerId,
        friend: options.friendButton?.(entry.playerId),
        values: [entry.points, entry.wins],
      })),
      ...(note ? { note } : {}),
    },
    highlights: {
      cards,
      empty: "The standings tell the story this time.",
    },
    details: {
      content: [
        totals,
        ...(recap.highlights.length ? [reel] : []),
        ...(recap.awards.length ? [awards] : []),
        comparison,
      ],
      ...(options.expanded ? { expanded: true } : {}),
    },
  });
}
