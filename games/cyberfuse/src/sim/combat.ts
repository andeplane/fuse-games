// SPDX-License-Identifier: GPL-2.0-or-later
// C-Dogs actor and damage rules adapted from Ronny Wester's ACTORS.C and OBJS.C.
import {
  advanceShots,
  burst,
  fireWeapon,
  MAX_SHOTS,
  type Shot,
} from "../ordnance/index.js";
import {
  approaches,
  obstacle,
  overlaps,
  tileX,
  tileY,
  wall,
  wallContact,
} from "./space.js";
import type {
  Actor,
  Control,
  Item,
  MissionState,
  Point,
  Prop,
} from "./types.js";

export function random(s: MissionState): number {
  s.rng = (Math.imul(s.rng, 1103515245) + 12345) >>> 0;
  return (s.rng >>> 16) & 32767;
}
function progress(s: MissionState, index: number | null) {
  if (index === null) return;
  const o = s.objectives[index];
  if (o) o.done = Math.min(o.count, o.done + 1);
}
function injure(s: MissionState, actor: Actor, power: number) {
  actor.hp = Math.max(0, actor.hp - power);
  if (actor.hp === 0 && actor.deathTick < 0) {
    actor.deathTick = s.tick;
    actor.walking = false;
    if (actor.role === "hostage") {
      const objective =
        actor.objectiveIndex === null
          ? undefined
          : s.objectives[actor.objectiveIndex];
      if (objective && objective.required > 0) {
        s.outcome = "defeat";
        s.extraction = 0;
      }
    } else progress(s, actor.objectiveIndex);
  }
}
export function updateActor(s: MissionState, a: Actor) {
  a.lock = Math.max(0, a.lock - 1);
  if (!a.hp) return;
  if (a.poisoned && !(a.poisoned & 7)) injure(s, a, 1);
  a.poisoned = Math.max(0, a.poisoned - 1);
  a.petrified = Math.max(0, a.petrified - 1);
  a.flamed = Math.max(0, a.flamed - 1);
  a.confused = Math.max(0, a.confused - 1);
}
function friendly(a: Actor) {
  return a.seat !== null || !!(a.skill.flags & (1 << 17));
}
function hitActor(
  s: MissionState,
  actor: Actor,
  owner: Actor,
  shot: Pick<Shot, "always" | "special" | "power" | "dx" | "dy">,
) {
  if (owner === actor && !shot.always) return false;
  const flags = actor.skill.flags;
  if (shot.special === "flame" && flags & (1 << 9)) return true;
  if (
    (shot.special === "poison" || shot.special === "confuse") &&
    flags & (1 << 10)
  )
    return true;
  switch (shot.special) {
    case "flame":
      actor.flamed = 10;
      break;
    case "poison":
      if (actor.poisoned < 140) actor.poisoned += 8;
      break;
    case "petrify":
      if (!actor.petrified) actor.petrified = 95;
      break;
    case "confuse":
      actor.confused = 700;
      break;
  }
  actor.slideX += Math.trunc((256 * shot.power * shot.dx) / 25) / 256;
  actor.slideY += Math.trunc((256 * shot.power * shot.dy) / 25) / 256;
  if (flags & (1 << 19)) return true;
  if (
    !shot.always &&
    !(flags & (1 << 22)) &&
    friendly(actor) === friendly(owner) &&
    (s.mode !== "dogfight" || !actor.seat || !owner.seat)
  )
    return true;
  injure(s, actor, shot.power);
  if (actor.hp === 0 && owner.seat) {
    if (friendly(actor) || flags & (1 << 21)) owner.friendlies++;
    else owner.kills++;
  }
  if (owner.seat && !friendly(actor))
    owner.score += (flags & (1 << 21) ? -3 : 1) * shot.power;
  return true;
}
function hitObject(
  s: MissionState,
  object: Item | Prop,
  owner: Actor,
  power: number,
  generated: Shot[],
) {
  const hp = Math.max(0, object.hp - power);
  if (hp > 0) {
    if ("id" in object) object.hp = hp;
    else s.props = s.props.map((p) => (p === object ? { ...p, hp } : p));
    return;
  }
  if ("id" in object) {
    progress(s, object.objectiveIndex);
    if (object.objectiveIndex !== null && owner.seat) owner.score += 50;
    s.items = s.items.filter((i) => i !== object);
  } else s.props = s.props.filter((p) => p !== object);
  const flags = object.objectFlags;
  const kind =
    flags & 1
      ? "explosion"
      : flags & (1 << 12)
        ? "fire"
        : flags & (1 << 13)
          ? "poison"
          : null;
  if (kind)
    generated.unshift(
      ...burst(kind, owner.id, object.x, object.y, () => random(s)),
    );
}
export function tickShots(s: MissionState) {
  const generated: Shot[] = [];
  const owners = new Map(s.actors.map((a) => [a.id, a]));
  s.shots = advanceShots(s.shots, {
    random: () => random(s),
    wall: (x, y) => wall(s, x, y),
    nearActor: (x, y) =>
      s.actors.some(
        (a) =>
          a.hp > 0 &&
          Math.abs(tileX(x) - tileX(a.x)) <= 1 &&
          Math.abs(tileY(y) - tileY(a.y)) <= 1,
      ),
    hit: (shot, x, y) => {
      const owner = owners.get(shot.owner);
      if (!owner) return false;
      const point = { x, y };
      for (const a of s.actors)
        if (
          a.hp > 0 &&
          approaches(shot, point, a) &&
          overlaps(point, a, shot.radiusX + 7, shot.radiusY + 5) &&
          hitActor(s, a, owner, shot)
        )
          return true;
      const item = s.items.find(
        (i) =>
          i.kind === "reactor" &&
          overlaps(point, i, shot.radiusX + 5, shot.radiusY + 4),
      );
      const obj =
        item ??
        s.props.find(
          (p) =>
            p.hp > 0 &&
            !!(p.objectFlags & 4) &&
            overlaps(point, p, shot.radiusX + p.w, shot.radiusY + p.h),
        );
      if (obj) {
        hitObject(s, obj, owner, shot.power, generated);
        return true;
      }
      return false;
    },
  });
  if (generated.length) s.shots = generated.concat(s.shots).slice(0, MAX_SHOTS);
}
function motion(s: MissionState, actor: Actor, proposed: Point) {
  let { x, y } = proposed;
  if (wallContact(s, x, y)) {
    if (wallContact(s, actor.x, y)) y = actor.y;
    if (wallContact(s, x, actor.y)) x = actor.x;
    if (x !== actor.x && y !== actor.y) return;
  }
  const target = obstacle(s, actor, x, y);
  if (target) {
    if (
      actor.seat &&
      "role" in target &&
      target.role === "hostage" &&
      target.escort === null
    ) {
      target.escort = actor.id;
      target.skill = {
        ...target.skill,
        flags: target.skill.flags & ~(1 << 18),
      };
      target.brain = { ...target.brain, sleeping: false };
      progress(s, target.objectiveIndex);
    }
    if (actor.weapon === 0) {
      if ("seat" in target)
        hitActor(s, target, actor, {
          always: false,
          special: "none",
          power: 2,
          dx: 0,
          dy: 0,
        });
      else if (
        target.hp > 0 &&
        !(target.objectFlags & (1 | (1 << 12) | (1 << 13)))
      )
        hitObject(s, target, actor, 2, []);
      return;
    }
    if (obstacle(s, actor, actor.x, y)) y = actor.y;
    if (obstacle(s, actor, x, actor.y)) x = actor.x;
    if ((x !== actor.x && y !== actor.y) || wallContact(s, x, y)) return;
  }
  actor.x = x;
  actor.y = y;
}
const decay = (v: number) =>
  Math.abs(v) < 0.25 ? 0 : v - Math.sign(v) * 0.125;
const DIRS = [
  [7, 0, 1],
  [6, 0, 2],
  [5, 4, 3],
];
export function command(s: MissionState, a: Actor, input: Control) {
  if (!a.hp) return;
  let dx = Math.sign(input.dx),
    dy = Math.sign(input.dy);
  if (a.confused) {
    dx = -dx;
    dy = -dy;
  }
  const direction = !!(dx || dy);
  const released = a.specialHeld && !input.special;
  if (!a.specialHeld && !input.special) a.usedSpecial = false;
  a.specialHeld = input.special;
  a.walking = false;
  if (a.seat && input.special && direction && !a.slideX && !a.slideY) {
    if (!a.petrified) {
      a.slideX = 5 * dx;
      a.slideY = 4 * dy;
    }
    a.usedSpecial = true;
    return;
  }
  if (
    a.seat &&
    released &&
    !a.usedSpecial &&
    !direction &&
    a.inventory.length > 1
  ) {
    a.weapon =
      a.inventory[(a.inventory.indexOf(a.weapon) + 1) % a.inventory.length]!;
    return;
  }
  const p = { x: a.x + a.slideX, y: a.y + a.slideY };
  a.slideX = decay(a.slideX);
  a.slideY = decay(a.slideY);
  if (!a.petrified) {
    if (direction) a.dir = DIRS[dy + 1]![dx + 1]!;
    if (input.fire) {
      if (!a.lock && a.weapon !== 0) {
        const fired = fireWeapon(a.weapon, a.id, a.x, a.y, a.dir, () =>
          random(s),
        );
        a.lock = fired.lock;
        a.lastShot = s.tick;
        if (a.seat) a.score -= fired.cost;
        s.shots = fired.shots.concat(s.shots).slice(0, MAX_SHOTS);
      }
    } else if (direction) {
      p.x += (dx * a.speed) / 256;
      p.y += (dy * a.speed) / 256;
      a.walking = true;
    }
  }
  if (p.x !== a.x || p.y !== a.y) motion(s, a, p);
}
export function collect(s: MissionState, a: Actor) {
  for (const key of s.keys)
    if (overlaps(a, key, 12, 8)) {
      if (!s.keyring.includes(key.color)) s.keyring.push(key.color);
      s.keys = s.keys.filter((k) => k !== key);
    }
  for (const item of s.items)
    if (overlaps(a, item, 12, 9)) {
      if (item.kind === "core" || item.kind === "medkit") {
        if (item.kind === "medkit" && a.hp === a.maxHp) continue;
        if (item.kind === "core") a.score += 10;
        else a.hp = Math.min(a.maxHp, a.hp + 50);
        progress(s, item.objectiveIndex);
        s.items = s.items.filter((i) => i !== item);
      }
    }
}
