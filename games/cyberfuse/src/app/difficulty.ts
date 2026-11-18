import type { CyberfuseSettings } from "../game/index.js";
import {
  DEFAULT_GAMEPLAY,
  DIFFICULTIES,
  PERCENTAGES,
  isDifficulty,
  isPercentage,
  type GameplayOptions,
} from "../options/index.js";

/** The same mission rules panel serves solo setup and the room's host and guests. */
export function createDifficulty(
  initial: CyberfuseSettings,
  onChange: (settings: CyberfuseSettings) => void,
  doc: Document = document,
) {
  const element = doc.createElement("details");
  element.className = "cf-resume";
  const summary = doc.createElement("summary");
  summary.textContent = "Difficulty";
  const fields = doc.createElement("div");
  fields.className = "cf-settings";
  element.append(summary, fields);
  let settings = initial;
  let editable = true;
  function label(text: string, input: HTMLElement) {
    const wrapper = doc.createElement("label");
    wrapper.append(doc.createTextNode(text), input);
    fields.append(wrapper);
  }
  function set(patch: Partial<GameplayOptions>) {
    if (!editable) return;
    const gameplay = { ...(settings.gameplay ?? DEFAULT_GAMEPLAY), ...patch };
    onChange({ ...settings, gameplay });
  }
  function select(
    title: string,
    name: string,
    values: readonly (string | number)[],
    caption: (value: string | number) => string,
  ) {
    const control = doc.createElement("select");
    control.name = name;
    for (const value of values) {
      const option = doc.createElement("option");
      option.value = String(value);
      option.textContent = caption(value);
      control.append(option);
    }
    label(title, control);
    return control;
  }
  const ai = select("Enemy difficulty", "difficulty", DIFFICULTIES, (value) => {
    const text = String(value);
    return text.charAt(0).toUpperCase() + text.slice(1);
  });
  ai.onchange = () => {
    if (isDifficulty(ai.value)) set({ difficulty: ai.value });
  };
  const percentages = [
    ["density", "Enemy density"],
    ["npcHp", "Non-player health"],
    ["playerHp", "Player health"],
  ] as const;
  const sliders = percentages.map(([key, title]) => {
    const input = select(title, key, PERCENTAGES, (n) => n + "%");
    input.onchange = () => {
      const value = Number(input.value);
      if (isPercentage(value)) set({ [key]: value });
    };
    return { key, input };
  });
  const friendly = doc.createElement("input");
  friendly.type = "checkbox";
  friendly.name = "friendlyFire";
  label("Friendly fire", friendly);
  friendly.onchange = () => set({ friendlyFire: friendly.checked });
  function update(next: CyberfuseSettings, allowEdit: boolean) {
    settings = next;
    editable = allowEdit && next.mode === "campaign";
    element.hidden = next.mode !== "campaign";
    const values = next.gameplay ?? DEFAULT_GAMEPLAY;
    ai.value = values.difficulty;
    ai.disabled = !editable;
    for (const { input, key } of sliders) {
      input.value = String(values[key]);
      input.disabled = !editable;
    }
    friendly.checked = values.friendlyFire;
    friendly.disabled = !editable;
  }
  update(initial, true);
  return { element, update };
}
