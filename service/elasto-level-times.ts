import type { IncomingMessage } from "node:http";
import {
  RoomError,
  rateLimitAddress,
  type HttpExtension,
} from "fuse-network-be";
import type { HistoryDatabase, IdentityVerifier } from "fuse-platform";
import {
  SharedTelemetryQuota,
  TelemetryAdmission,
} from "fuse-telemetry/limits";
import {
  record,
  type TelemetryDatabase,
} from "fuse-telemetry/metrics-database";
import {
  LEVEL_COUNT,
  RACE_LIMIT,
  RULES,
  isLevel,
} from "../games/elasto-fuse/src/engine/index.js";
import {
  LEVEL_BOARD_PAGE_SIZE,
  LEVEL_BOARD_PLACES,
  verifiedTime,
  type LevelBoardPage,
  type LevelTime,
} from "../games/elasto-fuse/src/level-times.js";

const PATH = "/api/games/elasto-fuse/level-times";
const MAX_PLAYERS = 100;
const MAX_BODY = 400_000;
const HOUR = 3_600_000;
const OVERVIEW_TTL_MS = 300_000;
interface RankedTime extends LevelTime {
  uid: string;
  endedAt: number;
}

async function runBody(req: IncomingMessage): Promise<unknown> {
  if (req.headers["content-type"]?.split(";")[0]?.trim() !== "application/json")
    throw new RoomError(415, "Expected application/json");
  const chunks: Buffer[] = [];
  let bytes = 0;
  const timeout = setTimeout(
    () => req.destroy(new RoomError(408, "Request too slow")),
    10_000,
  );
  timeout.unref();
  try {
    for await (const chunk of req as AsyncIterable<Buffer>) {
      bytes += chunk.length;
      if (bytes > MAX_BODY) throw new RoomError(413, "Input log too large");
      chunks.push(chunk);
    }
  } finally {
    clearTimeout(timeout);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RoomError(400, "Invalid JSON");
  }
}

function entries(raw: unknown): RankedTime[] {
  if (raw === undefined) return [];
  const rows: unknown = record(raw)?.players;
  if (!Array.isArray(rows) || rows.length > MAX_PLAYERS)
    throw new Error("Stored level board is invalid");
  const players = rows.map((raw: unknown): RankedTime => {
    const row = record(raw);
    if (
      !row ||
      typeof row.name !== "string" ||
      row.name.length < 1 ||
      row.name.length > 80 ||
      typeof row.uid !== "string" ||
      typeof row.steps !== "number" ||
      !Number.isInteger(row.steps) ||
      row.steps < 1 ||
      row.steps > RACE_LIMIT ||
      typeof row.endedAt !== "number" ||
      !Number.isSafeInteger(row.endedAt)
    )
      throw new Error("Stored level entry is invalid");
    return {
      uid: row.uid,
      name: row.name,
      steps: row.steps,
      endedAt: row.endedAt,
    };
  });
  return players;
}

const levelKey = (level: number) => `telemetry-level-times/${RULES}-${level}`;
const publicTime = ({ name, steps }: RankedTime): LevelTime => ({
  name,
  steps,
});

async function loadOverview(
  database: TelemetryDatabase,
): Promise<Required<LevelBoardPage>> {
  const documents = await database.readMany(
    Array.from({ length: LEVEL_COUNT }, (_, level) => levelKey(level)),
  );
  const leaders = new Map<
    string,
    { name: string; records: number; endedAt: number }
  >();
  const levels = documents.map((document) => {
    const top = entries(document).slice(0, LEVEL_BOARD_PLACES);
    const winner = top[0];
    if (winner) {
      const prior = leaders.get(winner.uid);
      const latest = prior && prior.endedAt > winner.endedAt ? prior : winner;
      leaders.set(winner.uid, {
        name: latest.name,
        endedAt: latest.endedAt,
        records: (prior?.records ?? 0) + 1,
      });
    }
    return top.map(publicTime);
  });
  const standings = [...leaders.values()]
    .map(({ name, records }) => ({ name, records }))
    .sort((a, b) => b.records - a.records || a.name.localeCompare(b.name));
  return { levels, standings };
}

export function elastoLevelTimesHttp(
  database: TelemetryDatabase,
  accounts: Pick<HistoryDatabase, "accounts">,
  identity: IdentityVerifier,
  rateLimitKey: string | undefined,
  now: () => number,
): HttpExtension {
  const admission = new TelemetryAdmission(now, 8, 2);
  const quota = rateLimitKey
    ? new SharedTelemetryQuota(database, rateLimitKey, now)
    : undefined;
  let overview:
    { expiresAt: number; data: Required<LevelBoardPage> } | undefined;
  let refresh: Promise<Required<LevelBoardPage>> | undefined;
  function readOverview() {
    if (overview && overview.expiresAt > now())
      return Promise.resolve(overview.data);
    refresh ??= loadOverview(database)
      .then((data) => {
        overview = { data, expiresAt: now() + OVERVIEW_TTL_MS };
        return data;
      })
      .finally(() => {
        refresh = undefined;
      });
    return refresh;
  }
  return {
    async handle(req, res, address) {
      const url = new URL(req.url ?? "/", "http://times");
      if (url.pathname !== PATH) return false;
      if (!quota) throw new RoomError(503, "Level times are unavailable");
      await admission.run(address, async () => {
        const read = req.method === "GET";
        if (!read && req.method !== "POST")
          throw new RoomError(405, "Use GET for leaderboards or POST for runs");
        await quota.consume([
          {
            dimension: read
              ? "level-times-read-address"
              : "level-times-post-address",
            identity: rateLimitAddress(address),
            cost: 1,
            limit: read ? 300 : 60,
            windowMs: HOUR,
          },
        ]);
        const rawLevel = url.searchParams.get("level") ?? "";
        const rawFrom = url.searchParams.get("from");
        let value: unknown;
        if (read && rawFrom !== null) {
          const from = /^\d{1,4}$/.test(rawFrom) ? Number(rawFrom) : undefined;
          if (rawLevel || !isLevel(from))
            throw new RoomError(400, "Unknown leaderboard offset");
          const data = await readOverview();
          value = {
            levels: data.levels.slice(from, from + LEVEL_BOARD_PAGE_SIZE),
            ...(from === 0 ? { standings: data.standings } : {}),
          } satisfies LevelBoardPage;
        } else {
          const level = /^\d{1,4}$/.test(rawLevel)
            ? Number(rawLevel)
            : undefined;
          if (!isLevel(level)) throw new RoomError(400, "Unknown level");
          const key = levelKey(level);
          if (read) {
            value = {
              players: entries((await database.readMany([key]))[0]).map(
                publicTime,
              ),
            };
          } else {
            const token = /^Bearer (.+)$/.exec(
              req.headers.authorization ?? "",
            )?.[1];
            const uid = token ? await identity(token) : undefined;
            if (!uid) throw new RoomError(401, "Sign in to save a time");
            await quota.consume([
              {
                dimension: "level-times-account",
                identity: uid,
                cost: 1,
                limit: 60,
                windowMs: HOUR,
              },
              {
                dimension: "level-times-post-global",
                identity: "all",
                cost: 1,
                limit: 600,
                windowMs: HOUR,
              },
            ]);
            const run = record(await runBody(req));
            if (run?.level !== level)
              throw new RoomError(400, "Run belongs to another level");
            const time = verifiedTime(run);
            if (time === undefined)
              throw new RoomError(400, "Run did not verify");
            const account = (await accounts.accounts([uid])).get(uid);
            const name = account?.username ?? account?.name;
            if (!name) throw new RoomError(409, "Choose an account name first");
            const entry = { uid, name, steps: time, endedAt: now() };
            const ranked = await database.transact(async (tx) => {
              const players = entries((await tx.getMany([key]))[0]);
              const previous = players.find((row) => row.uid === uid);
              if (previous && previous.steps <= time) return true;
              const next = players.filter((row) => row.uid !== uid);
              next.push(entry);
              next.sort(
                (a, b) =>
                  a.steps - b.steps ||
                  a.endedAt - b.endedAt ||
                  a.uid.localeCompare(b.uid),
              );
              const top = next.slice(0, MAX_PLAYERS);
              if (!top.includes(entry)) return false;
              tx.set(key, { players: top });
              return true;
            });
            value = { steps: time, ranked };
          }
        }
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify(value));
      });
      return true;
    },
  };
}
