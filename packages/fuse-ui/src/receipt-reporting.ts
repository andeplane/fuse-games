import type { MatchResult, PlayerResult } from "fuse-platform";

export interface MatchReceipt<
  Player extends PlayerResult = PlayerResult,
  Path extends "round-results" | "results" = "round-results" | "results",
> {
  key: string;
  path: Path;
  result: MatchResult<Player>;
}

export interface ReportTransport {
  fetch: typeof fetch;
  /** The room capability that proves which seat is reporting. */
  roomToken?: string;
  wait?: (ms: number) => Promise<void>;
}

/**
 * Best effort: a lost report costs one history entry and never disturbs the game. Every device reports at the same
 * moment and their writes land on one record, so a 503 (a lost race), a 403 (the socket is reconnecting) and a dropped
 * connection are retried; any other refusal is final.
 */
export async function sendReport(
  url: string,
  report: Pick<MatchReceipt, "result">,
  transport: ReportTransport,
  attempts = 3,
): Promise<"confirmed" | "pending" | "failed"> {
  const wait =
    transport.wait ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt) await wait(500 * 2 ** attempt);
    try {
      const response = await transport.fetch(url, {
        method: "POST",
        body: JSON.stringify({ result: report.result }),
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          ...(transport.roomToken === undefined
            ? {}
            : { Authorization: `Bearer ${transport.roomToken}` }),
        },
      });
      if (response.ok) {
        const body = (await response.json()) as { status?: unknown };
        return body.status === "confirmed" ? "confirmed" : "pending";
      }
      if (response.status !== 403 && response.status < 500) return "failed";
    } catch {
      /* offline or a dropped keepalive: try again */
    }
  }
  return "failed";
}

interface SingleRoundRoom {
  matchId: string;
  stage: string;
  decided?: { clock: number; finishers: readonly string[] } | null;
}

interface SingleRoundReceipts<Room, Player extends PlayerResult> {
  isBotId(id: string): boolean;
  roundResult(room: Room): MatchResult<Player> | null | undefined;
  matchResult(room: Room): MatchResult<Player> | null | undefined;
}

/** A one-round match owes a rating receipt and a separate career receipt. */
export function createSingleRoundReceipts<
  Room extends SingleRoundRoom,
  Player extends PlayerResult,
>({ isBotId, roundResult, matchResult }: SingleRoundReceipts<Room, Player>) {
  return (
    room: Room,
    me: string,
    confirmedTick: number,
    sent: ReadonlySet<string>,
  ): MatchReceipt<Player>[] => {
    const decided = room.decided;
    if (
      !me ||
      isBotId(me) ||
      room.stage !== "over" ||
      !decided ||
      decided.clock > confirmedTick ||
      !decided.finishers.includes(me)
    )
      return [];
    const due: MatchReceipt<Player>[] = [];
    const round = roundResult(room),
      match = matchResult(room);
    const roundKey = `${room.matchId}:1`,
      matchKey = `${room.matchId}:match`;
    if (round && !sent.has(roundKey))
      due.push({ key: roundKey, path: "round-results", result: round });
    if (match && !sent.has(matchKey))
      due.push({ key: matchKey, path: "results", result: match });
    return due;
  };
}

interface ReceiptReporterOptions<Room> {
  due(
    room: Room,
    me: string,
    confirmedTick: number,
    sent: ReadonlySet<string>,
  ): readonly MatchReceipt[];
  gameId: string;
  display: boolean;
  scope:
    | { kind: "room"; code: string; token?: string }
    | { kind: "solo"; signedIn(): boolean };
  apiUrl(path: string): string;
  fetch: typeof fetch;
  playerId(): string;
  confirmedTick(): number;
}

/** Observe one screen's room snapshots and send each due receipt once, including transport retries. */
export function createReceiptReporter<Room>(
  options: ReceiptReporterOptions<Room>,
) {
  const { scope } = options;
  const destination = scope.kind === "room" ? `rooms/${scope.code}` : "me";
  const transport: ReportTransport = {
    fetch: options.fetch,
    ...(scope.kind === "room" ? { roomToken: scope.token } : {}),
  };
  const sent = new Set<string>();
  return (room: Room | null | undefined): void => {
    if (
      options.display ||
      !room ||
      (scope.kind === "solo" && !scope.signedIn())
    )
      return;
    for (const report of options.due(
      room,
      options.playerId(),
      options.confirmedTick(),
      sent,
    )) {
      sent.add(report.key);
      void sendReport(
        options.apiUrl(
          `/api/games/${options.gameId}/${destination}/${report.path}`,
        ),
        report,
        transport,
      );
    }
  };
}
