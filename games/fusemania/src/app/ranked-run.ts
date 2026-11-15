import type { SongInput } from "../song-scores.js";

export interface RankObservation {
  key: string;
  song: string;
  chart: number;
  leadIn: number;
  eligible: boolean;
  beforeSong: boolean;
  finished: boolean;
  confirmed: boolean;
  rating: number;
}
export interface RankDependencies {
  token(): Promise<string | undefined>;
  version(song: string): Promise<string>;
  post(path: string, token: string, body: unknown): Promise<unknown>;
  inputs(): SongInput[] | undefined;
  changed(): void;
}
/** One request at a time, scoped to a match. Failed completion stays explicitly retryable on the result screen. */
export class RankedRun {
  private key = "";
  private ticket: string | undefined;
  private observation: RankObservation | undefined;
  private pending = false;
  private done = false;
  private error = false;
  status = "";
  constructor(private deps: RankDependencies) {}
  get canRetry() {
    return this.error && !!this.ticket && !this.pending;
  }
  observe(next: RankObservation) {
    if (this.key !== next.key) {
      this.key = next.key;
      this.observation = next;
      this.ticket = undefined;
      this.pending = false;
      this.done = false;
      this.error = false;
      this.status = next.eligible
        ? "Sign in to save song highscores."
        : "Battle and custom songs are unranked.";
      if (next.eligible && next.beforeSong) {
        this.deps.inputs(); // Begin evidence before the first key, even for a zero-score run.
        void this.start(next);
      } else if (next.eligible)
        this.status = "Join before the song starts to save a highscore.";
    }
    this.observation = next;
    if (
      next.finished &&
      next.confirmed &&
      this.ticket &&
      !this.pending &&
      !this.done &&
      !this.error
    )
      void this.save(next);
  }
  private async start(next: RankObservation) {
    this.pending = true;
    try {
      const token = await this.deps.token();
      if (this.key !== next.key) return;
      if (!token) return;
      this.status = "Preparing highscore verification…";
      const version = await this.deps.version(next.song);
      if (this.key !== next.key) return;
      const response = await this.deps.post("/runs", token, {
        song: next.song,
        chart: next.chart,
        leadIn: next.leadIn,
        version,
      });
      if (this.key !== next.key) return;
      if (
        !response ||
        typeof response !== "object" ||
        !("id" in response) ||
        typeof response.id !== "string"
      )
        throw new Error("Invalid run ticket");
      this.ticket = response.id;
      this.status = "Highscore verification ready.";
    } catch (error) {
      if (this.key === next.key)
        this.status = `Highscore unavailable: ${error instanceof Error ? error.message : "connection failed"}. Replay to try again.`;
    } finally {
      if (this.key === next.key) {
        this.pending = false;
        this.deps.changed();
      }
    }
  }
  private async save(next: RankObservation) {
    const ticket = this.ticket;
    const inputs = this.deps.inputs();
    if (!inputs) {
      this.done = true;
      this.status =
        "This run recovered or lost input evidence. Replay to save a highscore.";
      return;
    }
    this.pending = true;
    this.error = false;
    this.status = "Verifying song score…";
    this.deps.changed();
    try {
      // Refresh authentication for long/paused songs; the server still binds the ticket to its original account.
      const token = await this.deps.token();
      if (this.key !== next.key) return;
      if (!token) throw new Error("Sign in to save this score");
      const response = await this.deps.post(`/runs/${ticket}`, token, {
        inputs,
        rating: next.rating,
      });
      if (this.key !== next.key) return;
      if (
        !response ||
        typeof response !== "object" ||
        !("rating" in response) ||
        response.rating !== next.rating
      )
        throw new Error("The replay did not match your result");
      this.done = true;
      this.status = "Verified score saved to the song leaderboard.";
    } catch (error) {
      if (this.key === next.key) {
        this.error = true;
        this.status = `Score not saved: ${error instanceof Error ? error.message : "connection failed"}`;
      }
    } finally {
      if (this.key === next.key) {
        this.pending = false;
        this.deps.changed();
      }
    }
  }
  retry() {
    if (this.canRetry && this.observation) void this.save(this.observation);
  }
}
