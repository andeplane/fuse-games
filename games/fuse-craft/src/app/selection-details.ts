import type { Cell, Player, Structure, World } from "../engine/types.js";
import { RULES } from "../engine/index.js";
import {
  canAttack,
  constructionDispatchAvailability,
  planSupport,
  STRUCTURES,
} from "../engine/catalog.js";
import { POWERUP_PRESENTATION } from "../engine/powerups.js";
import { structureArt, teamArtFilter } from "../render/art.js";
import { neuronPortraitUrl } from "../render/board.js";
import { sporeIconUrl } from "../render/spore-art.js";
import { waitingText } from "./command-card.js";
import { escapeMarkup as escape } from "./escape-markup.js";

function connectionDetails(
  world: Readonly<World>,
  structure: World["structures"][number],
): string {
  let count = 0;
  let incomingCount = 0;
  let nextArrival = Infinity;
  for (const particle of world.particles) {
    if (particle.ownerId !== structure.ownerId) continue;
    if (particle.mode === "stationed" && particle.cell === structure.cell)
      count++;
    if (particle.mode === "transit" && particle.to === structure.cell) {
      incomingCount++;
      nextArrival = Math.min(nextArrival, particle.arrivesAt);
    }
  }
  return `<span title="${structure.connected ? "Connected to brain" : "Disconnected from brain"}${incomingCount ? ` · next arrival in ${Math.ceil((nextArrival - world.tick) / RULES.ticksPerSecond)}s` : ""}">${structure.connected ? "Connected" : "Disconnected"} · ${count} particles · ${incomingCount} incoming</span>`;
}

function cellTitle(
  cell: Cell | undefined,
  structure: Structure | undefined,
  powerup: World["powerups"][number] | undefined,
): string {
  if (structure) return `${structure.kind.toUpperCase()} · ${structure.hp} HP`;
  if (powerup)
    return `POWERUP · ${POWERUP_PRESENTATION[powerup.kind].label.toUpperCase()}`;
  if (cell?.terrain === "deposit")
    return `${cell.resourceKind.toUpperCase()} DEPOSIT`;
  return cell?.terrain === "blocked" ? "BLOCKED GROUND" : "OPEN GROUND";
}

function attackPriority(
  player: Player,
  structure: Structure | undefined,
  priority: number,
): string {
  if (structure?.ownerId !== player.id || !canAttack(structure.kind)) return "";
  return `${priority === 0 && structure.kind !== "brain" ? '<span class="supply-warning">No supply assigned — use D / Charge to arm this node.</span>' : ""}<div class="priority-control"><label class="field-label" for="priority-slider">Attack priority · ${priority}/3</label><input id="priority-slider" data-field="priority" type="range" min="0" max="3" step="1" value="${priority}"></div>`;
}

function miningDetails(structure: Structure | undefined): string {
  if (!structure) return "";
  const { miningBonus } = STRUCTURES[structure.kind];
  if (!miningBonus) return "";
  return `<span class="economic-summary" title="One specialist bonus per deposit per player. Requires a connection to the brain. No attack supply needed.">${structure.connected ? "Extracting" : "Extraction paused"} · +${miningBonus} shares/deposit · non-stacking</span>`;
}

function constructionProgress(
  world: Readonly<World>,
  player: Player,
  queued: Player["queue"][number] | undefined,
): string {
  if (!queued) return "";
  return `<span class="construction-progress" title="Queued construction waits for support, builder and resources.">${
    queued.paid
      ? `${queued.upgradeFrom !== undefined ? "Specializing" : "Growing"} · ${Math.ceil((queued.duration - queued.progress) / RULES.ticksPerSecond)}s remaining`
      : waitingText(
          constructionDispatchAvailability(world, player, queued).missing,
          planSupport(world, player).get(queued.cell),
        )
          .map(escape)
          .join(" ") || "Ready for construction"
  }</span>`;
}

export function selectionDetails(
  world: Readonly<World>,
  player: Player,
  selectedCell: number | null,
  structure: Structure | undefined,
): string {
  if (selectedCell === null)
    return '<div class="selection-summary"><strong>Select a hex</strong><span>Click terrain to build or inspect.</span></div>';
  const cell = world.map.cells[selectedCell];
  const queued = player.queue.find((item) => item.cell === selectedCell);
  const priority = player.priorities[String(selectedCell)] ?? 0;
  const powerup = world.powerups.find((item) => item.cell === selectedCell);
  return `<div class="selection-summary"><div class="tile-heading"><span>HEX ${selectedCell}</span><strong>${cellTitle(cell, structure, powerup)}</strong></div>
        ${powerup ? `<span>${escape(POWERUP_PRESENTATION[powerup.kind].description)} Fades in ${Math.ceil((powerup.expiresAt - world.tick) / RULES.ticksPerSecond)}s. Touch it with your connected network to claim it; two networks touching it keep it contested.</span>` : ""}
        ${structure ? connectionDetails(world, structure) : ""}
        ${cell?.terrain === "deposit" ? '<span title="Connected neighboring structures harvest this deposit. Several players may share it.">Expand alongside to mine.</span>' : ""}</div>
        ${attackPriority(player, structure, priority)}
        ${miningDetails(structure)}
        ${constructionProgress(world, player, queued)}`;
}

export function selectionPortrait(
  world: Readonly<World>,
  selectedCell: number | null,
  structure: Structure | undefined,
  sprites: Readonly<Record<string, string>> | undefined,
): string {
  const sprite = (name: string) => sprites?.[`${name}-v2`] ?? sprites?.[name];
  if (!structure) {
    const cell = selectedCell === null ? null : world.map.cells[selectedCell];
    const name =
      cell?.terrain === "deposit"
        ? `deposit-${cell.resourceKind}`
        : cell?.terrain === "blocked"
          ? "blocker-boulder"
          : "terrain-slate-a";
    return portraitMarkup(sprite(name));
  }
  if (structure.kind === "neuron")
    return portraitMarkup(neuronPortraitUrl(world, structure.cell));
  const slot =
    world.players.find((player) => player.id === structure.ownerId)?.slot ?? 0;
  if (structure.kind === "spore") return portraitMarkup(sporeIconUrl(slot));
  const url = sprite(structureArt(structure.kind));
  return url ? portraitMarkup(url, teamArtFilter(slot)) : "";
}

function portraitMarkup(url: string | undefined, filter = "none"): string {
  return url
    ? `<div class="selection-portrait"><img style="filter:${filter}" src="${escape(url)}" alt="" draggable="false"></div>`
    : "";
}
