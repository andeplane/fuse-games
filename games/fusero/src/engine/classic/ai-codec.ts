/** Strict, bounded native-AI checkpoints. Path graphs use compact numeric tuples. */
import {
  MAX_AI_AREAS,
  MAX_AI_PATH_NODES,
  type AiSearch,
  type AiArea,
} from "./ai-path.js";
import {
  NATIVE_AI_EPOCH_MS,
  type NativeAiShared,
  type NativeAiState,
} from "./ai-state.js";
import { len, minus, rectCenter, type AiPoint } from "./ai-geometry.js";

const TIME_KEYS = [
  "stuckMs",
  "stuckPauseAtMs",
  "lastThinkMs",
  "lastFaceMs",
  "badAimMs",
  "lastShootMs",
  "lastJumpMs",
  "lastWeaponChangeMs",
  "lastPathCreatedMs",
  "lastRandomChangeMs",
  "lastGoBackMs",
  "lastCarveMs",
  "ropeAttachedMs",
  "ropeFlightMs",
  "searchStartedAtMs",
  "spawnedAtMs",
] as const;
const POINT_KEYS = [
  "bonusPosition",
  "targetPosition",
  "stuckPosition",
  "lastShootTarget",
] as const;
const AI_KEYS = [
  "difficulty",
  "gameType",
  "mode",
  "targetType",
  "targetWormId",
  "bonusId",
  "stuck",
  "randomSpread",
  "pathFinished",
  "search",
  "path",
  "currentNode",
  ...TIME_KEYS,
  ...POINT_KEYS,
] as const;
const integer = (raw: unknown, low: number, high: number): raw is number =>
  typeof raw === "number" &&
  Number.isSafeInteger(raw) &&
  raw >= low &&
  raw <= high;
const native = (raw: unknown): raw is number =>
  typeof raw === "number" && Number.isFinite(raw) && Math.fround(raw) === raw;
const record = (raw: unknown): raw is Record<string, unknown> =>
  raw !== null &&
  typeof raw === "object" &&
  !Array.isArray(raw) &&
  (Object.getPrototypeOf(raw) === Object.prototype ||
    Object.getPrototypeOf(raw) === null);
const keys = (
  raw: Record<string, unknown>,
  expected: readonly string[],
): boolean =>
  Object.keys(raw).length === expected.length &&
  expected.every((key) => Object.hasOwn(raw, key));
const member = (raw: unknown): raw is string =>
  typeof raw === "string" &&
  /^[\w:.-]{1,64}$/.test(raw) &&
  !(raw in Object.prototype);
function point(raw: unknown): AiPoint | undefined {
  if (
    !Array.isArray(raw) ||
    raw.length !== 2 ||
    !native(raw[0]) ||
    !native(raw[1]) ||
    Math.abs(raw[0]) > 16384 ||
    Math.abs(raw[1]) > 16384
  )
    return;
  return { x: raw[0], y: raw[1] };
}
function points(raw: unknown): AiPoint[] | undefined {
  if (!Array.isArray(raw) || raw.length > MAX_AI_PATH_NODES) return;
  const result: AiPoint[] = [];
  for (const value of raw) {
    const p = point(value);
    if (!p) return;
    result.push(p);
  }
  return result;
}
const tuple = (p: AiPoint): [number, number] => [p.x, p.y];
function encodeSearch(search: AiSearch): unknown {
  return {
    start: tuple(search.start),
    target: tuple(search.target),
    areas: search.areas.map((area) => [
      area.rect.x1,
      area.rect.y1,
      area.rect.x2,
      area.rect.y2,
      area.parent,
      area.distance,
    ]),
    frontier: [...search.frontier],
    status: search.status,
    result: search.result.map(tuple),
    initialized: search.initialized,
    pendingRestart: search.pendingRestart,
    nextExpansionMs: search.nextExpansionMs,
  };
}
function decodeSearch(
  raw: unknown,
  now: number,
  width: number,
  height: number,
): AiSearch | undefined {
  if (
    !record(raw) ||
    !keys(raw, [
      "start",
      "target",
      "areas",
      "frontier",
      "status",
      "result",
      "initialized",
      "pendingRestart",
      "nextExpansionMs",
    ])
  )
    return;
  const start = point(raw.start),
    target = point(raw.target),
    result = points(raw.result);
  const {
    areas: values,
    frontier: pending,
    status,
    initialized,
    pendingRestart,
    nextExpansionMs,
  } = raw;
  if (
    !start ||
    !target ||
    !result ||
    ![start.x, start.y, target.x, target.y].every(Number.isInteger) ||
    !Array.isArray(values) ||
    values.length > MAX_AI_AREAS ||
    !Array.isArray(pending) ||
    pending.length > values.length ||
    typeof initialized !== "boolean" ||
    typeof pendingRestart !== "boolean" ||
    (pendingRestart && (initialized || status !== "searching")) ||
    // Snapshots are captured after the outer clock advances 10ms. Active work
    // was drained through the preceding frame, so at most 9ms can be overdue.
    !integer(
      nextExpansionMs,
      status === "searching" ? Math.max(0, now - 9) : 0,
      now + 100,
    ) ||
    (status !== "idle" &&
      status !== "searching" &&
      status !== "found" &&
      status !== "failed") ||
    (status === "found" ? !result.length : result.length !== 0) ||
    (!initialized && (values.length !== 0 || pending.length !== 0)) ||
    (status === "idle" &&
      (initialized ||
        values.length ||
        pending.length ||
        result.length ||
        nextExpansionMs !== 0))
  )
    return;
  const areas: AiArea[] = [];
  for (const value of values) {
    if (!Array.isArray(value) || value.length !== 6) return;
    const [x1, y1, x2, y2, parent, distance] = value;
    if (
      !integer(x1, 0, width - 1) ||
      !integer(y1, 0, height - 1) ||
      !integer(x2, x1 + 7, width - 1) ||
      !integer(y2, y1 + 7, height - 1) ||
      !(parent === null || integer(parent, 0, values.length - 1)) ||
      parent === areas.length ||
      typeof distance !== "number" ||
      !Number.isFinite(distance) ||
      distance < 0 ||
      distance > 1e12
    )
      return;
    areas.push({ rect: { x1, y1, x2, y2 }, parent, distance });
  }
  // Parent links may point to newer areas after relaxation; check acyclicity without recursive stack growth.
  const finished = new Uint8Array(areas.length);
  for (let i = 0; i < areas.length; i++) {
    if (finished[i]) continue;
    const chain: number[] = [],
      seen = new Set<number>();
    for (
      let cursor: number | null = i;
      cursor !== null && !finished[cursor];
      cursor = areas[cursor]!.parent
    ) {
      if (seen.has(cursor)) return;
      seen.add(cursor);
      chain.push(cursor);
    }
    for (const index of chain) finished[index] = 1;
  }
  const frontier: number[] = [],
    ids = new Set<number>();
  for (const value of pending) {
    if (!integer(value, 0, areas.length - 1) || ids.has(value)) return;
    ids.add(value);
    frontier.push(value);
  }
  let previousScore: number | undefined;
  for (const index of frontier) {
    const area = areas[index]!;
    const score = area.distance + len(minus(rectCenter(area.rect), target));
    if (
      previousScore !== undefined &&
      (score < previousScore || Math.abs(score - previousScore) < 0.0001)
    )
      return;
    previousScore = score;
  }
  return {
    start,
    target,
    areas,
    frontier,
    status,
    result,
    initialized,
    pendingRestart,
    nextExpansionMs,
  };
}

export function encodeNativeAi(ai: NativeAiState | null): unknown {
  if (!ai) return null;
  return {
    ...ai,
    bonusPosition: tuple(ai.bonusPosition),
    targetPosition: tuple(ai.targetPosition),
    stuckPosition: tuple(ai.stuckPosition),
    lastShootTarget: tuple(ai.lastShootTarget),
    path: ai.path.map(tuple),
    search: encodeSearch(ai.search),
  };
}
export function decodeNativeAi(
  raw: unknown,
  elapsedMs: number,
  width: number,
  height: number,
): NativeAiState | null | undefined {
  if (raw === null) return null;
  if (!record(raw) || !keys(raw, AI_KEYS)) return;
  const now = elapsedMs + NATIVE_AI_EPOCH_MS;
  const {
    difficulty,
    gameType,
    mode,
    targetType,
    targetWormId,
    bonusId,
    stuck,
    randomSpread,
    pathFinished,
    currentNode,
  } = raw;
  if (
    !integer(difficulty, 0, 3) ||
    (gameType !== "rifles" && gameType !== "100lt" && gameType !== "other") ||
    (mode !== "think" && mode !== "moving") ||
    (targetType !== "none" &&
      targetType !== "worm" &&
      targetType !== "bonus" &&
      targetType !== "position") ||
    !(targetWormId === null || member(targetWormId)) ||
    !(bonusId === null || integer(bonusId, 0, 31)) ||
    typeof stuck !== "boolean" ||
    !integer(randomSpread, -13, 13) ||
    Object.is(randomSpread, -0) ||
    typeof pathFinished !== "boolean"
  )
    return;
  const clockValues = TIME_KEYS.map((key) => raw[key]);
  if (!clockValues.every((value) => integer(value, 0, now))) return;
  const bonusPosition = point(raw.bonusPosition),
    targetPosition = point(raw.targetPosition),
    stuckPosition = point(raw.stuckPosition),
    lastShootTarget = point(raw.lastShootTarget);
  const path = points(raw.path),
    search = decodeSearch(raw.search, now, width, height);
  if (
    !bonusPosition ||
    !targetPosition ||
    !stuckPosition ||
    !lastShootTarget ||
    !path ||
    !search
  )
    return;
  if (pathFinished && search.status === "searching") return;
  if (currentNode !== null && !integer(currentNode, 0, path.length - 1)) return;
  if (currentNode === null && path.length !== 0) return;
  const readTime = (key: (typeof TIME_KEYS)[number]): number =>
    clockValues[TIME_KEYS.indexOf(key)]!;
  return {
    difficulty: difficulty as NativeAiState["difficulty"],
    gameType,
    mode,
    targetType,
    targetWormId,
    bonusId,
    stuck,
    randomSpread,
    pathFinished,
    currentNode,
    bonusPosition,
    targetPosition,
    stuckPosition,
    lastShootTarget,
    path,
    search,
    stuckMs: readTime("stuckMs"),
    stuckPauseAtMs: readTime("stuckPauseAtMs"),
    lastThinkMs: readTime("lastThinkMs"),
    lastFaceMs: readTime("lastFaceMs"),
    badAimMs: readTime("badAimMs"),
    lastShootMs: readTime("lastShootMs"),
    lastJumpMs: readTime("lastJumpMs"),
    lastWeaponChangeMs: readTime("lastWeaponChangeMs"),
    lastPathCreatedMs: readTime("lastPathCreatedMs"),
    lastRandomChangeMs: readTime("lastRandomChangeMs"),
    lastGoBackMs: readTime("lastGoBackMs"),
    lastCarveMs: readTime("lastCarveMs"),
    ropeAttachedMs: readTime("ropeAttachedMs"),
    ropeFlightMs: readTime("ropeFlightMs"),
    searchStartedAtMs: readTime("searchStartedAtMs"),
    spawnedAtMs: readTime("spawnedAtMs"),
  };
}
export function encodeNativeAiShared(shared: NativeAiShared): NativeAiShared {
  return {
    ...shared,
    angleNoise: [...shared.angleNoise],
    trajectoryNoise: [...shared.trajectoryNoise],
  };
}
export function decodeNativeAiShared(
  raw: unknown,
  elapsedMs: number,
): NativeAiShared | undefined {
  if (
    !record(raw) ||
    !keys(raw, [
      "angleNoise",
      "angleNoiseAtMs",
      "trajectoryNoise",
      "trajectoryNoiseAtMs",
    ])
  )
    return;
  const { angleNoise, angleNoiseAtMs, trajectoryNoise, trajectoryNoiseAtMs } =
    raw;
  const now = elapsedMs + NATIVE_AI_EPOCH_MS;
  if (
    !Array.isArray(angleNoise) ||
    angleNoise.length !== 3 ||
    !angleNoise.every((v) => native(v) && Math.abs(v) <= 50) ||
    !Array.isArray(trajectoryNoise) ||
    trajectoryNoise.length !== 4 ||
    !trajectoryNoise.every((v) => native(v) && Math.abs(v) <= 1) ||
    !integer(angleNoiseAtMs, 0, now) ||
    !integer(trajectoryNoiseAtMs, 0, now)
  )
    return;
  return {
    angleNoise: [angleNoise[0], angleNoise[1], angleNoise[2]],
    angleNoiseAtMs,
    trajectoryNoise: [
      trajectoryNoise[0],
      trajectoryNoise[1],
      trajectoryNoise[2],
      trajectoryNoise[3],
    ],
    trajectoryNoiseAtMs,
  };
}
