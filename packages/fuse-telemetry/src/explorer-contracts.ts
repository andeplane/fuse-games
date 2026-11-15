import type { TelemetryEvent, TelemetryProperty } from "./contracts.js";

export type EventKind = "app" | "seat" | "match" | "round" | "custom";
export type FilterOperator =
  "eq" | "neq" | "contains" | "gt" | "gte" | "lt" | "lte" | "exists";
export interface EventConstraint {
  field: string;
  operator: FilterOperator;
  value: TelemetryProperty;
}
/** OR of AND groups: (A AND B) OR (C AND D). An empty expression matches all. */
export interface EventFilters {
  groups: EventConstraint[][];
}
export function isEventFilters(value: unknown): value is EventFilters {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("groups" in value) ||
    Object.keys(value).some((key) => key !== "groups") ||
    !Array.isArray(value.groups) ||
    value.groups.length > 8
  )
    return false;
  return value.groups.every(
    (group) =>
      Array.isArray(group) &&
      group.length > 0 &&
      group.length <= 8 &&
      group.every((rule) => {
        if (!rule || typeof rule !== "object" || Array.isArray(rule))
          return false;
        const { field, operator, value } = rule as Record<string, unknown>;
        return (
          Object.keys(rule).every((key) =>
            ["field", "operator", "value"].includes(key),
          ) &&
          typeof field === "string" &&
          (baseEventFields.some((key) => key === field) ||
            /^properties\.[A-Za-z_][A-Za-z0-9_]{0,47}$/.test(field)) &&
          !/(?:__proto__|constructor|prototype)/.test(field) &&
          [
            "eq",
            "neq",
            "contains",
            "gt",
            "gte",
            "lt",
            "lte",
            "exists",
          ].includes(String(operator)) &&
          (value === null ||
            typeof value === "boolean" ||
            (typeof value === "string" && value.length <= 200) ||
            (typeof value === "number" && Number.isFinite(value)))
        );
      }),
  );
}
export interface ExplorerQuery {
  from: string;
  to: string;
  gameId: string;
  filters: EventFilters;
}
export interface ExplorerEvent extends TelemetryEvent {
  kind: EventKind;
}
export interface PlayerSession {
  id: string;
  player: string;
  startedAt: number;
  lastEventAt: number;
  games: string[];
  modes: string[];
  events: number;
  rounds: number;
  matches: number;
}
export interface ExplorerResult {
  events: ExplorerEvent[];
  sessions: PlayerSession[];
  fields: string[];
  commonFields: string[];
  gameIds: string[];
  scanned: number;
  matched: number;
  truncated: boolean;
  /** Cursor continues the bounded source scan; totals describe this slice only when truncated. */
  nextCursor?: string;
  participants?: Record<string, string[]>;
  summary: {
    players: number;
    sessions: number;
    roundPlays: number;
    completions: number;
    matchPlays: number;
    games: number;
    completionRate: number | null;
  };
}
export const eventKind = (name: string): EventKind =>
  name.startsWith("fuse.Match ")
    ? "match"
    : name.startsWith("fuse.Round ")
      ? "round"
      : name === "fuse.App Opened"
        ? "app"
        : name === "fuse.Seat Taken"
          ? "seat"
          : "custom";
export const baseEventFields = [
  "occurredAt",
  "name",
  "kind",
  "gameId",
  "userId",
  "sessionId",
] as const;
export function eventValue(
  event: ExplorerEvent,
  field: string,
): TelemetryProperty | undefined {
  if (field.startsWith("properties.")) return event.properties[field.slice(11)];
  if (baseEventFields.some((key) => key === field))
    return event[field as (typeof baseEventFields)[number]];
  return undefined;
}
export function matchesEvent(
  event: ExplorerEvent,
  filters: EventFilters,
): boolean {
  return (
    !filters.groups.length ||
    filters.groups.some((group) =>
      group.every((rule) => {
        const actual = eventValue(event, rule.field);
        switch (rule.operator) {
          case "exists":
            return (actual !== undefined) === (rule.value !== false);
          case "eq":
            return actual === rule.value;
          case "neq":
            return actual !== undefined && actual !== rule.value;
          case "contains":
            return (
              actual !== undefined &&
              String(actual)
                .toLowerCase()
                .includes(String(rule.value).toLowerCase())
            );
          default: {
            if (typeof actual !== "number" || typeof rule.value !== "number")
              return false;
            return rule.operator === "gt"
              ? actual > rule.value
              : rule.operator === "gte"
                ? actual >= rule.value
                : rule.operator === "lt"
                  ? actual < rule.value
                  : actual <= rule.value;
          }
        }
      }),
    )
  );
}
