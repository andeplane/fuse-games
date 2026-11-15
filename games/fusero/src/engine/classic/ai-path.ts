/* Altered port of OpenLieroX CWormBot.cpp:272–878, pinned
 * 0a20c6d0a10ed63b28a15f05c771913c294efbf6. LGPL.
 * Jason Boettcher, Dark Charlie, Albert Zeyer and contributors.
 * Thread work is scheduled in simulation time; see docs/design/fusero-native-ai.md.
 */
import { f, add, sub, mul } from "./physics-types.js";
import {
  intPoint,
  len,
  len2,
  maxFreeArea,
  minus,
  plus,
  point,
  pointOrder,
  rectCenter,
  simpleTrace,
  traceWorm,
  type AiPoint,
  type AiRect,
  type AiTerrain,
} from "./ai-geometry.js";

export const MAX_AI_AREAS = 8192;
export const MAX_AI_PATH_NODES = 8192;
export interface AiArea {
  rect: AiRect;
  parent: number | null;
  distance: number;
}
export interface AiSearch {
  start: AiPoint;
  target: AiPoint;
  areas: AiArea[];
  frontier: number[];
  status: "idle" | "searching" | "found" | "failed";
  result: AiPoint[];
  initialized: boolean;
  nextExpansionMs: number;
}
export function createAiSearch(): AiSearch {
  return {
    start: point(0, 0),
    target: point(0, 0),
    areas: [],
    frontier: [],
    status: "idle",
    result: [],
    initialized: false,
    nextExpansionMs: 0,
  };
}
const inside = (r: AiRect, p: AiPoint): boolean =>
  r.x1 <= p.x && p.x <= r.x2 && r.y1 <= p.y && p.y <= r.y2;
function connector(a: AiArea, b: AiArea | undefined): AiPoint {
  return b
    ? rectCenter({
        x1: Math.max(a.rect.x1, b.rect.x1),
        y1: Math.max(a.rect.y1, b.rect.y1),
        x2: Math.min(a.rect.x2, b.rect.x2),
        y2: Math.min(a.rect.y2, b.rect.y2),
      })
    : rectCenter(a.rect);
}
function distanceBetween(a: AiArea, b: AiArea): number {
  const p = connector(a, b);
  return add(
    len(minus(rectCenter(b.rect), p)),
    len(minus(rectCenter(a.rect), p)),
  );
}
function score(search: AiSearch, index: number): number {
  const area = search.areas[index]!;
  return area.distance + len(minus(rectCenter(area.rect), search.target));
}
function insertFrontier(search: AiSearch, index: number): void {
  const value = score(search, index);
  let position = search.frontier.length;
  for (let i = 0; i < search.frontier.length; i++) {
    const other = score(search, search.frontier[i]!);
    // std::set treats these scores as equivalent and retains its existing entry.
    if (Math.abs(other - value) < 0.0001) return;
    if (value < other) {
      position = i;
      break;
    }
  }
  search.frontier.splice(position, 0, index);
}
function addArea(
  search: AiSearch,
  terrain: AiTerrain,
  start: AiPoint,
  parent: number | null,
): void {
  if (
    start.x < 0 ||
    start.y < 0 ||
    start.x >= terrain.width ||
    start.y >= terrain.height
  )
    return;
  // Native getArea returns the first containing rectangle in the y/x multiset.
  // Find that same minimum without allocating/sorting the entire set per checkpoint.
  let existing = -1;
  for (let index = 0; index < search.areas.length; index++) {
    const rect = search.areas[index]!.rect;
    if (!inside(rect, start)) continue;
    const previous = existing < 0 ? undefined : search.areas[existing]!.rect;
    if (
      !previous ||
      pointOrder(point(rect.x1, rect.y1), point(previous.x1, previous.y1)) < 0
    )
      existing = index;
  }
  if (existing >= 0) {
    const index = existing,
      area = search.areas[index]!;
    const previous = parent === null ? undefined : search.areas[parent]!;
    const distance = previous
      ? previous.distance + distanceBetween(area, previous)
      : 0;
    if (area.distance > distance) {
      // erase(a) in the native std::set removes a comparator-equivalent entry,
      // even when a itself was excluded by a previous equal score.
      const oldScore = score(search, index);
      const offset = search.frontier.findIndex(
        (candidate) => Math.abs(score(search, candidate) - oldScore) < 0.0001,
      );
      if (offset >= 0) search.frontier.splice(offset, 1);
      area.parent = parent;
      area.distance = distance;
      insertFrontier(search, index);
    }
    return;
  }
  const rect = maxFreeArea(terrain, start);
  if (rect.x2 - rect.x1 < 7 || rect.y2 - rect.y1 < 7) return;
  if (search.areas.length >= MAX_AI_AREAS) {
    search.status = "failed";
    return;
  }
  const area: AiArea = { rect, parent, distance: 0 };
  if (parent !== null) {
    const previous = search.areas[parent]!;
    area.distance = previous.distance + distanceBetween(area, previous);
  }
  search.areas.push(area);
  insertFrontier(search, search.areas.length - 1);
}

/** Native boundary multiset: nearest target first; equivalent points keep insertion order. */
function checkpoints(rect: AiRect, target: AiPoint): AiPoint[] {
  const columns = Math.trunc((rect.x2 - rect.x1 - 3) / 5) + 1;
  const rows = Math.trunc((rect.y2 - rect.y1 - 3) / 5) + 1;
  const startX = Math.trunc((rect.x2 - rect.x1 - (columns - 1) * 5) / 2);
  const startY = Math.trunc((rect.y2 - rect.y1 - (rows - 1) * 5) / 2);
  const points: AiPoint[] = [];
  for (let i = 0; i < rows; i++)
    points.push(point(rect.x1, rect.y1 + startY + i * 5));
  for (let i = 0; i < rows; i++)
    points.push(point(rect.x2, rect.y1 + startY + i * 5));
  for (let i = 0; i < columns; i++)
    points.push(point(rect.x1 + startX + i * 5, rect.y1));
  for (let i = 0; i < columns; i++)
    points.push(point(rect.x1 + startX + i * 5, rect.y2));
  // Integer vector GetLength2 uses integer arithmetic, unlike the float geometry helpers.
  const distance = (p: AiPoint) =>
    (p.x - target.x) ** 2 + (p.y - target.y) ** 2;
  return points.sort((a, b) => distance(a) - distance(b));
}
function successors(search: AiSearch, terrain: AiTerrain, index: number): void {
  const rect = search.areas[index]!.rect;
  for (const start of checkpoints(rect, search.target)) {
    const dist =
      start.x === rect.x1
        ? point(-5, 0)
        : start.x === rect.x2
          ? point(5, 0)
          : start.y === rect.y1
            ? point(0, -5)
            : point(0, 5);
    const dir =
      Math.abs(dist.x) >= Math.abs(dist.y) ? point(0, 1) : point(1, 0);
    let p = plus(start, dir),
      left = 0,
      right = 0;
    let trace = simpleTrace(terrain, p, dist);
    for (; trace && left < 7; p = plus(p, dir)) {
      trace = simpleTrace(terrain, p, dist);
      if (trace) left++;
    }
    p = minus(start, dir);
    trace = true;
    for (; trace && right < 7 - left; p = minus(p, dir)) {
      trace = simpleTrace(terrain, p, dist);
      if (trace) right++;
    }
    if (left + right >= 7) addArea(search, terrain, plus(p, dist), index);
    if (search.status === "failed") return;
  }
}

interface Node {
  p: AiPoint;
  next: Node | null;
}
function finishPath(
  search: AiSearch,
  terrain: AiTerrain,
  index: number,
): AiPoint[] {
  let start: Node = { p: { ...search.target }, next: null };
  const visited = new Set<number>();
  for (let cursor: number | null = index; cursor !== null;) {
    if (visited.has(cursor)) return [];
    visited.add(cursor);
    const area: AiArea = search.areas[cursor]!;
    start = { p: rectCenter(area.rect), next: start };
    start = {
      p: connector(
        area,
        area.parent === null ? undefined : search.areas[area.parent],
      ),
      next: start,
    };
    cursor = area.parent;
  }
  // Preserve the source's squared-segment-length simplification (not total Euclidean length).
  for (let node: Node | null = start; node; node = node.next) {
    let length = 0,
      last = node,
      count = 0;
    for (
      let closest: Node | null = node;
      closest;
      closest = closest.next, count++
    ) {
      length = add(length, len2(minus(closest.p, last.p)));
      const distance = len2(minus(closest.p, node.p));
      if (
        count >= 3 &&
        distance < length &&
        traceWorm(terrain, closest.p, node.p).clear
      ) {
        node.next = closest;
        length = distance;
      }
      last = closest;
    }
  }
  // The second native simplify loop is inert: closest_node is NULL after the loop above.
  const result: AiPoint[] = [];
  for (let node: Node | null = start; node; node = node.next) {
    if (node.next) {
      const a: AiPoint = node.p,
        b: AiPoint = node.next.p;
      const sx: number = a.x > b.x ? 1 : -1,
        sy: number = a.y > b.y ? 1 : -1;
      const dx = sub(a.x, b.x),
        dy = sub(a.y, b.y);
      if (sx * dx > 50 || sy * dy > 50) {
        const p: AiPoint =
          sx * dx >= sy * dy
            ? point(sub(a.x, sx * 50), sub(a.y, f(mul(sx * 50, dy) / dx)))
            : point(sub(a.x, f(mul(sy * 50, dx) / dy)), sub(a.y, sy * 50));
        node.next = { p, next: node.next };
      }
    }
    result.push(node.p);
    if (result.length > MAX_AI_PATH_NODES) return [];
  }
  return result;
}

export function requestAiSearch(
  search: AiSearch,
  start: AiPoint,
  target: AiPoint,
  nowMs: number,
): void {
  const wasSearching = search.status === "searching";
  search.start = intPoint(start);
  search.target = intPoint(target);
  search.areas = [];
  search.frontier = [];
  search.result = [];
  search.status = "searching";
  search.initialized = false;
  search.nextExpansionMs = nowMs + (wasSearching ? 1 : 100);
}

/** Complete the source A* expansions due on the explicit deterministic worker clock. */
export function advanceAiSearch(
  search: AiSearch,
  terrain: AiTerrain,
  nowMs: number,
): void {
  while (search.status === "searching" && search.nextExpansionMs <= nowMs) {
    search.nextExpansionMs++;
    if (!search.initialized) {
      search.initialized = true;
      addArea(search, terrain, search.start, null);
      continue;
    }
    const index = search.frontier.shift();
    if (index === undefined) {
      search.status = "failed";
      return;
    }
    const center = rectCenter(search.areas[index]!.rect);
    if (traceWorm(terrain, search.target, center).clear) {
      search.result = finishPath(search, terrain, index);
      search.status = search.result.length ? "found" : "failed";
      return;
    }
    successors(search, terrain, index);
    if (!search.frontier.length) search.status = "failed";
  }
}
