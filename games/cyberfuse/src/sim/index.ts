// SPDX-License-Identifier: GPL-2.0-or-later
// C-Dogs DOS 1.06 simulation adapter. Reference provenance is in docs/design/cyberfuse-reference.md.
import { botControls, chooseEnemyControl, createBrain } from "../ai/index.js";
import { defaultLoadout, DOGFIGHTS, getMission } from "../campaign/index.js";
import { buildMission } from "../maps/index.js";
import { collect, command, random, tickShots, updateActor } from "./combat.js";
import {
  canStand,
  nearest,
  reveal,
  tileAt,
  tileX,
  tileY,
  updateDoors,
  visibleTile,
  wallContact,
} from "./space.js";
import {
  EXTRACTION_TICKS,
  REST,
  TILE_WIDTH as W,
  TILE_HEIGHT as H,
  type Actor,
  type Control,
  type MissionOptions,
  type MissionState,
  type Mode,
  type Objective,
  type Point,
  type Role,
} from "./types.js";
export * from "./types.js";
export { MISSION_COUNT } from "../campaign/index.js";
export { isMissionState } from "./validate.js";
export { visibleTile } from "./space.js";
export const botControl = botControls;
const center = (p: Point) => ({ x: p.x * W + W / 2, y: p.y * H + H / 2 });
const exitObjective = (): Objective => ({
  kind: "collect",
  description: "Reach extraction",
  count: 0,
  required: 0,
  done: 0,
  flags: 0,
});

function actor(
  id: string,
  seat: string | null,
  role: Role,
  p: Point,
  inventory: number[],
  hp: number,
): Actor {
  return {
    ...center(p),
    id,
    seat,
    role,
    dir: 4,
    inventory,
    weapon: inventory[0]!,
    hp,
    maxHp: hp,
    lock: 0,
    slideX: 0,
    slideY: 0,
    specialHeld: false,
    usedSpecial: false,
    walking: false,
    lastShot: -1,
    deathTick: -1,
    score: 0,
    speed: 256,
    skill: { move: 0, track: 0, shoot: 0, delay: 0, flags: 0 },
    brain: createBrain(false),
    objectiveIndex: null,
    characterIndex: 0,
    flamed: 0,
    poisoned: 0,
    confused: 0,
    petrified: 0,
  };
}
export function createMission(
  seed: number,
  seats: readonly string[],
  mode: Mode = "campaign",
  mission = 0,
  options: MissionOptions = {},
): MissionState {
  if (
    seats.length < 1 ||
    seats.length > 5 ||
    new Set(seats).size !== seats.length ||
    seats.some((seat) => typeof seat !== "string" || !seat || seat.length > 128)
  )
    throw new RangeError("Cyberfuse requires one to five distinct seats");
  const world = buildMission(
    mission,
    seed >>> 0,
    mode === "dogfight",
    options.campaign,
  );
  const spec =
    mode === "dogfight"
      ? DOGFIGHTS[mission]!
      : getMission(mission, options.campaign);
  const actors = seats.map((seat, i) => {
    const supplied = options.loadouts?.[seat];
    const valid = Array.isArray(supplied)
      ? [...new Set(supplied)]
          .filter((w) => spec.allowedWeapons.includes(w))
          .slice(0, 3)
      : [];
    return actor(
      "player-" + i,
      seat,
      "player",
      world.spawns[i]!,
      valid.length ? valid : defaultLoadout(i, spec),
      mode === "dogfight" ? 500 : 200,
    );
  });
  const objectives: Objective[] =
    mode === "dogfight"
      ? [
          {
            kind: "dogfight",
            description: "Be the last operative standing",
            count: 1,
            required: 1,
            done: 0,
            flags: 0,
          },
        ]
      : world.objectives.map((o) => ({ ...o, done: 0 }));
  const s: MissionState = {
    mode,
    mission,
    campaign: options.campaign ?? -1,
    seed: seed >>> 0,
    rng: seed >>> 0,
    tick: 0,
    width: world.tiles[0]!.length,
    height: world.tiles.length,
    tiles: [...world.tiles],
    decor: [...world.decor],
    props: world.props.map((p) => ({
      x: p.pixelX,
      y: p.pixelY,
      kind: p.kind,
      objectIndex: p.objectIndex,
      hp: p.hp,
      impassable: p.impassable,
      w: p.w,
      h: p.h,
      objectFlags: p.objectFlags,
    })),
    seen: world.tiles.map((row) => "0".repeat(row.length)),
    seenCount: 0,
    surveyArea: world.width * world.height,
    actors,
    shots: [],
    items: world.items.map((p, i) => ({
      x: p.pixelX ?? center(p).x,
      y: p.pixelY ?? center(p).y,
      id: "item-" + i,
      kind: p.kind,
      hp: p.hp,
      objectiveIndex: p.objectiveIndex ?? null,
      sprite: p.sprite,
      objectFlags: p.objectFlags,
      solid: p.solid,
      escort: null,
    })),
    keyring: [],
    doors: world.doors.map((p) => ({ ...p, timer: 0 })),
    keys: world.keys.map((k) => ({ ...center(k), color: k.color })),
    objectives,
    objective: objectives[0] ?? exitObjective(),
    extraction: 0,
    outcome: "playing",
    winners: [],
  };
  if (mode === "campaign")
    for (const [i, e] of world.enemies.entries()) {
      const a = actor(
        "enemy-" + i,
        null,
        e.role,
        e,
        [e.weapon],
        Math.max(1, e.hp),
      );
      a.characterIndex = e.characterIndex;
      a.speed = e.speed;
      a.objectiveIndex = e.objectiveIndex ?? null;
      a.skill = {
        move: e.move,
        track: e.track,
        shoot: e.shoot,
        delay: e.delay,
        flags: e.flags,
      };
      a.brain = createBrain(
        !(e.flags & (1 << 25)) &&
          (!!(e.flags & (1 << 24)) || random(s) % 100 >= i + mission * 4),
      );
      a.dir = random(s) % 8;
      s.actors.push(a);
    }
  for (const a of s.actors) if (a.seat) reveal(s, a);
  return s;
}
function nextFrame(s: MissionState): MissionState {
  return {
    ...s,
    tick: s.tick + 1,
    tiles: [...s.tiles],
    seen: [...s.seen],
    actors: s.actors.map((a) => ({ ...a })),
    items: s.items.map((i) => ({ ...i })),
    props: s.props.map((p) => ({ ...p })),
    doors: s.doors.map((d) => ({ ...d })),
    keyring: [...s.keyring],
    objectives: s.objectives.map((o) => ({ ...o })),
  };
}
function finish(s: MissionState, players: Actor[]) {
  if (!players.length) {
    s.outcome = "defeat";
    s.winners = [];
    return;
  }
  if (s.mode === "dogfight") {
    if (players.length === 1) {
      s.objectives[0]!.done = 1;
      s.extraction++;
    } else s.extraction = 0;
  } else {
    for (const o of s.objectives)
      if (o.kind === "investigate")
        o.done = Math.min(100, Math.floor((100 * s.seenCount) / s.surveyArea));
    const ready =
      s.objectives.every((o) => o.done >= o.required) &&
      players.every((a) => tileAt(s, a.x, a.y) === "E") &&
      s.items.every(
        (item) => item.escort === null || tileAt(s, item.x, item.y) === "E",
      );
    s.extraction = ready ? s.extraction + 1 : 0;
  }
  s.objective =
    s.objectives.find((o) => o.done < o.required) ??
    s.objectives[0] ??
    exitObjective();
  if (s.extraction >= EXTRACTION_TICKS) {
    s.outcome = "victory";
    s.winners = players.map((a) => a.seat!);
  }
}
function escort(s: MissionState, players: Actor[]) {
  for (const item of s.items) {
    if (item.escort === null) continue;
    const rider =
      players.find((a) => a.id === item.escort) ?? nearest(item, players);
    if (!rider) continue;
    item.escort = rider.id;
    if (Math.abs(rider.x - item.x) < 5 && Math.abs(rider.y - item.y) < 5)
      continue;
    const dx = Math.sign(rider.x - item.x),
      dy = Math.sign(rider.y - item.y);
    if (!wallContact(s, item.x + dx, item.y)) item.x += dx;
    if (!wallContact(s, item.x, item.y + dy)) item.y += dy;
  }
}
export function stepMission(
  previous: MissionState,
  controls: Readonly<Record<string, Control>>,
): MissionState {
  if (previous.outcome !== "playing") return previous;
  const s = nextFrame(previous);
  const players = s.actors.filter((a) => a.seat !== null && a.hp > 0);
  finish(s, players);
  if (s.outcome !== "playing") return s;
  for (const a of s.actors) updateActor(s, a);
  tickShots(s);
  const doorsChanged = updateDoors(s);
  for (const a of players) {
    if (!a.hp) continue;
    const oldX = tileX(a.x),
      oldY = tileY(a.y);
    const c = Object.hasOwn(controls, a.seat!) ? controls[a.seat!]! : REST;
    command(s, a, c);
    collect(s, a);
    if (doorsChanged || oldX !== tileX(a.x) || oldY !== tileY(a.y))
      reveal(s, a);
  }
  const targets = players
    .filter((a) => a.hp > 0)
    .map((a) => ({
      x: a.x,
      y: a.y,
      hp: a.hp,
      fire: Object.hasOwn(controls, a.seat!) && !!controls[a.seat!]?.fire,
    }));
  const goodGuysPresent = s.actors.some(
    (a) =>
      !a.seat &&
      !!(a.skill.flags & ((1 << 17) | (1 << 22))) &&
      !(a.skill.flags & (1 << 18)),
  );
  for (const a of s.actors)
    if (!a.seat && a.hp) {
      const visible = targets.some((p) =>
        visibleTile(s, p, tileX(a.x), tileY(a.y)),
      );
      const next = chooseEnemyControl(a, targets, a.skill, {
        visible,
        goodGuysPresent,
        canStand: (x, y) => canStand(s, a, x, y),
        random: () => random(s),
      });
      a.brain = next.brain;
      a.dir = next.dir;
      a.lock = next.lock;
      command(s, a, next.control);
    }
  escort(
    s,
    players.filter((a) => a.hp > 0),
  );
  return s;
}
