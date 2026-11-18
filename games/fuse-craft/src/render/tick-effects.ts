import type { Outcome, StructureKind, World } from "../engine/types.js";
import { POWERUP_PRESENTATION, isPowerupKind } from "../engine/powerups.js";
import { combatEffect } from "./combat-effects.js";
import { TEAM_PALETTES } from "./creep.js";
import {
  CYTOPLASM,
  EMBERS,
  rgb,
  SPARKS,
  SPORES,
  SPROUT,
  type LightField,
  type Rgb,
} from "./light-field.js";
import { organicBurst } from "./organic-burst.js";
import { claimLabelMarkup, POWERUP_STYLE } from "./powerup-art.js";
import { hexCenter } from "./projection.js";
import { weaponFlightMs, type WeaponStyle } from "./weapon-trail.js";

const ns = "http://www.w3.org/2000/svg";
const colors = TEAM_PALETTES.map((team) => team.glow);
type Pulse = {
  element: SVGElement;
  born: number;
  duration?: number;
  arrival?: boolean;
  ground?: SVGElement;
  body?: SVGElement;
  animate?: (age: number) => void;
};

export interface TickEffectState {
  tick: number;
  effectLayer: SVGGElement;
  groundEffects: SVGGElement;
  arrivalAt: Map<number, number>;
  prior: Map<number, number>;
  pulses: Pulse[];
  recoil: Map<number, { born: number; dx: number; dy: number }>;
  weaponKinds: Map<string, StructureKind>;
}

interface TickEffects {
  document: Document;
  world: Readonly<World>;
  currentKinds: ReadonlyMap<string, StructureKind>;
  now: number;
  light?: LightField;
  wreck(
    kind: StructureKind,
    cell: number,
    slot: number,
    at: BoardPoint,
  ): { artwork: SVGElement; foot: BoardPoint };
}

export function addTickEffects(
  cache: TickEffectState,
  frame: TickEffects,
): void {
  const slots = new Map(frame.world.players.map(({ id, slot }) => [id, slot]));
  addClaimEffects(cache, frame);
  addArrivalEffects(cache, frame, slots);
  if (cache.pulses.length < MAX_EFFECT_PULSES)
    addCombatEffects(cache, frame, slots);
}

const MAX_EFFECT_PULSES = 48;

function addClaimEffects(cache: TickEffectState, frame: TickEffects): void {
  const { document, world, now, light } = frame;
  const { width } = world.map;
  for (const claimed of world.outcomes)
    if (
      claimed.type === "claimed" &&
      claimed.cell !== undefined &&
      isPowerupKind(claimed.reason) &&
      cache.pulses.length < MAX_EFFECT_PULSES
    ) {
      const { x, y } = hexCenter(width, claimed.cell);
      const style = POWERUP_STYLE[claimed.reason];
      const label = document.createElementNS(ns, "g");
      label.setAttribute("class", "claim-effect");
      label.innerHTML = claimLabelMarkup(
        POWERUP_PRESENTATION[claimed.reason].label,
        claimed.reason,
        x,
        y,
      );
      cache.effectLayer.append(label);
      cache.pulses.push({
        element: label,
        born: now,
        duration: 1600,
        animate: (t) => {
          label.setAttribute(
            "transform",
            `translate(0 ${(-t * 26).toFixed(1)})`,
          );
          label.setAttribute(
            "opacity",
            String(t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85),
          );
        },
      });
      if (light) {
        const color = rgb(style.color);
        light.flash(x, y - 16, now, 70, color, 1, 520);
        light.burst(x, y - 16, now, world.tick * 7 + claimed.cell, {
          ...SPROUT(color),
          count: 34,
          speed: [30, 110],
          lift: [40, 120],
          gravity: 60,
        });
      }
    }
}

function addArrivalEffects(
  cache: TickEffectState,
  frame: TickEffects,
  slots: ReadonlyMap<string, number>,
): void {
  const { document, world, now } = frame;
  const { width } = world.map;
  for (const p of world.particles) {
    if (
      p.mode === "stationed" &&
      p.cell === cache.prior.get(p.id) &&
      now - (cache.arrivalAt.get(p.cell) ?? -Infinity) >= 160 &&
      cache.pulses.length < MAX_EFFECT_PULSES
    ) {
      const circle = document.createElementNS(ns, "circle"),
        { x, y } = hexCenter(width, p.cell);
      circle.setAttribute("cx", String(x));
      circle.setAttribute("cy", String(y));
      circle.setAttribute("class", "arrival-pulse");
      circle.setAttribute("stroke", colors[slots.get(p.ownerId) ?? 0]!);
      cache.arrivalAt.set(p.cell, now);
      cache.groundEffects.append(circle);
      cache.pulses.push({
        element: circle,
        born: now,
        duration: 260,
        arrival: true,
      });
    }
  }
}

export const weaponKey = (owner: string, cell: number | undefined) =>
  `${owner}:${cell}`;

function weaponStyle(kind: StructureKind | undefined): WeaponStyle {
  return kind === "siege" || kind === "relay" || kind === "spore"
    ? kind
    : "pulse";
}

interface IncomingHit {
  fromCell: number;
  amount: number;
  maxDelay: number;
}

function indexCombatHits(
  outcomes: readonly Outcome[],
  weaponAt: (owner: string, cell: number | undefined) => WeaponStyle,
) {
  const primary = new Map<string, Outcome>();
  const incoming = new Map<number, IncomingHit>();
  for (const outcome of outcomes) {
    const { type, playerId, fromCell, cell, amount = 0 } = outcome;
    if (type !== "damage" || fromCell === undefined) continue;

    // A spore pod flies to its hardest hit. Equal hits keep the first target.
    const shooter = weaponKey(playerId, fromCell);
    const first = primary.get(shooter);
    if (!first || amount > (first.amount ?? 0)) primary.set(shooter, outcome);
    if (cell === undefined) continue;

    const current = incoming.get(cell);
    const delay = weaponFlightMs[weaponAt(playerId, fromCell)];
    const maxDelay = Math.max(current?.maxDelay ?? 0, delay);
    // Shield and wreck direction use the strongest hit, then lowest source cell.
    if (
      !current ||
      amount > current.amount ||
      (amount === current.amount && fromCell < current.fromCell)
    ) {
      incoming.set(cell, { fromCell, amount, maxDelay });
    } else {
      current.maxDelay = maxDelay;
    }
  }
  return { primary, incoming };
}

type CombatKind = "damage" | "shielded" | "destroyed" | "constructed";

function isCombatKind(kind: Outcome["type"]): kind is CombatKind {
  switch (kind) {
    case "damage":
    case "shielded":
    case "destroyed":
    case "constructed":
      return true;
    default:
      return false;
  }
}

type BoardPoint = ReturnType<typeof hexCenter>;

function addCombatLight(
  light: LightField,
  {
    kind,
    at,
    from,
    weapon,
    lostKind,
    slot,
    now,
    hit,
    seed,
  }: {
    kind: CombatKind;
    at: BoardPoint;
    from?: BoardPoint;
    weapon: WeaponStyle;
    lostKind?: StructureKind;
    slot: number;
    now: number;
    hit: number;
    seed: number;
  },
): void {
  const team = rgb(TEAM_PALETTES[slot]!.glow);
  const fire: Rgb = [1, 0.55, 0.2];
  switch (kind) {
    case "damage":
      if (from) light.flash(from.x, from.y - 22, now, 22, team, 0.7, 150);
      if (weapon === "spore") {
        light.flash(at.x, at.y - 8, hit, 40, [0.5, 1, 0.4], 0.6, 420);
        light.burst(at.x, at.y - 4, hit, seed, SPORES);
      } else {
        light.flash(at.x, at.y - 10, hit, 34, fire, 0.75, 260);
        light.burst(at.x, at.y - 6, hit, seed, SPARKS(fire));
      }
      break;
    case "shielded":
      light.flash(at.x, at.y - 14, hit, 44, [0.45, 0.85, 1], 0.8, 320);
      break;
    case "destroyed":
      light.flash(at.x, at.y - 12, hit, 110, fire, 1, 560);
      light.burst(at.x, at.y, hit, seed, EMBERS);
      if (lostKind === "neuron")
        light.burst(at.x, at.y, hit, seed + 1, CYTOPLASM(team));
      break;
    case "constructed":
      light.flash(at.x, at.y - 6, now, 40, team, 0.55, 700);
      light.burst(at.x, at.y, now, seed, SPROUT(team));
      break;
  }
}

function addCombatEffects(
  cache: TickEffectState,
  frame: TickEffects,
  slots: ReadonlyMap<string, number>,
): void {
  const { document, world, currentKinds, now, light } = frame;
  const {
    tick,
    outcomes,
    map: { width },
  } = world;
  const priorKinds = tick === cache.tick + 1 ? cache.weaponKinds : undefined;
  const weaponAt = (owner: string, cell: number | undefined) => {
    const key = weaponKey(owner, cell);
    return weaponStyle(currentKinds.get(key) ?? priorKinds?.get(key));
  };
  const { primary, incoming } = indexCombatHits(outcomes, weaponAt);
  for (const outcome of outcomes) {
    if (cache.pulses.length >= MAX_EFFECT_PULSES) break;
    const { type, playerId, cell, fromCell } = outcome;
    if (!isCombatKind(type) || cell === undefined) continue;

    const slot = slots.get(playerId) ?? 0;
    const at = hexCenter(width, cell);
    const weapon = weaponAt(playerId, fromCell);
    const splash =
      type === "damage" &&
      weapon === "spore" &&
      primary.get(weaponKey(playerId, fromCell)) !== outcome;
    const origin = type === "damage" && !splash ? fromCell : undefined;
    const from = origin === undefined ? undefined : hexCenter(width, origin);
    const incomingHit = incoming.get(cell);
    const delay = incomingHit?.maxDelay ?? 0;
    const lostKind =
      type === "destroyed"
        ? priorKinds?.get(weaponKey(playerId, cell))
        : undefined;
    const effect = combatEffect(
      document,
      type,
      at,
      type === "destroyed" ? "#ffb767" : colors[slot]!,
      tick * 31 + cell,
      from,
      {
        wreck:
          lostKind && lostKind !== "neuron"
            ? frame.wreck(lostKind, cell, slot, at)
            : undefined,
        weapon,
        incoming: incomingHit && hexCenter(width, incomingHit.fromCell),
        impactDelay: splash
          ? weaponFlightMs.spore
          : type === "destroyed" || type === "shielded"
            ? delay
            : undefined,
      },
    );
    effect.body?.setAttribute("data-depth", String(cell));
    appendPulse(cache, { ...effect, born: now });

    if (light) {
      const hit = now + (type === "damage" ? weaponFlightMs[weapon] : delay);
      addCombatLight(light, {
        kind: type,
        at,
        from,
        weapon,
        lostKind,
        slot,
        now,
        hit,
        seed: tick * 977 + cell * 31,
      });
    }
    if (lostKind === "neuron") {
      const burst = organicBurst(document, at, slot, tick * 131 + cell, delay);
      burst.animate(0);
      appendPulse(cache, { ...burst, born: now });
    }
    if (from && origin !== undefined) {
      const length = Math.max(1, Math.hypot(at.x - from.x, at.y - from.y));
      cache.recoil.set(origin, {
        born: now,
        dx: ((from.x - at.x) / length) * 2.5,
        dy: ((from.y - at.y) / length) * 2.5,
      });
    }
  }
}

function appendPulse(
  cache: TickEffectState,
  pulse: Pulse & { ground: SVGElement },
): void {
  cache.effectLayer.append(pulse.element);
  cache.groundEffects.append(pulse.ground);
  cache.pulses.push(pulse);
}
