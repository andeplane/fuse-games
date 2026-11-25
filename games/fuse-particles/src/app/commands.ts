import { button, el } from "fuse-ui";
import {
  PATHS,
  UPGRADES,
  actionCost,
  canActBattle,
  type BattleAction,
  type BattleState,
} from "../game/simulation.js";

const CATEGORIES = [
  ["q", "Build"],
  ["w", "Research"],
  ["e", "Upgrades"],
  ["a", "Abilities"],
  ["s", "Towers"],
] as const;
const LABELS = {
  health: "Health",
  attack: "Attack",
  radius: "Radius",
  spawnRate: "Spawn rate",
  speed: "Speed",
  maxParticles: "Particle cap",
  defense: "Defense",
  interestRate: "Interest rate",
};
const RESEARCH_LABELS = {
  territory_income: "Territory income",
  territory_income_rate: "Territory payouts",
  tower_regen: "Tower regeneration",
  tower_range: "Tower range",
  laser_bounce: "Laser bounce",
  laser_overcharge: "Laser overcharge",
  weakness_slow: "Weakness slow",
  weakness_stun: "Weakness stun",
};
type Choice = { label: string; level?: number; action: BattleAction };
/** The map the commands point at: clicks on it pick a tower site. */
export interface CommandMap {
  canvas: HTMLCanvasElement;
  locate(
    clientX: number,
    clientY: number,
  ): { x: number; y: number } | undefined;
}
interface Option {
  button: HTMLButtonElement;
  label: HTMLElement;
  detail: HTMLElement;
}
/**
 * The player's commands, laid over the map's lower edge. The categories are a fixed row at the bottom and every
 * command is a cell of a fixed grid, so nothing moves when a level or a price changes.
 */
export function createCommands(
  send: (action: BattleAction) => boolean,
  map: CommandMap,
  doc: Document = document,
) {
  const element = el("div", "", "fp-commands", doc);
  const bar = el("div", "", "fp-command-bar", doc);
  const body = el("div", "", "fp-command-body", doc);
  const sites = el("div", "", "fp-command-sites", doc);
  const researchPage = button("Advanced research", "", doc);
  let advanced = false;
  researchPage.onclick = () => {
    advanced = !advanced;
    render();
  };
  const note = el("p", "", "fp-command-note", doc);
  note.setAttribute("aria-live", "polite");
  const actions = el("div", "", "fp-command-actions", doc);
  const gold = el("span", "", "fp-command-gold", doc);
  const options: Option[] = [];
  let battle: BattleState | undefined,
    seat = -1,
    category = 2,
    site = 0,
    match = "",
    signature = "";
  let choices: Choice[] = [];
  let open = true;
  /** Choosing the open category again folds the commands away, leaving the whole map in view. */
  function select(next: number) {
    open = category !== next || !open;
    category = next;
    note.textContent = "";
    render();
  }
  const tabs = CATEGORIES.map(([key, label], index) => {
    const tab = button(label, "", doc);
    tab.title = `${label} (${key.toUpperCase()})`;
    tab.onclick = () => select(index);
    bar.append(tab);
    return tab;
  });
  bar.append(gold);
  body.append(researchPage, sites, actions);
  element.append(note, body, bar);
  function chooseSite(index: number) {
    site = index;
    note.textContent = "";
    render();
  }
  function apply(index: number) {
    const choice = choices[index];
    if (!choice) return false;
    const accepted = send(choice.action);
    note.textContent = accepted
      ? ""
      : "Command unavailable. Check gold, research and site ownership.";
    return true;
  }
  function render() {
    const state = battle;
    element.hidden = !state || seat < 0;
    if (!state || seat < 0) return;
    const core = state.cores[seat];
    if (!core) return;
    tabs.forEach((tab, index) =>
      tab.setAttribute("aria-pressed", String(open && index === category)),
    );
    body.hidden = !open;
    const purse = `${Math.floor(core.gold)} gold`;
    if (gold.textContent !== purse) gold.textContent = purse;
    const choose = category === 0 || category === 4;
    researchPage.hidden = category !== 1;
    researchPage.textContent = advanced ? "Tower unlocks" : "Advanced research";
    const nextChoices: Choice[] =
      category === 0
        ? [
            {
              label: "Build laser tower",
              action: { type: "build", tower: "laser", site },
            },
            {
              label: "Build weakness tower",
              action: { type: "build", tower: "weakness", site },
            },
          ]
        : category === 1
          ? advanced
            ? PATHS.map((path) => ({
                label: RESEARCH_LABELS[path],
                level: core.paths[path],
                action: { type: "path", path },
              }))
            : [
                {
                  label: "Laser tower",
                  action: { type: "research", tower: "laser" },
                },
                {
                  label: "Weakness tower",
                  action: { type: "research", tower: "weakness" },
                },
              ]
          : category === 2
            ? UPGRADES.map((upgrade) => ({
                label: LABELS[upgrade],
                level: core.upgrades[upgrade],
                action: { type: "upgrade", upgrade },
              }))
            : category === 3
              ? [
                  {
                    label: core.research.nuke
                      ? "Launch pulse"
                      : "Research pulse",
                    action: { type: "nuke" },
                  },
                ]
              : [
                  {
                    label: "Upgrade selected tower",
                    action: { type: "tower", site },
                  },
                ];
    const nextSignature = JSON.stringify([
      category,
      site,
      state.sites.length,
      nextChoices.map((choice) => [choice.label, choice.action]),
    ]);
    choices = nextChoices;
    if (signature !== nextSignature) {
      signature = nextSignature;
      const focused = options.findIndex(
        (option) => option.button === doc.activeElement,
      );
      sites.replaceChildren();
      sites.hidden = !choose;
      if (choose) {
        sites.append(el("span", "Site", "", doc));
        state.sites.forEach((_, index) => {
          const b = button(String(index + 1), "", doc);
          b.setAttribute("aria-label", `Tower site ${index + 1}`);
          b.setAttribute("aria-pressed", String(index === site));
          b.onclick = () => chooseSite(index);
          sites.append(b);
        });
      }
      options.length = 0;
      actions.replaceChildren();
      choices.forEach((choice, index) => {
        const b = button("", "fp-command", doc);
        const key = el("kbd", String(index + 1), "", doc);
        const label = el("span", choice.label, "fp-command-label", doc);
        const detail = el("span", "", "fp-command-detail", doc);
        b.append(key, label, detail);
        b.onclick = () => apply(index);
        actions.append(b);
        options.push({ button: b, label, detail });
      });
      if (focused >= 0) options[focused]?.button.focus({ preventScroll: true });
    }
    choices.forEach(({ label, level, action }, index) => {
      const option = options[index]!;
      const b = option.button;
      const cost = actionCost(state, seat, action);
      const text = [
        ...(level === undefined ? [] : [`Lv ${level}`]),
        ...(Number.isFinite(cost) && cost > 0 ? [`${cost}g`] : []),
      ].join(" · ");
      if (option.label.textContent !== label) option.label.textContent = label;
      if (option.detail.textContent !== text) {
        option.detail.textContent = text;
        b.title = `${index + 1}. ${label}${text ? ` · ${text.replace(/g$/, " gold")}` : ""}`;
      }
      b.setAttribute(
        "aria-disabled",
        String(!canActBattle(state, seat, action)),
      );
    });
  }
  map.canvas.addEventListener("click", (event) => {
    if (!battle || seat < 0 || !open || (category !== 0 && category !== 4))
      return;
    const point = map.locate(event.clientX, event.clientY);
    if (!point) return;
    const index = battle.sites.findIndex(
      (target) => Math.hypot(target.x - point.x, target.y - point.y) < 1.3,
    );
    if (index >= 0) chooseSite(index);
  });
  return {
    element,
    update(state: BattleState, index: number, matchId: string) {
      if (match !== matchId) {
        match = matchId;
        site = 0;
        note.textContent = "";
      }
      battle = state;
      seat = index;
      render();
    },
    key(key: string) {
      if (element.hidden || seat < 0) return false;
      const tab = CATEGORIES.findIndex(([name]) => name === key);
      if (tab >= 0) {
        select(tab);
        return true;
      }
      return open && /^[1-8]$/.test(key) && apply(Number(key) - 1);
    },
  };
}
