import { uint32 } from "fuse-netcode";
import {
  FIELD,
  HEADINGS,
  INPUT_MASK,
  JUMP_TICKS,
  MAX_DRONES,
  TURRETS,
  WEAPONS,
  walkable,
  type World,
} from "./canal.js";
import { playerKey } from "./names.js";
const rec = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const int = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
const coords = (p: Record<string, unknown>) =>
  int(p.x, -FIELD.x, FIELD.x) && int(p.z, -FIELD.z, FIELD.z);
const beam = (v: Record<string, unknown>, tick: number) =>
  int(v.beamX, -FIELD.x, FIELD.x) &&
  int(v.beamZ, -FIELD.z, FIELD.z) &&
  int(v.shotTick, 0, tick);
const keys = (v: Record<string, unknown>, fields: string) =>
  Object.keys(v).length === fields.split(" ").length &&
  fields.split(" ").every((k) => Object.hasOwn(v, k));
export function decodeWorld(v: unknown): World | undefined {
  if (
    !rec(v) ||
    !keys(v, "tick seed rigs turrets drones nextDrone winners") ||
    !uint32(v.tick) ||
    !uint32(v.seed) ||
    !uint32(v.nextDrone) ||
    v.nextDrone < 1 ||
    !Array.isArray(v.rigs) ||
    v.rigs.length !== 2 ||
    !Array.isArray(v.turrets) ||
    v.turrets.length !== TURRETS.length ||
    !Array.isArray(v.drones) ||
    v.drones.length > MAX_DRONES ||
    !Array.isArray(v.winners) ||
    v.winners.length > 2
  )
    return;
  const tick = v.tick;
  if (
    !v.rigs.every(
      (r: unknown) =>
        rec(r) &&
        keys(
          r,
          "id x z travel hp respawn heading jump crouched lock shots previous credits launched intercepted captures",
        ) &&
        playerKey(r.id) &&
        int(r.x, -FIELD.x, FIELD.x) &&
        int(r.z, -FIELD.z, FIELD.z) &&
        typeof r.travel === "boolean" &&
        walkable(r.x, r.z, r.travel) &&
        int(r.hp, 0, 5) &&
        int(r.respawn, 0, 60) &&
        (r.hp === 0) === r.respawn > 0 &&
        int(r.heading, 0, HEADINGS - 1) &&
        int(r.jump, 0, JUMP_TICKS) &&
        typeof r.crouched === "boolean" &&
        (!r.travel || (!r.jump && !r.crouched)) &&
        int(r.lock, -1, Number(v.nextDrone) - 1) &&
        Array.isArray(r.shots) &&
        r.shots.length === WEAPONS.length &&
        r.shots.every((s: unknown, i: number) => {
          const weapon = WEAPONS[i]!;
          return (
            rec(s) &&
            keys(s, "x z fromX fromZ cooldown tick") &&
            int(s.fromX, -FIELD.x, FIELD.x) &&
            int(s.fromZ, -FIELD.z, FIELD.z) &&
            int(s.x, -FIELD.x - weapon.range, FIELD.x + weapon.range) &&
            int(s.z, -FIELD.z - weapon.range, FIELD.z + weapon.range) &&
            int(s.cooldown, 0, weapon.cooldown) &&
            int(s.tick, 0, tick)
          );
        }) &&
        int(r.previous, 0, INPUT_MASK) &&
        int(r.credits, 0, 99) &&
        int(r.launched, 0, tick) &&
        int(r.intercepted, 0, tick * 2) &&
        int(r.captures, 0, tick * 2),
    )
  )
    return;
  if (
    !v.turrets.every(
      (t: unknown) =>
        rec(t) &&
        keys(t, "owner cooldown beamX beamZ shotTick") &&
        int(t.owner, -1, 1) &&
        int(t.cooldown, 0, 22) &&
        beam(t, tick),
    )
  )
    return;
  let prev = 0;
  const live = [0, 0];
  for (const d of v.drones as unknown[]) {
    if (
      !rec(d) ||
      !keys(d, "id team lane x z waypoint hp") ||
      !int(d.id, prev + 1, v.nextDrone - 1) ||
      !int(d.team, 0, 1) ||
      !int(d.lane, 0, 1) ||
      !int(d.waypoint, 0, 3) ||
      !int(d.hp, 1, 5) ||
      !coords(d)
    )
      return;
    live[d.team] = (live[d.team] ?? 0) + 1;
    if (live[d.team]! > MAX_DRONES / 2) return;
    prev = d.id;
  }
  if (
    !v.winners.every(
      (t: unknown, i: number) =>
        int(t, 0, 1) &&
        (i === 0 ||
          (t === 1 && v.winners instanceof Array && v.winners[0] === 0)),
    )
  )
    return;
  return structuredClone(v) as unknown as World;
}
