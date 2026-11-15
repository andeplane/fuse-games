import type { SongInfo } from "../engine/index.js";

/** What the song select can order the carousel by. `pack` is the library's own order, pack by pack. */
export type SortKey =
  "pack" | "title" | "bpm" | "easy" | "medium" | "hard" | "challenge";
export type SortDirection = "asc" | "desc";
export interface SongSort {
  key: SortKey;
  direction: SortDirection;
}

export const SORT_CHOICES: readonly {
  key: SortKey;
  name: string;
  /** Short name for the button. */
  short: string;
}[] = [
  { key: "pack", name: "Song pack", short: "PACK" },
  { key: "title", name: "Title", short: "TITLE" },
  { key: "bpm", name: "BPM", short: "BPM" },
  { key: "easy", name: "Easy difficulty", short: "EASY" },
  { key: "medium", name: "Medium difficulty", short: "MEDIUM" },
  { key: "hard", name: "Hard difficulty", short: "HARD" },
  { key: "challenge", name: "Challenge difficulty", short: "CHALLENGE" },
];
export const DEFAULT_SORT: SongSort = { key: "pack", direction: "asc" };

/** The text on the button: "SORT: BPM ↑". */
export function sortLabel(sort: SongSort): string {
  const choice = SORT_CHOICES.find((each) => each.key === sort.key);
  return `${choice?.short ?? "PACK"} ${sort.direction === "asc" ? "↑" : "↓"}`;
}

/** The meter of a song's chart of that name (`Easy`…), or undefined for a song without one. */
function meterOf(song: SongInfo, level: string): number | undefined {
  return song.charts.find((chart) => chart.name.toLowerCase() === level)?.meter;
}

const text = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });

/**
 * `songs` in the order `sort` asks for. `packed` is the library order (pack by pack) and breaks every tie, so the
 * result is stable and a song never jumps between equal neighbours. A song that has no value to sort by (no chart
 * of that difficulty) goes last in either direction. A new array; the input is not touched.
 */
export function sortSongs<T extends SongInfo>(
  packed: readonly T[],
  sort: SongSort,
): T[] {
  const place = new Map(packed.map((song, index) => [song, index]));
  const rank = (song: T) => place.get(song) ?? 0;
  const sign = sort.direction === "asc" ? 1 : -1;
  if (sort.key === "pack") {
    return [...packed].sort((a, b) => sign * (rank(a) - rank(b)));
  }
  const value = (song: T): number | undefined =>
    sort.key === "bpm"
      ? song.bpm[1]
      : sort.key === "title"
        ? undefined
        : meterOf(song, sort.key);
  return [...packed].sort((a, b) => {
    if (sort.key === "title")
      return sign * text(a.title, b.title) || rank(a) - rank(b);
    const x = value(a),
      y = value(b);
    if (x === undefined || y === undefined) {
      if (x === y) return rank(a) - rank(b);
      return x === undefined ? 1 : -1;
    }
    return sign * (x - y) || text(a.title, b.title) || rank(a) - rank(b);
  });
}

/**
 * What the song slider's badge says for `song` under `sort`: the title's first letter, the pack's name, the BPM
 * (the top of a tempo range, as the order uses) or the meter of that difficulty, "-" for a song without one.
 */
export function badgeText(
  song: SongInfo,
  sort: SongSort,
  packName: string | undefined,
): string {
  switch (sort.key) {
    case "title": {
      const first = song.title.trim().charAt(0).toUpperCase();
      return /[A-Z]/.test(first) ? first : first ? "#" : "-";
    }
    case "pack":
      return packName ?? "-";
    case "bpm":
      return String(Math.round(song.bpm[1]));
    default:
      return String(meterOf(song, sort.key) ?? "-");
  }
}
