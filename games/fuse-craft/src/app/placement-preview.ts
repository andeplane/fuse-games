import {
  CONSTRUCTIONS,
  connectedFrontier,
  constructionDispatchAvailability,
  constructionQueueAvailability,
  constructionUpgradeSource,
  planSupport,
  type BuildKind,
} from "../engine/catalog.js";
import type { Player, World } from "../engine/types.js";
import { hexPoints, structureArtwork } from "../render/board.js";
import { requirementText, waitingText } from "./command-card.js";
import { planNeuronPlacement } from "./neuron-placement.js";

export function placementPreview(
  world: Readonly<World>,
  player: Player,
  kind: BuildKind,
  cell: number,
) {
  const upgradeFrom = constructionUpgradeSource(world, player, kind, cell);
  const availability = constructionQueueAvailability(world, player, kind, cell);
  const plan =
    kind === "neuron" ? planNeuronPlacement(world, player, cell) : null;
  const support = planSupport(world, player, { cell, kind }).get(cell);
  const hints = availability.allowed
    ? waitingText(
        constructionDispatchAvailability(world, player, {
          kind,
          cell,
          upgradeFrom: upgradeFrom?.id,
        }).missing,
        support,
      )
    : availability.missing.map(requirementText);
  return {
    cell,
    upgrading: upgradeFrom !== undefined,
    valid: availability.allowed && (!plan || plan.cells.length > 0),
    support:
      plan?.hint && plan.cells.length > 0
        ? "chained"
        : (support ?? "connected"),
    bridge: plan?.cells.slice(0, -1) ?? [],
    hint: plan?.hint || hints.join(" "),
  };
}

export type PlacementPreview = ReturnType<typeof placementPreview>;

export function placementPrompt(
  kind: BuildKind,
  preview: PlacementPreview | null,
) {
  if (preview?.upgrading)
    return "Neuron stays connected during work. Damage carries over.";
  return CONSTRUCTIONS[kind].upgradesFrom?.length
    ? "Choose open ground or upgrade your neuron."
    : "Click or tap open ground.";
}

export function renderPlacementPreview(
  board: SVGSVGElement,
  world: Readonly<World>,
  owner: Player | undefined,
  kind: BuildKind | null,
  target: PlacementPreview | null,
  sprites: Parameters<typeof structureArtwork>[4],
) {
  let preview = board.querySelector<SVGGElement>(".placement-preview");
  if (!preview) {
    preview = board.ownerDocument.createElementNS(
      "http://www.w3.org/2000/svg",
      "g",
    );
    preview.setAttribute("class", "placement-preview");
    preview.setAttribute("pointer-events", "none");
    board.append(preview);
  }
  const { width } = world.map;
  // Large structure artwork can hide adjacent hexes. Show where a plan starts at once.
  const frontier =
    owner && kind
      ? frontierMarkup(width, connectedFrontier(world, owner, kind))
      : "";
  if (!owner || !kind || !target) {
    preview.innerHTML = frontier;
    preview.removeAttribute("data-valid");
    preview.removeAttribute("data-support");
    preview.removeAttribute("data-upgrade");
    return;
  }
  const { cell, upgrading, valid, support } = target;
  preview.setAttribute("data-valid", String(valid));
  preview.setAttribute("data-support", support);
  preview.setAttribute("data-upgrade", String(upgrading));
  const bridge = target.bridge
    .map(
      (hex) =>
        `<polygon class="placement-bridge" data-cell="${hex}" points="${hexPoints(width, hex, 1.5)}"/>`,
    )
    .join("");
  const artwork = structureArtwork(width, cell, kind, owner.slot, sprites);
  preview.innerHTML = `${frontier}${bridge}<polygon points="${hexPoints(width, cell, 1.5)}"/><g opacity="0.55">${artwork}</g>`;
}

function frontierMarkup(width: number, cells: readonly number[]) {
  const polygons = cells
    .map(
      (cell) =>
        `<polygon data-cell="${cell}" points="${hexPoints(width, cell, 4)}"/>`,
    )
    .join("");
  return `<g class="placement-frontier">${polygons}</g>`;
}
