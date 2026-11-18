// SPDX-License-Identifier: GPL-2.0-or-later
// C-Dogs DOS 1.06 simulation adapter. Reference provenance is in docs/design/cyberfuse-reference.md.
import { botControls, chooseEnemyControl, createBrain } from "../ai/index.js";
import {
  defaultLoadout,
  DOGFIGHTS,
  getCampaignForMission,
  getMission,
  type Character,
} from "../campaign/index.js";
import { buildMission } from "../maps/index.js";
import {
  DEFAULT_GAMEPLAY,
  parseGameplayOptions,
  scaledHp,
  enemyCount,
} from "../options/index.js";
import { collect, command, random, tickShots, updateActor } from "./combat.js";
import {
  canStand,
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
const DEATH_TICKS = 37;
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
    ...p,
    id,
    seat,
    role,
    escort: null,
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
    kills: 0,
    friendlies: 0,
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
  const gameplay = parseGameplayOptions(
    options.gameplay === undefined ? DEFAULT_GAMEPLAY : options.gameplay,
  );
  if (!gameplay) throw new RangeError("Invalid Cyberfuse gameplay settings");
  const world = buildMission(
    mission,
    seed >>> 0,
    mode === "dogfight",
    options.campaign,
    0,
    seats.length,
    gameplay.density,
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
      { x: world.spawns[i]!.pixelX, y: world.spawns[i]!.pixelY },
      valid.length ? valid : defaultLoadout(i, spec),
      mode === "dogfight" ? 500 : scaledHp(200, gameplay.playerHp),
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
    gameplay,
    mode,
    mission,
    campaign: options.campaign ?? -1,
    seed: seed >>> 0,
    rng: seed >>> 0,
    tick: 0,
    nextEnemy: 0,
    goodGuysPresent: false,
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
    items: world.items
      .filter((p) => p.kind !== "hostage")
      .map((p, i) => ({
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
      const a = spawnEnemy(
        s,
        e.characterIndex,
        e,
        { x: e.pixelX, y: e.pixelY },
        i + mission * 4,
      );
      a.objectiveIndex = e.objectiveIndex ?? null;
    }
  const prisoner = world.items.find((p) => p.kind === "hostage");
  if (prisoner && mode === "campaign") {
    const index = spec.objectives[prisoner.objectiveIndex]!.index;
    const c = getCampaignForMission(mission, options.campaign).characters[
      index
    ]!;
    const a = spawnEnemy(
      s,
      index,
      c,
      { x: prisoner.pixelX, y: prisoner.pixelY },
      0,
      true,
    );
    a.objectiveIndex = prisoner.objectiveIndex;
  }
  for (const a of s.actors) if (a.seat) reveal(s, a);
  return s;
}
function spawnEnemy(
  s: MissionState,
  index: number,
  c: Character,
  p: Point,
  wakeChance: number,
  prisoner = false,
): Actor {
  const a = actor(
    prisoner ? "prisoner-0" : "enemy-" + s.nextEnemy++,
    null,
    prisoner
      ? "hostage"
      : c.hp >= 100
        ? "heavy"
        : c.speed > 256
          ? "scout"
          : "guard",
    p,
    [c.gun],
    prisoner && s.doors.some((d) => d.key !== null)
      ? Math.max(1, c.hp)
      : scaledHp(c.hp, s.gameplay.npcHp),
  );
  a.speed = c.speed;
  a.skill = {
    move: c.move,
    track: c.track,
    shoot: c.shoot,
    delay: c.delay,
    flags: c.flags,
  };
  a.characterIndex = index;
  a.brain = createBrain(
    !(c.flags & (1 << 25)) &&
      (!!(c.flags & (1 << 24)) || random(s) % 100 >= wakeChance),
  );
  s.actors.push(a);
  return a;
}
function replenish(s: MissionState, players: Actor[]) {
  if (s.mode !== "campaign") return;
  const campaign = s.campaign < 0 ? undefined : s.campaign;
  const m = getMission(s.mission, campaign);
  // Corpses still occupy an AI slot throughout the nine death frames.
  const present = s.actors.filter(
    (a) =>
      !a.seat &&
      !(a.skill.flags & (1 << 18)) &&
      (a.hp > 0 || s.tick - a.deathTick < DEATH_TICKS),
  );
  const owners = new Set(s.shots.map((v) => v.owner));
  s.actors = s.actors.filter(
    (a) =>
      a.seat !== null ||
      a.hp > 0 ||
      s.tick - a.deathTick < DEATH_TICKS ||
      owners.has(a.id),
  );
  if (
    !m.enemies.length ||
    m.enemyDensity === 0 ||
    present.length >= enemyCount(m.enemyDensity, s.gameplay.density) ||
    s.actors.length >= 256
  )
    return;
  const index = m.enemies[random(s) % m.enemies.length]!;
  const c = getCampaignForMission(s.mission, campaign).characters[index];
  if (!c) return;
  // A crowded or malformed checkpoint can never stall the simulation on placement.
  for (let i = 0; i < 256; i++) {
    const p = { x: random(s) % (s.width * W), y: random(s) % (s.height * H) };
    if (
      players.some(
        (a) => Math.max(Math.abs(a.x - p.x), Math.abs(a.y - p.y)) < 150,
      ) ||
      wallContact(s, p.x, p.y) ||
      s.actors.some(
        (a) => a.hp > 0 && Math.abs(a.x - p.x) < 14 && Math.abs(a.y - p.y) < 10,
      ) ||
      s.props.some(
        (o) =>
          o.impassable &&
          Math.abs(o.x - p.x) < o.w + 7 &&
          Math.abs(o.y - p.y) < o.h + 5,
      ) ||
      s.items.some(
        (o) => o.solid && Math.abs(o.x - p.x) < 12 && Math.abs(o.y - p.y) < 9,
      )
    )
      continue;
    spawnEnemy(
      s,
      index,
      c,
      p,
      Math.max(
        0,
        s.nextEnemy -
          s.objectives.reduce(
            (v, o) => v + (o.kind === "kill" ? o.count : 0),
            0,
          ),
      ) +
        s.mission * 4,
    );
    return;
  }
}
function nextFrame(s: MissionState): MissionState {
  return {
    ...s,
    tick: s.tick + 1,
    tiles: [...s.tiles],
    seen: [...s.seen],
    actors: s.actors.map((a) => ({ ...a })),
    items: s.items.map((i) => ({ ...i })),
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
      s.actors.every(
        (a) =>
          a.role !== "hostage" || a.hp === 0 || tileAt(s, a.x, a.y) === "E",
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
  s.goodGuysPresent ||= s.actors.some(
    (a) =>
      !a.seat &&
      !!(a.skill.flags & ((1 << 17) | (1 << 22))) &&
      !(a.skill.flags & (1 << 18)),
  );
  // AddActor links new characters at the head, so the latest NPC decides first.
  for (let index = s.actors.length - 1; index >= 0; index--) {
    const a = s.actors[index]!;
    if (!a.seat && a.hp) {
      const visible = targets.some((p) =>
        visibleTile(s, p, tileX(a.x), tileY(a.y)),
      );
      const next = chooseEnemyControl(a, targets, a.skill, {
        visible,
        goodGuysPresent: s.goodGuysPresent,
        difficulty: s.gameplay.difficulty,
        canStand: (x, y) => canStand(s, a, x, y),
        random: () => random(s),
      });
      a.brain = next.brain;
      a.dir = next.dir;
      a.lock = next.lock;
      command(s, a, next.control);
    }
  }
  replenish(
    s,
    players.filter((a) => a.hp > 0),
  );
  return s;
}
