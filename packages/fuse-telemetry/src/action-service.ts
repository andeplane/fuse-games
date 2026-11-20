import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { RoomError } from "fuse-network-be";
import {
  ACTION_LIMITS,
  type ActionClaimResponse,
  type ActionItem,
  type ActionsPage,
  type ActionsQuery,
  type TranscriptActionHook,
  type TranscriptActionInput,
  type TranscriptActionSegment,
} from "./action-contracts.js";
import {
  validateActionCandidates,
  type ActionCandidate,
  type ActionExtractor,
  type ActionExtractionInput,
} from "./action-extractor.js";
import {
  actionIdentifier,
  type ActionAgentToken,
  type ActionDatabase,
  type ActionState,
} from "./action-store.js";
import {
  selectActionPage,
  RECORDINGS_PER_ACTION_PAGE,
  visible,
  type ActionCursor,
} from "./action-page.js";
import { reconcileCandidates } from "./action-reconciliation.js";

export interface ActionPrincipal {
  uid: string;
  tokenId?: string;
  recordingId?: string;
  gameId?: string;
  email?: string;
}
export interface ActionServiceOptions {
  database: ActionDatabase;
  extractor: ActionExtractor;
  /** Read only nearby saved transcripts; include up to two predecessors and one successor. */
  readNeighbors: (
    recordingId: string,
    sequence: number,
  ) => Promise<TranscriptActionSegment[]>;
  /** True when this segment's transcription failed for good, so no transcript will ever arrive. */
  readFailed?: (recordingId: string, sequence: number) => Promise<boolean>;
  now?: () => number;
  randomId?: () => string;
  ownerPolicy?: (
    uid: string,
    email?: string,
  ) => Promise<{ generation: number; tokenAllowed: boolean }>;
}
/** Stands in `processed` for a segment that will never be transcribed. */
const SKIPPED = "0".repeat(64);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const integer = (value: unknown, max: number) =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max;
const ownerId = (principal: ActionPrincipal) =>
  principal.tokenId ? `agent_${principal.tokenId}` : principal.uid;
const checkScope = (
  principal: ActionPrincipal,
  item: { recordingId: string; gameId: string },
) => {
  if (
    (principal.recordingId && principal.recordingId !== item.recordingId) ||
    (principal.gameId && principal.gameId !== item.gameId)
  )
    throw new RoomError(403, "Action token scope denied");
};
function validateSegment(segment: TranscriptActionSegment) {
  if (
    (segment.gameId !== undefined && !actionIdentifier(segment.gameId)) ||
    !integer(segment.sequence, ACTION_LIMITS.segments - 1) ||
    !integer(segment.startMs, 7_200_000) ||
    !integer(segment.endMs, 7_200_000) ||
    segment.endMs <= segment.startMs ||
    typeof segment.text !== "string" ||
    segment.text.length > 32_000 ||
    (segment.reportIds &&
      (!Array.isArray(segment.reportIds) ||
        segment.reportIds.length > 20 ||
        !segment.reportIds.every(actionIdentifier)))
  )
    throw new Error("Invalid action transcript segment");
}
function decodeActionCursor(
  encoded: string | undefined,
): ActionCursor | undefined {
  if (!encoded) return;
  try {
    if (encoded.length > 500) throw new Error();
    const parsed: unknown = JSON.parse(
      Buffer.from(encoded, "base64url").toString(),
    );
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("recording" in parsed) ||
      !("action" in parsed) ||
      !actionIdentifier(parsed.recording) ||
      typeof parsed.action !== "string" ||
      parsed.action.length > 150
    )
      throw new Error();
    return { recording: parsed.recording, action: parsed.action };
  } catch {
    throw new RoomError(400, "Invalid action cursor");
  }
}

async function readActionPageStates(
  db: ActionDatabase,
  recordingId: string | undefined,
  cursor: ActionCursor | undefined,
): Promise<ActionState[]> {
  if (recordingId) {
    const state = await db.read(recordingId);
    return state ? [state] : [];
  }
  // An unscoped page resumes inside the cursor's recording before scanning subsequent recordings.
  const first = cursor ? await db.read(cursor.recording) : undefined;
  const rest = await db.list(cursor?.recording, RECORDINGS_PER_ACTION_PAGE);
  return first ? [first, ...rest] : rest;
}

type ActionOperation = "claim" | "renew" | "complete" | "release" | "dismiss";

function claim(
  item: ActionItem,
  rawName: unknown,
  uid: string,
  expiresAt: number,
): void {
  if (item.status !== "proposed" || item.retraction)
    throw new RoomError(
      409,
      "Action is not claimable; review status or spoken changes",
    );
  if (
    typeof rawName !== "string" ||
    !rawName.trim() ||
    rawName.length > 80 ||
    /[\u0000-\u001f]/.test(rawName)
  )
    throw new RoomError(400, "Agent name required");
  if (item.correction) {
    item.title = item.correction.title;
    item.detail = item.correction.detail;
  }
  item.status = "claimed";
  item.lease = {
    ownerId: uid,
    agentName: rawName.trim(),
    expiresAt,
    revision: item.revision + 1,
  };
}

function dismiss(
  item: ActionItem,
  note: unknown,
  principal: ActionPrincipal,
  uid: string,
  at: number,
): void {
  if (principal.tokenId)
    throw new RoomError(403, "Developer sign-in required to dismiss");
  if (item.status !== "proposed")
    throw new RoomError(409, "Only proposed actions can be dismissed");
  if (typeof note !== "string" || note.length > 1000)
    throw new RoomError(400, "Dismissal note required");
  item.status = "dismissed";
  item.resolution = { note, ownerId: uid, at };
}

function ownedLease(
  item: ActionItem,
  operation: ActionOperation,
  uid: string,
  proof: unknown,
  secret: string | undefined,
): NonNullable<ActionItem["lease"]> {
  const lease = item.lease;
  if (
    item.status !== "claimed" ||
    lease?.ownerId !== uid ||
    typeof proof !== "string" ||
    secret !== proof
  )
    throw new RoomError(409, "Claim expired or owned by another agent");
  if (
    (operation === "renew" || operation === "complete") &&
    (item.retraction ||
      (item.correction && item.correction.revision > lease.revision))
  )
    throw new RoomError(
      409,
      "Spoken change requires review; release this action",
    );
  return lease;
}

function finishLease(
  item: ActionItem,
  operation: ActionOperation,
  note: unknown,
  uid: string,
  at: number,
): void {
  if (operation === "complete") {
    if (typeof note !== "string" || !note.trim() || note.length > 1000)
      throw new RoomError(400, "Completion note required");
    item.status = "done";
    item.resolution = { note, at, ownerId: uid };
  } else item.status = item.retraction ? "retracted" : "proposed";
  item.lease = null;
}

export function createActionService(options: ActionServiceOptions) {
  const db = options.database,
    now = options.now ?? Date.now,
    id = options.randomId ?? randomUUID;
  const service = {
    async process(input: TranscriptActionInput): Promise<void> {
      if (
        !actionIdentifier(input.recordingId) ||
        !actionIdentifier(input.gameId)
      )
        throw new Error("Invalid action recording");
      validateSegment(input);
      const neighbors = await options.readNeighbors(
        input.recordingId,
        input.sequence,
      );
      if (neighbors.length > 4)
        throw new Error("Action context exceeds budget");
      for (const neighbor of neighbors) validateSegment(neighbor);
      const canonical = (
        segment: TranscriptActionSegment,
      ): TranscriptActionSegment => ({
        sequence: segment.sequence,
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: segment.text,
        gameId: segment.gameId ?? input.gameId,
        reportIds: segment.reportIds ?? [],
      });
      const segments = [
        ...neighbors
          .filter((segment) => segment.sequence !== input.sequence)
          .map(canonical),
        canonical({
          ...input,
          // Worker deliveries carry transcript data, while saved context owns
          // report links added separately through the reporting endpoint.
          reportIds:
            neighbors.find((segment) => segment.sequence === input.sequence)
              ?.reportIds ?? input.reportIds,
        }),
      ].sort((a, b) => a.sequence - b.sequence);
      const bySequence = new Map(
        segments.map((segment) => [segment.sequence, segment]),
      );
      if (bySequence.size !== segments.length)
        throw new Error("Duplicate action context");
      // A late predecessor also processes its immediate successor, repairing chunk-crossing directives.
      for (const current of segments.filter(
        (segment) =>
          segment.sequence === input.sequence ||
          segment.sequence === input.sequence + 1,
      )) {
        const gameId = current.gameId ?? input.gameId;
        // Segments just before this one that failed transcription for good.
        // They carry no directives, so they must not hold up every later one.
        const skipped: number[] = [];
        const preceding = bySequence.get(current.sequence - 1);
        if (current.sequence > 0 && !preceding) {
          for (
            let earlier = current.sequence - 1;
            earlier >= 0 &&
            (await options.readFailed?.(input.recordingId, earlier)) === true;
            earlier--
          )
            skipped.push(earlier);
          if (!skipped.length)
            throw new Error(
              "Previous transcript is not ready; retry action extraction",
            );
        }
        const previous =
          preceding?.endMs === current.startMs &&
          (preceding.gameId ?? input.gameId) === gameId
            ? preceding
            : undefined;
        const prior = previous
          ? [
              {
                ...previous,
                text: previous.text.slice(-ACTION_LIMITS.contextChars),
              },
            ]
          : [];
        const lease = id(),
          startedAt = now();
        const acquired = await db.transact(input.recordingId, (stored) => {
          const state: ActionState = stored ?? {
            recordingId: input.recordingId,
            gameId: input.gameId,
            items: [],
            processed: {},
            leaseSecrets: {},
            extractionLease: null,
            expiresAt: startedAt + ACTION_LIMITS.retentionMs,
          };
          if (state.expiresAt <= startedAt)
            throw new Error("Action recording expired");
          const earliest = skipped.at(-1);
          if (earliest !== undefined) {
            if (earliest > 0 && !state.processed[String(earliest - 1)])
              throw new Error(
                "Previous action extraction is not complete; retry delivery",
              );
            for (const sequence of skipped)
              state.processed[String(sequence)] ??= SKIPPED;
          }
          const predecessor = state.processed[String(current.sequence - 1)];
          // Saved text is not enough: a later cancellation/correction must see
          // the actions committed by every earlier extraction, even empty ones.
          // Reject rather than wait while another delivery owns that work.
          if (current.sequence > 0 && !predecessor)
            throw new Error(
              "Previous action extraction is not complete; retry delivery",
            );
          const fingerprint = hash(
            JSON.stringify([current, prior, predecessor]),
          );
          if (state.processed[String(current.sequence)] === fingerprint)
            return { result: undefined };
          if (
            state.extractionLease &&
            state.extractionLease.expiresAt > startedAt
          )
            throw new Error("Action extraction busy; retry delivery");
          state.extractionLease = {
            token: lease,
            expiresAt: startedAt + 10 * 60_000,
          };
          return { state, result: { state, fingerprint } };
        });
        if (!acquired) continue;
        const { state, fingerprint } = acquired;
        try {
          const candidates: ActionCandidate[] = [];
          const existing = state.items
            .filter((item) => item.gameId === gameId)
            .map(({ id, title, status }) => ({
              id,
              title,
              status,
              detail: "",
            }));
          for (
            let offset = 0;
            offset < current.text.length;
            offset += ACTION_LIMITS.transcriptChars - 1000
          ) {
            const text = current.text.slice(
              offset,
              offset + ACTION_LIMITS.transcriptChars,
            );
            const extraction: ActionExtractionInput = {
              currentSequence: current.sequence,
              segments: [...prior, { ...current, text }],
              existing: existing.map((item) => ({ ...item })),
            };
            candidates.push(
              ...validateActionCandidates(
                { actions: await options.extractor.extract(extraction) },
                {
                  ...extraction,
                  segments: [...(previous ? [previous] : []), current],
                },
              ),
            );
          }
          await db.transact(input.recordingId, (stored) => {
            if (!stored || stored.extractionLease?.token !== lease)
              throw new Error("Stale action extraction lease");
            const updatedAt = now();
            reconcileCandidates(stored.items, candidates, bySequence, {
              recordingId: input.recordingId,
              gameId,
              sequence: current.sequence,
              updatedAt,
            });
            stored.processed[String(current.sequence)] = fingerprint;
            stored.extractionLease = null;
            return { state: stored, result: undefined };
          });
        } catch (error) {
          await db.transact(input.recordingId, (state) => {
            if (state?.extractionLease?.token === lease) {
              state.extractionLease = null;
              return { state, result: undefined };
            }
            return { result: undefined };
          });
          throw error;
        }
      }
    },
    async list(
      query: ActionsQuery,
      principal: ActionPrincipal,
    ): Promise<ActionsPage> {
      if (
        (query.recordingId && !actionIdentifier(query.recordingId)) ||
        (query.gameId && !actionIdentifier(query.gameId)) ||
        (query.since !== undefined &&
          !integer(query.since, Number.MAX_SAFE_INTEGER)) ||
        (query.status &&
          !["proposed", "claimed", "done", "dismissed", "retracted"].includes(
            query.status,
          )) ||
        (query.limit !== undefined &&
          (!Number.isInteger(query.limit) ||
            query.limit < 1 ||
            query.limit > 100))
      )
        throw new RoomError(400, "Invalid action filters");
      if (principal.recordingId) {
        if (query.recordingId && query.recordingId !== principal.recordingId)
          throw new RoomError(403, "Action token scope denied");
        query = { ...query, recordingId: principal.recordingId };
      }
      if (principal.gameId) {
        if (query.gameId && query.gameId !== principal.gameId)
          throw new RoomError(403, "Action token scope denied");
        query = { ...query, gameId: principal.gameId };
      }
      const cursor = decodeActionCursor(query.cursor);
      if (query.recordingId && cursor && cursor.recording !== query.recordingId)
        throw new RoomError(400, "Action cursor scope mismatch");
      const at = now();
      const states = await readActionPageStates(db, query.recordingId, cursor);
      return selectActionPage(states, query, cursor, at);
    },
    async mutate(
      actionId: string,
      operation: ActionOperation,
      body: Record<string, unknown>,
      principal: ActionPrincipal,
    ): Promise<ActionItem | ActionClaimResponse> {
      const match = actionId.match(/^([A-Za-z0-9_-]{1,100})_([a-f0-9]{16})$/);
      if (!match) throw new RoomError(404, "Action not found");
      const at = now(),
        secret = id();
      return db.transact(match[1]!, (state) => {
        const index =
          state?.items.findIndex((item) => item.id === actionId) ?? -1;
        const original = state?.items[index];
        if (!state || state.expiresAt <= at || !original)
          throw new RoomError(404, "Action not found");
        checkScope(principal, original);
        const item = visible(original, at),
          uid = ownerId(principal);
        const leaseMs = body.leaseMs ?? ACTION_LIMITS.leaseMs;
        if (
          !Number.isSafeInteger(leaseMs) ||
          Number(leaseMs) < 10_000 ||
          Number(leaseMs) > ACTION_LIMITS.maxLeaseMs
        )
          throw new RoomError(400, "Invalid lease duration");
        if (operation === "claim") {
          claim(item, body.agentName, uid, at + Number(leaseMs));
          state.leaseSecrets[actionId] = secret;
        } else if (operation === "dismiss") {
          dismiss(item, body.note, principal, uid, at);
        } else {
          const lease = ownedLease(
            item,
            operation,
            uid,
            body.token,
            state.leaseSecrets[actionId],
          );
          if (operation === "renew") lease.expiresAt = at + Number(leaseMs);
          else {
            finishLease(item, operation, body.note, uid, at);
            delete state.leaseSecrets[actionId];
          }
        }
        item.updatedAt = at;
        item.revision++;
        state.items[index] = item;
        return {
          state,
          result:
            operation === "claim" || operation === "renew"
              ? { action: item, token: state.leaseSecrets[actionId]! }
              : item,
        };
      });
    },
    async mintToken(
      body: { recordingId?: unknown; gameId?: unknown; expiresInMs?: unknown },
      uid: string,
      email?: string,
      expectedGeneration?: number,
    ) {
      if (
        (!body.recordingId && !body.gameId) ||
        (body.recordingId !== undefined &&
          !actionIdentifier(body.recordingId)) ||
        (body.gameId !== undefined && !actionIdentifier(body.gameId))
      )
        throw new RoomError(400, "Choose a recording or game scope");
      const duration = body.expiresInMs ?? 3600_000;
      if (
        !Number.isSafeInteger(duration) ||
        Number(duration) < 60_000 ||
        Number(duration) > 86400_000
      )
        throw new RoomError(400, "Token lifetime must be 1 minute to 24 hours");
      const tokenId = id(),
        secret = randomBytes(32).toString("base64url");
      const ownerPolicy = await options.ownerPolicy?.(uid, email);
      if (
        ownerPolicy &&
        (!ownerPolicy.tokenAllowed ||
          (expectedGeneration !== undefined &&
            ownerPolicy.generation !== expectedGeneration))
      )
        throw new RoomError(403, "Developer capability required");
      const token = `fa1.${tokenId}.${secret}`;
      const record: ActionAgentToken = {
        id: tokenId,
        hash: hash(token),
        ownerId: uid,
        recordingId:
          typeof body.recordingId === "string" ? body.recordingId : null,
        gameId: typeof body.gameId === "string" ? body.gameId : null,
        expiresAt: now() + Number(duration),
        revoked: false,
        ...(ownerPolicy ? { ownerGeneration: ownerPolicy.generation } : {}),
        ...(email ? { ownerEmail: email } : {}),
      };
      await db.putToken(record);
      return {
        id: tokenId,
        token,
        expiresAt: record.expiresAt,
        ...(record.recordingId ? { recordingId: record.recordingId } : {}),
        ...(record.gameId ? { gameId: record.gameId } : {}),
      };
    },
    async verifyAgentToken(
      token: string,
    ): Promise<ActionPrincipal | undefined> {
      const match = token.match(
        /^fa1\.([A-Za-z0-9_-]{1,100})\.([A-Za-z0-9_-]{43})$/,
      );
      if (!match) return;
      const stored = await db.readToken(match[1]!);
      if (
        !stored ||
        stored.revoked ||
        stored.expiresAt <= now() ||
        !timingSafeEqual(
          Buffer.from(stored.hash, "hex"),
          Buffer.from(hash(token), "hex"),
        )
      )
        return;
      const ownerPolicy = await options.ownerPolicy?.(
        stored.ownerId,
        stored.ownerEmail,
      );
      if (
        ownerPolicy &&
        (!stored.ownerEmail ||
          !ownerPolicy.tokenAllowed ||
          ownerPolicy.generation !== (stored.ownerGeneration ?? 0))
      )
        return;
      return {
        uid: stored.ownerId,
        tokenId: stored.id,
        ...(stored.ownerEmail ? { email: stored.ownerEmail } : {}),
        ...(stored.recordingId ? { recordingId: stored.recordingId } : {}),
        ...(stored.gameId ? { gameId: stored.gameId } : {}),
      };
    },
    async revokeToken(tokenId: string, uid: string) {
      if (!actionIdentifier(tokenId))
        throw new RoomError(400, "Invalid token id");
      if (!(await db.revokeToken(tokenId, uid)))
        throw new RoomError(404, "Agent token not found");
    },
  } satisfies TranscriptActionHook & Record<string, unknown>;
  return service;
}
export type ActionService = ReturnType<typeof createActionService>;
