import {
  createTopResultHighlight,
  type ResultsBar,
  type ResultsHighlight,
  type ResultsReport,
  type ResultsRow,
} from "fuse-ui";
import { DURATION, carried } from "../engine/world.js";
import type { View } from "../online/game.js";

/** One hunter at the end of a shift. */
export interface ResultRow {
  id: string;
  slot: number;
  name: string;
  you: boolean;
  bot: boolean;
  /** 1 for the most banked energy; equal scores share a place. */
  place: number;
  /** Banked energy: the score. */
  banked: number;
  /** Ghosts still in the tank when the shift ended. */
  ghosts: number;
  /** The energy of those ghosts, which never counted. */
  unbanked: number;
}

export interface Result {
  title: string;
  rows: ResultRow[];
  /** The one winner's slot; -1 when the top score is shared or nobody banked anything. */
  winnerSlot: number;
  solo: boolean;
  host: boolean;
  /** This device holds a seat, so it has a ready button. */
  seated: boolean;
  /** This device's hunter has pressed ready. */
  ready: boolean;
  /** "2/4 ready", or empty in a solo shift. */
  waiting: string;
}

/** The finished shift as this device sees it, or undefined while there is none. */
export function shiftResult(
  frame: View,
  who: { self: string; host: boolean; solo: boolean },
): Result | undefined {
  const world = frame.world;
  if (frame.stage !== "over" || !world) return undefined;
  const seats = frame.seats.filter((seat) => !seat.watcher);
  const rows: ResultRow[] = [...world.hunters]
    .sort((a, b) => b.score - a.score || a.slot - b.slot)
    .map((hunter) => {
      const seat = seats.find((s) => s.id === hunter.id);
      return {
        id: hunter.id,
        slot: hunter.slot,
        // A hunter who left keeps their slot's colour; the name went with the seat.
        name: seat?.name ?? "Hunter",
        you: hunter.id === who.self,
        bot: seat?.bot ?? false,
        place: 1 + world.hunters.filter((p) => p.score > hunter.score).length,
        banked: hunter.score,
        ghosts: hunter.tank.length,
        unbanked: carried(world, hunter),
      };
    });
  const first = rows.filter((row) => row.place === 1);
  const winner = first.length === 1 ? first[0] : undefined;
  const scored = (first[0]?.banked ?? 0) > 0;
  // Who the next shift waits for: the same crew the game's own start rule counts.
  const crew = seats.filter((seat) => !seat.bot && seat.connected);
  return {
    title: !scored
      ? "THE GHOSTS WIN"
      : winner
        ? `${winner.name.toUpperCase()} WINS THE SHIFT`
        : "SHARED VICTORY",
    rows,
    winnerSlot: scored && winner ? winner.slot : -1,
    solo: who.solo,
    host: who.host,
    seated: seats.some((seat) => seat.id === who.self),
    ready: !!frame.ready[who.self],
    waiting: who.solo
      ? ""
      : `${crew.filter((seat) => frame.ready[seat.id]).length}/${crew.length} ready`,
  };
}

/** What the page lends the report: a seat's colour and the friend buttons. */
export interface ReportParts {
  color(slot: number): string;
  /** FRIENDS or + ADD FRIEND for another hunter whose account is known. */
  friend?(id: string): HTMLElement | undefined;
}

const count = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** A finished shift as the shared results screen shows it. */
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
    friend:
      row.you || row.bot || result.solo ? undefined : parts.friend?.(row.id),
    values: [String(row.banked), String(row.ghosts), String(row.unbanked)],
  }));
  const cards: ResultsHighlight[] = [];
  const most = createTopResultHighlight(
    result.rows,
    (row) => parts.color(row.slot),
    cards,
  );
  most(
    (row) => row.banked,
    (best) => ({
      icon: "◎",
      title: "Shrine keeper",
      detail: `${best} energy contained.`,
    }),
  );
  most(
    (row) => row.unbanked,
    (best) => ({
      icon: "≈",
      title: "The ones that got away",
      detail: `${best} energy still in the tank at dawn.`,
    }),
  );
  most(
    (row) => row.ghosts,
    (best) => ({
      icon: "▣",
      title: "Heavy backpack",
      detail: `${count(best, "ghost")} carried to the end.`,
    }),
  );
  const winner = result.rows[0];
  return {
    game: "GRAVEYARD SHIFT",
    kicker: "SHIFT COMPLETE",
    context: `${DURATION / 20} seconds · ${count(result.rows.length, "hunter")}`,
    headline: result.title,
    ...(winner && result.winnerSlot >= 0
      ? {
          summary: `${winner.banked} energy banked`,
          accent: parts.color(result.winnerSlot),
        }
      : {}),
    standings: {
      nameLabel: "HUNTER",
      columns: ["BANKED", "IN TANK", "UNBANKED"],
      rows,
    },
    highlights: { cards },
  };
}

/** The bar under the report: everybody's ready button, the count, and the host's way back to the lobby. */
export function resultBar(result: Result): ResultsBar {
  return {
    ...(result.waiting ? { status: result.waiting } : {}),
    actions: [
      ...(result.host ? [{ id: "lobby", label: "Back to lobby" }] : []),
      ...(result.seated
        ? [
            {
              id: "rematch",
              label: result.solo
                ? "PLAY AGAIN"
                : result.ready
                  ? "READY ✓"
                  : "READY FOR REMATCH",
              primary: true,
              pressed: result.ready,
            },
          ]
        : []),
    ],
  };
}
