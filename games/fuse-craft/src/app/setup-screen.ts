import { AI_STRATEGIES, type MapDefinition } from "../engine/types.js";
import type { GameMode, MapSummary, OpeningChoice } from "./contracts.js";
import { escapeMarkup as escape } from "./escape-markup.js";

export type LoadState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; value: T };

interface SetupState {
  mode: GameMode;
  catalog: LoadState<readonly MapSummary[]> | null;
  mapState: LoadState<MapDefinition> | null;
  selectedId: string | null;
  selectedSlot: number;
  aiStrategy: OpeningChoice;
  firstAiStrategy: OpeningChoice;
  tutorialError: string | null;
  launchError: string | null;
  launching: boolean;
  powerups: boolean;
  debug: boolean | undefined;
  instantConstruction: boolean;
  instantResearch: boolean;
}

const MODES = ["skirmish", "watch", "sandbox", "combat-lab"] as const;
const MODE_INFO: Record<
  GameMode,
  {
    label: string;
    help: string;
    title: string;
    description: string;
  }
> = {
  watch: {
    label: "Watch AI vs AI",
    help: "Choose two openings and follow their battle.",
    title: "Follow the battle",
    description:
      "Two AI players · Equal resources · Watch, pan and inspect either network",
  },
  skirmish: {
    label: "Player vs AI",
    help: "Grow, research and destroy the rival brain.",
    title: "Take the field",
    description:
      "You versus one AI · Equal resources · Destroy the enemy brain",
  },
  sandbox: {
    label: "Open sandbox",
    help: "One player, no AI. Grow at your pace.",
    title: "An open beginning",
    description: "One local player · No AI controller",
  },
  "combat-lab": {
    label: "Combat lab",
    help: "Scripted opposition to test routing and cuts.",
    title: "A controlled confrontation",
    description:
      "One local player · No AI controller · Scripted opposing network",
  },
};

function modeChoices(selected: GameMode): string {
  return MODES.map((mode) => {
    const active = mode === selected;
    const { label, help } = MODE_INFO[mode];
    return `<button data-action="mode-${mode}" class="choice ${active ? "active" : ""}" aria-pressed="${active}"><strong>${label}</strong><span>${help}</span></button>`;
  }).join("\n        ");
}

/** The opening picker: Random first, then every opening by name. */
export function openingOptions(selected: OpeningChoice): string {
  return (["random", ...AI_STRATEGIES] as const)
    .map(
      (kind) =>
        `<option value="${kind}" ${kind === selected ? "selected" : ""}>${kind[0]!.toUpperCase()}${kind.slice(1)}</option>`,
    )
    .join("");
}

function mapCatalog({
  catalog,
  selectedId,
  tutorialError,
}: SetupState): string {
  if (tutorialError)
    return `<div class="error-card" role="alert"><strong>Tutorial map unavailable</strong><p>${escape(tutorialError)}</p><button data-action="tutorial">Retry tutorial</button></div>`;
  if (!catalog || catalog.status === "loading")
    return '<p role="status">Loading maps…</p>';
  if (catalog.status === "error")
    return `<div class="error-card" role="alert"><strong>Map catalog unavailable</strong><p>${escape(catalog.message)}</p><button data-action="retry-catalog">Retry</button></div>`;
  if (catalog.value.length === 0)
    return '<div class="empty-card">No maps are available yet. <button data-action="retry-catalog">Retry</button></div>';
  const mapOptions = catalog.value
    .map(
      (map) =>
        `<option value="${escape(map.id)}" ${selectedId === map.id ? "selected" : ""}>${escape(map.title)}</option>`,
    )
    .join("");
  return `<label class="field-label" for="map-picker">Map</label><select id="map-picker" data-field="map">${mapOptions}</select>`;
}

function mapDetails({
  catalog,
  mapState,
  selectedId,
  selectedSlot,
}: SetupState): string {
  if (!selectedId || catalog?.status !== "ready") return "";
  if (!mapState || mapState.status === "loading")
    return '<p role="status">Validating selected map…</p>';
  if (mapState.status === "error")
    return `<div class="error-card" role="alert"><strong>Map unavailable or invalid</strong><p>${escape(mapState.message)}</p><button data-action="retry-map">Retry map</button></div>`;
  const { width, height, spawns } = mapState.value;
  const spawnOptions = spawns
    .map(
      (spawn) =>
        `<option value="${spawn.slot}" ${selectedSlot === spawn.slot ? "selected" : ""}>Spawn ${spawn.slot + 1} · tile ${spawn.cellIndex}</option>`,
    )
    .join("");
  return `<div class="map-meta"><strong>${width} × ${height} hexes</strong><span>◈ Biomass deposits</span><span>◇ Insight deposits</span><span>▰ Blocked ground</span></div><label class="field-label" for="spawn-picker">Spawn</label><select id="spawn-picker" data-field="spawn">${spawnOptions}</select>`;
}

export function setupScreenMarkup(
  state: SetupState,
  header: (actions: string) => string,
): string {
  const {
    mode,
    aiStrategy,
    firstAiStrategy,
    launchError,
    launching,
    powerups,
    debug,
    instantConstruction,
    instantResearch,
  } = state;
  const brief = MODE_INFO[mode];
  const watching = mode === "watch";
  const hasOpponent = watching || mode === "skirmish";
  const catalogBlock = mapCatalog(state);
  const details = mapDetails(state);
  const ready = state.mapState?.status === "ready" && !launching;
  const buttonLabel = launching
    ? "Starting…"
    : watching
      ? "Watch match →"
      : "Start →";
  const startButton = `<button data-action="start" class="primary" ${ready ? "" : "disabled"}>${buttonLabel}</button>`;
  // Start is at the top, beside Back, never under the page.
  return `${header(startButton)}
      <main class="setup-layout"><section class="nd-panel">
        <p class="section-index">01 / SCENARIO</p><div class="choice-grid">
        ${modeChoices(mode)}
        </div><p class="section-index">02 / FIELD</p>${catalogBlock}${details}</section>
        <aside class="nd-panel setup-summary"><p class="section-index">SESSION BRIEF</p>
        <h2>${brief.title}</h2>
        <p>${brief.description}</p>
        ${watching ? `<label class="field-label" for="first-strategy-picker">First AI opening</label><select id="first-strategy-picker" data-field="first-strategy">${openingOptions(firstAiStrategy)}</select>` : ""}
        ${hasOpponent ? `<label class="field-label" for="strategy-picker">${watching ? "Second AI opening" : "Opponent opening"}</label><select id="strategy-picker" data-field="strategy">${openingOptions(aiStrategy)}</select><p class="muted">Different openings, equal resources. Random keeps you guessing: scout what the AI builds and counter it. Its opening is revealed when the match ends.</p>` : ""}
        ${hasOpponent ? `<label class="toggle-field"><input type="checkbox" data-field="powerups" ${powerups ? "checked" : ""}> Random powerups <small>Contested pickups spawn between the brains; the first network to touch one claims it.</small></label>` : ""}
        ${
          debug
            ? `<fieldset class="debug-options"><legend>Debug options</legend>
          <p>Clear tile boundaries are on. Particle travel always takes normal time.</p>
          <label><input type="checkbox" data-debug="construction" ${instantConstruction ? "checked" : ""}> Instant construction after delivery</label>
          <label><input type="checkbox" data-debug="research" ${instantResearch ? "checked" : ""}> Instant research</label>
          <small>Resource costs and prerequisites still apply.</small></fieldset>`
            : watching
              ? "<p>Select a structure to inspect it. Use the minimap or either player's card to move around the field.</p>"
              : "<p>Build beside resources. Connect your network. Select frontline nodes and use <strong>Charge</strong> to supply their weapons.</p>"
        }
        ${launchError ? `<div class="error-card" role="alert">${escape(launchError)}<button data-action="start">Retry launch</button></div>` : ""}
        </aside></main>`;
}
