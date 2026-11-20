import { createHash } from "node:crypto";
import {
  ACTION_LIMITS,
  type ActionEvidence,
  type ActionItem,
  type TranscriptActionSegment,
} from "./action-contracts.js";
import type { ActionCandidate } from "./action-extractor.js";

const textKey = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const evidenceKey = ({ sequence, quote }: ActionEvidence) =>
  `${sequence}:${quote}`;

function evidence(
  candidate: ActionCandidate,
  segments: ReadonlyMap<number, TranscriptActionSegment>,
): ActionEvidence[] {
  return candidate.evidence.map((proof) => {
    const segment = segments.get(proof.sequence)!;
    return {
      ...proof,
      startMs: segment.startMs,
      endMs: segment.endMs,
      reportIds: [...(segment.reportIds ?? [])],
    };
  });
}

function searchKeys(item: ActionItem) {
  return {
    title: textKey(item.title),
    quotes: new Set(item.evidence.map((proof) => textKey(proof.quote))),
  };
}

function firstMatchingAction(
  items: readonly ActionItem[],
  keysByItem: Map<ActionItem, ReturnType<typeof searchKeys>>,
  match: { gameId: string; title: string; quote: string },
): ActionItem | undefined {
  for (const item of items) {
    if (item.gameId !== match.gameId) continue;
    let keys = keysByItem.get(item);
    if (!keys) {
      keys = searchKeys(item);
      keysByItem.set(item, keys);
    }
    if (keys.title === match.title || keys.quotes.has(match.quote)) return item;
  }
}

function latestSpokenSequence(item: ActionItem): number {
  return Math.max(
    -1,
    ...item.evidence.map((proof) => proof.sequence),
    item.retraction?.sequence ?? -1,
    ...(item.correction?.evidence.map((proof) => proof.sequence) ?? []),
  );
}

function applySpokenUpdate(
  item: ActionItem,
  candidate: ActionCandidate,
  proofs: ActionEvidence[],
  sequence: number,
): void {
  const knownEvidence = new Set(item.evidence.map(evidenceKey));
  const newEvidence = proofs.filter(
    (proof) => !knownEvidence.has(evidenceKey(proof)),
  );
  switch (candidate.kind) {
    case "propose":
      // Asked for again after being called off: it is wanted.
      if (
        item.status === "retracted" &&
        item.retraction &&
        sequence >= item.retraction.sequence &&
        newEvidence.length > 0
      ) {
        item.retraction = null;
        item.status = "proposed";
      }
      break;
    case "retract":
      item.retraction = proofs.at(-1)!;
      if (item.status === "proposed" || item.status === "dismissed")
        item.status = "retracted";
      // Existing claimed/done execution remains explicit; renew/complete require manual reconciliation.
      break;
    case "correct":
      item.correction = {
        title: candidate.title,
        detail: candidate.detail,
        evidence: proofs,
        revision: item.revision + 1,
      };
      if (item.status === "proposed") {
        item.title = candidate.title;
        item.detail = candidate.detail;
      }
      break;
  }
  item.evidence.push(...newEvidence);
  item.evidence = item.evidence.slice(-ACTION_LIMITS.evidence);
}

/** Apply grounded candidates in provider order to the current transaction's action list. */
export function reconcileCandidates(
  items: ActionItem[],
  candidates: readonly ActionCandidate[],
  bySequence: ReadonlyMap<number, TranscriptActionSegment>,
  context: {
    recordingId: string;
    gameId: string;
    sequence: number;
    updatedAt: number;
  },
): void {
  if (candidates.length === 0) return;
  const { recordingId, gameId, sequence, updatedAt } = context;
  // Keep the queue's first-match order and normalize only the items a search reaches.
  const keysByItem = new Map<ActionItem, ReturnType<typeof searchKeys>>();
  for (const candidate of candidates) {
    const proofs = evidence(candidate, bySequence);
    const quote = textKey(proofs.map((proof) => proof.quote).join(" "));
    const digest = createHash("sha256")
      .update(`${gameId}:${quote}`)
      .digest("hex");
    const actionId = `${recordingId}_${digest.slice(0, 16)}`;
    let item = candidate.targetId
      ? items.find(
          (item) => item.id === candidate.targetId && item.gameId === gameId,
        )
      : // A directive quoted in two pieces can still match its generated id.
        (firstMatchingAction(items, keysByItem, {
          gameId,
          title: textKey(candidate.title),
          quote,
        }) ?? items.find((item) => item.id === actionId));
    if (!item) {
      // Drop further proposals in a full queue without stalling later segments.
      if (
        candidate.kind !== "propose" ||
        items.length >= ACTION_LIMITS.perRecording
      )
        continue;
      item = {
        id: actionId,
        recordingId,
        gameId,
        title: candidate.title,
        detail: candidate.detail,
        evidence: [],
        status: "proposed",
        createdAt: updatedAt,
        updatedAt,
        revision: 0,
        lease: null,
        resolution: null,
        retraction: null,
        correction: null,
      };
      items.push(item);
    }
    if (candidate.kind !== "propose" && sequence < latestSpokenSequence(item))
      continue;
    applySpokenUpdate(item, candidate, proofs, sequence);
    item.updatedAt = updatedAt;
    item.revision++;
    keysByItem.delete(item);
  }
}
