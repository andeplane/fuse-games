import { GAMES } from "../../service/history.js";
import { AUDIT_RECIPES, RECIPES, type Recipe } from "./play-recipes.js";

interface PlaySurface {
  /** The rendered field after entering play. Decorative and offscreen canvases are excluded. */
  field: string;
  /** Each selector group must match a visible primary control during phone play. */
  controls: string | readonly string[];
  /** Complete interactive board, when it is laid over an extended playfield. */
  board?: string;
}

const SURFACES: Record<string, PlaySurface> = {
  "ball-bros": {
    field: '.in-match[data-phase="running"] .canvas-host canvas',
    controls: ".touch-controls .pad",
  },
  cyberfuse: {
    field:
      '.cyberfuse-room[data-phase="running"] canvas[aria-label="Cyberfuse mission"]',
    controls: ".cf-pad button, .cf-stick",
  },
  dice: {
    field: '.dice-room[data-phase="running"] .dice-table',
    controls: ".dice-table button",
  },
  dockside: {
    field:
      '.dockside-room[data-phase="running"] canvas[aria-label="Canal Lock arena"]',
    controls: ".dockside-controls button",
  },
  "elasto-fuse": {
    field: '.ef-room[data-phase="racing"] canvas.ef-canvas',
    controls: ".ef-touch .ef-pad",
  },
  "fuse-axe": {
    field: '.fa-room[data-stage="running"] canvas.fa-canvas',
    controls: ".fa-dpad, .fa-buttons button",
  },
  "fuse-birds": {
    field: 'canvas[data-ready="true"]',
    controls: ".birds-controls button, .birds-camera button",
  },
  "fuse-bombers": {
    field: 'body:has(#screen[data-screen="playing"]) #app canvas',
    controls: '[data-input="touch-pads"] > div',
  },
  "fuse-choppers": {
    field: '.fc-room[data-phase="play"] canvas.fc-canvas',
    controls: ".fc-touch .fc-pad",
  },
  "fuse-craft": {
    field: ".game-layout #nd-board",
    controls: ".game-layout .command-button",
  },
  "fuse-drivers": {
    field: 'canvas.fd-arena[data-ready="true"]',
    controls: ".fd-pad button",
  },
  "fuse-freight": {
    field: '.ff-room[data-phase="play"] canvas.ff-canvas',
    controls: ".ff-touch .ff-pad",
  },
  "fuse-front": {
    field: "canvas.ff-board",
    controls: ".ff-spell, .ff-item, .ff-shop-open, .ff-drawer, .ff-switch",
  },
  "fuse-lane": {
    field: 'canvas[aria-label="The city: tap a building to walk there"]',
    controls: ".fl-clock, .fl-end-week",
  },
  "fuse-particles": {
    field: '.fuseParticles-room[data-phase="running"] canvas.fp-arena__field',
    controls: ".fp-command-bar button, .fp-command",
  },
  "fuse-riders": {
    field: ".online-app canvas.online-arena",
    controls: ".online-controls button",
  },
  "fuse-surge": {
    field: '.fs-room[data-phase="play"] canvas.fs-layer-world',
    controls: ".fs-touch button, .fs-touch [role=button]",
  },
  "fuse-volley": {
    field: '.fv-room[data-stage="running"] canvas.fv-canvas',
    controls: [".fv-touch .fv-rocker", ".fv-touch .fv-jump"],
  },
  fuseball: {
    field:
      '.fb-room[data-stage="running"]:not([data-phase="countdown"]) canvas.fb-canvas',
    controls: [".fb-touch .fb-stick", ".fb-touch [role=button]"],
  },
  fuseheads: {
    field: '.fuseheads-room[data-phase="running"] canvas.fuseheads-arena',
    controls: ".fuseheads-pad button",
  },
  fusemania: {
    field: '.fm-room[data-stage="running"] canvas.fm-canvas',
    controls: ".fm-touch .fm-pad",
  },
  fusero: {
    field: '.liero-room[data-phase="running"] .liero-arena canvas',
    controls: ".liero-pad button, .liero-weapon-bar button",
  },
  "graveyard-shift": {
    field: '[data-phase="running"] canvas.arena',
    controls: ".pad button",
  },
  "hook-havok": {
    field: "#scene canvas",
    controls: "#touch-deck [data-pad]",
  },
  "incredible-fuse": {
    field: "canvas.if-bench-board",
    board: ".if-board-frame",
    controls: [".if-bench-run", ".if-bench-tools button"],
  },
  "killer-fuse": {
    field: 'main.kf-room[data-stage="running"] canvas',
    controls: ".kf-touch button, .kf-touch .kf-stick",
  },
};

export const PHONE_PLAY_RECIPES: Readonly<Record<string, Recipe>> = {
  ...RECIPES,
  ...AUDIT_RECIPES,
};

export const PHONE_PLAY_SURFACES: Readonly<Record<string, PlaySurface>> =
  SURFACES;

export const PHONE_PLAY_GAME_IDS: readonly string[] = GAMES.map(({ id }) => id);
