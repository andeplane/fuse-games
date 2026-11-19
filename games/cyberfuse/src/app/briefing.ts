import { button, el } from "fuse-ui";
import {
  CAMPAIGNS,
  DOGFIGHTS,
  WEAPONS,
  defaultLoadout,
} from "../campaign/index.js";
import {
  missionFromPassword,
  readMissionPassword,
} from "../progression/index.js";
import type { CyberfuseSettings } from "../game/index.js";
import type { Store } from "./session.js";

interface BriefingOptions {
  missionIndex?: number;
  host?: boolean;
  between?: boolean;
  slot?: number;
  cooperative?: boolean;
  personalKit?: number[];
  kitOnly?: boolean;
}

export function createBriefing(
  initial: CyberfuseSettings,
  store: Store,
  change: (settings: CyberfuseSettings) => void,
  equip?: (ids: number[]) => void,
) {
  const element = el("div", "", "cf-briefing");
  const mode = el("select"),
    campaign = el("select");
  mode.add(new Option("Campaign", "campaign"));
  mode.add(new Option("Dogfight", "dogfight"));
  const field = (name: string, input: HTMLElement) => {
    const label = el("label", name);
    label.append(input);
    return label;
  };
  const settings = el("div", "", "cf-settings");
  const campaignField = field("Campaign", campaign);
  settings.append(field("Game mode", mode), campaignField);
  const title = el("h3"),
    description = el("p"),
    objectives = el("ul"),
    armory = el("fieldset");
  const resume = el("details", "", "cf-resume"),
    code = el("input"),
    submit = button("Use password"),
    feedback = el("span");
  feedback.setAttribute("role", "status");
  code.autocomplete = "off";
  code.maxLength = 16;
  resume.append(
    el("summary", "Mission password"),
    field("Password", code),
    submit,
    feedback,
  );
  element.append(settings, resume, title, description, objectives, armory);
  let selected = initial,
    coop = false,
    previous = "",
    codeContext = "";
  mode.onchange = () =>
    change({
      ...selected,
      mode: mode.value === "dogfight" ? "dogfight" : "campaign",
      campaign: mode.value === "dogfight" ? 0 : 1,
      startMission: 0,
      loadout: [],
    });
  campaign.onchange = () =>
    change({
      ...selected,
      campaign: Number(campaign.value),
      startMission: 0,
      loadout: [],
    });
  submit.onclick = () => {
    const index = missionFromPassword(
      selected.campaign ?? 0,
      code.value.trim().toLowerCase(),
      0,
      coop,
    );
    if (index === undefined) {
      feedback.textContent =
        "Unknown password for this campaign and squad size.";
      return;
    }
    feedback.textContent = "Mission selected";
    change({ ...selected, startMission: index, loadout: [] });
  };
  code.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit.click();
    }
  };
  const update = (value: CyberfuseSettings, options: BriefingOptions = {}) => {
    const signature = JSON.stringify([value, options]);
    if (previous === signature) return;
    previous = signature;
    selected = value;
    coop = options.cooperative ?? false;
    const { host = true, between = false, slot = 0 } = options;
    mode.value = value.mode;
    mode.disabled = !host || between;
    campaign.disabled = mode.disabled;
    const dogfight = value.mode === "dogfight",
      campaignId = value.campaign ?? 0;
    campaignField.firstChild!.textContent = dogfight ? "Arena" : "Campaign";
    const choices = dogfight ? DOGFIGHTS : CAMPAIGNS;
    const order = dogfight
      ? choices.map((_, i) => i)
      : [1, 0, ...choices.slice(2).map((_, i) => i + 2)];
    campaign.replaceChildren(
      ...order.map((i) => new Option(choices[i]!.title, String(i))),
    );
    campaign.value = String(campaignId);
    resume.hidden = dogfight || between || !host;
    const key = String(campaignId) + ":" + coop;
    if (!resume.hidden && key !== codeContext) {
      codeContext = key;
      code.value = readMissionPassword(store, campaignId, 0, coop);
      feedback.textContent = "";
    }
    const pack = CAMPAIGNS[campaignId] ?? CAMPAIGNS[0]!;
    const mission = dogfight
      ? DOGFIGHTS[campaignId]!
      : (pack.missions[options.missionIndex ?? value.startMission ?? 0] ??
        pack.missions[0]!);
    settings.hidden = !!options.kitOnly;
    title.hidden = !!options.kitOnly;
    description.hidden = !!options.kitOnly;
    if (options.kitOnly) resume.hidden = true;
    title.textContent = mission.title;
    description.textContent = mission.description;
    objectives.replaceChildren(
      ...mission.objectives.map((o) => el("li", o.description)),
    );
    objectives.hidden = !!options.kitOnly || !mission.objectives.length;
    const available = mission.allowedWeapons;
    const custom = options.personalKit?.length
      ? options.personalKit
      : value.loadout;
    let chosen = custom?.filter((id) => available.includes(id)) ?? [];
    if (!chosen.length) chosen = defaultLoadout(Math.max(0, slot), mission);
    armory.replaceChildren(
      el(
        "legend",
        options.kitOnly
          ? "Player 2 loadout · choose up to three"
          : "Loadout · choose up to three",
      ),
    );
    available.forEach((id) => {
      const input = el("input");
      input.type = "checkbox";
      input.checked = chosen.includes(id);
      input.disabled =
        slot < 0 ||
        (!input.checked && chosen.length >= 3) ||
        (input.checked && chosen.length === 1);
      input.onchange = () => {
        const ids = input.checked
          ? [...chosen, id]
          : chosen.filter((w) => w !== id);
        if (equip) equip(ids);
        else change({ ...selected, loadout: ids });
      };
      const label = el("label");
      label.append(input, el("span", WEAPONS[id]!.name));
      armory.append(label);
    });
  };
  update(initial);
  return { element, update };
}
