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
type Choice = { label: string; action: BattleAction };
export function createCommands(
  send: (action: BattleAction) => boolean,
  canvas: HTMLCanvasElement,
) {
  const element = el("div", "", "fp-commands");
  const bar = el("div", "", "fp-command-bar");
  const body = el("div", "", "fp-command-body");
  const sites = el("div", "", "fp-command-sites");
  const researchPage = button("Advanced research");
  let advanced = false;
  researchPage.onclick = () => {
    advanced = !advanced;
    render();
  };
  const note = el("p", "", "fp-command-note");
  note.setAttribute("aria-live", "polite");
  const actions = el("div", "", "fp-command-actions");
  const options: HTMLButtonElement[] = [];
  let battle: BattleState | undefined,
    seat = -1,
    category = 2,
    site = 0,
    match = "",
    signature = "";
  let choices: Choice[] = [];
  function select(next: number) {
    category = next;
    note.textContent = "";
    render();
  }
  const tabs = CATEGORIES.map(([key, label], index) => {
    const tab = button(label);
    tab.title = `${label} (${key.toUpperCase()})`;
    tab.onclick = () => select(index);
    bar.append(tab);
    return tab;
  });
  body.append(researchPage, sites, actions, note);
  element.append(bar, body);
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
      tab.setAttribute("aria-pressed", String(index === category)),
    );
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
                label: `${RESEARCH_LABELS[path]} · Lv ${core.paths[path]}`,
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
                label: `${LABELS[upgrade]} · Lv ${core.upgrades[upgrade]}`,
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
      nextChoices,
    ]);
    choices = nextChoices;
    if (signature !== nextSignature) {
      signature = nextSignature;
      const focused = options.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      sites.replaceChildren();
      sites.hidden = !choose;
      if (choose) {
        sites.append(el("span", "Site"));
        state.sites.forEach((_, index) => {
          const b = button(String(index + 1));
          b.setAttribute("aria-label", `Tower site ${index + 1}`);
          b.setAttribute("aria-pressed", String(index === site));
          b.onclick = () => chooseSite(index);
          sites.append(b);
        });
      }
      options.length = 0;
      actions.replaceChildren();
      choices.forEach((_, index) => {
        const b = button("");
        b.onclick = () => apply(index);
        actions.append(b);
        options.push(b);
      });
      if (focused >= 0) options[focused]?.focus({ preventScroll: true });
    }
    choices.forEach(({ label, action }, index) => {
      const b = options[index]!;
      const cost = actionCost(state, seat, action);
      const amount = Number.isFinite(cost) && cost > 0 ? ` · ${cost} gold` : "";
      const text = `${index + 1}. ${label}${amount}`;
      if (b.textContent !== text) b.textContent = text;
      b.setAttribute(
        "aria-disabled",
        String(!canActBattle(state, seat, action)),
      );
    });
  }
  canvas.addEventListener("click", (event) => {
    if (!battle || seat < 0 || (category !== 0 && category !== 4)) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.x) * battle.cols) / rect.width;
    const y = ((event.clientY - rect.y) * battle.rows) / rect.height;
    const index = battle.sites.findIndex(
      (target) => Math.hypot(target.x - x, target.y - y) < 1.3,
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
      return /^[1-8]$/.test(key) && apply(Number(key) - 1);
    },
  };
}
