import { isBrain } from "../ai/index.js";
import { parseGameplayOptions } from "../options/index.js";
import { CAMPAIGNS, DOGFIGHTS, MISSION_COUNT } from "../campaign/index.js";
import { isShot, MAX_SHOTS } from "../ordnance/index.js";
import type { Actor, Item, MissionState, Objective, Prop } from "./types.js";

type RecordValue = Record<string, unknown>;
const record = (v: unknown): v is RecordValue =>
  !!v && typeof v === "object" && !Array.isArray(v);
const integer = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const fixed = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(256 * v) && v >= min && v <= max;
const text = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.length <= max;
const option = (v: unknown, values: readonly string[]) =>
  typeof v === "string" && values.includes(v);
const array = (v: unknown, n: number): v is unknown[] =>
  Array.isArray(v) && v.length <= n;
const distinct = (values: readonly unknown[]) =>
  new Set(values).size === values.length;
const color = (v: unknown) => option(v, ["red", "blue", "yellow", "green"]);
const flag = (x: unknown) => typeof x === "boolean";
const keys = (v: RecordValue, allowed: string) =>
  Object.keys(v).every((k) => allowed.split(" ").includes(k));
const pos = (v: RecordValue) =>
  fixed(v.x, 0, 1023.99609375) && fixed(v.y, 0, 767.99609375);
const idx = (v: unknown, n: number) => v === null || integer(v, 0, n - 1);
const weapon = (v: unknown) => integer(v, 0, 15);
function actor(a: unknown, tick: number, n: number): a is Actor {
  if (
    !record(a) ||
    !keys(
      a,
      "id seat role escort dir hp maxHp inventory weapon lock slideX slideY specialHeld usedSpecial walking lastShot deathTick score kills friendlies speed skill brain objectiveIndex characterIndex flamed poisoned petrified confused x y",
    )
  )
    return false;
  const skill = a.skill;
  return (
    pos(a) &&
    text(a.id, 32) &&
    /^(player|enemy|prisoner)-[0-9]{1,10}$/.test(a.id) &&
    (a.seat === null
      ? option(a.role, ["guard", "heavy", "scout", "hostage"])
      : text(a.seat, 128) && a.seat.length > 0 && a.role === "player") &&
    integer(a.dir, 0, 7) &&
    (a.escort === null || (a.role === "hostage" && text(a.escort, 32))) &&
    integer(a.maxHp, 1, 10000) &&
    integer(a.hp, 0, a.maxHp) &&
    array(a.inventory, 3) &&
    a.inventory.length > 0 &&
    a.inventory.every(weapon) &&
    distinct(a.inventory) &&
    integer(a.weapon, 0, 15) &&
    a.inventory.includes(a.weapon) &&
    integer(a.lock, 0, 1000) &&
    fixed(a.slideX, -4096, 4096) &&
    fixed(a.slideY, -4096, 4096) &&
    flag(a.specialHeld) &&
    flag(a.usedSpecial) &&
    flag(a.walking) &&
    integer(a.lastShot, -1, tick) &&
    integer(a.deathTick, -1, tick) &&
    (a.hp === 0) === (a.deathTick !== -1) &&
    integer(a.score, -0x7fffffff, 0x7fffffff) &&
    integer(a.kills, 0, 0x7fffffff) &&
    integer(a.friendlies, 0, 0x7fffffff) &&
    integer(a.speed, 1, 2048) &&
    record(skill) &&
    keys(skill, "move track shoot delay flags") &&
    integer(skill.move, 0, 100) &&
    integer(skill.track, 0, 100) &&
    integer(skill.shoot, 0, 100) &&
    integer(skill.delay, 0, 65535) &&
    integer(skill.flags, 0, 0x7fffffff) &&
    isBrain(a.brain) &&
    idx(a.objectiveIndex, n) &&
    integer(a.characterIndex, 0, 255) &&
    integer(a.flamed, 0, 10) &&
    integer(a.poisoned, 0, 147) &&
    integer(a.petrified, 0, 95) &&
    integer(a.confused, 0, 700)
  );
}
function objective(o: unknown): o is Objective {
  return (
    record(o) &&
    keys(o, "kind description flags index required count done") &&
    option(o.kind, [
      "kill",
      "collect",
      "destroy",
      "rescue",
      "investigate",
      "dogfight",
    ]) &&
    text(o.description, 500) &&
    integer(o.count, 0, 4096) &&
    integer(o.required, 0, 4096) &&
    integer(o.done, 0, 4096) &&
    integer(o.flags, 0, 65535) &&
    (o.index === undefined || integer(o.index, 0, 255))
  );
}
function item(i: unknown, n: number, actors: readonly Actor[]): i is Item {
  return (
    record(i) &&
    keys(i, "x y id kind hp objectiveIndex sprite escort objectFlags solid") &&
    pos(i) &&
    text(i.id, 32) &&
    option(i.kind, ["core", "reactor", "medkit", "hostage"]) &&
    integer(i.hp, 0, 10000) &&
    idx(i.objectiveIndex, n) &&
    integer(i.sprite, -1, 1024) &&
    (i.escort === null ||
      (i.kind === "hostage" &&
        actors.some((a) => a.seat !== null && a.id === i.escort))) &&
    integer(i.objectFlags, 0, 65535) &&
    flag(i.solid)
  );
}
function prop(p: unknown): p is Prop {
  return (
    record(p) &&
    keys(p, "x y kind objectIndex hp impassable w h objectFlags") &&
    pos(p) &&
    text(p.kind, 64) &&
    integer(p.objectIndex, 0, 255) &&
    integer(p.hp, 0, 10000) &&
    flag(p.impassable) &&
    integer(p.w, 0, 64) &&
    integer(p.h, 0, 64) &&
    integer(p.objectFlags, 0, 65535)
  );
}
const rows = (v: unknown, chars: RegExp): v is string[] =>
  array(v, 64) &&
  v.length === 64 &&
  v.every(
    (row) => typeof row === "string" && row.length === 64 && chars.test(row),
  );
export function isMissionState(s: unknown): s is MissionState {
  if (
    !record(s) ||
    !keys(
      s,
      "mode campaign mission seed rng tick nextEnemy goodGuysPresent gameplay width height tiles decor props seen seenCount surveyArea actors shots items doors keys keyring objectives objective extraction outcome winners",
    )
  )
    return false;
  if (
    !option(s.mode, ["campaign", "dogfight"]) ||
    !parseGameplayOptions(s.gameplay) ||
    !integer(s.campaign, -1, CAMPAIGNS.length - 1) ||
    !integer(
      s.mission,
      0,
      s.mode === "dogfight"
        ? DOGFIGHTS.length - 1
        : s.campaign < 0
          ? MISSION_COUNT - 1
          : CAMPAIGNS[s.campaign]!.missions.length - 1,
    ) ||
    !integer(s.seed, 0, 0xffffffff) ||
    !integer(s.rng, 0, 0xffffffff) ||
    !integer(s.tick, 0, 0x7fffffff) ||
    !integer(s.nextEnemy, 0, s.tick + 256) ||
    !flag(s.goodGuysPresent) ||
    s.width !== 64 ||
    s.height !== 64 ||
    !rows(s.tiles, /^[#.ED+]+$/) ||
    !rows(s.decor, /^[ .12rd]+$/) ||
    !rows(s.seen, /^[01]+$/) ||
    !integer(s.surveyArea, 1, 4096) ||
    !integer(s.seenCount, 0, 4096)
  )
    return false;
  if (
    s.seen.reduce((sum, row) => sum + row.split("1").length - 1, 0) !==
    s.seenCount
  )
    return false;
  const os = s.objectives;
  if (
    !array(os, 16) ||
    !os.every(objective) ||
    !objective(s.objective) ||
    !array(s.actors, 256)
  )
    return false;
  const actors = s.actors;
  const tick = s.tick;
  if (
    !actors.every((v): v is Actor => actor(v, tick, os.length)) ||
    !distinct(actors.map((a) => a.id))
  )
    return false;
  const players = actors.filter((a) => a.seat !== null);
  const nextEnemy = s.nextEnemy;
  if (
    actors.some((a) =>
      a.role === "hostage"
        ? a.id !== "prisoner-0" ||
          a.objectiveIndex === null ||
          os[a.objectiveIndex]?.kind !== "rescue" ||
          (a.escort === null) !== !!(a.skill.flags & (1 << 18)) ||
          (a.escort !== null && !players.some((p) => p.id === a.escort))
        : a.seat === null
          ? !a.id.startsWith("enemy-") || Number(a.id.slice(6)) >= nextEnemy
          : !a.id.startsWith("player-"),
    )
  )
    return false;
  if (
    !players.length ||
    players.length > 5 ||
    !distinct(players.map((a) => a.seat))
  )
    return false;
  const ids = new Set(actors.map((a) => a.id));
  if (
    !array(s.shots, MAX_SHOTS) ||
    !s.shots.every(
      (v) =>
        isShot(v) &&
        record(v) &&
        keys(
          v,
          "weapon owner kind x y dx dy z dz age range power radiusX radiusY frame always special",
        ) &&
        ids.has(v.owner),
    )
  )
    return false;
  if (
    !array(s.items, 1024) ||
    !s.items.every((v): v is Item => item(v, os.length, actors)) ||
    !distinct(s.items.map((i) => i.id)) ||
    !array(s.props, 4096) ||
    !s.props.every(prop) ||
    !array(s.keys, 4) ||
    !s.keys.every(
      (k) => record(k) && keys(k, "x y color") && pos(k) && color(k.color),
    ) ||
    !array(s.keyring, 4) ||
    !s.keyring.every(color) ||
    !distinct(s.keyring) ||
    !array(s.doors, 512)
  )
    return false;
  const terrain = s.tiles;
  if (
    !s.doors.every(
      (d) =>
        record(d) &&
        keys(d, "x y key timer horizontal") &&
        flag(d.horizontal) &&
        integer(d.x, 0, 63) &&
        integer(d.y, 0, 63) &&
        (d.key === null || color(d.key)) &&
        integer(d.timer, 0, 30) &&
        terrain[d.y]![d.x] === (d.timer ? "+" : "D"),
    )
  )
    return false;
  if (
    !integer(s.extraction, 0, 350) ||
    !option(s.outcome, ["playing", "victory", "defeat"]) ||
    !array(s.winners, 5) ||
    !distinct(s.winners) ||
    !s.winners.every((w) => players.some((a) => a.seat === w && a.hp > 0))
  )
    return false;
  return s.outcome === "victory"
    ? s.extraction === 350 && s.winners.length > 0
    : s.winners.length === 0;
}
