import type {
  ResultsBar,
  ResultsHighlight,
  ResultsReport,
  ResultsRow,
} from "fuse-ui";
import type { WorldView } from "../engine/view.js";

/** One bird's line in the result. */
export interface ResultRow {
  id: string;
  slot: number;
  name: string;
  you: boolean;
  bot: boolean;
  /** The survivor is first; the birds that fell share second, and a draw is shared by all. */
  place: number;
  /** Health left at the end. */
  health: number;
  /** Turns this bird played: shots and passes. */
  turns: number;
  /** Scatter Bombs left unspent. */
  bombs: number;
}

/** A finished battle, as the page shows it. */
export interface Result {
  title: string;
  /** Turns the battle took. */
  turns: number;
  /** Every bird, the winner first. */
  rows: ResultRow[];
  /** The winner's seat, or -1 for a draw. */
  winnerSlot: number;
  host: boolean;
  waiting: string;
}

/** Who the viewer is, and which members are bots. */
export interface Viewer {
  me: string;
  host: boolean;
  bots?: ReadonlySet<string>;
}

/** The result of a battle that is over; null while one is still being played. */
export function matchResult(view: WorldView, viewer: Viewer): Result | null {
  if (view.phase !== "over") return null;
  const winner = view.players.find((p) => p.id === view.winner);
  const rows = view.players
    .map((p) => ({
      id: p.id,
      slot: p.slot,
      name: p.name,
      you: p.id === viewer.me,
      bot: viewer.bots?.has(p.id) ?? false,
      place: !winner || p.id === winner.id ? 1 : 2,
      health: p.hp,
      turns: p.ordinal,
      bombs: p.ammo,
    }))
    .sort((a, b) => a.place - b.place || a.slot - b.slot);
  return {
    title: winner ? `${winner.name.toUpperCase()} WINS!` : "DRAW!",
    turns: view.turn,
    rows,
    winnerSlot: winner?.slot ?? -1,
    host: viewer.host,
    waiting: viewer.host ? "" : "Waiting for the host…",
  };
}

/** What the page lends the report: a seat's colour and the friend buttons. */
export interface ReportParts {
  color(slot: number): string;
  /** FRIENDS or + ADD FRIEND for another bird whose account is known. */
  friend?(id: string): HTMLElement | undefined;
}

const count = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** A finished battle as the shared results screen shows it. */
export function resultReport(
  result: Result,
  parts: ReportParts,
): ResultsReport {
  const rows: ResultsRow[] = result.rows.map((row) => ({
    id: row.id,
    placement: row.place,
    name: row.name,
    color: parts.color(row.slot),
    you: row.you,
    ...(row.bot ? { tag: "AI" } : {}),
    friend: row.you || row.bot ? undefined : parts.friend?.(row.id),
    values: [
      row.health > 0 ? String(row.health) : "OUT",
      String(row.turns),
      String(row.bombs),
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
          .map((row) => ({ name: row.name, color: parts.color(row.slot) })),
      });
  };
  most(
    (row) => row.health,
    (best) => ({
      icon: "◆",
      title: "Last bird standing",
      detail: `Finished with ${best} health.`,
    }),
  );
  most(
    (row) => row.turns,
    (best) => ({
      icon: "↺",
      title: "Busiest beak",
      detail: `Played ${count(best, "turn")}.`,
    }),
  );
  most(
    (row) => row.bombs,
    (best) => ({
      icon: "▣",
      title: "Bomb hoarder",
      detail: `${count(best, "Scatter Bomb")} never thrown.`,
    }),
  );
  const winner = result.rows[0];
  return {
    game: "FUSE BIRDS",
    context: `${count(result.turns, "turn")} · ${count(result.rows.length, "bird")}`,
    headline: result.title,
    ...(winner && result.winnerSlot >= 0
      ? {
          summary: `${winner.health} health left after ${count(winner.turns, "turn")}`,
          accent: parts.color(result.winnerSlot),
        }
      : { summary: "Nobody survived the last blast." }),
    standings: {
      nameLabel: "BIRD",
      columns: ["HEALTH", "TURNS", "BOMBS LEFT"],
      rows,
    },
    highlights: { cards },
  };
}

/** The bar under the report: the host's next steps, and what everybody else waits for. */
export function resultBar(result: Result): ResultsBar {
  return {
    ...(result.waiting ? { status: result.waiting } : {}),
    actions: result.host
      ? [
          { id: "lobby", label: "Back to room" },
          { id: "rematch", label: "Rematch", primary: true },
        ]
      : [],
  };
}
