import {
  createTopResultHighlight,
  roomResultsBar,
  type ResultsBar,
  type ResultsHighlight,
  type ResultsReport,
  type ResultsRow,
} from "fuse-ui";
import type { World } from "../engine/index.js";
import {
  clock,
  peakTerritory,
  TEAM_NAMES,
  type ReportPlayer,
} from "./match-report.js";

/** One network's line of the standings. */
export interface ResultRow {
  id: string;
  slot: number;
  name: string;
  color: string;
  you: boolean;
  bot: boolean;
  /** 1 for the winner; networks that fell on the same tick share a place. */
  place: number;
  /** The most cells the network ever claimed. */
  peak: number;
  built: number;
  damage: number;
  lost: number;
  research: number;
}

/** A finished match, as the results screen needs it. */
export interface MatchResult {
  title: string;
  how: string;
  elapsed: string;
  /** The winner's colour; null on a draw. */
  accent: string | null;
  rows: ResultRow[];
  /** Which opening each AI played. */
  note: string;
  /** A local match: the bar restarts it and leads back to the menu. */
  solo: boolean;
  /** What the local bar's restart says. */
  again: string;
  /** Online: this device may send the room on. */
  host: boolean;
  waiting: string;
}

export interface ResultContext {
  /** This device's seat, or null when it only watches. */
  self: string | null;
  bot(id: string): boolean;
  /** Player id to the name of the opening its AI played. */
  openings: ReadonlyMap<string, string>;
  /** The room, online; null for a local match. */
  room: { host: boolean } | null;
}

/** The result of a finished world. `players` are `reportPlayers` of the same world. */
export function matchResult(
  world: Readonly<World>,
  players: readonly ReportPlayer[],
  context: ResultContext,
): MatchResult {
  const { self } = context;
  const playing = self !== null;
  const team = (id: string) =>
    TEAM_NAMES[world.players.find((p) => p.id === id)?.slot ?? 0] ?? "Player";
  const winnerId = world.winnerId;
  const title =
    winnerId === null
      ? "Draw"
      : !playing
        ? `${team(winnerId)} wins`
        : winnerId === self
          ? "Victory"
          : "Defeat";
  const winner =
    winnerId === null ? "" : winnerId === self ? "You" : team(winnerId);
  const how =
    winnerId === null
      ? "Every brain was destroyed."
      : world.victory === "dominance"
        ? `${winner} held a dominant share of the cortex for a minute.`
        : !playing
          ? `${winner} destroyed the last rival brain.`
          : winnerId === self
            ? "The last rival brain has been destroyed."
            : "Your brain has been destroyed.";
  // The winner first, then whoever still stands, then the fallen by how long they lasted.
  const survival = (id: string, alive: boolean) =>
    id === winnerId
      ? Number.MAX_SAFE_INTEGER
      : alive
        ? world.tick + 1
        : (world.events.find(
            (e) => e.type === "eliminated" && e.playerId === id,
          )?.tick ?? world.tick);
  const ranked = world.players.map((p) => ({
    player: p,
    lasted: survival(p.id, p.alive),
  }));
  const rows = ranked
    .map(({ player, lasted }): ResultRow => {
      const shown = players.find((p) => p.id === player.id);
      return {
        id: player.id,
        slot: player.slot,
        name: shown?.name ?? team(player.id),
        color: shown?.color ?? "#63cfff",
        you: player.id === self,
        bot: context.bot(player.id),
        place: 1 + ranked.filter((other) => other.lasted > lasted).length,
        peak: peakTerritory(world, player.id),
        built: player.statistics.built,
        damage: player.statistics.damage,
        lost: player.statistics.lost,
        research: player.research.length,
      };
    })
    .sort((a, b) => a.place - b.place || a.slot - b.slot);
  return {
    title,
    how,
    elapsed: clock(world.tick),
    accent:
      winnerId === null
        ? null
        : (rows.find((row) => row.id === winnerId)?.color ?? null),
    rows,
    note: rows
      .flatMap((row) => {
        const opening = context.openings.get(row.id);
        return opening ? [`${row.name} played ${opening}`] : [];
      })
      .join(" · "),
    solo: !context.room,
    again: playing ? "PLAY AGAIN" : "WATCH AGAIN",
    host: !!context.room?.host,
    waiting: context.room && !context.room.host ? "Waiting for the host…" : "",
  };
}

/** What the page lends the report: friend buttons and the nodes it draws the old report's parts into. */
export interface ReportParts {
  /** FRIENDS or + ADD FRIEND for another player whose account is known. */
  friend?(id: string): HTMLElement | undefined;
  /** Why the match went the way it did. */
  findings: readonly Node[];
  /** The chart with its metric tabs; the page redraws it when a tab is pressed. */
  chart: readonly Node[];
  /** The scoreboard, research paths and key moments, behind "View full stats". */
  breakdown: readonly Node[];
}

const count = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** A finished match as the shared results screen shows it. */
export function resultReport(
  result: MatchResult,
  parts: ReportParts,
): ResultsReport {
  const rows: ResultsRow[] = result.rows.map((row) => ({
    id: row.id,
    placement: row.place,
    name: row.name,
    color: row.color,
    you: row.you,
    ...(row.bot ? { tag: "AI" } : {}),
    friend:
      row.you || row.bot || result.solo ? undefined : parts.friend?.(row.id),
    values: [
      String(row.peak),
      String(row.built),
      String(row.damage),
      String(row.lost),
    ],
  }));
  const cards: ResultsHighlight[] = [];
  const most = createTopResultHighlight(result.rows, (row) => row.color, cards);
  most(
    (row) => row.damage,
    (best) => ({
      icon: "✕",
      title: "Heaviest hitter",
      detail: `${best} damage dealt to rival structures.`,
    }),
  );
  most(
    (row) => row.built,
    (best) => ({
      icon: "▣",
      title: "Master builder",
      detail: `${count(best, "structure")} grown.`,
    }),
  );
  most(
    (row) => row.research,
    (best) => ({
      icon: "◎",
      title: "Deep thinker",
      detail: `${count(best, "research project")} finished.`,
    }),
  );
  const sections = [
    { title: "WHAT DECIDED IT", content: parts.findings },
    { title: "HOW THE MATCH WENT", content: parts.chart },
  ].filter((section) => section.content.length);
  return {
    game: "FUSE CRAFT",
    context: `${result.elapsed} elapsed · ${count(result.rows.length, "network")}`,
    headline: result.title,
    summary: result.how,
    ...(result.accent ? { accent: result.accent } : {}),
    standings: {
      nameLabel: "NETWORK",
      columns: ["PEAK CELLS", "BUILT", "DAMAGE", "LOST"],
      rows,
      ...(result.note ? { note: result.note } : {}),
    },
    highlights: { cards },
    sections,
    ...(parts.breakdown.length
      ? { details: { content: parts.breakdown } }
      : {}),
  };
}

/** The bar under the report: a local match's restart and menu, or the host's next steps. */
export function resultBar(result: MatchResult): ResultsBar {
  if (result.solo)
    return {
      // Alone, Menu in the bar is the way out.
      back: false,
      actions: [
        { id: "menu", label: "Menu" },
        { id: "rematch", label: result.again, primary: true },
      ],
    };
  return roomResultsBar(result);
}
