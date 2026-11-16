import { RoomError } from "fuse-network-be";
import { record, type TelemetryDatabase } from "./metrics-database.js";
import { parseTelemetryEvents } from "./metrics.js";
import {
  baseEventFields,
  eventKind,
  matchesEvent,
  isParticipation,
  type EventFilters,
  type ExplorerQuery,
  type ExplorerResult,
  type PlayerSession,
} from "./explorer-contracts.js";
const DAY = 86400_000;
export const EXPLORER_SCAN_LIMIT = 2000;
export function parseEventFilters(value: unknown): EventFilters {
  const data = record(value);
  if (
    !data ||
    Object.keys(data).some((key) => key !== "groups") ||
    !Array.isArray(data.groups) ||
    data.groups.length > 8
  )
    throw new RoomError(400, "Use at most eight OR groups");
  return {
    groups: data.groups.map((raw) => {
      if (!Array.isArray(raw) || !raw.length || raw.length > 8)
        throw new RoomError(400, "Use one to eight AND constraints per group");
      return raw.map((value) => {
        const rule = record(value);
        if (
          !rule ||
          Object.keys(rule).some(
            (key) => !["field", "operator", "value"].includes(key),
          ) ||
          typeof rule.field !== "string" ||
          !(
            baseEventFields.some((field) => field === rule.field) ||
            /^properties\.[A-Za-z_][A-Za-z0-9_]{0,47}$/.test(rule.field)
          ) ||
          /(?:__proto__|constructor|prototype)/.test(rule.field) ||
          ![
            "eq",
            "neq",
            "contains",
            "gt",
            "gte",
            "lt",
            "lte",
            "exists",
          ].includes(String(rule.operator)) ||
          !(
            rule.value === null ||
            typeof rule.value === "boolean" ||
            (typeof rule.value === "string" && rule.value.length <= 200) ||
            (typeof rule.value === "number" && Number.isFinite(rule.value))
          )
        )
          throw new RoomError(400, "Invalid event constraint");
        return {
          field: rule.field,
          operator: rule.operator,
          value: rule.value,
        } as EventFilters["groups"][number][number];
      });
    }),
  };
}
export function parseExplorerQuery(
  value: unknown,
  games: ReadonlySet<string>,
  now: number,
): ExplorerQuery {
  const data = record(value);
  if (
    !data ||
    Object.keys(data).some(
      (key) => !["from", "to", "gameId", "filters", "cursor"].includes(key),
    )
  )
    throw new RoomError(400, "Invalid explorer query");
  const date = (value: unknown) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new RoomError(400, "Expected UTC dates");
    const time = Date.parse(`${value}T00:00:00Z`);
    if (
      !Number.isFinite(time) ||
      new Date(time).toISOString().slice(0, 10) !== value
    )
      throw new RoomError(400, "Invalid date");
    return time;
  };
  const from = date(data.from),
    to = date(data.to);
  if (
    to < from ||
    to - from > 92 * DAY ||
    from < Math.floor((now - 90 * DAY) / DAY) * DAY ||
    to > now
  )
    throw new RoomError(
      422,
      "Choose up to 90 days of retained events through today",
    );
  if (
    typeof data.gameId !== "string" ||
    (data.gameId && !games.has(data.gameId))
  )
    throw new RoomError(400, "Unknown game");
  return {
    from: String(data.from),
    to: String(data.to),
    gameId: data.gameId,
    filters: parseEventFilters(data.filters),
  };
}
export class EventExplorer {
  constructor(
    private database: TelemetryDatabase,
    private games: ReadonlySet<string>,
    private now: () => number,
  ) {}
  async query(value: unknown): Promise<ExplorerResult> {
    const query = parseExplorerQuery(value, this.games, this.now());
    if (!this.database.queryEvents)
      throw new RoomError(503, "Event explorer unavailable");
    const cursor = record(value)?.cursor;
    let after: { time: number; id: string } | undefined;
    if (cursor !== undefined) {
      if (typeof cursor !== "string" || cursor.length > 180)
        throw new RoomError(400, "Invalid event cursor");
      const match = /^(\d{1,16}):([a-f0-9-]{36})$/.exec(cursor);
      if (!match) throw new RoomError(400, "Invalid event cursor");
      after = { time: Number(match[1]), id: match[2]! };
    }
    const now = this.now();
    const raw = await this.database.queryEvents({
      from: Date.parse(`${query.from}T00:00:00Z`),
      to: Math.min(now + 1, Date.parse(`${query.to}T00:00:00Z`) + DAY),
      limit: EXPLORER_SCAN_LIMIT + 1,
      after,
    });
    const hasMore = raw.length > EXPLORER_SCAN_LIMIT;
    const truncated = hasMore || after !== undefined;
    const source = raw
      .slice(0, EXPLORER_SCAN_LIMIT)
      .filter((value) => {
        const event = record(value);
        return (
          event &&
          Number(event.occurredAt) >= now - 90 * DAY &&
          Number(event.expiresAt ?? now + 1) > now
        );
      })
      .map((value) => {
        const event = record(value);
        if (!event) throw new Error("Invalid stored event");
        const [safe] = parseTelemetryEvents(
          {
            events: [
              {
                v: event.v,
                id: event.id,
                gameId: event.gameId,
                userId: event.userId,
                sessionId: event.sessionId,
                name: event.name,
                occurredAt: event.occurredAt,
                properties: event.properties,
              },
            ],
          },
          this.games,
          now,
        );
        return { ...safe!, kind: eventKind(safe!.name) };
      });
    const events = source.filter(
      (event) =>
        (!query.gameId || event.gameId === query.gameId) &&
        matchesEvent(event, query.filters),
    );
    const participants = new Map<string, Set<string>>();
    for (const event of source) {
      if (!isParticipation(event)) continue;
      for (const reference of [
        event.properties.matchRef,
        event.properties.roundRef,
      ])
        if (
          typeof reference === "string" &&
          /^p_[a-f0-9]{8}(?:-[a-f0-9]{8}){3}$/.test(reference)
        ) {
          const players = participants.get(reference) ?? new Set<string>();
          players.add(event.userId);
          participants.set(reference, players);
        }
    }
    const fieldSets = events.map(
      (event) =>
        new Set([
          ...baseEventFields,
          ...Object.keys(event.properties).map((key) => `properties.${key}`),
        ]),
    );
    const fields = [
      ...new Set(fieldSets.flatMap((fields) => [...fields])),
    ].sort();
    const sessions = new Map<string, PlayerSession>();
    for (const event of events) {
      // Include user in the grouping key: an untrusted session id cannot mix two browsers.
      const key = `${event.userId}:${event.sessionId}`;
      const session = sessions.get(key) ?? {
        id: event.sessionId,
        player: event.userId,
        startedAt: event.occurredAt,
        lastEventAt: event.occurredAt,
        games: [],
        modes: [],
        events: 0,
        rounds: 0,
        matches: 0,
      };
      session.startedAt = Math.min(session.startedAt, event.occurredAt);
      session.lastEventAt = Math.max(session.lastEventAt, event.occurredAt);
      session.events++;
      session.rounds += Number(
        event.name === "fuse.Round Started" && isParticipation(event),
      );
      session.matches += Number(
        event.name === "fuse.Match Started" && isParticipation(event),
      );
      if (!session.games.includes(event.gameId))
        session.games.push(event.gameId);
      if (
        typeof event.properties.mode === "string" &&
        !session.modes.includes(event.properties.mode)
      )
        session.modes.push(event.properties.mode);
      sessions.set(key, session);
    }
    const roundPlays = events.filter(
      (event) => event.name === "fuse.Round Started" && isParticipation(event),
    ).length;
    const completions = events.filter(
      (event) => event.name === "fuse.Round Ended" && isParticipation(event),
    ).length;
    const last = record(raw[Math.min(raw.length, EXPLORER_SCAN_LIMIT) - 1]);
    return {
      events,
      participants: Object.fromEntries(
        [...participants].map(([reference, players]) => [
          reference,
          [...players],
        ]),
      ),
      sessions: [...sessions.values()].sort(
        (a, b) => b.lastEventAt - a.lastEventAt,
      ),
      fields,
      commonFields: fields.filter(
        (field) => fieldSets.length && fieldSets.every((set) => set.has(field)),
      ),
      gameIds: [...this.games].sort(),
      scanned: source.length,
      matched: events.length,
      truncated,
      ...(hasMore && last
        ? { nextCursor: `${String(last.occurredAt)}:${String(last.id)}` }
        : {}),
      summary: {
        players: new Set(events.map((event) => event.userId)).size,
        sessions: sessions.size,
        roundPlays,
        completions,
        matchPlays: events.filter(
          (event) =>
            event.name === "fuse.Match Started" && isParticipation(event),
        ).length,
        games: new Set(
          events
            .filter(
              (event) =>
                isParticipation(event) &&
                ["fuse.Match Started", "fuse.Round Started"].includes(
                  event.name,
                ),
            )
            .map((event) => event.gameId),
        ).size,
        participationUnknown: events.filter(
          (event) =>
            /^fuse\.(?:(?:Match|Round) Started|Round Ended)$/.test(
              event.name,
            ) && typeof event.properties.played !== "boolean",
        ).length,
        completionRate: roundPlays ? completions / roundPlays : null,
      },
    };
  }
}
