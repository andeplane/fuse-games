/** Static lane obstacles of the race-road builder. Based on the MIT-licensed
 * Street Rod 2 SDL3 port, copyright 2026 Krzysztof Kania (../motor/LICENSE.txt).
 * tests/reference/road-seed.py verifies the behavior against the DOS build. */
import { courseFeatures } from "../course/index.js";
import { trafficDodge } from "../motor/opponent.js";
import { courseLayout, integer, metres, object, type Route } from "./basics.js";
export interface RoadObstacle {
  segment: number;
  kind: "rock" | "debris" | "warning" | "bush";
  lane: number;
}
export interface TrafficState {
  seedAfter: number;
  obstacles: RoadObstacle[];
}
export function buildTraffic(route: Route, seed: number): TrafficState {
  let state = seed >>> 0;
  const obstacles: RoadObstacle[] = [];
  if (route !== "canyon") return { seedAfter: state, obstacles };
  const rnd = (n: number) => {
    state = (Math.imul(state, 0x015a4e35) + 1) >>> 0;
    return ((state >>> 16) & 0x7fff) % n;
  };
  // Reconstruct bank direction. The builder consumes another random number only
  // while a bank has remained clear for long enough, affecting every later lane.
  const bank: number[] = [];
  let leftBank = 0;
  for (let group = 200; group < 990; group += 10) {
    const rising =
      group >= 380 &&
      (group <= 398 ||
        (group > 599 && group < 619) ||
        (group > 699 && group < 719));
    const falling =
      (group >= 400 && group <= 418) || (group >= 500 && group <= 518);
    for (let j = 0; j < 10; j++) {
      leftBank += rising ? 200 : falling ? -200 : 0;
      bank[group + j] = leftBank;
    }
  }
  let rockAge = 0,
    bankAge = 0;
  const addBank = (s: number, lane: number) => {
    bankAge = 0;
    if (s > 370 && s <= 960)
      obstacles.push({ segment: s - 371, kind: "warning", lane });
    if (s >= 370 && s < 960)
      obstacles.push({ segment: s - 370, kind: "bush", lane });
  };
  for (let s = 180; s < 990; s++, rockAge++, bankAge++) {
    rnd(7); // palm placement
    let rock = false;
    if (s > 400 && rnd(64) === 0 && rockAge++ > 70) {
      rock = true;
      const lane = rnd(16) + 1;
      if (s < 960) obstacles.push({ segment: s - 370, kind: "rock", lane });
      rockAge = 0;
    }
    if (s > 400 && rnd(80) === 0 && !rock) {
      const lane = rnd(16) + 1;
      if (s < 960) obstacles.push({ segment: s - 370, kind: "debris", lane });
    }
    const leftTrees = rnd(35) === 0,
      rightTrees = rnd(25) === 0;
    if (rnd(4) === 0 && !leftTrees) rnd(2);
    if (rnd(6) === 0 && !rightTrees) rnd(2);
    // Four independent scenery tests share the same seed as the road.
    rnd(21);
    rnd(25);
    rnd(23);
    rnd(30);
    if (rnd(2) === 0) rnd(2);
    if (rnd(2) === 0) rnd(2);
    if (s > 240 && bankAge > 70) {
      if (rnd(80) === 0 && (bank[s + 1] ?? 0) > 0) addBank(s, 0);
      if (rnd(80) === 0 && (bank[s + 1] ?? 0) < 0) addBank(s, 16);
    }
  }
  rnd(140); // overhead sign, last call before the game returns to its general RNG.
  obstacles.sort(
    (a, b) =>
      a.segment - b.segment || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0),
  );
  return { seedAfter: state, obstacles };
}
/** The DOS course pass clears lane and verge flags on its bridge deck. */
export function raceTraffic(route: Route, seed: number): TrafficState {
  const traffic = buildTraffic(route, seed);
  const bridges = courseFeatures(route, courseLayout(route, seed)).filter(
    (f) => f.kind === "bridge",
  );
  traffic.obstacles = traffic.obstacles.filter(
    (o) =>
      !bridges.some(
        (f) =>
          metres(o.segment * 64) >= f.start && metres(o.segment * 64) < f.end,
      ),
  );
  return traffic;
}
export function decodeTraffic(
  v: unknown,
  route: Route,
  seed: number,
): TrafficState | undefined {
  if (
    !object(v) ||
    Object.keys(v).length !== 2 ||
    !integer(v.seedAfter, 0, 0xffffffff) ||
    !Array.isArray(v.obstacles) ||
    v.obstacles.length > 590
  )
    return;
  const expected = raceTraffic(route, seed);
  if (
    v.seedAfter !== expected.seedAfter ||
    v.obstacles.length !== expected.obstacles.length
  )
    return;
  for (const [i, row] of expected.obstacles.entries()) {
    const raw: unknown = v.obstacles[i];
    if (
      !object(raw) ||
      Object.keys(raw).length !== 3 ||
      raw.kind !== row.kind ||
      raw.segment !== row.segment ||
      raw.lane !== row.lane
    )
      return;
  }
  return expected;
}
/** The original lane coordinate is 1500+112*lane. Centre hazards have a 112-unit span. */
const laneX = (o: RoadObstacle) => 1500 + 112 * o.lane;
const bankMarker = (o: RoadObstacle) =>
  o.kind === "warning" || o.kind === "bush";
export const obstacleLateral = (o: RoadObstacle) =>
  bankMarker(o)
    ? (o.lane === 0 ? -880 : 920) / 850
    : (laneX(o) + 56 - 2380) / 850;
export function trafficView(t: TrafficState) {
  return t.obstacles.map((o) => ({
    kind: o.kind,
    distance: metres(o.segment * 64),
    lateral: obstacleLateral(o),
  }));
}
interface Span {
  left: number;
  right: number;
}
export interface RoadDriver {
  x: number;
  position: number;
}
/** 0001:cf9a, center-lane spans scanned from six segments ahead back to the current segment.
 * Keep separate road users in distinct spans, just as the DOS scan does.
 */
export function dodgeTraffic(
  t: TrafficState,
  driver: RoadDriver,
  player: RoadDriver | undefined,
  target: number,
  speed: number,
): number {
  const segment = Math.floor(driver.position / 64);
  const x = 2380 + Math.round((driver.x * 850) / 1000);
  let blocked: Span | null = null;
  for (let k = 6; k >= 0; k--) {
    const j = segment + k;
    const rows = t.obstacles.filter((o) => o.segment === j);
    const obstacle = speed > 50 ? rows.find((o) => !bankMarker(o)) : undefined;
    if (obstacle) {
      const left = laneX(obstacle);
      if (!blocked) blocked = { left, right: left + 112 };
      else if (blocked.left > left && blocked.left - left < 225)
        blocked.left = left;
      else if (blocked.right < left && left - blocked.right + 112 < 225)
        blocked.right = left + 112;
      continue;
    }
    if (rows.some((o) => bankMarker(o) && o.lane === 0)) {
      if (!blocked || blocked.right + 225 < 1950)
        blocked = { left: 1500, right: 1950 };
      else if (blocked.left - 225 < 1950) blocked.left = 1500;
      continue;
    }
    if (rows.some((o) => bankMarker(o) && o.lane === 16)) {
      if (!blocked || blocked.left > 2850)
        blocked = { left: 2850, right: 3300 };
      else if (2850 - 225 > blocked.right) blocked.right = 3300;
      continue;
    }
    if (!player || j - Math.floor(player.position / 64) !== 1) continue;
    const carX = 2380 + Math.round((player.x * 850) / 1000);
    if (k === 0 && blocked) break;
    if (k < 2 && Math.abs(x - carX) < 280) return 0;
    const lo = carX - 310,
      hi = carX + 350;
    if (!blocked || (lo < blocked.left && blocked.right < hi))
      blocked = { left: lo, right: hi };
    else {
      if (blocked.left - 225 < hi && blocked.right > hi) blocked.left = lo;
      if (blocked.right < lo && blocked.right + 225 > lo) blocked.right = hi;
    }
  }
  const nativeTarget = 2380 + Math.round((target * 850) / 1000);
  return (trafficDodge(x, nativeTarget, 1500, 3300, blocked) * 1000) / 850;
}
export function hitTraffic(
  t: TrafficState,
  oldPosition: number,
  position: number,
  x: number,
  speed: number,
) {
  const first = Math.floor(oldPosition / 64),
    last = Math.floor(position / 64);
  let crashed = false,
    newSpeed = speed,
    sideways = 0;
  for (const o of t.obstacles) {
    if (o.segment <= first || o.segment > last) continue;
    if (bankMarker(o)) {
      const camera = 2380 + Math.round((x * 850) / 1000);
      if (
        o.kind === "bush" &&
        (o.lane === 0 ? camera - 30 < 1950 : camera + 70 > 2850)
      )
        crashed = true;
      continue;
    }
    // The game checks the wheels against each projected sprite. The Fuse cockpit
    // projects in road coordinates, so use wheel tracks either side of the lane centre.
    const wheelOffset = 0.075,
      halfWidth = o.kind === "rock" ? 0.09 : 0.11;
    const lateral = obstacleLateral(o);
    const left = Math.abs(x / 1000 - wheelOffset - lateral) < halfWidth;
    const right = Math.abs(x / 1000 + wheelOffset - lateral) < halfWidth;
    if (!left && !right) continue;
    if (o.kind === "rock" && newSpeed > 30) crashed = true;
    if (o.kind === "debris") {
      if (newSpeed > 50) sideways = left ? 40 : -40;
      if (newSpeed > 20) newSpeed -= 10;
    }
  }
  return { speed: newSpeed, crashed, sideways };
}
