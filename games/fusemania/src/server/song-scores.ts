import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { RoomError } from "fuse-network-be";
import { publicIdOf, type HistoryDatabase } from "fuse-platform";
import {
  record,
  type TelemetryDatabase,
} from "fuse-telemetry/metrics-database";
import {
  createWorld,
  stepWorld,
  rating,
  LEAD_IN_MS,
  SOLO_LEAD_IN_MS,
  SCORE_MODE,
  TICK_MS,
  type Library,
  type SongSource,
} from "../engine/index.js";
import {
  MAX_RUN_INPUTS,
  scoreSource,
  type SongInput,
  type ScoreEntry,
  type SongBoard,
} from "../song-scores.js";

const HOUR = 3_600_000;
const MAX_EVIDENCE_BYTES = 900_000;
const CATALOG_CACHE_MS = 15_000;
interface RankedEntry extends ScoreEntry {
  uid: string;
}
interface Ticket {
  uid: string;
  song: string;
  chart: number;
  version: string;
  leadIn: number;
  startedAt: number;
  expiresAt: number;
  status: "started" | "completed";
}
export interface SongScoreOptions {
  database: TelemetryDatabase;
  accounts: Pick<HistoryDatabase, "accounts">;
  library: Library;
  sources: readonly SongSource[];
  rules: string;
  now(): number;
  id(): string;
}
const publicEntry = ({
  uid,
  name,
  rating,
  endedAt,
}: RankedEntry): ScoreEntry => ({
  publicId: publicIdOf(uid),
  name,
  rating,
  endedAt,
});
const integer = (n: unknown): n is number => Number.isSafeInteger(n);
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
function parseTicket(value: unknown): Ticket {
  const data = record(value);
  if (
    !data ||
    typeof data.uid !== "string" ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(data.uid) ||
    typeof data.song !== "string" ||
    !integer(data.chart) ||
    data.chart < 0 ||
    typeof data.version !== "string" ||
    !/^[a-f0-9]{64}$/.test(data.version) ||
    (data.leadIn !== SOLO_LEAD_IN_MS && data.leadIn !== LEAD_IN_MS) ||
    !integer(data.startedAt) ||
    data.startedAt < 0 ||
    !integer(data.expiresAt) ||
    data.expiresAt <= data.startedAt ||
    (data.status !== "started" && data.status !== "completed") ||
    (data.status === "completed" &&
      (!integer(data.rating) || data.rating < 0 || data.rating > 1_000_000))
  )
    throw new Error("Stored song ticket is invalid");
  return {
    uid: data.uid,
    song: data.song,
    chart: data.chart,
    version: data.version,
    leadIn: data.leadIn,
    startedAt: data.startedAt,
    expiresAt: data.expiresAt,
    status: data.status,
  };
}

/** Server-owned completion events and leaderboard projections share the existing telemetry database adapter.
 * They never pass through the anonymous analytics ingestion endpoint. */
export class SongScores {
  private versions = new Map<string, string>();
  private catalogGeneration = 0;
  private cachedCatalog: { until: number; songs: SongBoard[] } | undefined;
  private pendingCatalog:
    { generation: number; promise: Promise<SongBoard[]> } | undefined;
  constructor(private options: SongScoreOptions) {
    for (const source of options.sources)
      this.versions.set(
        source.id,
        digest(scoreSource(options.rules, source.ssc, source.id)),
      );
  }
  private chart(song: unknown, chart: unknown) {
    if (typeof song !== "string" || !integer(chart) || chart < 0)
      throw new RoomError(400, "Unknown song or chart");
    const info = this.options.library.song(song),
      version = this.versions.get(song);
    if (!info || !version || !info.charts[chart])
      throw new RoomError(400, "Unknown song or chart");
    return {
      info,
      chart,
      version,
      key: `telemetry-song-boards/${version}_${chart}`,
    };
  }
  async catalog(): Promise<SongBoard[]> {
    const generation = this.catalogGeneration;
    if (this.cachedCatalog && this.cachedCatalog.until > this.options.now())
      return structuredClone(this.cachedCatalog.songs);
    let pending = this.pendingCatalog;
    if (!pending || pending.generation !== generation) {
      const promise = this.readCatalog()
        .then((songs) => {
          if (generation === this.catalogGeneration)
            this.cachedCatalog = {
              until: this.options.now() + CATALOG_CACHE_MS,
              songs,
            };
          return songs;
        })
        .finally(() => {
          if (this.pendingCatalog?.promise === promise)
            this.pendingCatalog = undefined;
        });
      pending = { generation, promise };
      this.pendingCatalog = pending;
    }
    const songs = await pending.promise;
    // A completion invalidates an already in-flight read as well as a settled cache.
    return generation === this.catalogGeneration
      ? structuredClone(songs)
      : this.catalog();
  }
  private invalidateCatalog(): void {
    this.catalogGeneration++;
    this.cachedCatalog = undefined;
  }
  private async readCatalog(): Promise<SongBoard[]> {
    const songs = this.options.library.songs;
    const keys = songs.flatMap((song) =>
      song.charts.map((_, i) => this.chart(song.id, i).key),
    );
    const stored = await this.options.database.readMany(keys);
    let index = 0;
    return songs.map((song) => ({
      song: song.id,
      title: song.title,
      charts: song.charts.map((chart, i) => {
        const data = this.entries(stored[index++]);
        return {
          chart: i,
          difficulty: chart.name,
          version: this.versions.get(song.id)!,
          ...(data[0] ? { top: publicEntry(data[0]) } : {}),
        };
      }),
    }));
  }
  private entries(value: unknown): RankedEntry[] {
    if (value === undefined) return [];
    const data = record(value);
    if (
      !data ||
      !Array.isArray(data.players) ||
      data.players.length > 100 ||
      !data.players.every((raw) => {
        const row = record(raw);
        return (
          row &&
          typeof row.uid === "string" &&
          typeof row.name === "string" &&
          row.name.length <= 100 &&
          integer(row.rating) &&
          row.rating >= 0 &&
          row.rating <= 1_000_000 &&
          integer(row.endedAt)
        );
      })
    )
      throw new Error("Stored song leaderboard is invalid");
    return data.players as RankedEntry[];
  }
  async leaderboard(song: unknown, chart: unknown): Promise<ScoreEntry[]> {
    const { key } = this.chart(song, chart);
    return this.entries((await this.options.database.readMany([key]))[0]).map(
      publicEntry,
    );
  }
  async start(uid: string, raw: unknown) {
    const data = record(raw);
    const selected = this.chart(data?.song, data?.chart);
    if (data?.version !== selected.version)
      throw new RoomError(409, "The chart changed; reload Fusemania");
    if (data.leadIn !== SOLO_LEAD_IN_MS && data.leadIn !== LEAD_IN_MS)
      throw new RoomError(400, "Invalid lead-in");
    const id = this.options.id(),
      now = this.options.now();
    const ticket: Ticket = {
      uid,
      song: selected.info.id,
      chart: selected.chart,
      version: selected.version,
      leadIn: data.leadIn,
      startedAt: now,
      expiresAt: now + HOUR,
      status: "started",
    };
    await this.options.database.transact(async (tx) => {
      const key = `telemetry-song-runs/${id}`;
      const activeKey = `telemetry-song-active/${digest(uid)}`;
      const [old, active] = await tx.getMany([key, activeKey]);
      if (old) throw new Error("Duplicate run id");
      // Starting another song cancels the previous ticket, including across devices/instances.
      tx.set(key, ticket);
      tx.set(activeKey, {
        id,
        expiresAt: ticket.expiresAt,
        previous: record(active)?.id ?? null,
      });
    });
    return { id };
  }
  async complete(uid: string, id: string, raw: unknown) {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new RoomError(400, "Invalid run");
    const key = `telemetry-song-runs/${id}`;
    const initial = record((await this.options.database.readMany([key]))[0]);
    if (!initial || initial.uid !== uid)
      throw new RoomError(404, "Run not found");
    const ticket = parseTicket(initial);
    const selected = this.chart(ticket.song, ticket.chart);
    if (ticket.version !== selected.version)
      throw new RoomError(409, "The chart changed; replay the song");
    // A completed event is immutable: retries return the original result, never re-run caller-supplied evidence.
    if (ticket.status === "completed") {
      this.invalidateCatalog();
      return { rating: initial.rating, saved: true };
    }
    const now = this.options.now();
    if (ticket.expiresAt <= now)
      throw new RoomError(410, "Run expired; replay the song");
    // Ticket may arrive during the lead-in, so require at least the actual song duration server-side.
    if (now - ticket.startedAt < selected.info.endMs)
      throw new RoomError(409, "The song has not finished yet");
    const data = record(raw);
    if (!Array.isArray(data?.inputs) || data.inputs.length > MAX_RUN_INPUTS)
      throw new RoomError(400, "Invalid input log");
    const inputs: SongInput[] = [];
    let last = -ticket.leadIn;
    for (const value of data.inputs) {
      const input = record(value);
      if (
        !input ||
        Object.keys(input).length !== 3 ||
        !integer(input.at) ||
        !integer(input.code) ||
        !integer(input.ms) ||
        input.code < 0 ||
        input.code > 7 ||
        input.at < last ||
        input.at <= -ticket.leadIn ||
        input.at > selected.info.endMs + TICK_MS ||
        (input.at + ticket.leadIn) % TICK_MS !== 0 ||
        Math.abs(input.ms - input.at) > 300
      )
        throw new RoomError(400, "Invalid input log");
      inputs.push({ at: input.at, code: input.code, ms: input.ms });
      last = input.at;
    }
    const world = createWorld(
      this.options.library,
      ticket.song,
      SCORE_MODE,
      0,
      [{ id: "ranked", chart: ticket.chart, bot: false }],
      ticket.leadIn,
    )!;
    let at = 0;
    const maxTicks = Math.ceil((selected.info.endMs + ticket.leadIn) / TICK_MS);
    for (let ticks = 0; ticks < maxTicks && world.phase !== "over"; ticks++) {
      const tick: { slot: number; code: number; ms: number }[] = [];
      while (inputs[at]?.at === world.ms + TICK_MS) {
        const input = inputs[at++]!;
        tick.push({ slot: 0, code: input.code, ms: input.ms });
      }
      stepWorld(this.options.library, world, tick);
    }
    if (world.phase !== "over") throw new Error("Ranked replay did not finish");
    if (at !== inputs.length)
      throw new RoomError(400, "Inputs after the song ended");
    const result = rating(
      this.options.library.steps(ticket.song, ticket.chart)!,
      world.players[0]!.score,
    );
    if (data.rating !== result)
      throw new RoomError(400, "The replay did not match the reported result");
    if (result < 0 || result > 1_000_000)
      throw new RoomError(400, "Invalid ranked result");
    const account = (await this.options.accounts.accounts([uid])).get(uid);
    const name = account?.username ?? account?.name;
    if (!name)
      throw new RoomError(
        409,
        "Choose your account name before saving a highscore",
      );
    const entry: RankedEntry = { uid, name, rating: result, endedAt: now };
    // Canonicalize after validation and replay. The API never accepts client-compressed evidence.
    // A bytes field avoids Firestore's per-map overhead; the cap leaves >140KiB for bounded metadata.
    const inputEvidence = deflateSync(
      Buffer.from(JSON.stringify(inputs), "utf8"),
    );
    if (inputEvidence.byteLength > MAX_EVIDENCE_BYTES)
      throw new RoomError(400, "Input evidence too large");
    const outcome = await this.options.database.transact(async (tx) => {
      const personalKey = `telemetry-song-bests/${digest(`${uid}:${selected.key}`)}`;
      const activeKey = `telemetry-song-active/${digest(uid)}`;
      const [stored, board, personal, active] = await tx.getMany([
        key,
        selected.key,
        personalKey,
        activeKey,
      ]);
      const current = record(stored);
      const checked = parseTicket(current);
      if (current?.status === "completed")
        return { rating: current.rating, saved: true };
      if (record(active)?.id !== id)
        throw new RoomError(409, "A newer song replaced this run");
      if (
        checked.uid !== uid ||
        checked.song !== ticket.song ||
        checked.chart !== ticket.chart ||
        checked.version !== ticket.version ||
        checked.leadIn !== ticket.leadIn ||
        checked.startedAt !== ticket.startedAt ||
        checked.expiresAt !== ticket.expiresAt ||
        ticket.expiresAt <= this.options.now()
      )
        throw new RoomError(410, "Run expired");
      const previous =
        personal === undefined
          ? undefined
          : this.entries({ players: [personal] })[0];
      if (previous && previous.uid !== uid)
        throw new Error("Stored personal best has the wrong owner");
      if (!previous || Number(previous.rating) < result) {
        const players = this.entries(board).filter((row) => row.uid !== uid);
        players.push(entry);
        players.sort(
          (a, b) =>
            b.rating - a.rating ||
            a.endedAt - b.endedAt ||
            a.uid.localeCompare(b.uid),
        );
        tx.set(selected.key, { players: players.slice(0, 100) });
        tx.set(personalKey, entry);
      }
      tx.set(key, {
        ...ticket,
        status: "completed",
        name: "fuse.Song Completed",
        gameId: "fusemania",
        difficulty: selected.info.charts[ticket.chart]!.name,
        rating: result,
        percent: result / 10_000,
        endedAt: now,
        inputEvidence,
        inputEncoding: "json+deflate",
        inputCount: inputs.length,
        expiresAt: now + 90 * 24 * HOUR,
      });
      return { rating: result, saved: true };
    });
    this.invalidateCatalog();
    return outcome;
  }
}
