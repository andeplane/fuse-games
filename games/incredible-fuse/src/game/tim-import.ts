import { HEIGHT, WIDTH, type Part, type PartKind } from "./machine-parts.js";
import {
  canonicalLink,
  compareLinks,
  validLinks,
  type LinkKind,
  type MachineLink,
} from "./machine-links.js";
import type { WorkshopBlueprint } from "./machine.js";

export const MAX_TIM_BYTES = 256 * 1024;
const NONE = 0xffff;
const PULLEY = 7;
const DRIVE_BELT = 8;
const CORD = 10;

/** The v1.02 disk IDs. Belts and cords carry topology rather than art on the board. */
const pieces: Readonly<Partial<Record<number, PartKind>>> = {
  0: "bowling",
  1: "wall",
  2: "ramp",
  3: "seesaw",
  4: "balloon",
  5: "belt",
  6: "mouseWheel",
  7: "pulley",
  9: "basketball",
  11: "cage",
  12: "cat",
  13: "jack",
  14: "gear",
  15: "fish",
  16: "bellows",
  17: "basket",
  18: "popper",
  19: "spark",
  21: "outlet",
  22: "plunger",
  23: "eyelet",
  24: "fan",
  25: "lamp",
  26: "generator",
  27: "popper",
  28: "baseball",
  29: "bulb",
  30: "lens",
  31: "monkey",
  32: "pumpkin",
  33: "heart",
  34: "tree",
  35: "glove",
  36: "rocket",
  37: "scissors",
  38: "solar",
  39: "spring",
  40: "windmill",
  42: "mouse",
  43: "ball",
  44: "tennis",
  45: "candle",
  46: "pipe",
  47: "elbow",
  48: "timber",
  50: "motor",
};

class Reader {
  private offset = 0;
  private readonly data: DataView;
  constructor(bytes: Uint8Array) {
    this.data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  word(signed = false): number {
    if (this.offset + 2 > this.data.byteLength)
      throw new Error("The machine file is truncated.");
    const value = signed
      ? this.data.getInt16(this.offset, true)
      : this.data.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }
  get finished(): boolean {
    return this.offset === this.data.byteLength;
  }
}

type Pair = [number, number];
interface Cord {
  ends: Pair;
  slots: Pair;
}
interface RecordPart {
  type: number;
  flags: number;
  frame: number;
  state: number;
  width: number;
  height: number;
  x: number;
  y: number;
  belt: Pair | undefined;
  ropes: Cord[];
  neighbors: Pair;
  plugs: Pair;
  ropeOwner: number;
}

function readRecord(reader: Reader): RecordPart {
  const pair = (): Pair => [reader.word(), reader.word()];
  const type = reader.word();
  reader.word(); // Runtime flags1.
  const flags = reader.word();
  reader.word(); // Runtime flags3.
  const frame = reader.word(true),
    state = reader.word(true);
  const [width, height] = pair();
  pair(); // Editor resize handles.
  const x = reader.word(true),
    y = reader.word(true);
  reader.word(); // Part-dependent scratch value.
  const hasBelt = reader.word();
  pair(); // Belt attachment coordinates and width.
  const belt = hasBelt ? pair() : undefined;
  const ropes: Cord[] = [];
  for (let slot = 0; slot < 2; slot++) {
    const hasRope = reader.word();
    reader.word(); // XY anchor packed as two bytes.
    if (hasRope) {
      const ends = pair(),
        packed = reader.word();
      ropes.push({ ends, slots: [packed & 255, packed >>> 8] });
    }
  }
  const neighbors = pair(),
    plugs = pair();
  const ropeOwner = type === PULLEY ? reader.word() : NONE;
  return {
    type,
    flags,
    frame,
    state,
    width,
    height,
    x,
    y,
    belt,
    ropes,
    neighbors,
    plugs,
    ropeOwner,
  };
}

function connections(records: RecordPart[], parts: Part[]): MachineLink[] {
  const links: MachineLink[] = [];
  const add = (kind: LinkKind, a: number, b: number) => {
    const link = canonicalLink(kind, a + 1, b + 1);
    // Electrical references can be reciprocal. Each cable is represented once.
    if (kind === "wire" && links.some((old) => compareLinks(old, link) === 0))
      return;
    links.push(link);
  };
  function check(index: number) {
    if (index !== NONE && index >= records.length)
      throw new Error("A connection points to a missing part.");
  }
  for (const part of records) {
    const pointers = [
      ...part.neighbors,
      ...part.plugs,
      part.ropeOwner,
      ...(part.belt ?? []),
    ];
    for (const rope of part.ropes) {
      if (
        part.type !== CORD &&
        (part.type !== PULLEY || rope.ends.some((end) => end !== NONE))
      )
        throw new Error("An unsupported part owns a cord.");
      pointers.push(...rope.ends);
      if (rope.slots.some((slot) => slot > 1))
        throw new Error("A cord uses an unknown attachment slot.");
    }
    pointers.forEach(check);
  }
  const routed = new Set<number>();
  for (const [index, part] of records.entries()) {
    for (const to of part.plugs) if (to !== NONE) add("wire", index, to);
    if (part.type === DRIVE_BELT) {
      if (!part.belt || part.belt.includes(NONE))
        throw new Error("A drive belt has a loose end.");
      add("belt", ...part.belt);
    } else if (part.belt) throw new Error("Unsupported belt record.");
    if (part.type !== CORD) continue;
    const rope = part.ropes[0];
    if (part.ropes.length !== 1 || !rope || rope.ends.includes(NONE))
      throw new Error("A pull cord has a loose end.");
    const [start, end] = rope.ends;
    let previous = start;
    let next = records[start]!.neighbors[rope.slots[0]]!;
    const seen = new Set([start]);
    // Each pulley names both immediate neighbors and the cord that runs over it.
    while (next !== end) {
      const guide = records[next];
      if (
        seen.has(next) ||
        !guide ||
        guide.type !== PULLEY ||
        guide.ropeOwner !== index ||
        !guide.neighbors.includes(previous)
      )
        throw new Error("A pull cord has an unsupported route.");
      add("rope", previous, next);
      seen.add(next);
      routed.add(next);
      const onward = guide.neighbors[guide.neighbors[0] === previous ? 1 : 0];
      previous = next;
      next = onward;
    }
    if (records[end]!.neighbors[rope.slots[1]] !== previous)
      throw new Error("A pull cord has inconsistent endpoints.");
    add("rope", previous, end);
  }
  if (
    records.some(
      (r, i) => r.type === PULLEY && r.ropeOwner !== NONE && !routed.has(i),
    )
  )
    throw new Error("A pulley refers to an unsupported cord.");
  links.sort(compareLinks);
  if (!validLinks(parts, links))
    throw new Error("A connection cannot fit the sockets on this workbench.");
  for (const [index, part] of records.entries()) {
    for (const neighbor of part.neighbors) {
      if (
        neighbor !== NONE &&
        !links.some(
          (link) =>
            compareLinks(
              link,
              canonicalLink("rope", index + 1, neighbor + 1),
            ) === 0,
        )
      )
        throw new Error("A part refers to a cord that is missing.");
    }
  }
  return links;
}

/** Import local v1.02 freeform .TIM machines. Packed resources and campaign .LEV files have a different layout. */
export function parseTimWorkshop(bytes: Uint8Array): {
  blueprint: WorkshopBlueprint;
  warnings: string[];
} {
  if (bytes.byteLength > MAX_TIM_BYTES)
    throw new Error("The machine exceeds the 256 KiB limit.");
  const reader = new Reader(bytes);
  if (reader.word() !== 0xaced || reader.word() !== 0x0102)
    throw new Error("Choose a DOS v1.02 freeform .TIM machine.");
  const air = reader.word(),
    gravity = reader.word();
  if (air > 255 || gravity > 512)
    throw new Error("The machine's atmosphere is outside the supported range.");
  reader.word(); // Original music track.
  const count = reader.word() + reader.word();
  if (count > 128)
    throw new Error("This workbench holds at most 128 part records.");
  if (reader.word() !== 0)
    throw new Error(
      "Choose a freeform .TIM machine with an unrestricted parts bin.",
    );
  const records = Array.from({ length: count }, () => readRecord(reader));
  if (!reader.finished) throw new Error("Unexpected data follows the machine.");
  const warnings = new Set<string>();
  const parts: Part[] = [];
  for (const [index, raw] of records.entries()) {
    if (raw.type === DRIVE_BELT || raw.type === CORD) continue;
    const kind = pieces[raw.type];
    if (!kind)
      throw new Error(
        `Part type ${raw.type} is unsupported on this workbench.`,
      );
    const { width, height } = raw;
    const x = raw.x + width / 2,
      y = raw.y + height / 2;
    if (
      width < 1 ||
      height < 1 ||
      width > 320 ||
      height > 320 ||
      x < 0 ||
      x > WIDTH ||
      y < 0 ||
      y > HEIGHT
    )
      throw new Error(
        "A part's dimensions or position are outside the workbench.",
      );
    if (
      (raw.flags & 0x20) !== 0 ||
      (kind === "elbow" && raw.frame !== 0) ||
      (kind === "pipe" && width > height)
    )
      warnings.add(
        "Some tube openings or vertical flips use the Fuse orientation.",
      );
    if (
      raw.state !== 0 ||
      (kind === "seesaw" && raw.frame !== 0) ||
      (kind === "outlet" && raw.frame >= 4)
    )
      warnings.add(
        "Switches, rockers and powered parts start in their Fuse rest state.",
      );
    parts.push({
      id: index + 1,
      kind,
      x,
      y,
      width,
      height,
      flip: (raw.flags & 0x10) !== 0,
      fixed: false,
    });
  }
  if (parts.length)
    warnings.add(
      "Parts use Fuse artwork and physics. Creature movement, contact shapes and timing can differ.",
    );
  return {
    blueprint: { air, gravity, parts, links: connections(records, parts) },
    warnings: [...warnings],
  };
}
