import {
  PARTS,
  FREE_WORKSHOP,
  getPuzzle,
  HEIGHT,
  WIDTH,
  isPartKind,
  partSize,
  canRotate,
  type PartKind,
  type Part,
  type Body,
} from "./machine-parts.js";
export * from "./machine-parts.js";
import { atmosphere } from "./machine-motion.js";
import { stepCords } from "./machine-cords.js";
import { evaluateObjective } from "./machine-goals.js";
import {
  canonicalLink,
  canLink,
  compareLinks,
  connectedNeighbors,
  isLinkKind,
  linkedParts,
  validLinks,
  type LinkKind,
  type MachineLink,
} from "./machine-links.js";
export * from "./machine-links.js";
export interface WorkshopBlueprint {
  air: number;
  gravity: number;
  parts: Part[];
  links: MachineLink[];
}

export interface Machine {
  puzzle: number;
  mode: "build" | "running" | "failed" | "solved";
  tick: number;
  /** Remainder of the DOS PIT clock relative to the 20 Hz room log. */
  phase: number;
  air: number;
  gravity: number;
  parts: Part[];
  imported: boolean;
  bodies: Body[];
  active: number[];
  links: MachineLink[];
  broken: number[];
  /** Only movable placements are saved. The fixed layout belongs to the puzzle. */
  undo: Part[][];
  undoLinks: MachineLink[][];
}
export type MachineCommand =
  | { type: "place"; kind: PartKind; x: number; y: number }
  | { type: "move"; id: number; x: number; y: number }
  | { type: "flip" | "rotate" | "remove"; id: number }
  | { type: "connect" | "disconnect"; kind: LinkKind; a: number; b: number }
  | { type: "run" | "rewind" | "undo" };
const MAX_UNDO = 8;
const MAX_STEPS = 600;
const within = (value: unknown, low: number, high: number): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= low &&
  value <= high;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const position = (raw: Record<string, unknown>) =>
  within(raw.x, 0, WIDTH) && within(raw.y, 0, HEIGHT);
export function validCommand(raw: unknown): raw is MachineCommand {
  if (!record(raw)) return false;
  const fields = Object.keys(raw).length;
  switch (raw.type) {
    case "undo":
    case "run":
    case "rewind":
      return fields === 1;
    case "remove":
    case "flip":
    case "rotate":
      return fields === 2 && within(raw.id, 1, 128);
    case "connect":
    case "disconnect":
      return (
        fields === 4 &&
        isLinkKind(raw.kind) &&
        within(raw.a, 1, 128) &&
        within(raw.b, 1, 128) &&
        raw.a !== raw.b
      );
    case "place":
      return fields === 4 && isPartKind(raw.kind) && position(raw);
    case "move":
      return fields === 4 && within(raw.id, 1, 128) && position(raw);
    default:
      return false;
  }
}

const copyParts = (parts: Part[]) => parts.map((p) => ({ ...p }));
export function createMachine(puzzleIndex: number): Machine {
  if (!within(puzzleIndex, 0, FREE_WORKSHOP))
    throw new RangeError("Unknown workshop puzzle");
  const spec = getPuzzle(puzzleIndex);
  return {
    puzzle: puzzleIndex,
    mode: "build",
    tick: 0,
    phase: 0,
    air: 67,
    gravity: 272,
    imported: false,
    parts: copyParts(spec.parts),
    bodies: [],
    active: [],
    links: (spec.links ?? []).map((link) => ({ ...link })),
    broken: [],
    undo: [],
    undoLinks: [],
  };
}
export function available(m: Machine, kind: PartKind): number {
  return Math.max(
    0,
    (getPuzzle(m.puzzle).stock[kind] ?? 0) -
      m.parts.filter((p) => !p.fixed && p.kind === kind).length,
  );
}
function fits(
  { width, height }: { width: number; height: number },
  x: number,
  y: number,
): boolean {
  return (
    x >= width / 2 &&
    y >= height / 2 &&
    x <= WIDTH - width / 2 &&
    y <= HEIGHT - height / 2
  );
}
const editable = (m: Machine) => m.parts.filter((p) => !p.fixed);
function remember(m: Machine) {
  m.undo.push(copyParts(editable(m)));
  m.undoLinks.push(m.links.map((l) => ({ ...l })));
  if (m.undo.length > MAX_UNDO) {
    m.undo.shift();
    m.undoLinks.shift();
  }
}
function initialBody(p: Part): Body {
  return { id: p.id, x: p.x, y: p.y, vx: 0, vy: 0 };
}
export function applyMachine(m: Machine, c: MachineCommand): boolean {
  if (!validCommand(c)) return false;
  if (c.type === "rewind") {
    if (m.mode === "build") return false;
    m.mode = "build";
    m.tick = 0;
    m.phase = 0;
    m.bodies = [];
    m.active = [];
    m.broken = [];
    return true;
  }
  if (m.mode !== "build") return false;
  if (c.type === "run") {
    m.mode = "running";
    m.bodies = m.parts.filter(isDynamic).map(initialBody);
    return true;
  }
  if (c.type === "undo") {
    const last = m.undo.pop();
    if (!last) return false;
    m.parts = [...m.parts.filter((p) => p.fixed), ...last];
    m.links = m.undoLinks.pop()!;
    return true;
  }
  if (c.type === "connect" || c.type === "disconnect") {
    const link = canonicalLink(c.kind, c.a, c.b);
    const index = m.links.findIndex((l) => compareLinks(l, link) === 0);
    if (c.type === "connect" ? !canLink(m.parts, m.links, link) : index < 0)
      return false;
    remember(m);
    if (c.type === "connect") m.links = [...m.links, link].sort(compareLinks);
    else m.links.splice(index, 1);
    return true;
  }
  const piece =
    "id" in c ? m.parts.find((p) => p.id === c.id && !p.fixed) : undefined;
  if (c.type === "place" || c.type === "move") {
    const kind = c.type === "place" ? c.kind : piece?.kind;
    if (
      !kind ||
      (c.type === "place" && (m.parts.length >= 128 || available(m, kind) <= 0))
    )
      return false;
    const x = Math.round(c.x / 2) * 2,
      y = Math.round(c.y / 2) * 2;
    if (
      !fits(piece ? partSize(piece) : PARTS[kind], x, y) ||
      (piece && piece.x === x && piece.y === y)
    )
      return false;
    // Parts can couple at their edges; the same point cannot hold two origins.
    if (
      m.parts.some(
        (p) =>
          p.id !== piece?.id && Math.abs(p.x - x) < 5 && Math.abs(p.y - y) < 5,
      )
    )
      return false;
    remember(m);
    if (piece) {
      piece.x = x;
      piece.y = y;
    } else {
      let id = 1;
      while (m.parts.some((p) => p.id === id)) id++;
      m.parts.push({ id, kind, x, y, flip: false, fixed: false });
    }
    return true;
  }
  if (!piece) return false;
  if (
    c.type === "rotate" &&
    (!canRotate(piece.kind) ||
      !fits(
        partSize({ ...piece, rotation: piece.rotation ? 0 : 1 }),
        piece.x,
        piece.y,
      ))
  )
    return false;
  remember(m);
  if (c.type === "remove") {
    m.parts = m.parts.filter((p) => p.id !== piece.id);
    m.links = m.links.filter((l) => l.a !== piece.id && l.b !== piece.id);
  } else if (c.type === "rotate") piece.rotation = piece.rotation ? 0 : 1;
  else piece.flip = !piece.flip;
  return true;
}

/** Motion is expressed in the original 1/512-pixel lattice per simulation tick. */
const UNIT = 512;
const quant = (n: number) => Math.round(n * UNIT) / UNIT;
const clampVelocity = (n: number, maximum: number) =>
  quant(Math.max(-maximum, Math.min(maximum, n)));
interface Material {
  bounce: number;
  mass: number;
}
const materials: Partial<Record<PartKind, Material>> = {
  bowling: { bounce: 128, mass: 16 },
  basketball: { bounce: 192, mass: 4 },
  baseball: { bounce: 128, mass: 3 },
  tennis: { bounce: 192, mass: 1 },
  balloon: { bounce: 24, mass: 1 },
  heart: { bounce: 24, mass: 1 },
  ball: { bounce: 128, mass: 4 },
  crate: { bounce: 0, mass: 8 },
  pumpkin: { bounce: 36, mass: 6 },
  mouse: { bounce: 0, mass: 1 },
  cat: { bounce: 0, mass: 4 },
  rocket: { bounce: 0, mass: 1 },
};
const looseMaterial: Material = { bounce: 32, mass: 3 };
const isDynamic = (part: Part) =>
  part.mobile ?? Object.hasOwn(materials, part.kind);
export function bodyKind(part: Part): PartKind {
  return part.kind === "popper" ? "tennis" : part.kind;
}
const sign = (p: Part) => (p.flip ? -1 : 1);
const near = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  dx: number,
  dy: number,
) => Math.abs(a.x - b.x) <= dx && Math.abs(a.y - b.y) <= dy;
const has = (m: Machine, id: number) => m.active.includes(id);
function fire(m: Machine, id: number) {
  if (!has(m, id)) m.active.push(id);
}
const driver = new Set<PartKind>([
  "windmill",
  "mouseWheel",
  "motor",
  "monkey",
  "gear",
  "generator",
  "driveBelt",
  "belt",
]);
const cord = new Set<PartKind>(["rope", "pulley", "eyelet"]);
const pulled = new Set<PartKind>([
  "bell",
  "switch",
  "outlet",
  "plunger",
  "bellows",
  "popper",
  "glove",
  "jack",
  "monkey",
  "scissors",
]);
const electric = new Set<PartKind>([
  "switch",
  "outlet",
  "plunger",
  "solar",
  "generator",
]);
const powered = new Set<PartKind>([
  "bulb",
  "motor",
  "lamp",
  "gate",
  "fan",
  "magnet",
]);
const touch = new Set<PartKind>([
  ...pulled,
  "lamp",
  "spark",
  "domino",
  "fish",
  "rocket",
]);
const air = (p: Part, target: { x: number; y: number }) => {
  const reach = (target.x - p.x) * sign(p);
  return reach >= 0 && reach <= 175 && Math.abs(target.y - p.y) <= 40;
};
function switchedOn(m: Machine, p: Part): boolean {
  const plugged = m.links.some(
    (l) => l.kind === "wire" && (l.a === p.id || l.b === p.id),
  );
  return plugged ? has(m, p.id) : m.puzzle !== FREE_WORKSHOP;
}
function blowing(m: Machine, p: Part): boolean {
  return p.kind === "fan"
    ? switchedOn(m, p)
    : p.kind === "bellows" && has(m, p.id);
}
function beltSpeed(m: Machine, p: Part): number {
  const shaft = linkedParts(m.links, "belt", p.id);
  const motor = m.parts.find((q) => q.kind === "motor" && shaft.includes(q.id));
  if (motor) return has(m, motor.id) ? -sign(motor) * 8 : 0;
  if (shaft.length > 1)
    return m.parts.some(
      (q) => q.id !== p.id && shaft.includes(q.id) && has(m, q.id),
    )
      ? sign(p) * 4
      : 0;
  return m.puzzle === FREE_WORKSHOP ? 0 : sign(p) * 4;
}
function coupled(a: Part, b: Part, margin: number): boolean {
  const sa = partSize(a),
    sb = partSize(b);
  return near(
    a,
    b,
    (sa.width + sb.width) / 2 + margin,
    (sa.height + sb.height) / 2 + margin,
  );
}
/** Each call propagates one link. A pulse visibly travels along a domino or belt line. */
function mechanisms(m: Machine) {
  const on = m.parts.filter((p) => has(m, p.id));
  const cut = on.filter((p) => p.kind === "scissors");
  for (const p of m.parts) {
    if (has(m, p.id)) continue;
    const inputs = (kind: LinkKind) => connectedNeighbors(m.links, kind, p.id);
    const drivenBy = (kind: LinkKind, sources: Set<PartKind>) =>
      inputs(kind).some((id) =>
        on.some((q) => q.id === id && sources.has(q.kind)),
      );
    const implicit = m.puzzle !== FREE_WORKSHOP;
    if (powered.has(p.kind) && drivenBy("wire", electric)) {
      fire(m, p.id);
      continue;
    }
    if (p.kind !== "motor" && driver.has(p.kind) && drivenBy("belt", driver)) {
      fire(m, p.id);
      continue;
    }
    if (
      (pulled.has(p.kind) || cord.has(p.kind) || p.kind === "seesaw") &&
      inputs("rope").some(
        (id) =>
          on.some((q) => q.id === id) &&
          !m.broken.some((i) => {
            const l = m.links[i]!;
            return (l.a === p.id && l.b === id) || (l.b === p.id && l.a === id);
          }),
      )
    ) {
      fire(m, p.id);
      continue;
    }
    if (
      p.kind === "windmill" &&
      m.parts.some((a) => blowing(m, a) && air(a, p))
    ) {
      fire(m, p.id);
      continue;
    }
    if (
      p.kind === "mouseWheel" &&
      m.bodies.some(
        (b) =>
          m.parts.some((a) => a.id === b.id && a.kind === "mouse") &&
          near(p, b, 65, 50),
      )
    ) {
      fire(m, p.id);
      continue;
    }
    for (const a of on) {
      const along = (p.x - a.x) * sign(a);
      const beam = along >= 0 && along <= 180 && Math.abs(a.y - p.y) <= 24;
      if (
        (driver.has(a.kind) &&
          driver.has(p.kind) &&
          p.kind !== "motor" &&
          (implicit || (a.kind === "gear" && p.kind === "gear")) &&
          coupled(a, p, implicit ? 12 : 1)) ||
        (implicit &&
          (cord.has(a.kind) || cord.has(p.kind)) &&
          (cord.has(p.kind) || pulled.has(p.kind)) &&
          coupled(a, p, 14) &&
          !cut.some((s) => coupled(s, cord.has(p.kind) ? p : a, 8))) ||
        (a.kind === "domino" &&
          (p.kind === "domino" || pulled.has(p.kind)) &&
          along > 0 &&
          along <= 56 &&
          Math.abs(a.y - p.y) < 26) ||
        (a.kind === "spark" && near(a, p, 65, 65) && touch.has(p.kind)) ||
        (a.kind === "lamp" &&
          beam &&
          (p.kind === "solar" || p.kind === "lens")) ||
        (a.kind === "lens" && beam && p.kind === "candle") ||
        (a.kind === "candle" &&
          near(a, p, 70, 55) &&
          (p.kind === "rocket" || p.kind === "spark"))
      ) {
        fire(m, p.id);
        break;
      }
    }
  }
  for (const p of m.parts) {
    if (
      p.kind === "popper" &&
      has(m, p.id) &&
      !m.bodies.some((b) => b.id === p.id)
    ) {
      m.bodies.push({
        id: p.id,
        x: p.x + sign(p) * 22,
        y: p.y - 16,
        vx: sign(p) * 6,
        vy: -8,
      });
    }
  }
}

const inert = new Set<PartKind>([
  "rope",
  "eyelet",
  "pulley",
  "driveBelt",
  "lens",
  "solar",
  "bulb",
  "candle",
  "rocket",
  "magnet",
  "fan",
  "windmill",
  "motor",
  "generator",
  "gear",
  "mouseWheel",
  "lamp",
  "glove",
  "bellows",
  "scissors",
  "popper",
  "bell",
  "cage",
  "fish",
  "monkey",
  "spark",
]);
function motion(m: Machine, b: Body, p: Part) {
  const kind = bodyKind(p),
    mat = materials[kind] ?? looseMaterial;
  const field = atmosphere(kind, m.air, m.gravity);
  const limit = (value: number) => clampVelocity(value, field.terminal / UNIT);
  const { width, height } = p.kind === "popper" ? PARTS[kind] : partSize(p),
    rx = width / 2,
    ry = height / 2;
  let ax = 0,
    ay = field.acceleration / UNIT;
  const animal = kind === "mouse" || kind === "cat";
  if (animal) {
    const seek = m.parts.find((q) =>
      kind === "cat"
        ? q.kind === "mouse" || q.kind === "fish"
        : q.kind === "cat",
    );
    const target =
      seek && (m.bodies.find((body) => body.id === seek.id) ?? seek);
    let direction = sign(p);
    if (target && near(target, b, 170, 65))
      direction =
        (Math.sign(target.x - b.x) || direction) * (kind === "mouse" ? -1 : 1);
    b.vx = direction * (kind === "cat" ? 1.2 : 1.6);
  }
  for (const q of m.parts) {
    if (q.id === b.id) continue;
    if (blowing(m, q) && air(q, b))
      ax += (sign(q) * 0.65) / Math.sqrt(mat.mass);
    if (
      q.kind === "magnet" &&
      switchedOn(m, q) &&
      (kind === "ball" || kind === "bowling") &&
      near(q, b, 110, 110)
    ) {
      const distance = Math.max(1, Math.hypot(q.x - b.x, q.y - b.y));
      ax += ((q.x - b.x) / distance) * 1.1;
      ay += ((q.y - b.y) / distance) * 1.1;
    }
    if (q.kind === "glove" && has(m, q.id) && near(q, b, 47, 25))
      b.vx = sign(q) * 9;
    if (q.kind === "rocket" && near(q, b, 30, 35)) fire(m, q.id);
  }
  if (kind === "rocket" && has(m, p.id)) ay = -1;
  b.vx = limit(b.vx + ax);
  b.vy = limit(b.vy + ay);
  // Vertical sweeps retain the DOS contact tick; moving sideways subdivides travel near incline edges.
  const steps = Math.max(1, Math.ceil(Math.abs(b.vx) / 5));
  for (let i = 0; i < steps; i++) {
    const oldX = b.x,
      oldY = b.y;
    b.x += b.vx / steps;
    b.y += b.vy / steps;
    for (const q of m.parts) {
      if (q.id === p.id || isDynamic(q)) continue;
      const shape = partSize(q),
        w = shape.width / 2,
        h = shape.height / 2;
      if (!near(b, q, w + rx + 1, h + ry + 1)) continue;
      if (touch.has(q.kind)) fire(m, q.id);
      if (q.kind === "rope" || q.kind === "pulley" || q.kind === "eyelet")
        fire(m, q.id);
      if (q.kind === "cage" && animal) {
        fire(m, q.id);
        b.x = q.x;
        b.y = q.y;
        b.vx = b.vy = 0;
        return;
      }
      if (q.kind === "basket") {
        if (
          b.vy >= 0 &&
          Math.abs(b.x - q.x) <= w &&
          oldY <= q.y &&
          b.y + ry >= q.y - h
        ) {
          fire(m, q.id);
          b.x = q.x;
          b.y = q.y;
          b.vx = b.vy = 0;
          return;
        }
        continue;
      }
      if (q.kind === "elbow" || q.kind === "pipe") {
        if (q.kind === "pipe" && w > h) {
          const entersLeft = b.vx > 0 && oldX <= q.x - w && b.x + rx >= q.x - w;
          const entersRight =
            b.vx < 0 && oldX >= q.x + w && b.x - rx <= q.x + w;
          if ((entersLeft || entersRight) && Math.abs(b.y - q.y) <= h) {
            fire(m, q.id);
            b.x = q.x + (entersLeft ? 1 : -1) * (w + rx + 1);
            b.y = q.y;
            b.vy = 0;
          }
          continue;
        }
        if (
          b.vy >= 0 &&
          oldY <= q.y - h &&
          b.y + ry >= q.y - h &&
          Math.abs(b.x - q.x) <= w
        ) {
          fire(m, q.id);
          const turn = q.kind === "elbow";
          b.x = q.x + (turn ? sign(q) * (w + rx + 1) : 0);
          b.y = q.y + h + ry + 1;
          if (turn) {
            b.vx = sign(q) * 6;
            b.vy = 1;
          } else {
            b.vx = 0;
            b.vy = Math.max(2, b.vy);
          }
        }
        continue;
      }
      if (
        inert.has(q.kind) ||
        (q.kind === "gate" && has(m, q.id)) ||
        (q.kind === "domino" && has(m, q.id))
      )
        continue;
      const inclined = q.kind === "ramp" || q.kind === "seesaw";
      const slope = inclined
        ? (sign(q) *
            (q.kind === "seesaw" && has(m, q.id) ? -1 : 1) *
            (shape.height - 6)) /
          shape.width
        : 0;
      const top = inclined ? q.y + (b.x - q.x) * slope - 2 : q.y - h;
      const oldTop = inclined ? q.y + (oldX - q.x) * slope - 2 : top;
      const flat =
        q.kind === "wall" || q.kind === "timber" || q.kind === "shelf";
      const crossed = flat ? Math.floor(b.y + ry) > top : b.y + ry >= top;
      if (
        Math.abs(b.x - q.x) <= w + (inclined ? 0 : rx / 2) &&
        b.vy >= -0.02 &&
        oldY + ry <= oldTop + 1.5 &&
        crossed
      ) {
        b.y = top - ry + (flat ? 511 / UNIT : 0);
        if (q.kind === "spring" || q.kind === "jack") {
          fire(m, q.id);
          b.vy = -Math.max(9, Math.abs(b.vy) * 1.25);
        } else if (inclined) {
          b.vx = limit(
            b.vx + ((b.vy - b.vx * slope) * slope) / (1 + slope * slope),
          );
          b.vy = limit(b.vx * slope);
          if (q.kind === "seesaw" && !has(m, q.id)) {
            fire(m, q.id);
            for (const other of m.bodies)
              if (
                other !== b &&
                near(other, q, w, 36) &&
                (other.x - q.x) * (b.x - q.x) < 0
              )
                other.vy = -11;
          }
        } else {
          const settle = flat && oldY === b.y && b.vy <= ay;
          b.vy = settle
            ? 0
            : -Math.max(0, Math.floor((b.vy * UNIT * mat.bounce) / 256) - 64) /
              UNIT;
          if (q.kind === "belt") {
            const speed = beltSpeed(m, q);
            if (speed !== 0) fire(m, q.id);
            b.vx = speed;
          } else {
            b.vx = quant(b.vx * 0.98);
            if (flat) b.x = Math.floor(b.x) + (b.vx < 0 ? 0 : 511 / UNIT);
          }
        }
      } else if (!inclined && Math.abs(b.y - q.y) < h + ry - 1) {
        if (oldX + rx <= q.x - w + 0.5 && b.x + rx >= q.x - w) {
          b.x = q.x - w - rx;
          b.vx = (-Math.abs(b.vx) * mat.bounce) / 256;
        } else if (oldX - rx >= q.x + w - 0.5 && b.x - rx <= q.x + w) {
          b.x = q.x + w + rx;
          b.vx = (Math.abs(b.vx) * mat.bounce) / 256;
        } else if (oldY - ry >= q.y + h - 0.5 && b.y - ry <= q.y + h) {
          b.y = q.y + h + ry;
          b.vy = (Math.abs(b.vy) * mat.bounce) / 256;
        }
      }
    }
  }
  b.x = quant(b.x);
  b.y = quant(b.y);
  b.vx = limit(b.vx);
  b.vy = limit(b.vy);
}

function transfer(m: Machine, a: Body, b: Body, pa: Part, pb: Part) {
  const ka = bodyKind(pa),
    kb = bodyKind(pb),
    ma = materials[ka] ?? looseMaterial,
    mb = materials[kb] ?? looseMaterial;
  const distance = Math.hypot(a.x - b.x, a.y - b.y);
  const radius =
    (Math.min(PARTS[ka].width, PARTS[ka].height) +
      Math.min(PARTS[kb].width, PARTS[kb].height)) /
    2;
  if (distance >= radius) return;
  const nx = distance ? (b.x - a.x) / distance : 1,
    ny = distance ? (b.y - a.y) / distance : 0;
  const speed = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny,
    total = ma.mass + mb.mass,
    depth = radius - distance;
  a.x = quant(a.x - (depth * nx * mb.mass) / total);
  a.y = quant(a.y - (depth * ny * mb.mass) / total);
  b.x = quant(b.x + (depth * nx * ma.mass) / total);
  b.y = quant(b.y + (depth * ny * ma.mass) / total);
  if (speed <= 0) return;
  const impulse = (speed * (1 + Math.min(ma.bounce, mb.bounce) / 256)) / total;
  const aMax = atmosphere(ka, m.air, m.gravity).terminal / UNIT;
  const bMax = atmosphere(kb, m.air, m.gravity).terminal / UNIT;
  a.vx = clampVelocity(a.vx - impulse * mb.mass * nx, aMax);
  a.vy = clampVelocity(a.vy - impulse * mb.mass * ny, aMax);
  b.vx = clampVelocity(b.vx + impulse * ma.mass * nx, bMax);
  b.vy = clampVelocity(b.vy + impulse * ma.mass * ny, bMax);
}
export function stepPhysics(m: Machine): void {
  if (m.mode !== "running") return;
  m.tick = Math.min(0x7fffffff, m.tick + 1);
  mechanisms(m);
  const partOf = new Map(m.parts.map((p) => [p.id, p]));
  for (const b of m.bodies) {
    // Objects which have left the workshop stop integrating; rewind puts them back.
    if (b.x < -320 || b.x > WIDTH + 320 || b.y < -320 || b.y > HEIGHT + 320)
      continue;
    motion(m, b, partOf.get(b.id)!);
  }
  for (let i = 0; i < m.bodies.length; i++)
    for (let j = i + 1; j < m.bodies.length; j++) {
      const a = m.bodies[i]!,
        b = m.bodies[j]!;
      transfer(m, a, b, partOf.get(a.id)!, partOf.get(b.id)!);
    }
  if (m.links.some((l) => l.kind === "rope")) {
    stepCords({
      parts: partOf,
      bodies: new Map(m.bodies.map((b) => [b.id, b])),
      links: m.links,
      broken: m.broken,
      active: m.active,
      mass: (p) => (materials[bodyKind(p)] ?? looseMaterial).mass,
      maximum: (p) => atmosphere(bodyKind(p), m.air, m.gravity).terminal / UNIT,
      activate: (id) => fire(m, id),
    });
  }
  if (m.puzzle === FREE_WORKSHOP) return;
  const spec = getPuzzle(m.puzzle);
  if (spec.objective) m.mode = evaluateObjective(spec.objective, m);
  else if (spec.targets.every((id) => has(m, id))) m.mode = "solved";
  if (
    m.mode === "running" &&
    (m.tick >= MAX_STEPS ||
      (m.tick > 12 &&
        m.bodies.length > 0 &&
        m.bodies.every(
          (b) =>
            b.x < -80 || b.x > WIDTH + 80 || b.y < -80 || b.y > HEIGHT + 80,
        )))
  )
    m.mode = "failed";
}
const CLOCK_DENOMINATOR = 5041 * 8 * 20;
const lattice = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value * UNIT) &&
  value >= min &&
  value <= max;
function validParts(raw: unknown): raw is Part[] {
  if (!Array.isArray(raw) || raw.length > 128) return false;
  const ids = new Set<number>();
  for (const p of raw) {
    if (
      !record(p) ||
      !within(p.id, 1, 128) ||
      ids.has(p.id) ||
      !isPartKind(p.kind) ||
      !lattice(p.x, -160, WIDTH + 160) ||
      !lattice(p.y, -160, HEIGHT + 160) ||
      typeof p.flip !== "boolean" ||
      typeof p.fixed !== "boolean" ||
      (p.width !== undefined && !within(p.width, 1, 320)) ||
      (p.height !== undefined && !within(p.height, 1, 320)) ||
      (p.rotation !== undefined &&
        (!(p.rotation === 0 || p.rotation === 1) || !canRotate(p.kind))) ||
      (p.mobile !== undefined && typeof p.mobile !== "boolean") ||
      Object.keys(p).some(
        (k) =>
          ![
            "id",
            "kind",
            "x",
            "y",
            "flip",
            "fixed",
            "width",
            "height",
            "rotation",
            "mobile",
          ].includes(k),
      )
    )
      return false;
    ids.add(p.id);
  }
  return true;
}
export function validWorkshopBlueprint(raw: unknown): raw is WorkshopBlueprint {
  return (
    record(raw) &&
    Object.keys(raw).length === 4 &&
    within(raw.air, 0, 255) &&
    within(raw.gravity, 0, 512) &&
    validParts(raw.parts) &&
    validLinks(raw.parts, raw.links)
  );
}
export function createWorkshop(blueprint: WorkshopBlueprint): Machine {
  if (!validWorkshopBlueprint(blueprint))
    throw new RangeError("Invalid workshop blueprint");
  return {
    ...createMachine(FREE_WORKSHOP),
    imported: true,
    air: blueprint.air,
    gravity: blueprint.gravity,
    parts: copyParts(blueprint.parts),
    links: blueprint.links.map((l) => ({ ...l })),
  };
}
function matchesLayout(
  parts: Part[],
  puzzle: number,
  imported: boolean,
): boolean {
  if (imported) return puzzle === FREE_WORKSHOP;
  const spec = getPuzzle(puzzle),
    fixed = parts.filter((p) => p.fixed);
  if (
    fixed.length !== spec.parts.length ||
    !spec.parts.every((p) =>
      fixed.some(
        (q) =>
          p.id === q.id &&
          p.kind === q.kind &&
          p.x === q.x &&
          p.y === q.y &&
          p.flip === q.flip &&
          p.rotation === q.rotation,
      ),
    )
  )
    return false;
  const counts = new Map<PartKind, number>();
  for (const p of parts) {
    if (
      p.width !== undefined ||
      p.height !== undefined ||
      p.mobile !== undefined
    )
      return false;
    if (p.fixed) continue;
    if (
      !fits(partSize(p), p.x, p.y) ||
      !Number.isInteger(p.x / 2) ||
      !Number.isInteger(p.y / 2)
    )
      return false;
    const count = (counts.get(p.kind) ?? 0) + 1;
    if (count > (spec.stock[p.kind] ?? 0)) return false;
    counts.set(p.kind, count);
  }
  return true;
}
export function validMachine(raw: unknown): raw is Machine {
  if (
    !record(raw) ||
    Object.keys(raw).length !== 14 ||
    !within(raw.puzzle, 0, FREE_WORKSHOP) ||
    typeof raw.imported !== "boolean" ||
    !(
      raw.mode === "build" ||
      raw.mode === "running" ||
      raw.mode === "failed" ||
      raw.mode === "solved"
    ) ||
    !within(raw.tick, 0, 0x7fffffff) ||
    !within(raw.phase, 0, CLOCK_DENOMINATOR - 1) ||
    !within(raw.air, 0, 255) ||
    !within(raw.gravity, 0, 512) ||
    (!raw.imported && (raw.air !== 67 || raw.gravity !== 272)) ||
    !validParts(raw.parts) ||
    !matchesLayout(raw.parts, raw.puzzle, raw.imported) ||
    !validLinks(raw.parts, raw.links) ||
    !Array.isArray(raw.broken) ||
    raw.broken.length > raw.links.length ||
    !Array.isArray(raw.active) ||
    raw.active.length > raw.parts.length ||
    !Array.isArray(raw.bodies) ||
    raw.bodies.length > raw.parts.length ||
    !Array.isArray(raw.undo) ||
    raw.undo.length > MAX_UNDO ||
    !Array.isArray(raw.undoLinks) ||
    raw.undoLinks.length !== raw.undo.length
  )
    return false;
  const parts = raw.parts,
    puzzle = raw.puzzle,
    imported = raw.imported;
  const ids = new Map(parts.map((p) => [p.id, p]));
  const links = raw.links;
  if (
    !raw.broken.every(
      (i) => within(i, 0, links.length - 1) && links[i]!.kind === "rope",
    ) ||
    new Set(raw.broken).size !== raw.broken.length
  )
    return false;
  if (
    !raw.active.every((id) => within(id, 1, 128) && ids.has(id)) ||
    new Set(raw.active).size !== raw.active.length
  )
    return false;
  if (
    raw.mode === "build" &&
    (raw.tick !== 0 ||
      raw.phase !== 0 ||
      raw.broken.length ||
      raw.active.length ||
      raw.bodies.length)
  )
    return false;
  const expected = parts.filter(isDynamic);
  if (raw.mode !== "build" && raw.bodies.length < expected.length) return false;
  const bodyIds = new Set<number>();
  for (const b of raw.bodies) {
    if (
      !record(b) ||
      Object.keys(b).length !== 5 ||
      !within(b.id, 1, 128) ||
      bodyIds.has(b.id) ||
      !lattice(b.x, -1024, WIDTH + 1024) ||
      !lattice(b.y, -1024, HEIGHT + 1024) ||
      !lattice(b.vx, -24, 24) ||
      !lattice(b.vy, -24, 24)
    )
      return false;
    const p = ids.get(b.id);
    if (
      !p ||
      !(isDynamic(p) || (p.kind === "popper" && raw.active.includes(p.id)))
    )
      return false;
    bodyIds.add(b.id);
    const maximum =
      atmosphere(bodyKind(p), raw.air, raw.gravity).terminal / UNIT;
    if (Math.abs(b.vx) > maximum || Math.abs(b.vy) > maximum) return false;
  }
  if (raw.mode !== "build" && !expected.every((p) => bodyIds.has(p.id)))
    return false;
  if (raw.mode === "solved") {
    if (puzzle === FREE_WORKSHOP) return false;
    const spec = getPuzzle(puzzle);
    const state = { tick: raw.tick, active: raw.active, bodies: raw.bodies };
    if (
      spec.objective
        ? evaluateObjective(spec.objective, state) !== "solved"
        : !spec.targets.every((id) => state.active.includes(id))
    )
      return false;
  }
  const fixed = parts.filter((p) => p.fixed),
    undoLinks = raw.undoLinks;
  return raw.undo.every((entry, i) => {
    if (!validParts(entry) || entry.some((p) => p.fixed)) return false;
    const layout = [...fixed, ...entry];
    return (
      validParts(layout) &&
      matchesLayout(layout, puzzle, imported) &&
      validLinks(layout, undoLinks[i])
    );
  });
}
/** One 20 Hz log tick; the original IRQ divisor schedules about 29.59 physics steps per second. */
export function stepMachine(m: Machine): void {
  if (m.mode !== "running") return;
  m.phase += 1193182;
  while (m.phase >= CLOCK_DENOMINATOR) {
    m.phase -= CLOCK_DENOMINATOR;
    stepPhysics(m);
  }
}
