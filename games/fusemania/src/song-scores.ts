/** Shared wire contract. Ratings remain integer millionths; every score shown to a player is a percentage. */
export const SCORE_DIFFICULTIES = [
  "Easy",
  "Medium",
  "Hard",
  "Challenge",
] as const;
/** Firestore map entries cost more than their JSON encoding; 12k leaves >200KiB below its 1MiB document limit. */
export const MAX_RUN_INPUTS = 12_000;
export interface SongInput {
  at: number;
  code: number;
  ms: number;
}
export interface ScoreEntry {
  name: string;
  rating: number;
  endedAt: number;
}
export interface SongBoard {
  song: string;
  title: string;
  charts: {
    chart: number;
    difficulty: string;
    version: string;
    top?: ScoreEntry;
  }[];
}
export const scorePercent = (rating: number): string =>
  `${(Math.floor(rating / 100) / 100).toFixed(2)}%`;
/** Hash the exact shipped song source and scoring rules on both browser and server. */
export const scoreSource = (rules: string, ssc: string, song = "") =>
  `${rules}\n${song}\n${ssc}`;
