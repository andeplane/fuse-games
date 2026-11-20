import type { Course } from "./index.js";

// Normalized maneuver sequences. The DOS builder aliases three opcodes per
// simple turn. w/W = right/left works, B = bridge, s/t = left/right S-bend.
const layouts = [
  "RRLLwsRWLRBLR",
  "tLLLWBRRwRRLR",
  "LRLRWtLwRLBLR",
  "RLLBRWLLRWsRL",
  "BsRLLRRwLRWRL",
  "RRWsRtLwLLBRL",
  "LRBLLRRsWLLBL",
  "RLwtRRWLLwLRL",
  "RLWsLLRwRLLBR",
  "LRLLLLBsLWRRL",
];

// Rise per segment over successive ten-segment sections from native 380.
const grades = [
  1, -2, 2, -2, 2, -2, 2, -1, 0, 1, 0, 1, 0, -1, 0, 1, 0, 1, -1, 2, 1, 0, 1, -1,
  2, -1, 0, 1, -1, 1, 1, -1, 0, -1, 1, 0, 1, 2, -1, 0, 0, 1, -1, 2, -1, 2, -1,
  0, 1, 1, 0, -1, 0, 1, 1, -1, 0, -1, 1,
];

const canyonStart = 370;
const canyonFinish = 960;

function buildCanyon(sequence: string) {
  const heading = new Int16Array(canyonFinish + 2);
  const height = new Int16Array(heading.length);
  const flags = new Uint8Array(heading.length);
  const leftBank = new Int16Array(heading.length),
    rightBank = new Int16Array(heading.length);
  const guardrail = new Uint8Array(heading.length);
  for (let s = 380; s < heading.length; s++) {
    const rise =
      s < 400 || (s >= 600 && s < 620) || (s >= 700 && s < 720)
        ? 200
        : s < 420 || (s >= 500 && s < 520)
          ? -200
          : 0;
    leftBank[s] = leftBank[s - 1]! + rise;
    rightBank[s] = -leftBank[s]!;
    if (rightBank[s]! < 0) guardrail[s] = 1;
  }
  let at = 390,
    yaw = 0;
  function advance(count: number, step = 0, flag = 0) {
    for (let i = 0; i < count && at < heading.length; i++, at++) {
      heading[at] = yaw;
      yaw += step;
      flags[at] = flag;
    }
  }
  for (const feature of sequence) {
    if (feature === "L" || feature === "R") {
      const right = feature === "R";
      advance(right ? 6 : 11);
      advance(right ? 45 : 40, right ? -7 : 7);
    } else if (feature === "s" || feature === "t") {
      const right = feature === "t";
      advance(7);
      advance(right ? 35 : 40, right ? -7 : 7);
      advance(right ? 48 : 43, right ? 7 : -7);
    } else if (feature === "B") {
      advance(10);
      leftBank.fill(-500, at, at + 20);
      rightBank.fill(-500, at, at + 20);
      guardrail.fill(0, at, at + 21);
      advance(20, 0, 0x80);
      advance(3);
    } else {
      // The constructor skips works at locations where the banks coincide.
      const uneven = leftBank[at] !== rightBank[at];
      if (uneven) {
        const right = feature === "w";
        advance(right ? 9 : 10);
        advance(5, 0, right ? 0x40 : 0x20);
        advance(right ? 4 : 3);
      }
    }
  }
  advance(heading.length - at);
  for (let s = 380; s < height.length; s++) {
    const section = Math.floor((s - 380) / 10);
    // The finish straight and bridge decks hold the previous height.
    const rise = flags[s] === 0x80 || s >= 920 ? 0 : grades[section]!;
    height[s] = height[s - 1]! + rise;
  }
  return { heading, height, flags, leftBank, rightBank, guardrail };
}

const canyons = layouts.map(buildCanyon);
const channel = new Uint16Array(370);
for (let s = 0; s < channel.length; s++) {
  const repeat = s % 24;
  if (s % 6 === 1) channel[s]! |= 1;
  if (repeat >= 3 && repeat <= 6) channel[s]! |= 2;
  if (repeat === 17) channel[s]! |= s === 137 || s === 281 ? 0x100 : 4;
  if (repeat === 16) channel[s]! |= s === 136 || s === 280 ? 0x200 : 8;
}
for (const s of [4, 76, 220, 316, 364]) channel[s]! |= 0x10;
for (const s of [5, 34, 59, 100, 179, 214, 322]) channel[s]! |= 0x20;
for (const s of [23, 82, 130, 155, 238, 262, 358]) channel[s]! |= 0x40;
for (const s of [124, 268]) channel[s]! |= 0x80;
channel[341]! |= 0x400;

export function nativeCourseSample(
  route: Course,
  position: number,
  layout = 0,
) {
  const offset = Math.max(0, Math.floor(position / 64));
  if (route !== "canyon") {
    const flags =
      route === "aqueduct" ? channel[8 + Math.min(334, offset)]! : 0;
    return {
      heading: 0,
      height: 0,
      bend: 0,
      grade: 0,
      flags,
      leftBank: 0,
      rightBank: 0,
      guardrail: false,
    };
  }
  const { heading, height, flags, leftBank, rightBank, guardrail } =
    canyons[layout] ?? canyons[0]!;
  const s = Math.min(canyonFinish, canyonStart + offset);
  return {
    heading: heading[s]!,
    height: height[s]!,
    bend: heading[s]! - heading[s + 1]!,
    grade: height[s + 1]! - height[s]!,
    flags: flags[s]!,
    leftBank: leftBank[s]!,
    rightBank: rightBank[s]!,
    guardrail: Boolean(guardrail[s]),
  };
}
