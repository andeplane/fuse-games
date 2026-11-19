/** All distances are centimetres. The simulation advances at 20 Hz. */
export const FIELD = { x: 3600, z: 2200, water: 550, bridge: 260, catwalk: 95 };
export const LANES = [-1170, 1170] as const;
export const TURRETS = [
  { x: -840, z: -1170 },
  { x: 840, z: 1170 },
] as const;
export const FACTORY = 2700,
  GATE = 3150,
  COST = 6,
  MAX_DRONES = 4;
export const teamSign = (team: number) => (team === 0 ? 1 : -1);
export const factoryX = (team: number) => -teamSign(team) * FACTORY;
export const depotZ = (lane: number) => Math.sign(LANES[lane]!) * 300;
export interface Point {
  x: number;
  z: number;
}
export const near = (a: Point, b: Point, r: number) =>
  (a.x - b.x) ** 2 + (a.z - b.z) ** 2 <= r * r;
export function walkable(x: number, z: number, travel: boolean): boolean {
  if (Math.abs(x) > FIELD.x - 70 || Math.abs(z) > FIELD.z - 70) return false;
  return (
    Math.abs(x) >= FIELD.water + 50 ||
    LANES.some((l) => Math.abs(z - l) <= FIELD.bridge - 50) ||
    (!travel && Math.abs(z) <= FIELD.catwalk - 50)
  );
}
export const KEY = {
  up: 1,
  down: 2,
  left: 4,
  right: 8,
  fire: 16,
  shift: 32,
  launch: 64,
  jinkLeft: 128,
  jinkRight: 256,
  lock: 512,
  jump: 1024,
  missile: 2048,
  special: 4096,
  modifier: 8192,
} as const;
export const INPUT_MASK = 16383;
export const HEADINGS = 64;
export const headingAngle = (heading: number) =>
  (heading * 2 * Math.PI) / HEADINGS;
export const JUMP_TICKS = 12;
export const jumpHeight = (remaining: number) =>
  (2.4 * 4 * remaining * (JUMP_TICKS - remaining)) / JUMP_TICKS ** 2;
export const WEAPONS = [
  { bit: KEY.fire, range: 1150, cooldown: 7, damage: 1 },
  { bit: KEY.missile, range: 1500, cooldown: 23, damage: 2 },
  { bit: KEY.special, range: 650, cooldown: 35, damage: 3 },
] as const;
export interface Shot extends Point {
  tick: number;
  fromX: number;
  fromZ: number;
  cooldown: number;
}
export type Team = 0 | 1;
export interface Rig extends Point {
  id: string;
  travel: boolean;
  hp: number;
  respawn: number;
  heading: number;
  jump: number;
  crouched: boolean;
  /** -1 for no target, 0 for the opposing pilot, positive for a convoy id. */
  lock: number;
  shots: Shot[];
  previous: number;
  credits: number;
  launched: number;
  intercepted: number;
  captures: number;
}
export interface Drone extends Point {
  id: number;
  team: Team;
  lane: number;
  waypoint: number;
  hp: number;
}
export interface Turret {
  owner: number;
  cooldown: number;
  beamX: number;
  beamZ: number;
  shotTick: number;
}
export interface World {
  tick: number;
  seed: number;
  rigs: Rig[];
  turrets: Turret[];
  drones: Drone[];
  nextDrone: number;
  winners: Team[];
}
export function createWorld(ids: readonly string[], seed: number): World {
  return {
    tick: 0,
    seed,
    rigs: ids.map((id, t) => ({
      id,
      x: factoryX(t),
      z: 0,
      travel: false,
      hp: 5,
      respawn: 0,
      heading: (t * HEADINGS) / 2,
      jump: 0,
      crouched: false,
      lock: -1,
      shots: WEAPONS.map(() => ({
        x: 0,
        z: 0,
        fromX: 0,
        fromZ: 0,
        tick: 0,
        cooldown: 0,
      })),
      previous: 0,
      credits: 2,
      launched: 0,
      intercepted: 0,
      captures: 0,
    })),
    turrets: TURRETS.map(() => ({
      owner: -1,
      cooldown: 0,
      beamX: 0,
      beamZ: 0,
      shotTick: 0,
    })),
    drones: [],
    nextDrone: 1,
    winners: [],
  };
}
export function laneAtFactory(rig: Point, team: number): number {
  return LANES.findIndex((_, lane) =>
    near(rig, { x: factoryX(team), z: depotZ(lane) }, 240),
  );
}
function moveRig(rig: Rig, bits: number) {
  const turn = Number(!!(bits & KEY.right)) - Number(!!(bits & KEY.left));
  rig.heading = (rig.heading + turn + HEADINGS) % HEADINGS;
  if (rig.travel && bits & KEY.jump) return;
  const drive = Number(!!(bits & KEY.up)) - Number(!!(bits & KEY.down));
  const side =
    Number(!!(bits & KEY.jinkRight)) - Number(!!(bits & KEY.jinkLeft));
  const angle = headingAngle(rig.heading);
  const speed =
    (rig.travel ? 40 : bits & KEY.modifier ? 12 : 25) *
    (drive && side ? Math.SQRT1_2 : 1);
  const dx = Math.round(
    (drive * Math.cos(angle) - side * Math.sin(angle)) * speed,
  );
  const dz = Math.round(
    (drive * Math.sin(angle) + side * Math.cos(angle)) * speed,
  );
  if (walkable(rig.x + dx, rig.z, rig.travel)) rig.x += dx;
  if (walkable(rig.x, rig.z + dz, rig.travel)) rig.z += dz;
}
function enemies(w: World, team: number) {
  const rival = w.rigs[1 - team]!;
  return [
    ...(rival.hp ? [{ id: 0, unit: rival as Rig | Drone }] : []),
    ...w.drones
      .filter((d) => d.team !== team)
      .map((unit) => ({ id: unit.id, unit })),
  ];
}
export function lockedUnit(w: World, team: number) {
  return enemies(w, team).find((e) => e.id === w.rigs[team]!.lock)?.unit;
}
export function route(team: Team, lane: number): Point[] {
  const s = teamSign(team),
    z = LANES[lane]!;
  return [
    { x: -2450 * s, z },
    { x: 2450 * s, z },
    { x: 2850 * s, z: 0 },
    { x: GATE * s, z: 0 },
  ];
}
function advance(drone: Drone): boolean {
  const p = route(drone.team, drone.lane)[drone.waypoint]!;
  const dx = p.x - drone.x,
    dz = p.z - drone.z,
    length = Math.hypot(dx, dz);
  if (length <= 12) {
    drone.x = p.x;
    drone.z = p.z;
    return ++drone.waypoint === 4;
  }
  drone.x += Math.round((12 * dx) / length);
  drone.z += Math.round((12 * dz) / length);
  return false;
}
export function stepWorld(
  w: World,
  inputs: readonly (number | readonly number[])[],
) {
  if (w.winners.length) return;
  w.tick++;
  const hits = new Map<Rig | Drone, number>();
  const hit = (target: Rig | Drone, damage = 1) =>
    hits.set(target, (hits.get(target) ?? 0) + damage);
  const firing: number[] = [],
    cycles: number[] = [];
  for (const [t, r] of w.rigs.entries()) {
    const input = inputs[t] ?? 0,
      samples = typeof input === "number" ? [input] : input;
    let bits = 0,
      motion = 0,
      switches = 0,
      launches = 0,
      locks = 0,
      jumping = false;
    for (const held of samples) {
      const pressed = held & ~r.previous;
      if (pressed & KEY.shift) switches++;
      if (pressed & KEY.launch) launches++;
      if (pressed & KEY.lock) locks++;
      if (pressed & KEY.jump && !(held & KEY.modifier)) jumping = true;
      if (
        held &
        (KEY.up |
          KEY.down |
          KEY.left |
          KEY.right |
          KEY.jinkLeft |
          KEY.jinkRight |
          KEY.jump)
      )
        motion = held;
      bits |= held;
      r.previous = held;
    }
    firing[t] = bits;
    cycles[t] = locks;
    if (w.tick % 60 === 0)
      r.credits = Math.min(
        99,
        r.credits + 1 + w.turrets.filter((v) => v.owner === t).length,
      );
    for (const shot of r.shots) if (shot.cooldown) shot.cooldown--;
    if (r.jump) r.jump--;
    if (r.respawn > 0) {
      if (--r.respawn === 0) {
        r.x = factoryX(t);
        r.z = 0;
        r.hp = 5;
        r.travel = false;
        r.heading = (t * HEADINGS) / 2;
        r.lock = -1;
      }
      continue;
    }
    if (!r.jump && switches % 2 === 1 && walkable(r.x, r.z, !r.travel))
      r.travel = !r.travel;
    if (jumping && !r.travel && !r.jump) r.jump = JUMP_TICKS;
    r.crouched =
      !r.travel &&
      !r.jump &&
      !!(motion & KEY.modifier) &&
      !!(motion & KEY.jump);
    moveRig(r, motion);
    const lane = laneAtFactory(r, t);
    while (
      launches-- > 0 &&
      lane >= 0 &&
      r.credits >= COST &&
      w.drones.filter((d) => d.team === t).length < MAX_DRONES / 2
    ) {
      r.credits -= COST;
      r.launched++;
      w.drones.push({
        id: w.nextDrone++,
        team: t as Team,
        lane,
        x: factoryX(t),
        z: depotZ(lane),
        waypoint: 0,
        hp: 5,
      });
    }
  }
  function target(origin: Point, team: number, radius: number) {
    const enemies: (Rig | Drone)[] = [
      ...w.drones.filter((d) => d.team !== team),
      ...w.rigs.filter((r, t) => t !== team && r.hp > 0),
    ];
    return enemies
      .filter((e) => near(origin, e, radius))
      .sort(
        (a, b) =>
          (a.x - origin.x) ** 2 +
          (a.z - origin.z) ** 2 -
          ((b.x - origin.x) ** 2 + (b.z - origin.z) ** 2),
      )[0];
  }
  for (const [i, p] of TURRETS.entries()) {
    const turret = w.turrets[i]!;
    const touching = w.rigs
      .map((r, t) => (r.hp > 0 && near(r, p, 160) ? t : -1))
      .filter((t) => t >= 0);
    if (touching.length === 1 && turret.owner !== touching[0]) {
      turret.owner = touching[0]!;
      w.rigs[turret.owner]!.captures++;
      turret.cooldown = 16;
    }
    if (turret.cooldown > 0) turret.cooldown--;
    if (turret.owner < 0 || turret.cooldown) continue;
    const e = target(p, turret.owner, 680);
    if (e) {
      hit(e);
      turret.cooldown = 22;
      turret.beamX = e.x;
      turret.beamZ = e.z;
      turret.shotTick = w.tick;
    }
  }
  for (const [t, r] of w.rigs.entries()) {
    if (r.hp === 0) continue;
    const contacts = enemies(w, t).filter((e) => near(r, e.unit, 1650));
    let index = contacts.findIndex((e) => e.id === r.lock);
    if (contacts.length && cycles[t])
      index = (index + cycles[t]!) % contacts.length;
    const locked = contacts[index];
    r.lock = locked?.id ?? -1;
    const angle = headingAngle(r.heading),
      fx = Math.cos(angle),
      fz = Math.sin(angle);
    for (const [i, weapon] of WEAPONS.entries()) {
      const shot = r.shots[i]!;
      if (shot.cooldown || !(firing[t]! & weapon.bit)) continue;
      const ahead = contacts
        .filter(({ unit }) => {
          const dx = unit.x - r.x,
            dz = unit.z - r.z;
          return (
            near(r, unit, weapon.range) &&
            dx * fx + dz * fz >= 0 &&
            Math.abs(dx * fz - dz * fx) <= 85
          );
        })
        .sort(
          (a, b) =>
            Math.hypot(a.unit.x - r.x, a.unit.z - r.z) -
            Math.hypot(b.unit.x - r.x, b.unit.z - r.z),
        );
      const unit =
        locked && near(r, locked.unit, weapon.range)
          ? locked.unit
          : ahead[0]?.unit;
      shot.fromX = r.x;
      shot.fromZ = r.z;
      shot.x = unit?.x ?? Math.round(r.x + fx * weapon.range);
      shot.z = unit?.z ?? Math.round(r.z + fz * weapon.range);
      shot.cooldown = weapon.cooldown;
      shot.tick = w.tick;
      if (
        unit &&
        !(
          "jump" in unit &&
          unit.jump > 2 &&
          unit.jump < JUMP_TICKS - 2 &&
          i === 2
        )
      )
        hit(unit, weapon.damage);
    }
  }
  for (const [target, count] of hits)
    target.hp = Math.max(0, target.hp - count);
  for (const r of w.rigs) if (r.hp === 0 && !r.respawn) r.respawn = 60;
  const surviving: Drone[] = [];
  const scored = new Set<Team>();
  for (const d of w.drones) {
    if (!d.hp) {
      const defender = w.rigs[1 - d.team]!;
      defender.intercepted++;
      defender.credits = Math.min(99, defender.credits + 1);
      continue;
    }
    if (advance(d)) scored.add(d.team);
    else surviving.push(d);
  }
  w.drones = surviving;
  w.winners = ([0, 1] as Team[]).filter((t) => scored.has(t));
}
/** The practice pilot uses the same control bits as a human. It visits a lane post and returns to buy. */
export function botInput(w: World, t: number): number {
  const r = w.rigs[t]!,
    lane = (r.launched + w.seed + t) % 2,
    s = teamSign(t);
  const buy = { x: factoryX(t), z: depotZ(lane) };
  const turret = TURRETS[t]!;
  const enemy = w.drones.find((d) => d.team !== t && d.x * s < -700);
  let goal: Point = buy;
  if (enemy) goal = enemy;
  else if (r.credits < COST && w.turrets[t]!.owner !== t) goal = turret;
  else if (r.credits < COST) goal = { x: -1300 * s, z: LANES[lane]! };
  const dx = goal.x - r.x,
    dz = goal.z - r.z;
  const desired = Math.round((Math.atan2(dz, dx) * HEADINGS) / (2 * Math.PI));
  const delta =
    ((desired - r.heading + HEADINGS * 2.5) % HEADINGS) - HEADINGS / 2;
  const move =
    (delta > 0 ? KEY.right : delta < 0 ? KEY.left : 0) |
    (Math.hypot(dx, dz) > 30 && Math.abs(delta) < 9 ? KEY.up : 0);
  const launch =
    r.credits >= COST &&
    laneAtFactory(r, t) === lane &&
    !(r.previous & KEY.launch);
  return move | KEY.fire | (launch ? KEY.launch : 0);
}
