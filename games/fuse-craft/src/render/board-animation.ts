import type { TickEffectState } from "./tick-effects.js";

const LINK_GROW_MS = 900;

export function animateRecoil(
  structures: SVGGElement,
  recoil: TickEffectState["recoil"],
  frameNow: number,
  reducedMotion: boolean,
): void {
  for (const [cell, kick] of recoil) {
    const age = (frameNow - kick.born) / 240;
    const art = structures.querySelector<SVGGElement>(
      `.structure[data-cell="${cell}"] .building-art`,
    );
    if (age >= 1 || reducedMotion) {
      art?.removeAttribute("transform");
      recoil.delete(cell);
    } else {
      const amount =
        Math.sin(Math.min(1, Math.max(0, age)) * Math.PI) * (1 - age);
      art?.setAttribute(
        "transform",
        `translate(${kick.dx * amount} ${kick.dy * amount})`,
      );
    }
  }
}

type Brain = { cell: number; art: SVGGElement; x: number; foot: number };

export function animateBrains(
  brains: readonly Brain[],
  recoil: ReadonlyMap<number, unknown>,
  frameNow: number,
  reducedMotion: boolean,
): void {
  // Brains breathe: a slow swell anchored at the base of the sprite.
  for (const brain of brains)
    if (!recoil.has(brain.cell)) {
      if (reducedMotion) brain.art.removeAttribute("transform");
      else {
        const breath = Math.sin(frameNow / 900 + brain.cell) * 0.018;
        brain.art.setAttribute(
          "transform",
          `translate(${brain.x} ${brain.foot}) scale(${(1 - breath * 0.6).toFixed(4)} ${(1 + breath).toFixed(4)}) translate(${-brain.x} ${-brain.foot})`,
        );
      }
    }
}

type GrowingLink = {
  born: number;
  forward: boolean;
  paths: readonly SVGPathElement[];
};

function finishLink(link: GrowingLink) {
  for (const path of link.paths) {
    path.removeAttribute("pathLength");
    path.style.removeProperty("stroke-dasharray");
    path.style.removeProperty("stroke-dashoffset");
  }
}

export function animateLinks(
  links: readonly GrowingLink[],
  frameNow: number,
  reducedMotion: boolean,
) {
  for (const link of links) {
    const progress = reducedMotion
      ? 1
      : Math.max(0, Math.min(1, (frameNow - link.born) / LINK_GROW_MS));
    if (progress >= 1) {
      finishLink(link);
      continue;
    }
    const eased = 1 - Math.pow(1 - progress, 2);
    const offset = link.forward ? "0" : String(-(1 - eased));
    for (const path of link.paths) {
      path.setAttribute("pathLength", "1");
      path.style.setProperty("stroke-dasharray", `${eased} 2`);
      path.style.setProperty("stroke-dashoffset", offset);
    }
  }
}

export function animatePulses(
  pulses: TickEffectState["pulses"],
  frameNow: number,
  reducedMotion: boolean,
): TickEffectState["pulses"] {
  return pulses.filter((p) => {
    const t = (frameNow - p.born) / (p.duration ?? 320);
    if (t >= 1 || reducedMotion) {
      p.element.remove();
      p.ground?.remove();
      p.body?.remove();
      return false;
    }
    if (p.animate) {
      p.animate(t);
      return true;
    }
    p.element.setAttribute("r", String(p.arrival ? 8 + t * 13 : 10 + t * 21));
    p.element.setAttribute("opacity", String((p.arrival ? 0.35 : 1) * (1 - t)));
    return true;
  });
}
