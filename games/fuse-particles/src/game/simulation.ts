export const MAPS = [
  "random",
  "maze",
  "hourglass",
  "lanes",
  "islands",
  "rooms",
  "fortress",
] as const;
export type MapId = (typeof MAPS)[number];
export const UPGRADES = [
  "health",
  "attack",
  "radius",
  "spawnRate",
  "speed",
  "maxParticles",
  "defense",
  "interestRate",
] as const;
export type UpgradeId = (typeof UPGRADES)[number];
export type TowerKind = "laser" | "weakness";
export const PATHS = [
  "territory_income",
  "territory_income_rate",
  "tower_regen",
  "tower_range",
  "laser_bounce",
  "laser_overcharge",
  "weakness_slow",
  "weakness_stun",
] as const;
export type ResearchPath = (typeof PATHS)[number];
export type BattleAction =
  | { type: "upgrade"; upgrade: UpgradeId }
  | { type: "research"; tower: TowerKind }
  | { type: "build"; tower: TowerKind; site: number }
  | { type: "tower"; site: number }
  | { type: "path"; path: ResearchPath }
  | { type: "nuke" };
type Levels = Record<UpgradeId, number>;
interface Point {
  x: number;
  y: number;
}
interface Job {
  action: BattleAction;
  ready: number;
}
interface Core extends Point {
  hp: number;
  gold: number;
  kills: number;
  bot: boolean;
  upgrades: Levels;
  research: Record<TowerKind | "nuke", boolean>;
  paths: Record<ResearchPath, number>;
  jobs: Job[];
  nukeReadyTick: number;
  spawnCredit: number;
  produced: number;
  towerKills: number;
  damage: number;
  recentKills: number[];
  lastKills: number;
}
interface Particle extends Point {
  owner: number;
  target: number;
  id: number;
  born: number;
  vx: number;
  vy: number;
  radius: number;
  speed: number;
  hp: number;
  maxHp: number;
  attack: number;
  stunnedUntil: number;
}
interface Tower {
  site: number;
  owner: number;
  kind: TowerKind;
  hp: number;
  level: number;
  nextShot: number;
  shots: number;
}
export interface BattlePlayerSample {
  army: number;
  power: number;
  kpm: number;
  hp: number;
  gold: number;
  produced: number;
  totalUpgrades: number;
  capPressure: number;
  dps: number;
  frontline: number | null;
  towers: number;
  towerKills: number;
  territory: number;
  upgrades: Levels;
}
export interface BattleSample {
  timeSec: number;
  players: BattlePlayerSample[];
}
export interface BattleState {
  tick: number;
  rng: number;
  nextId: number;
  map: MapId;
  cols: number;
  rows: number;
  walls: boolean[];
  ownership: number[];
  cores: Core[];
  particles: Particle[];
  towers: Tower[];
  sites: Point[];
  winner: number | null;
  samples: BattleSample[];
  affinities: number[][];
}
export const TICKS_PER_SECOND = 20;
export const CORE_HP = 1000;
export const CORE_RADIUS = 2.5;
export const DUEL_BASE_WIDTH = 4;
export const BATTLE_TIMEOUT_TICKS = 20 * 60 * 12;
const PIXELS = 32;
const CAP = 2000;
const DT = 1 / TICKS_PER_SECOND;
const upgradeBase: Levels = {
  health: 5,
  attack: 5,
  radius: 3,
  spawnRate: 8,
  speed: 7,
  maxParticles: 10,
  defense: 15,
  interestRate: 10,
};
const upgradeMax: Levels = {
  health: 50,
  attack: 50,
  radius: 7,
  spawnRate: 50,
  speed: 50,
  maxParticles: 50,
  defense: 28,
  interestRate: 20,
};
const pathSpecs: Record<ResearchPath, [number, number, number]> = {
  territory_income: [150, 30, 1],
  territory_income_rate: [100, 15, 5],
  tower_regen: [100, 10, 5],
  tower_range: [80, 10, 5],
  laser_bounce: [130, 15, 5],
  laser_overcharge: [120, 12, 5],
  weakness_slow: [100, 10, 5],
  weakness_stun: [150, 20, 5],
};
function levels(): Levels {
  return {
    health: 0,
    attack: 0,
    radius: 0,
    spawnRate: 0,
    speed: 0,
    maxParticles: 0,
    defense: 0,
    interestRate: 0,
  };
}
function paths(): Record<ResearchPath, number> {
  return {
    territory_income: 0,
    territory_income_rate: 0,
    tower_regen: 0,
    tower_range: 0,
    laser_bounce: 0,
    laser_overcharge: 0,
    weakness_slow: 0,
    weakness_stun: 0,
  };
}
const q = (v: number) => Math.round(v * 1e6) / 1e6;
function random(s: BattleState): number {
  s.rng = (Math.imul(s.rng, 1664525) + 1013904223) >>> 0;
  return s.rng / 4294967296;
}
const distance2 = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const index = (s: BattleState, x: number, y: number) =>
  Math.floor(y) * s.cols + Math.floor(x);
const blocked = (s: BattleState, x: number, y: number) =>
  x < 0 ||
  y < 0 ||
  x >= s.cols ||
  y >= s.rows ||
  s.walls[index(s, x, y)] === true;
function positions(n: number, cols: number, rows: number): Point[] {
  if (n <= 2)
    return [
      { x: 2, y: rows / 2 },
      { x: cols - 2, y: rows / 2 },
    ].slice(0, n);
  if (n === 3)
    return [
      { x: cols / 2, y: 3 },
      { x: 3, y: rows - 4 },
      { x: cols - 3, y: rows - 4 },
    ];
  return [
    { x: 3, y: 3 },
    { x: cols - 3, y: 3 },
    { x: cols - 3, y: rows - 3 },
    { x: 3, y: rows - 3 },
  ];
}
function generateMap(s: BattleState) {
  const { cols: w, rows: h, walls } = s;
  const set = (x: number, y: number, wall: boolean) => {
    if (x >= 0 && y >= 0 && x < w && y < h) walls[y * w + x] = wall;
  };
  if (s.map === "maze") {
    walls.fill(true);
    const stack: Point[] = [{ x: 1, y: 1 }];
    set(1, 1, false);
    while (stack.length) {
      const p = stack[stack.length - 1]!;
      const choices = [
        [0, 2],
        [2, 0],
        [0, -2],
        [-2, 0],
      ].filter(([dx, dy]) => {
        const x = p.x + dx!,
          y = p.y + dy!;
        return x > 0 && y > 0 && x < w - 1 && y < h - 1 && walls[y * w + x];
      });
      if (!choices.length) {
        stack.pop();
        continue;
      }
      const [dx, dy] = choices[Math.floor(random(s) * choices.length)]!;
      const x = p.x + dx!,
        y = p.y + dy!;
      set(x, y, false);
      set((x + p.x) / 2, (y + p.y) / 2, false);
      stack.push({ x, y });
    }
    for (let i = 0; i < walls.length; i++)
      if (walls[i] && random(s) < 0.15) walls[i] = false;
  } else if (s.map === "islands") {
    for (let i = 0; i < 10; i++) {
      const x = 4 + Math.floor(random(s) * (w / 2 - 9)),
        y = Math.floor(random(s) * (h - 6));
      const rw = 3 + Math.floor(random(s) * 4),
        rh = 3 + Math.floor(random(s) * 4);
      for (let a = x; a < x + rw; a++)
        for (let b = y; b < y + rh; b++) {
          set(a, b, true);
          set(w - 1 - a, b, true);
        }
    }
  } else {
    const gaps = Array.from({ length: 3 }, () =>
      Math.floor(random(s) * (h - 3)),
    );
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let wall = false;
        switch (s.map) {
          case "random":
            wall = random(s) > 0.8;
            break;
          case "lanes":
            wall =
              (y === Math.floor(h / 3) || y === Math.floor((2 * h) / 3)) &&
              random(s) > 0.15;
            break;
          case "rooms":
            wall =
              (x % Math.floor(w / 4) === 0 &&
                Math.abs((y % Math.floor(h / 2)) - h / 4) > 1) ||
              (y === h / 2 && Math.abs((x % Math.floor(w / 4)) - w / 8) > 1);
            break;
          case "hourglass":
            wall =
              Math.abs(x - w / 2) < 4 && !gaps.some((g) => y >= g && y < g + 3);
            break;
          case "fortress":
            wall =
              s.cores.some((c) => Math.hypot(c.x - x, c.y - y) < 15) &&
              random(s) < 0.55;
            break;
        }
        set(x, y, wall);
      }
  }
  // Every core has open spawn space and a connected route to the central arena.
  for (const c of s.cores) {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (
          s.cores.length <= 2
            ? Math.abs(x + 0.5 - c.x) < 2.1
            : distance2(c, { x, y }) <= 18
        )
          set(x, y, false);
      }
    for (let step = 0; step <= 2 * w; step++) {
      const t = step / (2 * w),
        x = Math.floor(c.x + (w / 2 - c.x) * t),
        y = Math.floor(c.y + (h / 2 - c.y) * t);
      set(x, y, false);
      set(x, y - 1, false);
      set(x - 1, y, false);
    }
  }
  for (const y of [1 / 3, 2 / 3])
    for (const x of [1 / 4, 1 / 2, 3 / 4]) {
      const col = Math.round(w * x),
        row = Math.round(h * y);
      s.sites.push({ x: col + 0.5, y: row + 0.5 });
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          set(col + dx, row + dy, dx === 0 && dy === 0);
    }
}
export function createBattle(
  seed: number,
  map: MapId,
  bots: boolean[],
): BattleState {
  if (!bots.length || bots.length > 4)
    throw new RangeError("A battle needs one to four cores");
  const cols = bots.length <= 2 ? 64 : 48,
    rows = bots.length <= 2 ? 32 : 48;
  const cores = positions(bots.length, cols, rows).map((point, i) => ({
    ...point,
    hp: CORE_HP,
    gold: 25,
    kills: 0,
    bot: bots[i]!,
    upgrades: levels(),
    research: { laser: false, weakness: false, nuke: false },
    paths: paths(),
    jobs: [],
    nukeReadyTick: 0,
    spawnCredit: 0,
    produced: 0,
    towerKills: 0,
    damage: 0,
    recentKills: [],
    lastKills: 0,
  }));
  const s: BattleState = {
    tick: 0,
    rng: seed >>> 0,
    nextId: 0,
    map,
    cols,
    rows,
    walls: Array<boolean>(cols * rows).fill(false),
    ownership: Array<number>(cols * rows).fill(-1),
    cores,
    particles: [],
    towers: [],
    sites: [],
    winner: null,
    samples: [],
    affinities: cores.map(() => [0, 0, 0, 0, 0, 0]),
  };
  generateMap(s);
  sample(s);
  return s;
}
export function upgradeCost(id: UpgradeId, level: number): number {
  return Math.floor(upgradeBase[id] * 1.3 ** level);
}
export function actionCost(
  s: BattleState,
  seat: number,
  a: BattleAction,
): number {
  const c = s.cores[seat];
  if (!c) return Infinity;
  switch (a.type) {
    case "upgrade":
      return upgradeCost(a.upgrade, c.upgrades[a.upgrade]);
    case "research":
      return 60;
    case "build":
      return 150;
    case "tower":
      return Math.floor(
        60 * 1.3 ** (s.towers.find((t) => t.site === a.site)?.level ?? 0),
      );
    case "path":
      return Math.floor(pathSpecs[a.path][0] * 1.3 ** c.paths[a.path]);
    case "nuke":
      return c.research.nuke ? 0 : 2000;
  }
}
function sameJob(a: BattleAction, b: BattleAction): boolean {
  if (a.type === "upgrade" && b.type === "upgrade")
    return a.upgrade === b.upgrade;
  if (a.type === "research" && b.type === "research")
    return a.tower === b.tower;
  if (a.type === "path" && b.type === "path") return a.path === b.path;
  if ("site" in a && "site" in b) return a.site === b.site;
  return a.type === "nuke" && b.type === "nuke";
}
export function eligibleSite(
  s: BattleState,
  seat: number,
  site: number,
): boolean {
  const p = s.sites[site];
  if (
    !p ||
    s.towers.some((t) => t.site === site) ||
    s.cores.some((c) =>
      c.jobs.some((j) => j.action.type === "build" && j.action.site === site),
    )
  )
    return false;
  const adjacent = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
    .map(([dx, dy]) => index(s, p.x + dx!, p.y + dy!))
    .filter((i) => !s.walls[i]);
  return adjacent.length > 0 && adjacent.every((i) => s.ownership[i] === seat);
}
export function canActBattle(
  s: BattleState,
  seat: number,
  a: BattleAction,
): boolean {
  const c = s.cores[seat];
  if (
    !c ||
    c.hp <= 0 ||
    s.winner !== null ||
    !isBattleAction(a) ||
    c.gold < actionCost(s, seat, a) ||
    c.jobs.some((j) => sameJob(j.action, a))
  )
    return false;
  switch (a.type) {
    case "upgrade":
      return c.upgrades[a.upgrade] < upgradeMax[a.upgrade];
    case "research":
      return !c.research[a.tower];
    case "tower":
      return s.towers.some(
        (t) => t.site === a.site && t.owner === seat && t.level < 5,
      );
    case "build":
      return (
        c.research[a.tower] &&
        s.towers.filter((t) => t.owner === seat).length +
          c.jobs.filter((j) => j.action.type === "build").length <
          5 &&
        eligibleSite(s, seat, a.site)
      );
    case "nuke":
      return s.tick >= c.nukeReadyTick;
    case "path": {
      if (c.paths[a.path] >= pathSpecs[a.path][2]) return false;
      if (a.path === "territory_income") return true;
      if (a.path === "territory_income_rate")
        return c.paths.territory_income > 0;
      if (a.path.startsWith("laser_")) return c.research.laser;
      if (a.path.startsWith("weakness_")) return c.research.weakness;
      return c.research.laser || c.research.weakness;
    }
  }
}
export function actBattle(
  s: BattleState,
  seat: number,
  a: BattleAction,
): boolean {
  if (!canActBattle(s, seat, a)) return false;
  const c = s.cores[seat]!;
  c.gold -= actionCost(s, seat, a);
  if (a.type === "nuke" && c.research.nuke) {
    const count =
      s.particles.filter((p) => p.owner !== seat).length +
      s.towers.filter((t) => t.owner !== seat).length;
    s.particles = s.particles.filter((p) => p.owner === seat);
    s.towers = s.towers.filter((t) => t.owner === seat);
    earn(c, Math.floor(count / 4));
    c.nukeReadyTick = s.tick + 600 * 20;
    return true;
  }
  const seconds =
    a.type === "upgrade"
      ? 0.5
      : a.type === "research"
        ? 20
        : a.type === "build"
          ? 3
          : a.type === "tower"
            ? 5
            : a.type === "path"
              ? pathSpecs[a.path][1]
              : 300;
  c.jobs.push({ action: { ...a }, ready: s.tick + seconds * 20 });
  return true;
}
function finishJobs(s: BattleState, c: Core, seat: number) {
  for (const { action: a, ready } of c.jobs) {
    if (ready > s.tick) continue;
    switch (a.type) {
      case "upgrade":
        c.upgrades[a.upgrade]++;
        break;
      case "research":
        c.research[a.tower] = true;
        break;
      case "path":
        c.paths[a.path]++;
        break;
      case "build":
        s.towers.push({
          site: a.site,
          owner: seat,
          kind: a.tower,
          hp: a.tower === "laser" ? 50 : 40,
          level: 0,
          nextShot: s.tick,
          shots: 0,
        });
        break;
      case "tower": {
        const t = s.towers.find((t) => t.site === a.site && t.owner === seat);
        if (t) {
          t.level++;
          t.hp += t.kind === "laser" ? 10 : 8;
        }
        break;
      }
      case "nuke":
        c.research.nuke = true;
        break;
    }
  }
  if (c.jobs.length) c.jobs = c.jobs.filter((j) => j.ready > s.tick);
}
function earn(c: Core, amount: number) {
  c.gold += amount;
  c.produced += amount;
}
function chooseTarget(s: BattleState, owner: number): number {
  const enemies = s.cores.flatMap((c, i) =>
    c.hp > 0 && i !== owner ? [i] : [],
  );
  return enemies.length
    ? enemies[Math.floor(random(s) * enemies.length)]!
    : owner;
}
function spawn(s: BattleState, owner: number) {
  const c = s.cores[owner]!,
    u = c.upgrades,
    target = chooseTarget(s, owner),
    enemy = s.cores[target]!;
  const speed = (180 + 20 * u.speed) / PIXELS;
  const angle =
    Math.atan2(enemy.y - c.y, enemy.x - c.x) +
    (random(s) - 0.5) * Math.PI * 0.8;
  let x = c.x,
    y = c.y;
  if (s.cores.length <= 2)
    y = s.rows * (0.25 + Math.floor(random(s) * 3) * 0.25);
  const hp = 5 + 0.8 * u.health;
  s.particles.push({
    id: s.nextId++,
    born: s.tick,
    owner,
    target,
    x,
    y,
    hp,
    maxHp: hp,
    attack: 2 + 1.2 * u.attack,
    vx: q(Math.cos(angle) * speed),
    vy: q(Math.sin(angle) * speed),
    radius: (3 + u.radius) / PIXELS,
    speed,
    stunnedUntil: 0,
  });
}
function drift(s: BattleState, p: Particle, magnitude: number) {
  let x = (random(s) * 2 - 1) * magnitude,
    y = (random(s) * 2 - 1) * magnitude;
  const home = s.cores[p.owner]!,
    enemy = s.cores[p.target]!;
  const dx = enemy.x - home.x,
    dy = enemy.y - home.y,
    norm = dx * dx + dy * dy;
  const projection = x * dx + y * dy;
  if (projection < 0 && norm > 0 && random(s) < 0.65) {
    x -= (2 * projection * dx) / norm;
    y -= (2 * projection * dy) / norm;
  }
  const vx = p.vx + x,
    vy = p.vy + y,
    len = Math.hypot(vx, vy) || 1;
  p.vx = q((vx / len) * p.speed);
  p.vy = q((vy / len) * p.speed);
}
function move(s: BattleState, p: Particle, slow: number) {
  if (s.cores[p.target]!.hp <= 0) p.target = chooseTarget(s, p.owner);
  const tile = s.ownership[index(s, p.x, p.y)]!;
  const dt = DT * slow * (tile >= 0 && tile !== p.owner ? 0.8 : 1);
  drift(s, p, 0.3 * p.speed * dt);
  const nx = q(p.x + p.vx * dt);
  if (blocked(s, nx, p.y)) {
    p.vx = -p.vx;
    drift(s, p, 10 / PIXELS);
  } else p.x = nx;
  let ny = p.y + p.vy * dt;
  if (s.cores.length <= 2 && (ny < p.radius || ny > s.rows - p.radius)) {
    const span = s.rows - 2 * p.radius;
    ny = p.radius + ((((ny - p.radius) % span) + span) % span);
  }
  ny = q(ny);
  if (blocked(s, p.x, ny)) {
    p.vy = -p.vy;
    drift(s, p, 10 / PIXELS);
  } else p.y = ny;
  const c = s.cores[p.owner]!;
  if (s.cores.length <= 2) {
    if (Math.abs(p.x - c.x) < 2.3125)
      p.vx = Math.abs(p.vx) * (p.owner === 0 ? 1 : -1);
  } else if (distance2(p, c) < 9) {
    const dx = s.cols / 2 - c.x,
      dy = s.rows / 2 - c.y,
      dot = p.vx * dx + p.vy * dy;
    if (dot < 0) {
      p.vx = q(p.vx - (2 * dot * dx) / (dx * dx + dy * dy));
      p.vy = q(p.vy - (2 * dot * dy) / (dx * dx + dy * dy));
    }
  }
}
function defense(s: BattleState, p: Particle) {
  const level = s.cores[p.owner]!.upgrades.defense;
  return s.ownership[index(s, p.x, p.y)] === p.owner
    ? Math.min(0.6, 0.05 + level * 0.02)
    : Math.min(0.25, level * 0.018);
}
function hit(
  s: BattleState,
  p: Particle,
  owner: number,
  raw: number,
  tower = false,
) {
  if (p.hp <= 0) return;
  const dmg = raw * (1 - defense(s, p)),
    c = s.cores[owner]!;
  c.damage += Math.min(dmg, p.hp);
  p.hp = q(p.hp - dmg);
  if (p.hp <= 0) {
    earn(c, 1);
    c.kills++;
    if (tower) c.towerKills++;
  }
}
function unitDamage(
  s: BattleState,
  target: Particle,
  attacker: Particle,
  weak: number,
) {
  const speed =
    1 + (0.3 * Math.max(0, attacker.speed - target.speed)) / (180 / PIXELS);
  const scaling =
    1 +
    ((0.05 * target.maxHp) / 5) * (1 - Math.min(1, defense(s, target) * 4.5));
  return s.tick < attacker.stunnedUntil
    ? 0
    : attacker.attack * weak * speed * scaling;
}
function collide(s: BattleState, weak: Map<number, number>) {
  const buckets = new Map<number, Particle[]>();
  for (const a of s.particles) {
    if (a.hp <= 0) continue;
    const x = Math.floor(a.x),
      y = Math.floor(a.y);
    for (let dy = -1; dy <= 1 && a.hp > 0; dy++)
      for (let dx = -1; dx <= 1 && a.hp > 0; dx++) {
        if (x + dx < 0 || x + dx >= s.cols || y + dy < 0 || y + dy >= s.rows)
          continue;
        const bucket = buckets.get((y + dy) * s.cols + x + dx);
        if (!bucket) continue;
        for (const b of bucket) {
          if (a.hp <= 0) break;
          if (a.owner === b.owner || b.hp <= 0) continue;
          const bx = b.x - a.x,
            by = b.y - a.y,
            dist = Math.hypot(bx, by),
            overlap = a.radius + b.radius - dist;
          if (overlap <= 0) continue;
          const nx = dist ? bx / dist : 1,
            ny = dist ? by / dist : 0;
          const da = unitDamage(s, b, a, weak.get(a.id) ?? 1),
            db = unitDamage(s, a, b, weak.get(b.id) ?? 1);
          hit(s, a, b.owner, db);
          hit(s, b, a.owner, da);
          const dot = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
          a.vx = q(a.vx - dot * nx);
          a.vy = q(a.vy - dot * ny);
          b.vx = q(b.vx + dot * nx);
          b.vy = q(b.vy + dot * ny);
          const ax = q(a.x - (nx * overlap) / 2),
            ay = q(a.y - (ny * overlap) / 2),
            bxx = q(b.x + (nx * overlap) / 2),
            byy = q(b.y + (ny * overlap) / 2);
          if (!blocked(s, ax, ay)) {
            a.x = ax;
            a.y = ay;
          }
          if (!blocked(s, bxx, byy)) {
            b.x = bxx;
            b.y = byy;
          }
        }
      }
    const i = index(s, a.x, a.y),
      bucket = buckets.get(i);
    if (bucket) bucket.push(a);
    else buckets.set(i, [a]);
  }
}
function towerEffects(
  s: BattleState,
  slow: Map<number, number>,
  weak: Map<number, number>,
) {
  for (const t of s.towers) {
    const c = s.cores[t.owner]!,
      p = s.sites[t.site]!,
      levels = c.paths,
      laser = t.kind === "laser";
    const range = ((laser ? 150 : 140) + 25 * levels.tower_range) / PIXELS;
    t.hp = Math.min(
      (laser ? 50 : 40) + (laser ? 10 : 8) * t.level,
      t.hp + 2 * levels.tower_regen * DT,
    );
    const enemies = s.particles.filter(
      (e) => e.hp > 0 && e.owner !== t.owner && distance2(p, e) < range * range,
    );
    if (laser && t.nextShot <= s.tick && enemies.length) {
      enemies.sort((a, b) => distance2(a, p) - distance2(b, p));
      t.shots++;
      const overcharge =
        levels.laser_overcharge > 0 &&
        t.shots % (9 - levels.laser_overcharge) === 0;
      for (const [i, e] of enemies.slice(0, 1 + levels.laser_bounce).entries())
        hit(
          s,
          e,
          t.owner,
          (5 + 2 * t.level) * (overcharge ? 3 : 1) * (i === 0 ? 1 : 0.7),
          true,
        );
      t.nextShot = s.tick + Math.max(1, Math.round(20 / (2.5 + 0.4 * t.level)));
    } else if (!laser) {
      for (const e of enemies) {
        const factor = Math.max(0, 0.75 - t.level * 0.07);
        weak.set(e.id, Math.min(weak.get(e.id) ?? 1, factor));
        slow.set(
          e.id,
          Math.min(slow.get(e.id) ?? 1, 1 - 0.12 * levels.weakness_slow),
        );
        hit(s, e, t.owner, (1.5 + t.level * 0.07) * DT, true);
      }
      if (levels.weakness_stun && enemies.length && s.tick >= t.nextShot) {
        enemies.sort(
          (a, b) => distance2(a, p) - distance2(b, p),
        )[0]!.stunnedUntil = s.tick + 20;
        t.nextShot = s.tick + 200 - 30 * levels.weakness_stun;
      }
    }
    for (const e of enemies) {
      if (t.hp <= 0) break;
      if (e.hp <= 0 || distance2(e, p) > (0.5 + e.radius) ** 2) continue;
      t.hp -= 0.5 * e.attack;
      if (t.hp <= 0) {
        s.cores[e.owner]!.kills++;
        earn(s.cores[e.owner]!, 1);
      }
    }
  }
  s.towers = s.towers.filter((t) => t.hp > 0);
}
function territory(s: BattleState) {
  const occupants = new Map<number, number>();
  for (const p of s.particles) {
    const key = index(s, p.x, p.y);
    occupants.set(key, (occupants.get(key) ?? 0) | (1 << p.owner));
  }
  for (const [i, mask] of occupants) {
    const old = s.ownership[i]!;
    if (old >= 0 && (1 << old) & mask) continue;
    // A simultaneous contested arrival leaves the previous claim in place.
    if ((mask & (mask - 1)) === 0) s.ownership[i] = Math.log2(mask);
  }
}
function botAction(s: BattleState, seat: number) {
  const c = s.cores[seat]!;
  if (c.gold >= 60 && random(s) < 0.16) {
    const tower = random(s) < 0.5 ? "laser" : "weakness";
    if (!c.research[tower]) {
      if (actBattle(s, seat, { type: "research", tower })) return;
    } else
      for (let site = 0; site < s.sites.length; site++)
        if (actBattle(s, seat, { type: "build", tower, site })) return;
  }
  const candidates = UPGRADES.map(
    (upgrade) => ({ type: "upgrade", upgrade }) as const,
  ).filter((a) => canActBattle(s, seat, a));
  if (!candidates.length) return;
  const profile = weights[seat % weights.length]!;
  const scores = candidates.map(
    (a) =>
      ((profile[UPGRADES.indexOf(a.upgrade)] ?? 1) * (0.5 + random(s))) /
      (1 + c.upgrades[a.upgrade]),
  );
  actBattle(s, seat, candidates[scores.indexOf(Math.max(...scores))]!);
}
// Source profile weights in UPGRADES order.
const weights = [
  [1.5, 1.8, 0.5, 2, 1.6, 1, 0.8, 0.5],
  [0.5, 1.8, 0.3, 3, 1.9, 1, 0, 0],
  [0.8, 2, 0.3, 2, 1.5, 1.5, 0.3, 2],
  [2, 1.8, 0.3, 1.5, 1.2, 0.8, 2, 1.5],
  [0.3, 1.6, 0.4, 1.5, 1.6, 1, 0, 0],
  [2.5, 2, 0.5, 2.2, 1.2, 1.5, 1.7, 0.8],
];
function sample(s: BattleState) {
  const previous = s.samples.at(-1)?.timeSec ?? 0,
    seconds = s.tick / 20 - previous;
  const players = s.cores.map((c, i) => {
    const army = s.particles.filter((p) => p.owner === i),
      towers = s.towers.filter((t) => t.owner === i).length;
    const progress = army
      .map((p) =>
        s.cores.length === 2
          ? i === 0
            ? p.x
            : s.cols - p.x
          : Math.sqrt(distance2(c, p)),
      )
      .sort((a, b) => b - a)
      .slice(0, 20);
    const scores = weights.map((profile, j) => {
      const base = UPGRADES.reduce(
        (v, k, idx) => v + c.upgrades[k] * profile[idx]!,
        0,
      );
      return Math.max(
        0,
        base +
          (j === 3
            ? towers * 2
            : j === 2
              ? c.produced / 500
              : j === 1
                ? -3 * towers
                : 0),
      );
    });
    const best = Math.max(1, ...scores);
    s.affinities[i] = scores.map((v) => Math.round((100 * v) / best));
    const elapsed = Math.min(30, s.tick / 20);
    const last = c.recentKills.length < 30 ? 0 : c.recentKills[0]!;
    const kpm = elapsed > 0 ? ((c.kills - last) * 60) / elapsed : 0;
    const data = {
      army: army.length,
      power: q(
        army.reduce(
          (v, p) =>
            v +
            p.hp * 0.6 +
            p.attack * 1.2 +
            p.speed * PIXELS * 0.4 +
            p.radius * PIXELS * 0.2,
          0,
        ),
      ),
      kpm,
      hp: c.hp,
      gold: c.gold,
      produced: c.produced,
      totalUpgrades: Object.values(c.upgrades).reduce((a, b) => a + b, 0),
      capPressure: army.length / (1000 + c.upgrades.maxParticles * 50),
      dps: seconds > 0 ? c.damage / seconds : 0,
      frontline: progress.length
        ? progress.reduce((a, b) => a + b, 0) / progress.length
        : null,
      towers,
      towerKills: c.towerKills,
      territory: s.ownership.filter((o) => o === i).length,
      upgrades: { ...c.upgrades },
    };
    c.damage = 0;
    c.lastKills = c.kills;
    return data;
  });
  s.samples.push({ timeSec: s.tick / 20, players });
}
export function tickBattle(s: BattleState): void {
  if (s.winner !== null) return;
  s.tick++;
  const counts = s.cores.map(() => 0);
  for (const p of s.particles) counts[p.owner]!++;
  for (let offset = 0; offset < s.cores.length; offset++) {
    const seat = (s.tick + offset) % s.cores.length,
      c = s.cores[seat]!;
    if (c.hp <= 0) continue;
    finishJobs(s, c, seat);
    if (c.bot && s.tick % 20 === 1) botAction(s, seat);
    if (s.tick % 600 === 0)
      earn(
        c,
        Math.floor(c.gold * Math.min(0.05, c.upgrades.interestRate * 0.0025)),
      );
    if (c.paths.territory_income && s.tick % 100 === 0)
      earn(
        c,
        Math.floor(
          s.ownership.filter((o) => o === seat).length *
            (0.003 + 0.002 * c.paths.territory_income_rate) *
            5,
        ),
      );
    c.spawnCredit += 10 + c.upgrades.spawnRate;
    while (c.spawnCredit >= 40) {
      c.spawnCredit -= 40;
      if (
        counts[seat]! < 1000 + 50 * c.upgrades.maxParticles &&
        s.particles.length < CAP
      ) {
        spawn(s, seat);
        counts[seat]!++;
      }
    }
  }
  const slow = new Map<number, number>(),
    weak = new Map<number, number>();
  towerEffects(s, slow, weak);
  for (const p of s.particles) {
    if (p.hp <= 0) continue;
    move(s, p, slow.get(p.id) ?? 1);
    for (const [seat, c] of s.cores.entries()) {
      if (seat === p.owner || c.hp <= 0) continue;
      const reached =
        s.cores.length === 2
          ? seat === 0
            ? p.x < DUEL_BASE_WIDTH
            : p.x >= s.cols - DUEL_BASE_WIDTH
          : distance2(c, p) < CORE_RADIUS ** 2;
      if (reached) {
        c.hp--;
        s.cores[p.owner]!.damage++;
        p.hp = 0;
        break;
      }
    }
    if (s.tick - p.born >= 200 && distance2(p, s.cores[p.owner]!) < 100) {
      p.hp = 0;
      s.cores[p.owner]!.spawnCredit += 40;
    }
  }
  collide(s, weak);
  s.particles = s.particles.filter((p) => p.hp > 0 && s.cores[p.owner]!.hp > 0);
  s.towers = s.towers.filter((t) => s.cores[t.owner]!.hp > 0);
  territory(s);
  s.winner = battleOutcome(s);
  // Counters are captured every second, while chart points use a five-second cadence.
  if (s.tick % 100 === 0 || s.winner !== null) sample(s);
  if (s.tick % 20 === 0)
    for (const c of s.cores) {
      c.recentKills.push(c.kills);
      if (c.recentKills.length > 30) c.recentKills.shift();
    }
}

type Guard<T> = (value: unknown) => value is T;
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function integer(min: number, max: number): Guard<number> {
  return (v): v is number =>
    typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}
function number(min: number, max: number): Guard<number> {
  return (v): v is number =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}
function list<T>(guard: Guard<T>, min: number, max: number): Guard<T[]> {
  return (v): v is T[] => {
    if (!Array.isArray(v) || v.length < min || v.length > max) return false;
    for (let i = 0; i < v.length; i++) if (!guard(v[i])) return false;
    return true;
  };
}
function fields<T extends object>(guards: {
  [K in keyof T]: Guard<T[K]>;
}): Guard<T> {
  const entries = Object.entries<Guard<unknown>>(guards);
  return (v): v is T =>
    object(v) &&
    Object.keys(v).length === entries.length &&
    entries.every(([k, g]) => Object.hasOwn(v, k) && g(v[k]));
}
function enumeration<const T extends string>(values: readonly T[]): Guard<T> {
  return (v): v is T => typeof v === "string" && values.some((x) => v === x);
}
const bool: Guard<boolean> = (v): v is boolean => typeof v === "boolean";
const kind = enumeration(["laser", "weakness"]);
const upgrade = enumeration(UPGRADES),
  path = enumeration(PATHS);
const siteId = integer(0, 5);
export function isBattleAction(v: unknown): v is BattleAction {
  if (!object(v) || !Object.hasOwn(v, "type")) return false;
  const n = Object.keys(v).length;
  switch (v.type) {
    case "nuke":
      return n === 1;
    case "upgrade":
      return n === 2 && upgrade(v.upgrade);
    case "research":
      return n === 2 && kind(v.tower);
    case "build":
      return n === 3 && kind(v.tower) && siteId(v.site);
    case "tower":
      return n === 2 && siteId(v.site);
    case "path":
      return n === 2 && path(v.path);
    default:
      return false;
  }
}
const count = integer(0, 1e9),
  amount = number(0, 1e9),
  coord = number(0, 64);
const tick = integer(0, BATTLE_TIMEOUT_TICKS);
const futureTick = integer(0, BATTLE_TIMEOUT_TICKS + 12000);
const validLevels: Guard<Levels> = (v): v is Levels =>
  object(v) &&
  Object.keys(v).length === UPGRADES.length &&
  UPGRADES.every((k) => integer(0, upgradeMax[k])(v[k]));
const validPaths: Guard<Core["paths"]> = (v): v is Core["paths"] =>
  object(v) &&
  Object.keys(v).length === PATHS.length &&
  PATHS.every((k) => integer(0, pathSpecs[k][2])(v[k]));
const validPoint = fields<Point>({ x: coord, y: coord });
const validJob = fields<Job>({ action: isBattleAction, ready: futureTick });
const validCore = fields<Core>({
  x: coord,
  y: coord,
  hp: integer(0, CORE_HP),
  gold: count,
  kills: count,
  bot: bool,
  upgrades: validLevels,
  research: fields({ laser: bool, weakness: bool, nuke: bool }),
  paths: validPaths,
  jobs: list(validJob, 0, 32),
  nukeReadyTick: futureTick,
  spawnCredit: integer(0, CAP * 40 + 40),
  produced: count,
  towerKills: count,
  damage: amount,
  recentKills: list(count, 0, 30),
  lastKills: count,
});
const seatId = integer(0, 3);
const validParticle = fields<Particle>({
  x: coord,
  y: coord,
  owner: seatId,
  target: seatId,
  id: count,
  born: tick,
  vx: number(-100, 100),
  vy: number(-100, 100),
  radius: number(3 / PIXELS, 10 / PIXELS),
  speed: number(180 / PIXELS, 40),
  hp: number(Number.MIN_VALUE, 50),
  maxHp: number(5, 50),
  attack: number(2, 62),
  stunnedUntil: futureTick,
});
const validTower = fields<Tower>({
  owner: seatId,
  site: siteId,
  kind,
  hp: number(Number.MIN_VALUE, 101),
  level: integer(0, 5),
  nextShot: futureTick,
  shots: count,
});
const validPlayerSample = fields<BattlePlayerSample>({
  army: integer(0, CAP),
  power: amount,
  kpm: amount,
  hp: integer(0, CORE_HP),
  gold: amount,
  produced: amount,
  totalUpgrades: count,
  capPressure: number(0, 1),
  dps: amount,
  frontline: (v): v is number | null => v === null || number(0, 90)(v),
  towers: integer(0, 5),
  towerKills: count,
  territory: integer(0, 2304),
  upgrades: validLevels,
});
const validSample = fields<BattleSample>({
  timeSec: number(0, BATTLE_TIMEOUT_TICKS / 20),
  players: list(validPlayerSample, 1, 4),
});
const validState = fields<BattleState>({
  tick,
  rng: integer(0, 0xffffffff),
  nextId: count,
  map: enumeration(MAPS),
  cols: integer(48, 64),
  rows: integer(32, 48),
  walls: list(bool, 2048, 2304),
  ownership: list(integer(-1, 3), 2048, 2304),
  cores: list(validCore, 1, 4),
  particles: list(validParticle, 0, CAP),
  towers: list(validTower, 0, 6),
  sites: list(validPoint, 6, 6),
  winner: (v): v is number | null => v === null || integer(-1, 3)(v),
  samples: list(validSample, 1, BATTLE_TIMEOUT_TICKS / 100 + 2),
  affinities: list(list(integer(0, 100), 6, 6), 1, 4),
});
function battleOutcome(state: BattleState): number | null {
  const living = state.cores.flatMap((core, index) =>
    core.hp > 0 ? [index] : [],
  );
  if (living.length < 2 && state.cores.length > 1) return living[0] ?? -1;
  if (state.tick < BATTLE_TIMEOUT_TICKS) return null;
  const best = Math.max(...state.cores.map((core) => core.hp));
  const tied = state.cores.flatMap((core, index) =>
    core.hp === best ? [index] : [],
  );
  return tied.length === 1 ? tied[0]! : -1;
}

export function decodeBattle(raw: unknown): BattleState | undefined {
  if (!validState(raw)) return;
  const n = raw.cores.length,
    { cols, rows } = raw;
  if (
    cols !== (n > 2 ? 48 : 64) ||
    rows !== (n > 2 ? 48 : 32) ||
    raw.walls.length !== cols * rows ||
    raw.ownership.length !== cols * rows ||
    raw.winner !== battleOutcome(raw) ||
    raw.affinities.length !== n
  )
    return;
  if (raw.ownership.some((v, i) => v >= n || (v >= 0 && raw.walls[i]))) return;
  const origins = positions(n, cols, rows),
    ids = new Set<number>(),
    occupied = new Set<number>();
  if (
    raw.cores.some(
      (c, i) =>
        distance2(c, origins[i]!) !== 0 ||
        c.jobs.some((j) => j.ready <= raw.tick && c.hp > 0),
    )
  )
    return;
  for (const p of raw.particles) {
    if (
      ids.has(p.id) ||
      p.id >= raw.nextId ||
      p.owner >= n ||
      p.target >= n ||
      p.born > raw.tick ||
      blocked(raw, p.x, p.y) ||
      p.hp > p.maxHp
    )
      return;
    ids.add(p.id);
  }
  for (const [i, site] of raw.sites.entries()) {
    if (
      site.x !== Math.round(cols * (((i % 3) + 1) / 4)) + 0.5 ||
      site.y !== Math.round(rows * (i < 3 ? 1 / 3 : 2 / 3)) + 0.5 ||
      !raw.walls[index(raw, site.x, site.y)]
    )
      return;
  }
  for (const t of raw.towers) {
    if (t.owner >= n || occupied.has(t.site)) return;
    occupied.add(t.site);
  }
  for (const c of raw.cores)
    for (const j of c.jobs)
      if (j.action.type === "build") {
        if (occupied.has(j.action.site)) return;
        occupied.add(j.action.site);
      }
  let previous = -1;
  for (const sm of raw.samples) {
    if (
      sm.players.length !== n ||
      sm.timeSec <= previous ||
      sm.timeSec > raw.tick / 20
    )
      return;
    previous = sm.timeSec;
  }
  return structuredClone(raw);
}
