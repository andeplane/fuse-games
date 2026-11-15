/** Shared wire contract. Ratings remain integer millionths; every score shown to a player is a percentage. */
export const SCORE_DIFFICULTIES = [
  "Easy",
  "Medium",
  "Hard",
  "Challenge",
] as const;
/** Room for the largest bundled charts' press/releases plus extra taps; private server evidence is compressed. */
export const MAX_RUN_INPUTS = 24_000;
export interface SongInput {
  at: number;
  code: number;
  ms: number;
}
export interface ScoreEntry {
  /** The platform's opaque public player ID, for shared player activity. */
  publicId?: string;
  name: string;
  rating: number;
  endedAt: number;
}
export interface SongBoard {
  song: string;
  title: string;
  /** Completed verified runs recorded since play counting was introduced. */
  plays?: number;
  charts: {
    chart: number;
    difficulty: string;
    meter?: number;
    version: string;
    top?: ScoreEntry;
  }[];
}
export const scorePercent = (rating: number): string =>
  `${(Math.floor(rating / 100) / 100).toFixed(2)}%`;
/** Hash the exact shipped song source and scoring rules on both browser and server. */
export const scoreSource = (rules: string, ssc: string, song = "") =>
  `${rules}\n${song}\n${ssc}`;
