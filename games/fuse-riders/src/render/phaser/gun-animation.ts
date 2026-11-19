import type { WorldView as ViewSnapshot } from "../../engine/view.js";

type Tracer = ViewSnapshot["bombs"][number];

interface ShotFamily {
  root: Tracer;
  active: ActiveRay[];
}

interface ActiveRay {
  ray: Tracer;
  strength: number;
  family: ShotFamily;
}

function shotFamilies(
  bombs: ViewSnapshot["bombs"],
  sample?: (ray: Tracer, family: ShotFamily) => void,
): Map<string, ShotFamily> {
  const families = new Map<string, ShotFamily>();
  for (const ray of bombs) {
    if (!ray.shell?.gun) continue;
    const key = `${ray.ownerId}:${ray.launchedTick}:${ray.shell.vx}:${ray.shell.vy}`;
    let family = families.get(key);
    if (!family) {
      family = { root: ray, active: [] };
      families.set(key, family);
    } else if (ray.id < family.root.id) family.root = ray;
    sample?.(ray, family);
  }
  return families;
}

/** A portal/wrap continuation has the same direction and birth tick, but a later id. */
export function gunRoots(bombs: ViewSnapshot["bombs"]): Tracer[] {
  return [...shotFamilies(bombs).values()].map((family) => family.root);
}

/** Samples supplied world time only; neither recoil nor flash changes rider position. */
export function gunFrame(bomb: Tracer, tick: number) {
  const age = tick - bomb.launchedTick;
  const visible = !!bomb.shell?.gun && age >= 0 && tick < bomb.explodeAtTick;
  return {
    alpha: visible
      ? (1 - age / Math.max(1, bomb.explodeAtTick - bomb.launchedTick)) ** 2
      : 0,
    glow: visible ? Math.max(0, 1 - age / 1.5) : 0,
    flash: visible ? Math.max(0, 1 - age) : 0,
    recoil: visible ? 5 * Math.sin(Math.min(1, age / 2) * Math.PI) : 0,
    dx: bomb.shell?.vx ?? 0,
    dy: bomb.shell?.vy ?? 0,
  };
}

interface PortalPulse {
  pairId: string;
  strength: number;
  entry: { x: number; y: number };
  exit: { x: number; y: number };
}

interface PortalShot {
  pulses: PortalPulse[];
  glow: number;
}

/** Match supplied incoming and outgoing segments; a ray merely ending near a gate does not pulse it. */
function collectPortalPulses(
  snapshot: ViewSnapshot,
  tick: number,
  rays: readonly ActiveRay[],
): PortalPulse[] {
  const pulses: PortalPulse[] = [];
  const clearance =
    snapshot.rules.portalWallHalfWidth + snapshot.rules.gunRadius;
  for (const pair of snapshot.portalPairs) {
    if (pair.expiresAtTick <= tick) continue;
    const activation = pair.expiresAtTick - snapshot.rules.portalLifetimeTicks;
    for (const [index, gate] of pair.gates.entries()) {
      const linked = pair.gates[1 - index]!;
      for (const { ray, strength, family } of rays) {
        if (ray.launchedTick < activation) continue;
        const nearY = Math.max(
          gate.y - gate.halfLength,
          Math.min(gate.y + gate.halfLength, ray.y),
        );
        if (
          Math.abs(Math.hypot(ray.x - gate.x, ray.y - nearY) - clearance) > 0.1
        )
          continue;
        const proportion = Math.max(
          -1,
          Math.min(1, (ray.y - gate.y) / gate.halfLength),
        );
        const exitY = linked.y + proportion * linked.halfLength;
        const exit = family.active.find(
          ({ ray: next }) =>
            next.id > ray.id &&
            Math.abs(Math.abs(next.launchX - linked.x) - (clearance + 1)) <
              0.1 &&
            Math.abs(next.launchY - exitY) < 0.1,
        );
        if (exit)
          pulses.push({
            pairId: pair.id,
            strength,
            entry: { x: ray.x, y: ray.y },
            exit: { x: exit.ray.launchX, y: exit.ray.launchY },
          });
      }
    }
  }
  return pulses;
}

type GunPose = ReturnType<typeof gunFrame>;

function indexGunFrame(snapshot: ViewSnapshot, tick: number) {
  const rays: ActiveRay[] = [];
  const poses = new Map<Tracer, GunPose>();
  const families = shotFamilies(snapshot.bombs, (ray, family) => {
    const pose = gunFrame(ray, tick);
    poses.set(ray, pose);
    // A NaN direction cannot match another ray by exact equality.
    if (pose.alpha > 0 && !Number.isNaN(pose.dx) && !Number.isNaN(pose.dy)) {
      const active = { ray, strength: pose.alpha, family };
      family.active.push(active);
      rays.push(active);
    }
  });
  return { rays, poses, families };
}

export function gunPortalPulses(
  snapshot: ViewSnapshot,
  tick: number,
): PortalPulse[] {
  return collectPortalPulses(
    snapshot,
    tick,
    indexGunFrame(snapshot, tick).rays,
  );
}

/** A frame shares each ray's animation and gives each portal its ordered pulses and brightest hit. */
export function sampleGunPresentation(snapshot: ViewSnapshot) {
  const tick = snapshot.presentationTick ?? snapshot.tick;
  const { rays, poses, families } = indexGunFrame(snapshot, tick);
  const roots = [...families.values()].map((family) => family.root);
  const portals = new Map<string, PortalShot>();
  for (const pulse of collectPortalPulses(snapshot, tick, rays)) {
    const prior = portals.get(pulse.pairId);
    if (prior) {
      prior.pulses.push(pulse);
      prior.glow = Math.max(prior.glow, pulse.strength);
    } else portals.set(pulse.pairId, { pulses: [pulse], glow: pulse.strength });
  }
  return { tick, roots, poses, portals };
}
