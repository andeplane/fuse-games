import {
  hasBuff,
  isBuffKind,
  isPowerupKind,
  POWERUP_RULES,
  powerupPhase,
  powerupDraw,
} from "./powerups.js";
import {
  DOMINANCE_LEAD,
  dominanceCells,
  territoryCounts,
  territoryPhase,
} from "./territory.js";
import { EVENT_TYPES, recordTimeline, TIMELINE } from "./timeline.js";
import { loadMap, neighbors, homeCellOrder, homeOrder } from "./map.ts";
import { autoExpandCell } from "./auto-expand.js";
import { balanceParticleDestinations } from "./particle-destinations.js";
import {
  brainIndex,
  cellIndex,
  connectedStructures,
  findRoutes,
  type CellIndex,
  type Route,
} from "./routes.js";
import {
  CONSTRUCTIONS,
  RESEARCH,
  STRUCTURES,
  PARTICLES,
  canAttack,
  attackCells,
  protectionCells,
  depositContribution,
  constructionSiteRequirements,
  particleProfile,
  isParticleKind,
  researchPrerequisites,
  constructionQueueAvailability,
  constructionUpgradeSource,
  constructionDispatchAvailability,
  constructionDuration,
  constructionDurations,
  isSprout,
  sproutSlots,
  SPROUT,
  researchAvailability,
  isBuildKind,
  isResearchKind,
} from "./catalog.js";
import {
  RULES,
  isAiStrategy,
  type Action,
  type Command,
  type Construction,
  type MatchSettings,
  type Particle,
  type Player,
  type RosterEntry,
  type Structure,
  type World,
  type MapDefinition,
} from "./types.ts";
export * from "./types.ts";
export { loadMap, neighbors } from "./map.ts";
export * from "./powerups.js";
export * from "./territory.js";
export * from "./timeline.js";
export { SPROUT, isSprout, sproutSlots } from "./catalog.js";
const clone = <T>(v: T): T => structuredClone(v);
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const integer = (
  n: unknown,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= min && n <= max;
const hp = (kind: Structure["kind"]) => STRUCTURES[kind].hp;
const structure = (w: World, cell: number) =>
  w.structures.find((s) => s.cell === cell);
const brain = (w: World, p: Player) =>
  w.structures.find((s) => s.ownerId === p.id && s.kind === "brain");
function emit(
  w: World,
  p: Player,
  type: World["outcomes"][number]["type"],
  extra: Partial<World["outcomes"][number]> = {},
) {
  w.outcomes.push({ tick: w.tick, playerId: p.id, type, ...extra });
}
function validateSetup(
  raw: MapDefinition,
  settings: MatchSettings,
  roster: RosterEntry[],
): MapDefinition {
  const map = loadMap(raw);
  if (
    roster.length < 1 ||
    roster.length > RULES.maxPlayers ||
    new Set(roster.map((p) => p.id)).size !== roster.length ||
    new Set(roster.map((p) => p.slot)).size !== roster.length ||
    roster.some(
      (p) =>
        !/^[-a-zA-Z0-9_]{1,64}$/.test(p.id) ||
        !map.spawns.some((s) => s.slot === p.slot),
    )
  )
    throw new Error("roster: invalid players or spawn assignments");
  if (
    !record(settings) ||
    Object.keys(settings).some(
      (k) =>
        ![
          "instantConstruction",
          "instantResearch",
          "matchId",
          "aiStrategy",
          "powerups",
        ].includes(k),
    ) ||
    (settings.powerups !== undefined &&
      typeof settings.powerups !== "boolean") ||
    (settings.aiStrategy !== undefined && !isAiStrategy(settings.aiStrategy)) ||
    (settings.instantConstruction !== undefined &&
      typeof settings.instantConstruction !== "boolean") ||
    (settings.instantResearch !== undefined &&
      typeof settings.instantResearch !== "boolean") ||
    (settings.matchId !== undefined &&
      (typeof settings.matchId !== "string" || settings.matchId.length > 128))
  )
    throw new Error("settings: invalid");
  return map;
}

export function createMatch(
  raw: MapDefinition,
  settings: MatchSettings = {},
  roster: RosterEntry[] = [{ id: "player-1", slot: 0 }],
): World {
  const map = validateSetup(raw, settings, roster);
  const w: World = {
    formatVersion: 1,
    rulesVersion: RULES.version,
    matchId: settings.matchId ?? "sandbox",
    tick: 0,
    map,
    settings: clone(settings),
    players: [],
    structures: [],
    particles: [],
    nextEntityId: 1,
    powerups: [],
    powerupSerial: 0,
    outcomes: [],
    victory: null,
    timeline: [],
    events: [],
    winnerId: null,
    finished: false,
  };
  for (const r of [...roster].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const cell = map.spawns.find((s) => s.slot === r.slot)!.cellIndex;
    w.players.push({
      ...r,
      alive: true,
      autoExpand: false,
      particleKind: "pulse",
      biomass: 60_000,
      insight: 0,
      sequence: -1,
      queue: [],
      worker: {
        mode: "idle",
        cell,
        from: cell,
        to: cell,
        departedAt: 0,
        arrivesAt: 0,
        recoverAt: 0,
      },
      research: [],
      researchJob: null,
      priorities: {},
      miningRemainders: {},
      statistics: {
        biomassEarned: 0,
        insightEarned: 0,
        built: 0,
        damage: 0,
        lost: 0,
        sitesLost: 0,
      },
      buffs: [],
      territory: 0,
      dominanceSince: null,
    });
    w.structures.push({
      id: w.nextEntityId++,
      cell,
      ownerId: r.id,
      kind: "brain",
      hp: 240,
      connected: true,
    });
    for (let i = 0; i < RULES.particleCount; i++)
      w.particles.push({
        kind: "pulse",
        id: w.nextEntityId++,
        ownerId: r.id,
        cell,
        destination: cell,
        from: cell,
        to: cell,
        departedAt: 0,
        arrivesAt: 0,
        recoverAt: 0,
        mode: "stationed",
        attack: 2,
        speed: RULES.particleSpeed,
      });
  }
  return w;
}
function connectivity(w: World) {
  const connected = connectedStructures(
    w,
    cellIndex(w),
    brainIndex(w.structures),
  );
  for (const structure of w.structures)
    structure.connected = connected.has(structure);
}
export function isAction(raw: unknown): raw is Action {
  const a = raw as Action;
  if (!a || typeof a !== "object") return false;
  const keys: Record<Action["type"], string[]> = {
    setParticleKind: ["type", "kind"],
    setAutoExpand: ["type", "enabled"],
    queueConstruction: ["type", "cell", "kind"],
    cancelConstruction: ["type", "cell"],
    setPriority: ["type", "cell", "weight"],
    startResearch: ["type", "research"],
    cancelResearch: ["type"],
  };
  if (
    !Object.hasOwn(keys, a.type) ||
    Object.keys(a).some((k) => !keys[a.type].includes(k))
  )
    return false;
  switch (a.type) {
    case "setParticleKind":
      return isParticleKind(a.kind);
    case "setAutoExpand":
      return typeof a.enabled === "boolean";
    case "queueConstruction":
      return integer(a.cell) && isBuildKind(a.kind);
    case "cancelConstruction":
      return integer(a.cell);
    case "setPriority":
      return integer(a.cell) && integer(a.weight, 0, 3);
    case "startResearch":
      return isResearchKind(a.research);
    case "cancelResearch":
      return true;
    default:
      return false;
  }
}
function apply(w: World, c: Command) {
  const p = w.players.find((p) => p.id === c.playerId);
  if (!p) return;
  const reject = (reason: string) => emit(w, p, "rejected", { reason });
  if (
    !integer(c.sequence) ||
    !isAction(c.action) ||
    (c.matchId !== undefined && c.matchId !== w.matchId)
  ) {
    reject("invalid command");
    return;
  }
  if (c.sequence <= p.sequence) return;
  p.sequence = c.sequence;
  if (!p.alive) {
    reject("player eliminated");
    return;
  }
  const a = c.action;
  switch (a.type) {
    case "setAutoExpand":
      p.autoExpand = a.enabled;

      return;
    case "queueConstruction": {
      if (!constructionQueueAvailability(w, p, a.kind, a.cell).allowed) {
        reject("invalid construction cell or full queue");
        return;
      }
      const upgrade = constructionUpgradeSource(w, p, a.kind, a.cell);
      p.queue.push({
        ...(upgrade && { upgradeFrom: upgrade.id }),
        cell: a.cell,
        kind: a.kind,
        paid: false,
        progress: 0,
        duration: 0,
        hp: hp(a.kind),
      });
      emit(w, p, "queued", { cell: a.cell });

      return;
    }
    case "cancelConstruction": {
      const i = p.queue.findIndex((j) => j.cell === a.cell);
      if (i < 0) {
        reject("no owned construction");
        return;
      }
      const j = p.queue[i]!;
      p.queue.splice(i, 1);
      // Delivered work is spent; queued ghosts cost nothing. Only the builder's
      // own job sends it home: sprouts never use it, and a recovering builder
      // keeps its penalty.
      if (j.paid && !isSprout(j) && p.worker.mode !== "recovering")
        p.worker.mode = "returning";

      return;
    }
    case "setPriority": {
      // Clearing an old destination must remain possible after its destruction.
      if (a.weight === 0) {
        delete p.priorities[String(a.cell)];
        return;
      }
      const s = structure(w, a.cell);
      if (
        !s ||
        s.ownerId !== p.id ||
        !canAttack(s.kind) ||
        (!Object.hasOwn(p.priorities, String(a.cell)) &&
          Object.keys(p.priorities).length >= 8)
      ) {
        reject("invalid priority destination");
        return;
      }
      p.priorities[String(a.cell)] = a.weight;

      return;
    }
    case "setParticleKind":
      if (researchPrerequisites(p, PARTICLES[a.kind].requires).length) {
        reject("particle profile unavailable");
        return;
      }
      p.particleKind = a.kind;

      return;
    case "startResearch": {
      if (!researchAvailability(p, a.research).allowed) {
        reject("research unavailable");
        return;
      }
      const definition = RESEARCH[a.research];
      p.insight -= definition.cost;
      p.researchJob = {
        kind: a.research,
        completesAt:
          w.tick + (w.settings.instantResearch ? 0 : definition.duration),
      };
      emit(w, p, "researchStarted", {
        amount: definition.cost,
        resource: "insight",
      });

      return;
    }
    case "cancelResearch":
      p.researchJob = null;
      return;
  }
}

function economy(w: World, p: Player) {
  const initialBiomass = p.biomass,
    initialInsight = p.insight;
  const add = (kind: "biomass" | "insight", amount: number) => {
    const actual = Math.min(amount, RULES.bankCap - p[kind]);
    p[kind] += actual;
    p.statistics[kind === "biomass" ? "biomassEarned" : "insightEarned"] +=
      actual;
  };
  add("biomass", 50);
  add("insight", 25);
  w.map.cells.forEach((cell, index) => {
    if (cell.terrain !== "deposit") return;
    const n = depositContribution(w, p.id, index);
    const numerator =
      (p.miningRemainders[index] ?? 0) +
      (cell.resourceKind === "biomass" ? 6000 : 3000) * n;
    add(cell.resourceKind, Math.floor(numerator / 120));
    p.miningRemainders[index] = numerator % 120;
  });
  if (p.researchJob && p.researchJob.completesAt <= w.tick) {
    p.research.push(p.researchJob.kind);
    emit(w, p, "researched", { reason: p.researchJob.kind });
    p.researchJob = null;
  }
  emit(w, p, "income", {
    resource: "biomass",
    amount: p.biomass - initialBiomass,
  });
  emit(w, p, "income", {
    resource: "insight",
    amount: p.insight - initialInsight,
  });
}
function prepareWorker(w: World, p: Player, index: CellIndex): boolean {
  const b = brain(w, p);
  if (!b) return false;
  const worker = p.worker;
  const recover = () => {
    worker.mode = "recovering";
    worker.recoverAt = w.tick + RULES.recoveryTicks;
  };
  if (worker.mode === "recovering") {
    if (w.tick < worker.recoverAt) return false;
    worker.cell = b.cell;
    worker.to = b.cell;
    worker.from = b.cell;
    worker.arrivesAt = w.tick;
    worker.mode = p.queue.some((j) => j.paid && !isSprout(j))
      ? "outbound"
      : "idle";
  }
  // Check both endpoints before waiting or arriving: an alternate route to the
  // destination does not repair the edge on which this builder was travelling.
  if (worker.to !== worker.cell) {
    const from = index.get(worker.from),
      to = index.get(worker.to);
    if (
      !from?.connected ||
      !to?.connected ||
      from.ownerId !== p.id ||
      to.ownerId !== p.id
    ) {
      recover();
      return false;
    }
  }
  if (worker.arrivesAt > w.tick) return false;
  if (worker.to !== worker.cell) {
    worker.cell = worker.to;
    worker.from = worker.cell;
  }
  if (!findRoutes(w.map, p, index, worker.cell, [b.cell]).has(b.cell)) {
    recover();
    return false;
  }
  return true;
}
/**
 * A seat's place in this tick's construction precedence; the lowest wins a
 * contested claim. Each tick shuffles every seat by hashing the match, tick
 * and slot, so any two seats are equally likely to come first, whatever the
 * number of players and however regular their timing (the AI acts every 20
 * ticks), and matches do not all resolve their first contest the same way. A
 * rotation is not enough: with four players, neighbours in the rotation win
 * three ties in four against each other.
 */
export function claimPrecedence(
  matchId: string,
  tick: number,
  slot: number,
): number {
  return powerupDraw(matchId, tick, 1000 + slot);
}
/**
 * A waiting plan whose hex now holds a building it does not upgrade (an
 * opponent grew there, or this network built it another way) can never start.
 * Drop it with an outcome rather than leave a numbered ghost in the queue.
 */
function dropTakenPlans(w: World, p: Player) {
  const taken = p.queue.filter(
    (j) =>
      !j.paid &&
      w.structures.some((s) => s.cell === j.cell && s.id !== j.upgradeFrom),
  );
  if (!taken.length) return;
  p.queue = p.queue.filter((j) => !taken.includes(j));
  for (const j of taken)
    emit(w, p, "dropped", { cell: j.cell, reason: "hex taken" });
}
function dispatchConstruction(w: World, ready: Player[]) {
  // Collect claims against one shared pre-dispatch board. Contested claims go
  // by claimPrecedence, a per-tick shuffle of seats, so renaming players
  // cannot buy construction priority.
  const rank = (p: Player) => claimPrecedence(w.matchId, w.tick, p.slot);
  // The builder takes one tower or upgrade at a time; neurons sprout from the
  // network into every free sprout slot.
  const claims = w.players
    .filter((p) => p.alive)
    .flatMap((p) => {
      const out: { p: Player; job: Construction }[] = [];
      if (
        ready.includes(p) &&
        p.worker.mode === "idle" &&
        !p.queue.some((j) => j.paid && !isSprout(j))
      ) {
        const job = p.queue.find(
          (j) =>
            !j.paid &&
            !isSprout(j) &&
            constructionDispatchAvailability(w, p, j).allowed,
        );
        if (job) out.push({ p, job });
      }
      let free =
        sproutSlots(p) - p.queue.filter((j) => j.paid && isSprout(j)).length;
      for (const job of p.queue) {
        if (free <= 0) break;
        if (
          !job.paid &&
          isSprout(job) &&
          constructionDispatchAvailability(w, p, job).allowed
        ) {
          out.push({ p, job });
          free--;
        }
      }
      return out;
    })
    .sort((a, b) => rank(a.p) - rank(b.p));
  const claimed = new Set<number>();
  for (const { p, job } of claims) {
    const cost = CONSTRUCTIONS[job.kind].cost;
    if (claimed.has(job.cell) || p.biomass < cost) continue;
    claimed.add(job.cell);
    p.biomass -= cost;
    job.paid = true;
    job.duration = constructionDuration(w, p, job.kind);
    if (!isSprout(job)) p.worker.mode = "outbound";
    emit(w, p, "dispatched", {
      cell: job.cell,
      amount: cost,
      resource: "biomass",
    });
  }
}
function worker(w: World, p: Player) {
  const b = brain(w, p)!;
  const worker = p.worker;
  const job = p.queue.find((j) => j.paid && !isSprout(j));
  const move = (route: Route | undefined) => {
    if (!route) {
      worker.mode = "recovering";
      worker.recoverAt = w.tick + RULES.recoveryTicks;
      return;
    }
    if (route.distance > 0) {
      worker.from = worker.cell;
      worker.to = route.next;
      worker.departedAt = w.tick;
      worker.arrivesAt = w.tick + (p.research.includes("conduction") ? 3 : 4);
    }
  };
  if (worker.mode === "returning" || !job) {
    worker.mode = "returning";
    if (worker.cell === b.cell) {
      worker.mode = "idle";
      worker.to = b.cell;
    } else
      move(
        findRoutes(w.map, p, cellIndex(w), worker.cell, [b.cell]).get(b.cell),
      );
    return;
  }
  const anchors = neighbors(w.map, job.cell);
  const routes = findRoutes(w.map, p, cellIndex(w), worker.cell, anchors);
  const closest = [...routes].sort(
    ([a, left], [b, right]) =>
      left.distance - right.distance || homeCellOrder(w.map, p.slot, a, b),
  )[0];
  if (!closest) return;
  const [target, route] = closest;
  if (worker.cell !== target) {
    move(route);
    return;
  }
  worker.mode = "building";
  job.progress += hasBuff(p, "surge", w.tick) ? 2 : 1;
  if (job.progress >= job.duration) {
    const source =
      job.upgradeFrom === undefined
        ? undefined
        : w.structures.find((s) => s.id === job.upgradeFrom);
    if (source) {
      const fraction = source.hp / hp(source.kind);
      source.kind = job.kind;
      source.hp = Math.max(1, Math.floor(hp(job.kind) * fraction));
      delete source.firingCursor;
      if (!canAttack(source.kind)) delete p.priorities[String(source.cell)];
    } else
      w.structures.push({
        id: w.nextEntityId++,
        cell: job.cell,
        ownerId: p.id,
        kind: job.kind,
        hp: job.hp,
        connected: true,
      });
    p.queue.splice(p.queue.indexOf(job), 1);
    p.statistics.built++;
    emit(w, p, "constructed", { cell: job.cell });
    worker.mode = "returning";
  }
}
/**
 * Paid neurons grow while they touch this player's connected network. One
 * that loses every connected neighbour goes back to a waiting plan with its
 * biomass returned, so it cannot hold a sprout slot, and with it all later
 * growth, until its anchor returns; it is claimed again once something
 * connected touches it.
 */
function sprouts(w: World, p: Player) {
  for (const job of p.queue.filter((j) => j.paid && isSprout(j))) {
    const anchored = neighbors(w.map, job.cell).some((cell) =>
      w.structures.some(
        (s) => s.cell === cell && s.ownerId === p.id && s.connected,
      ),
    );
    if (!anchored) {
      const refund = Math.min(
        CONSTRUCTIONS[job.kind].cost,
        RULES.bankCap - p.biomass,
      );
      p.biomass += refund;
      job.paid = false;
      job.progress = 0;
      job.duration = 0;
      // A waiting plan is undamaged by definition (checkpoints require it),
      // so damage to the cut-off site goes with the refund.
      job.hp = hp(job.kind);
      emit(w, p, "stalled", {
        cell: job.cell,
        amount: refund,
        resource: "biomass",
        reason: "cut off, refunded",
      });
      continue;
    }
    job.progress += hasBuff(p, "surge", w.tick) ? 2 : 1;
    if (job.progress < job.duration) continue;
    w.structures.push({
      id: w.nextEntityId++,
      cell: job.cell,
      ownerId: p.id,
      kind: job.kind,
      hp: job.hp,
      connected: true,
    });
    p.queue.splice(p.queue.indexOf(job), 1);
    p.statistics.built++;
    emit(w, p, "constructed", { cell: job.cell });
  }
}
function recoverParticle(w: World, particle: Particle) {
  particle.mode = "recovering";
  particle.recoverAt =
    w.tick + PARTICLES[particle.kind].recovery + particle.speed;
}
function advanceParticle(
  w: World,
  player: Player,
  particle: Particle,
  brainCell: number,
  index: CellIndex,
): void {
  if (particle.mode === "recovering") {
    if (particle.recoverAt > w.tick) return;
    particle.cell = brainCell;
    particle.mode = "stationed";
    particle.destination = brainCell;
    Object.assign(particle, particleProfile(player));
  }
  if (particle.mode === "transit") {
    const hasConduit = (cell: number) => {
      const node = index.get(cell);
      return node?.connected && node.ownerId === player.id;
    };
    if (!hasConduit(particle.from) || !hasConduit(particle.to))
      return recoverParticle(w, particle);
    if (particle.arrivesAt > w.tick) return;
    particle.cell = particle.to;
    particle.mode = "stationed";
  }
  if (!index.get(particle.cell)?.connected) recoverParticle(w, particle);
}

const particleEdge = (a: number, b: number) =>
  a < b ? `${a}:${b}` : `${b}:${a}`;

function transitCounts(particles: readonly Particle[]) {
  const transitsOn = new Map<string, number>();
  for (const particle of particles) {
    if (particle.mode !== "transit") continue;
    const edge = particleEdge(particle.from, particle.to);
    transitsOn.set(edge, (transitsOn.get(edge) ?? 0) + 1);
  }
  return transitsOn;
}

function particleTraffic(w: World, active: readonly Particle[]) {
  const transitsOn = transitCounts(w.particles);
  const arriving = new Map<number, number>();
  for (const particle of active) {
    const cell = particle.mode === "transit" ? particle.to : particle.cell;
    arriving.set(cell, (arriving.get(cell) ?? 0) + 1);
  }
  return { transitsOn, arriving };
}

function particles(
  w: World,
  p: Player,
  index: CellIndex,
  edgeLaunch: Map<string, number>,
) {
  const b = brain(w, p);
  if (!b) return;
  const all = w.particles.filter((q) => q.ownerId === p.id);
  for (const q of all) advanceParticle(w, p, q, b.cell, index);
  const active = all.filter((q) => q.mode !== "recovering");
  balanceParticleDestinations(w.map, p, active, b.cell, index);
  // Rotate arbitration to avoid permanently privileging low particle IDs.
  const ordered = [...all.slice(w.tick % 128), ...all.slice(0, w.tick % 128)];
  // Edge and arrival counts are kept as particles launch, matching a fresh count at every decision.
  const routes = new Map<string, Route | undefined>();
  const { transitsOn, arriving } = particleTraffic(w, active);
  for (const q of ordered) {
    if (
      q.mode !== "stationed" ||
      q.cell === q.destination ||
      q.arrivesAt === w.tick
    )
      continue;
    if (q.cell === b.cell) {
      Object.assign(q, particleProfile(p));
    }
    const key = `${q.cell}>${q.destination}`;
    if (!routes.has(key))
      routes.set(
        key,
        findRoutes(w.map, p, index, q.cell, [q.destination]).get(q.destination),
      );
    const route = routes.get(key);
    if (!route || route.distance === 0) continue;
    const next = route.next,
      edge = particleEdge(q.cell, next);
    if (
      (edgeLaunch.get(edge) ?? 0) >= RULES.edgeLaunchCapacity ||
      (transitsOn.get(edge) ?? 0) >= RULES.edgeTransitCapacity ||
      (arriving.get(next) ?? 0) >= 128
    )
      continue;
    edgeLaunch.set(edge, (edgeLaunch.get(edge) ?? 0) + 1);
    transitsOn.set(edge, (transitsOn.get(edge) ?? 0) + 1);
    arriving.set(q.cell, (arriving.get(q.cell) ?? 0) - 1);
    arriving.set(next, (arriving.get(next) ?? 0) + 1);
    q.from = q.cell;
    q.to = next;
    q.departedAt = w.tick;
    q.arrivesAt = w.tick + q.speed;
    q.mode = "transit";
  }
}
interface CombatShot {
  player: Player;
  from: number;
  cell: number;
  owner: string;
  site: boolean;
  id: number;
  damage: number;
}

function unshieldedDamage(
  w: World,
  shot: CombatShot,
  owner: Player,
  availableAt: (structure: Structure) => Particle[],
): number {
  const order = homeOrder(w.map, owner.slot);
  const protectors = w.structures
    .filter(
      (s) =>
        s.ownerId === owner.id &&
        s.connected &&
        protectionCells(w, s.kind, s.cell).has(shot.cell),
    )
    .sort((a, b) => order(a.cell, b.cell));
  // Fields do not stack their percentage. Supplied protectors share the finite cost.
  const percent = Math.max(
    0,
    ...protectors.map((s) => STRUCTURES[s.kind].protection!.absorbPercent),
  );
  const limit = Math.floor((shot.damage * percent) / 100);
  let remaining = limit;
  for (const protector of protectors) {
    if (remaining <= 0) break;
    const definition = STRUCTURES[protector.kind].protection!;
    const before = remaining;
    for (const particle of availableAt(protector)) {
      if (remaining <= 0) break;
      remaining -= Math.min(
        remaining,
        particle.attack * definition.capacityPerAttack,
      );
      recoverParticle(w, particle);
    }
    const absorbed = before - remaining;
    if (absorbed)
      emit(w, owner, "shielded", {
        cell: shot.cell,
        fromCell: protector.cell,
        amount: absorbed,
      });
  }
  return shot.damage - (limit - remaining);
}

function chooseTarget(
  w: World,
  s: Structure,
  p: Player,
  adjacentEnemies: (cell: number, owner: string) => Structure[],
) {
  const weapon = STRUCTURES[s.kind];
  const cells = attackCells(w.map, s.cell, s.kind);
  const targets = [
    ...w.structures
      .filter((t) => t.ownerId !== s.ownerId && cells.has(t.cell))
      .map((t) => ({
        cell: t.cell,
        hp: t.hp,
        id: t.id,
        owner: t.ownerId,
        site: false,
        priority:
          t.kind === "brain"
            ? 0
            : t.connected &&
                canAttack(t.kind) &&
                attackCells(w.map, t.cell, t.kind).has(s.cell)
              ? 1
              : 2,
      })),
    ...w.players
      .filter((o) => o.id !== p.id)
      .flatMap((o) =>
        o.queue
          .filter(
            (j) => j.paid && j.upgradeFrom === undefined && cells.has(j.cell),
          )
          .map((j) => ({
            cell: j.cell,
            hp: j.hp,
            id: -1,
            owner: o.id,
            site: true,
            priority: 3,
          })),
      ),
  ];
  // Splash weapons aim where the burst hits most: the target with the most
  // enemy structures beside it. Others finish the weakest target first.
  const cluster = (cell: number) =>
    weapon.splashPercent ? adjacentEnemies(cell, s.ownerId).length : 0;
  const density = new Map(targets.map((t) => [t.cell, cluster(t.cell)]));
  targets.sort(
    (a, b) =>
      a.priority - b.priority ||
      density.get(b.cell)! - density.get(a.cell)! ||
      a.hp - b.hp ||
      homeCellOrder(w.map, p.slot, a.cell, b.cell),
  );
  const first = targets[0];
  if (!first) return undefined;
  const equal = targets.filter(
    (t) =>
      t.priority === first.priority &&
      density.get(t.cell) === density.get(first.cell) &&
      t.hp === first.hp,
  );
  return equal[(s.firingCursor ?? 0) % equal.length];
}

function resolveSalvos(
  w: World,
  shots: CombatShot[],
  players: Map<string, Player>,
  availableAt: (s: Structure) => Particle[],
) {
  const brainIds = new Set(
    w.structures.filter((s) => s.kind === "brain").map((s) => s.id),
  );
  // Resolve protection after every gun reserves its salvo. A particle cannot
  // fire and shield in the same tick. Protectors and victims remain alive until
  // simultaneous damage is applied, as with offensive fire.
  // Spend shared protection on brain attacks first, then strongest salvos.
  // Home-relative cell ties preserve swapped-seat symmetry and make allocation
  // independent of structure-array insertion order.
  shots.sort((a, b) => {
    if (a.owner !== b.owner) return a.owner < b.owner ? -1 : 1;
    const slot = players.get(a.owner)!.slot;
    const priority = (shot: typeof a) => (brainIds.has(shot.id) ? 0 : 1);
    return (
      priority(a) - priority(b) ||
      b.damage - a.damage ||
      homeCellOrder(w.map, slot, a.cell, b.cell) ||
      homeCellOrder(w.map, slot, a.from, b.from)
    );
  });
  const hits = new Map<number, number>();
  const siteHits = new Map<string, number>();
  for (const shot of shots) {
    const damage = unshieldedDamage(
      w,
      shot,
      players.get(shot.owner)!,
      availableAt,
    );
    if (shot.site) {
      const key = `${shot.owner}:${shot.cell}`;
      siteHits.set(key, (siteHits.get(key) ?? 0) + damage);
    } else hits.set(shot.id, (hits.get(shot.id) ?? 0) + damage);
    shot.player.statistics.damage += damage;
    emit(w, shot.player, "damage", {
      cell: shot.cell,
      fromCell: shot.from,
      amount: damage,
    });
  }
  return { hits, siteHits };
}

function combat(w: World) {
  const structures = cellIndex(w);
  const players = new Map(w.players.map((player) => [player.id, player]));
  const adjacentEnemies = (cell: number, owner: string): Structure[] =>
    neighbors(w.map, cell)
      .map((adjacent) => structures.get(adjacent))
      .filter((s): s is Structure => s !== undefined && s.ownerId !== owner);
  const supplies = new Map<number, Particle[]>();
  for (const q of w.particles) {
    if (q.mode !== "stationed" || q.cell !== q.destination) continue;
    const atCell = supplies.get(q.cell);
    if (atCell) atCell.push(q);
    else supplies.set(q.cell, [q]);
  }
  // The index keeps particle order. A particle already reserved this tick is recovering.
  const availableAt = (s: Structure) =>
    (supplies.get(s.cell) ?? []).filter(
      (q) => q.ownerId === s.ownerId && q.mode === "stationed",
    );
  const shots: CombatShot[] = [];
  for (const s of w.structures) {
    const weapon = STRUCTURES[s.kind];
    if (!s.connected || !canAttack(s.kind)) continue;
    const p = players.get(s.ownerId)!;
    // Synaptic frenzy halves the time between volleys.
    const cadence = hasBuff(p, "frenzy", w.tick)
      ? Math.max(1, Math.floor(weapon.cadence / 2))
      : weapon.cadence;
    if (w.tick % cadence !== 0) continue;
    const target = chooseTarget(w, s, p, adjacentEnemies);
    if (!target) continue;
    const ammo = availableAt(s).slice(0, weapon.volley);
    const damage = ammo.reduce((sum, q) => sum + q.attack, 0);
    if (!damage) continue;
    s.firingCursor = (s.firingCursor ?? 0) + 1;
    for (const q of ammo) recoverParticle(w, q);
    shots.push({ player: p, from: s.cell, ...target, damage });
    // Spores burst on impact: every enemy structure beside the target is hit too.
    const splash = Math.floor((damage * (weapon.splashPercent ?? 0)) / 100);
    if (splash > 0)
      for (const t of adjacentEnemies(target.cell, s.ownerId))
        shots.push({
          player: p,
          from: s.cell,
          cell: t.cell,
          owner: t.ownerId,
          site: false,
          id: t.id,
          damage: splash,
        });
  }
  const { hits, siteHits } = resolveSalvos(w, shots, players, availableAt);
  applyCombatLosses(w, hits, siteHits);
}
function applyCombatLosses(
  w: World,
  hits: Map<number, number>,
  siteHits: Map<string, number>,
) {
  for (const s of w.structures) s.hp -= hits.get(s.id) ?? 0;
  for (const p of w.players) {
    let builderLostSite = false;
    p.queue = p.queue.filter((job) => {
      job.hp -= siteHits.get(`${p.id}:${job.cell}`) ?? 0;
      if (job.hp > 0) return true;
      if (!job.paid) return false;
      builderLostSite ||= !isSprout(job);
      if (job.upgradeFrom === undefined) {
        p.statistics.sitesLost++;
        emit(w, p, "destroyed", { cell: job.cell });
      }
      return false;
    });
    if (builderLostSite && p.worker.mode !== "recovering")
      p.worker.mode = "returning";
  }
  const destroyed = w.structures.filter((s) => s.hp <= 0);
  for (const s of destroyed) {
    const p = w.players.find((p) => p.id === s.ownerId)!;
    p.statistics.lost++;
    delete p.priorities[String(s.cell)];
    emit(w, p, "destroyed", { cell: s.cell });
  }
  w.structures = w.structures.filter((s) => s.hp > 0);
  const survivors = new Set(w.structures.map((s) => s.id));
  for (const p of w.players) {
    p.queue = p.queue.filter((job) => {
      if (job.upgradeFrom === undefined || survivors.has(job.upgradeFrom))
        return true;
      if (job.paid) p.worker.mode = "returning";
      return false;
    });
  }
  eliminateDefeatedPlayers(w);
}

function eliminateDefeatedPlayers(w: World) {
  for (const p of w.players)
    if (p.alive && !brain(w, p)) {
      p.alive = false;
      p.autoExpand = false;
      p.queue = [];
      p.researchJob = null;
      p.priorities = {};
      p.territory = 0;
      p.dominanceSince = null;
      w.structures = w.structures.filter((s) => s.ownerId !== p.id);
      w.particles = w.particles.filter((q) => q.ownerId !== p.id);
      emit(w, p, "eliminated");
    }
  const alive = w.players.filter((p) => p.alive);
  if (w.players.length > 1 && alive.length <= 1) {
    w.finished = true;
    w.winnerId = alive[0]?.id ?? null;
    w.victory = alive.length ? "elimination" : null;
  }
}
export function step(state: World, commands: readonly Command[] = []): World {
  if (commands.length > 256) throw new Error("too many commands in one tick");
  const w = clone(state);
  w.outcomes = [];
  if (w.finished) return w;
  w.tick++;
  connectivity(w);
  for (const c of [...commands].sort((a, b) =>
    a.playerId < b.playerId
      ? -1
      : a.playerId > b.playerId
        ? 1
        : a.sequence - b.sequence,
  ))
    apply(w, c);
  for (const p of w.players) if (p.alive) economy(w, p);
  // Damage resolves before completion, so a killed site cannot become a healthy building.
  combat(w);
  connectivity(w);
  for (const p of w.players)
    for (const cell of Object.keys(p.priorities))
      if (structure(w, Number(cell))?.ownerId !== p.id)
        delete p.priorities[cell];
  const workerIndex = cellIndex(w);
  const ready = w.players.filter(
    (p) => p.alive && prepareWorker(w, p, workerIndex),
  );
  const automatic: { player: Player; cell: number }[] = [];
  for (const p of w.players) {
    if (!p.alive) continue;
    const cell = autoExpandCell(w, p);
    if (cell !== null) {
      p.queue.push({
        cell,
        kind: "neuron",
        paid: false,
        progress: 0,
        duration: 0,
        hp: hp("neuron"),
      });
      automatic.push({ player: p, cell });
    }
  }
  for (const p of w.players) if (p.alive) dropTakenPlans(w, p);
  dispatchConstruction(w, ready);
  // Losing automatic claims are retried from the next authoritative board;
  // they must not become stale ghost jobs that block this player's expansion.
  for (const { player, cell } of automatic)
    player.queue = player.queue.filter((job) => job.cell !== cell || job.paid);
  for (const p of ready) worker(w, p);
  for (const p of w.players) if (p.alive) sprouts(w, p);
  connectivity(w);
  powerupPhase(w);
  if (!w.finished) {
    const dominant = territoryPhase(w, (id, type) =>
      emit(
        w,
        w.players.find((p) => p.id === id)!,
        type,
      ),
    );
    if (dominant) {
      w.finished = true;
      w.winnerId = dominant;
      w.victory = "dominance";
    }
  }
  const launches = new Map<string, number>();
  const particleIndex = cellIndex(w);
  for (const p of w.players)
    if (p.alive) particles(w, p, particleIndex, launches);
  recordTimeline(w, w.outcomes);
  return w;
}
export function observe(world: World): Readonly<World> {
  return clone(world);
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, v]) => [key, canonical(v)]),
    );
  return value;
}
export function encodeState(world: World): string {
  return JSON.stringify(canonical(world));
}
export function hashState(world: World): string {
  let hash = 2166136261;
  const text = encodeState({ ...world, outcomes: [] });
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
export function decodeState(raw: unknown): World {
  if (typeof raw !== "string" || raw.length > 4_000_000)
    throw new Error("checkpoint: invalid size");
  const w: World = JSON.parse(raw);
  if (
    !record(w) ||
    w.formatVersion !== 1 ||
    w.rulesVersion !== RULES.version ||
    !integer(w.tick) ||
    !Array.isArray(w.players) ||
    !Array.isArray(w.structures) ||
    !Array.isArray(w.particles) ||
    !record(w.settings) ||
    w.structures.length > 4096 ||
    w.particles.length > RULES.particleCount * RULES.maxPlayers
  )
    throw new Error("checkpoint: unsupported or malformed");
  validateSetup(
    w.map,
    w.settings,
    w.players.map((p) => ({ id: p.id, slot: p.slot })),
  );
  if (
    typeof w.matchId !== "string" ||
    w.matchId.length > 128 ||
    w.matchId !== (w.settings.matchId ?? "sandbox") ||
    !integer(w.nextEntityId, 1) ||
    typeof w.finished !== "boolean" ||
    !Array.isArray(w.outcomes) ||
    w.outcomes.length > 2048
  )
    throw new Error("checkpoint: invalid world");
  if (w.players.some((p, i) => i > 0 && w.players[i - 1]!.id >= p.id))
    throw new Error("checkpoint: players out of order");
  const owners = new Set(w.players.map((p) => p.id)),
    ids = new Set<number>(),
    structures = new Map<number, Structure>();
  for (const o of w.outcomes)
    if (
      !o ||
      !owners.has(o.playerId) ||
      !integer(o.tick, 0, w.tick) ||
      ![
        "rejected",
        "queued",
        "dropped",
        "stalled",
        "dispatched",
        "constructed",
        "researched",
        "researchStarted",
        "income",
        "damage",
        "shielded",
        "destroyed",
        "eliminated",
        "claimed",
        "dominating",
        "dominanceBroken",
      ].includes(o.type) ||
      (o.cell !== undefined && !integer(o.cell, 0, w.map.cells.length - 1)) ||
      (o.fromCell !== undefined &&
        !integer(o.fromCell, 0, w.map.cells.length - 1)) ||
      (o.amount !== undefined && !integer(o.amount)) ||
      (o.type === "shielded" &&
        (!integer(o.cell, 0, w.map.cells.length - 1) ||
          !integer(o.fromCell, 0, w.map.cells.length - 1) ||
          !integer(o.amount, 1))) ||
      (o.resource !== undefined &&
        !["biomass", "insight"].includes(o.resource)) ||
      (o.reason !== undefined &&
        (typeof o.reason !== "string" || o.reason.length > 256))
    )
      throw new Error("checkpoint: invalid events");
  for (const s of w.structures) {
    if (
      !record(s) ||
      !owners.has(s.ownerId) ||
      !integer(s.id, 1) ||
      ids.has(s.id) ||
      !integer(s.cell, 0, w.map.cells.length - 1) ||
      w.map.cells[s.cell]?.terrain !== "open" ||
      structures.has(s.cell) ||
      (s.kind !== "brain" && !isBuildKind(s.kind)) ||
      !integer(s.hp, 1, hp(s.kind)) ||
      typeof s.connected !== "boolean" ||
      (s.firingCursor !== undefined && !integer(s.firingCursor))
    )
      throw new Error("checkpoint: invalid structure");
    ids.add(s.id);
    structures.set(s.cell, s);
  }
  const occupied = new Set(structures.keys());
  const brains = brainIndex(w.structures);
  for (const p of w.players) {
    if (
      typeof p.alive !== "boolean" ||
      !integer(p.biomass, 0, RULES.bankCap) ||
      !integer(p.insight, 0, RULES.bankCap) ||
      typeof p.autoExpand !== "boolean" ||
      !isParticleKind(p.particleKind) ||
      (!p.alive && p.autoExpand) ||
      !integer(p.sequence, -1) ||
      !Array.isArray(p.queue) ||
      p.queue.length > RULES.queueLimit ||
      !Array.isArray(p.research) ||
      p.research.some((r) => !isResearchKind(r)) ||
      new Set(p.research).size !== p.research.length ||
      !record(p.worker) ||
      !["idle", "outbound", "building", "returning", "recovering"].includes(
        p.worker.mode,
      ) ||
      !record(p.priorities) ||
      Object.keys(p.priorities).length > 8 ||
      !record(p.miningRemainders) ||
      !record(p.statistics) ||
      !integer(p.territory, 0, w.map.cells.length) ||
      (p.dominanceSince !== null && !integer(p.dominanceSince, 0, w.tick)) ||
      (!p.alive && (p.territory !== 0 || p.dominanceSince !== null)) ||
      !Array.isArray(p.buffs) ||
      p.buffs.length > 2 ||
      (!w.settings.powerups && p.buffs.length > 0) ||
      p.buffs.some(
        (b, i) =>
          !record(b) ||
          !isBuffKind(b.kind) ||
          // Stacked pickups extend a buff, at most once per powerup spawned.
          !integer(
            b.expiresAt,
            w.tick + 1,
            w.tick +
              Math.max(POWERUP_RULES.surgeTicks, POWERUP_RULES.frenzyTicks) *
                Math.max(1, w.powerupSerial),
          ) ||
          (i > 0 && p.buffs[i - 1]!.kind >= b.kind),
      )
    )
      throw new Error("checkpoint: invalid player");
    if (
      researchPrerequisites(p, PARTICLES[p.particleKind].requires).length ||
      p.research.some(
        (kind) => researchPrerequisites(p, RESEARCH[kind].requires).length,
      )
    )
      throw new Error("checkpoint: unmet research prerequisite");
    for (const [key, value] of Object.entries(p.priorities))
      if (
        !integer(Number(key), 0, w.map.cells.length - 1) ||
        String(Number(key)) !== key ||
        !integer(value, 1, 3) ||
        structures.get(Number(key))?.ownerId !== p.id ||
        !canAttack(structures.get(Number(key))!.kind)
      )
        throw new Error("checkpoint: invalid priorities");
    for (const [cell, n] of Object.entries(p.miningRemainders))
      if (
        String(Number(cell)) !== cell ||
        w.map.cells[Number(cell)]?.terrain !== "deposit" ||
        !integer(n, 0, 119)
      )
        throw new Error("checkpoint: invalid remainder");
    for (const key of [
      "biomassEarned",
      "insightEarned",
      "built",
      "damage",
      "lost",
      "sitesLost",
    ] as const)
      if (!integer(p.statistics[key]))
        throw new Error("checkpoint: invalid statistics");
    if (
      p.researchJob !== null &&
      (!record(p.researchJob) ||
        !isResearchKind(p.researchJob.kind) ||
        researchPrerequisites(p, RESEARCH[p.researchJob.kind].requires).length >
          0 ||
        p.research.includes(p.researchJob.kind) ||
        !integer(
          p.researchJob.completesAt,
          w.tick + 1,
          w.tick + RESEARCH[p.researchJob.kind].duration,
        ))
    )
      throw new Error("checkpoint: invalid research job");
    for (const j of p.queue) {
      const source = isBuildKind(j.kind)
        ? constructionUpgradeSource(w, p, j.kind, j.cell)
        : undefined;
      if (
        !record(j) ||
        !integer(j.cell, 0, w.map.cells.length - 1) ||
        w.map.cells[j.cell]?.terrain !== "open" ||
        !isBuildKind(j.kind) ||
        constructionSiteRequirements(w, j.kind, j.cell).length > 0 ||
        researchPrerequisites(p, CONSTRUCTIONS[j.kind].requires).length > 0 ||
        typeof j.paid !== "boolean" ||
        !integer(j.progress) ||
        !integer(j.duration) ||
        // Zero-time work exists only with debug instant construction.
        (j.paid
          ? w.settings.instantConstruction
            ? j.duration !== 0
            : j.duration === 0 ||
              !constructionDurations(j.kind).includes(j.duration)
          : !constructionDurations(j.kind).includes(j.duration)) ||
        !integer(j.hp, 1, hp(j.kind)) ||
        (!j.paid &&
          (j.progress !== 0 || j.duration !== 0 || j.hp !== hp(j.kind))) ||
        (j.paid &&
          (j.duration === 0 ? j.progress !== 0 : j.progress >= j.duration)) ||
        (j.upgradeFrom !== undefined &&
          (!integer(j.upgradeFrom) ||
            source?.id !== j.upgradeFrom ||
            j.hp !== hp(j.kind))) ||
        (j.paid &&
          occupied.has(j.cell) &&
          (j.upgradeFrom === undefined || source?.id !== j.upgradeFrom))
      )
        throw new Error("checkpoint: invalid construction");
      if (j.paid) occupied.add(j.cell);
    }
    for (const key of ["cell", "from", "to"] as const)
      if (!integer(p.worker[key], 0, w.map.cells.length - 1))
        throw new Error("checkpoint: invalid worker location");
    for (const key of ["departedAt", "arrivesAt", "recoverAt"] as const)
      if (!integer(p.worker[key]))
        throw new Error("checkpoint: invalid worker timing");
    const worker = p.worker;
    const paid = p.queue.some((j) => j.paid && !isSprout(j));
    if (
      p.alive &&
      (worker.departedAt > w.tick ||
        (["outbound", "building"].includes(worker.mode) && !paid) ||
        (["idle", "returning"].includes(worker.mode) && paid) ||
        (worker.mode === "idle" && worker.cell !== brains.get(p.id)?.cell) ||
        (worker.mode === "recovering" &&
          !integer(worker.recoverAt, w.tick + 1, w.tick + RULES.recoveryTicks)))
    )
      throw new Error("checkpoint: inconsistent worker");
    if (p.alive && worker.mode !== "recovering") {
      const from = structures.get(worker.cell),
        to = structures.get(worker.to);
      if (
        !from?.connected ||
        from.ownerId !== p.id ||
        !to?.connected ||
        to.ownerId !== p.id ||
        worker.from !== worker.cell ||
        (worker.to !== worker.cell &&
          (!neighbors(w.map, worker.from).includes(worker.to) ||
            worker.arrivesAt <= w.tick ||
            ![3, 4].includes(worker.arrivesAt - worker.departedAt))) ||
        (worker.to === worker.cell && worker.arrivesAt > w.tick)
      )
        throw new Error("checkpoint: invalid worker transit");
    }
    if (
      p.queue.filter((j) => j.paid && !isSprout(j)).length > 1 ||
      p.queue.filter((j) => j.paid && isSprout(j)).length > SPROUT.maxSlots ||
      new Set(p.queue.map((j) => j.cell)).size !== p.queue.length ||
      w.structures.filter((s) => s.ownerId === p.id && s.kind === "brain")
        .length !== (p.alive ? 1 : 0) ||
      p.alive !== brains.has(p.id) ||
      (!p.alive &&
        (p.queue.length > 0 ||
          p.researchJob !== null ||
          Object.keys(p.priorities).length > 0 ||
          w.structures.some((s) => s.ownerId === p.id))) ||
      w.particles.filter((q) => q.ownerId === p.id).length !==
        (p.alive ? 128 : 0)
    )
      throw new Error("checkpoint: particle conservation or brain mismatch");
  }
  for (const s of w.structures) {
    const owner = w.players.find((p) => p.id === s.ownerId)!;
    if (
      s.kind !== "brain" &&
      (researchPrerequisites(owner, CONSTRUCTIONS[s.kind].requires).length ||
        constructionSiteRequirements(w, s.kind, s.cell).length)
    )
      throw new Error("checkpoint: structure requires research");
  }
  for (const q of w.particles) {
    if (
      !record(q) ||
      !owners.has(q.ownerId) ||
      !integer(q.id, 1) ||
      ids.has(q.id) ||
      !["stationed", "transit", "recovering"].includes(q.mode) ||
      !isParticleKind(q.kind) ||
      researchPrerequisites(
        w.players.find((p) => p.id === q.ownerId)!,
        PARTICLES[q.kind].requires,
      ).length > 0 ||
      // Upgrades apply only once researched, and only when a particle is
      // re-equipped, so either value is possible after research, not before.
      ![
        PARTICLES[q.kind].attack,
        ...(w.players
          .find((p) => p.id === q.ownerId)!
          .research.includes("excitation")
          ? [PARTICLES[q.kind].attack + 1]
          : []),
      ].includes(q.attack) ||
      ![
        PARTICLES[q.kind].speed,
        ...(w.players
          .find((p) => p.id === q.ownerId)!
          .research.includes("conduction")
          ? [PARTICLES[q.kind].speed - 1]
          : []),
      ].includes(q.speed)
    )
      throw new Error("checkpoint: invalid particle");
    ids.add(q.id);
    for (const key of ["cell", "from", "to", "destination"] as const)
      if (!integer(q[key], 0, w.map.cells.length - 1))
        throw new Error("checkpoint: invalid particle location");
    for (const key of ["departedAt", "arrivesAt", "recoverAt"] as const)
      if (!integer(q[key]))
        throw new Error("checkpoint: invalid particle timing");
    if (
      q.mode === "transit" &&
      (!neighbors(w.map, q.from).includes(q.to) ||
        q.arrivesAt - q.departedAt !== q.speed ||
        q.departedAt > w.tick ||
        q.cell !== q.from ||
        ![q.from, q.to].every((cell) => {
          const s = structures.get(cell);
          return s?.connected && s.ownerId === q.ownerId;
        }))
    )
      throw new Error("checkpoint: invalid transit");
    if (
      q.mode === "recovering" &&
      !integer(
        q.recoverAt,
        w.tick + 1,
        w.tick + PARTICLES[q.kind].recovery + q.speed,
      )
    )
      throw new Error("checkpoint: invalid recovery");
  }
  if (
    !Array.isArray(w.powerups) ||
    w.powerups.length > POWERUP_RULES.maxActive ||
    !integer(w.powerupSerial, w.powerups.length) ||
    (!w.settings.powerups && (w.powerups.length > 0 || w.powerupSerial > 0))
  )
    throw new Error("checkpoint: invalid powerups");
  for (const p of w.powerups) {
    if (
      !record(p) ||
      !integer(p.id, 1) ||
      ids.has(p.id) ||
      !integer(p.cell, 0, w.map.cells.length - 1) ||
      w.map.cells[p.cell]?.terrain !== "open" ||
      w.powerups.filter((q) => q.cell === p.cell).length > 1 ||
      !isPowerupKind(p.kind) ||
      !integer(p.expiresAt, w.tick + 1, w.tick + POWERUP_RULES.lifetime)
    )
      throw new Error("checkpoint: invalid powerup");
    ids.add(p.id);
  }
  if ([...ids].some((id) => id >= w.nextEntityId))
    throw new Error("checkpoint: invalid identity counter");
  const connected = connectedStructures(w, structures, brains);
  if (
    w.structures.some(
      (structure) => structure.connected !== connected.has(structure),
    )
  )
    throw new Error("checkpoint: invalid connectivity");
  for (const q of w.particles) {
    const site = structures.get(q.cell);
    if (
      q.mode === "stationed" &&
      (site?.ownerId !== q.ownerId || !site.connected)
    )
      throw new Error("checkpoint: invalid stationary particle");
    if (q.mode === "transit" && q.arrivesAt <= w.tick)
      throw new Error("checkpoint: overdue transit");
  }
  const edges = transitCounts(w.particles);
  if ([...edges.values()].some((n) => n > RULES.edgeTransitCapacity))
    throw new Error("checkpoint: edge capacity exceeded");
  const alive = w.players.filter((p) => p.alive);
  const eliminated = w.players.length > 1 && alive.length <= 1;
  // Territory and the dominance clock come from the network. A match still
  // in play cannot claim more than its structures claim, nor run a clock
  // without the dominant share and lead (an ended match may be a tick stale).
  if (!w.finished) {
    const counts = territoryCounts(w);
    const needed = dominanceCells(w);
    for (const p of alive) {
      const rival = Math.max(
        0,
        ...alive.filter((q) => q !== p).map((q) => q.territory),
      );
      if (
        p.territory > (counts.get(p.id) ?? 0) ||
        (p.dominanceSince !== null &&
          (w.players.length < 2 ||
            p.territory < needed ||
            p.territory < rival * DOMINANCE_LEAD))
      )
        throw new Error("checkpoint: invalid territory");
    }
  }
  if (
    !["elimination", "dominance", null].includes(w.victory) ||
    (!w.finished && (w.winnerId !== null || w.victory !== null)) ||
    (w.winnerId !== null && !alive.some((p) => p.id === w.winnerId)) ||
    (w.victory === "dominance"
      ? !w.finished || w.winnerId === null || eliminated
      : w.finished !== eliminated ||
        (w.finished && w.winnerId !== (alive[0]?.id ?? null)) ||
        (w.victory === "elimination") !== (w.finished && w.winnerId !== null))
  )
    throw new Error("checkpoint: invalid outcome");
  if (
    !Array.isArray(w.timeline) ||
    w.timeline.length > TIMELINE.maxSamples ||
    w.timeline.some(
      (sample, i) =>
        !record(sample) ||
        !integer(sample.tick, 0, w.tick) ||
        (i > 0 && sample.tick <= w.timeline[i - 1]!.tick) ||
        !Array.isArray(sample.players) ||
        sample.players.length !== w.players.length ||
        sample.players.some(
          (entry, j) =>
            !record(entry) ||
            entry.id !== w.players[j]!.id ||
            (
              [
                "territory",
                "structures",
                "weapons",
                "biomassEarned",
                "insightEarned",
                "damage",
                "lost",
                "biomass",
              ] as const
            ).some((key) => !integer(entry[key])),
        ),
    ) ||
    !Array.isArray(w.events) ||
    w.events.length > TIMELINE.maxEvents ||
    w.events.some(
      (e) =>
        !record(e) ||
        !integer(e.tick, 0, w.tick) ||
        !owners.has(e.playerId) ||
        !(EVENT_TYPES as readonly string[]).includes(e.type) ||
        (e.detail !== undefined &&
          (typeof e.detail !== "string" || e.detail.length > 64)),
    )
  )
    throw new Error("checkpoint: invalid timeline");
  return clone(w);
}
