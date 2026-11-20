import {
  playerResultRows,
  type ResultsBar,
  type ResultsHighlight,
  type ResultsReport,
} from "fuse-ui";
import type { KeeperView, WorldView } from "../engine/view.js";

/** One keeper's line of a finished round. */
export interface ResultRow {
  id: string;
  slot: number;
  name: string;
  you: boolean;
  bot: boolean;
  /** 1 for a winner; keepers who tied share a place. */
  place: number;
  score: number;
  /** How the round ended for this keeper: STANDING, FELL, BOMBED… */
  fate: string;
  knockouts: number;
  selfKnockouts: number;
  thrown: number;
  falls: number;
  powerUps: number;
}

/** A finished competitive round, as the results screen needs it. */
export interface Result {
  rules: "score" | "elimination";
  map: WorldView["map"];
  /** Bombs were on: knockouts and throws mean something. */
  bombs: boolean;
  /** Power-up pads were on. */
  powers: boolean;
  rows: ResultRow[];
  /** The one winner's seat, or -1 for a shared win or a draw. */
  winnerSlot: number;
  winners: number;
  host: boolean;
  waiting: string;
}

/** What of the replicated view a result is made of. */
export type RoundFacts = Pick<
  WorldView,
  "map" | "bombMode" | "powers" | "contest"
> & { keepers: readonly Pick<KeeperView, "id" | "name" | "bot" | "tally">[] };

// A keeper who left the room: the seat stays, the tally is gone.
const EMPTY_TALLY: KeeperView["tally"] = {
  thrown: 0,
  knockouts: 0,
  selfKnockouts: 0,
  bombed: 0,
  zapped: 0,
  falls: 0,
  fate: "",
  by: "",
  powerUps: 0,
};

/** The result of a round that is over; null in free play and while a round runs. */
export function matchResult(
  view: RoundFacts,
  selfId: string,
  host: boolean,
): Result | null {
  const c = view.contest;
  if (c.rules === "free" || c.phase !== "over") return null;
  const rules = c.rules;
  const winners = new Set(c.winners);
  // Winners share first place, then whoever stayed in, by score where the round kept one.
  const rank = (entry: (typeof c.entries)[number]) =>
    winners.has(entry.id)
      ? 3e6
      : (entry.out ? 0 : 1e6) + (rules === "score" ? entry.score : 0);
  const rows = c.entries
    .map((entry) => {
      const keeper = view.keepers.find((k) => k.id === entry.id);
      const tally = keeper?.tally ?? EMPTY_TALLY;
      const fate = !entry.out
        ? "STANDING"
        : tally.fate === "fall"
          ? "FELL"
          : tally.fate === "self"
            ? "OWN BOMB"
            : tally.fate === "bomb"
              ? "BOMBED"
              : tally.fate === "hazard"
                ? tally.by
                  ? "PUSHED"
                  : "ZAPPED"
                : "LEFT";
      return {
        id: entry.id,
        slot: entry.slot,
        name: keeper?.name ?? "Keeper",
        you: entry.id === selfId,
        bot: !!keeper?.bot,
        place:
          1 + c.entries.filter((other) => rank(other) > rank(entry)).length,
        score: entry.score,
        fate,
        knockouts: tally.knockouts,
        selfKnockouts: tally.selfKnockouts,
        thrown: tally.thrown,
        falls: tally.falls,
        powerUps: tally.powerUps,
      };
    })
    .sort((a, b) => a.place - b.place || a.slot - b.slot);
  const winner =
    c.winners.length === 1
      ? c.entries.find((entry) => entry.id === c.winners[0])
      : undefined;
  return {
    rules,
    map: view.map,
    bombs: view.bombMode !== "off",
    powers: view.powers.length > 0,
    rows,
    winnerSlot: winner ? winner.slot : -1,
    winners: c.winners.length,
    host,
    waiting: host ? "" : "Waiting for the room manager to start the next round",
  };
}

/** What the page lends the report: a seat's colour and the friend buttons. */
export interface ReportParts {
  color(slot: number): string;
  /** FRIENDS or + ADD FRIEND for another keeper whose account is known. */
  friend?(id: string): HTMLElement | undefined;
}

const count = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** The stat columns this round has, at most four: what was switched off is left out. */
function columns(
  result: Result,
): { label: string; value: (row: ResultRow) => string }[] {
  const all: {
    label: string;
    on: boolean;
    value: (row: ResultRow) => string;
  }[] = [
    {
      label: "SCORE",
      on: result.rules === "score",
      value: (row) => String(row.score),
    },
    {
      label: "FATE",
      on: result.rules === "elimination",
      value: (row) => row.fate,
    },
    { label: "KOS", on: result.bombs, value: (row) => String(row.knockouts) },
    {
      // In elimination a fall is the fate, not a count.
      label: "FALLS",
      on: result.rules === "score",
      value: (row) => String(row.falls),
    },
    { label: "BOMBS", on: result.bombs, value: (row) => String(row.thrown) },
    {
      label: "POWER-UPS",
      on: result.powers,
      value: (row) => String(row.powerUps),
    },
  ];
  return all.filter((column) => column.on).slice(0, 4);
}

/** A finished round as the shared results screen shows it. */
export function resultReport(
  result: Result,
  parts: ReportParts,
): ResultsReport {
  const shown = columns(result);
  const rows = playerResultRows(result.rows, parts, {
    colorKey: (row) => row.slot,
    values: (row) => shown.map((column) => column.value(row)),
  });
  const cards: ResultsHighlight[] = [];
  /** A card for whoever has the most of something, when anybody has any. */
  const most = (
    pick: (row: ResultRow) => number,
    card: (best: number) => Omit<ResultsHighlight, "winners">,
  ) => {
    const best = Math.max(0, ...result.rows.map(pick));
    if (best > 0 && cards.length < 3)
      cards.push({
        ...card(best),
        winners: result.rows
          .filter((row) => pick(row) === best)
          .map((row) => ({ name: row.name, color: parts.color(row.slot) })),
      });
  };
  most(
    (row) => row.knockouts,
    (best) => ({
      icon: "✕",
      title: "Demolisher",
      detail: `${count(best, "knockout")} by bomb.`,
    }),
  );
  most(
    (row) => row.powerUps,
    (best) => ({
      icon: "✦",
      title: "Pad collector",
      detail: `Took ${count(best, "power-up")}.`,
    }),
  );
  most(
    (row) => row.selfKnockouts,
    (best) => ({
      icon: "↺",
      title: "Own worst enemy",
      detail: `Caught in their own blast ${count(best, "time")}.`,
    }),
  );
  most(
    (row) => row.falls,
    (best) => ({
      icon: "≈",
      title: "Long way down",
      detail: `${count(best, "fall")}.`,
    }),
  );
  const winner = result.winnerSlot >= 0 ? result.rows[0] : undefined;
  return {
    game: "HOOK HAVOK",
    kicker: "ROUND COMPLETE",
    context: `${result.rules === "score" ? "Hook score" : "Last keeper standing"} · ${
      result.map === "crossroads"
        ? "The Crossroads"
        : result.map === "spire"
          ? "Neon Spire"
          : "Lantern Belfry"
    } · ${count(result.rows.length, "keeper")}`,
    headline: winner
      ? `${winner.name.toUpperCase()} WINS`
      : result.winners
        ? "SHARED VICTORY"
        : "NO KEEPER LEFT STANDING",
    ...(winner
      ? {
          summary:
            result.rules === "score"
              ? count(winner.score, "point")
              : "The last keeper standing",
          accent: parts.color(winner.slot),
        }
      : result.winners
        ? {}
        : { summary: "The round ends in a draw." }),
    standings: {
      nameLabel: "KEEPER",
      columns: shown.map((column) => column.label),
      rows,
    },
    highlights: { cards },
  };
}

/** The bar under the report: a look at the arena for everybody, and the manager's next steps. */
export function resultBar(result: Result): ResultsBar {
  return {
    ...(result.waiting ? { status: result.waiting } : {}),
    actions: [
      { id: "arena", label: "View arena" },
      ...(result.host
        ? [
            { id: "free", label: "Free play" },
            { id: "rematch", label: "REMATCH", primary: true },
          ]
        : []),
    ],
  };
}
