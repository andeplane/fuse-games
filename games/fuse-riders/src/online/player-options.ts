import { selectedTheme, storeTheme } from "../client/theme-choice.js";
import {
  applyThemeProperties,
  themes,
  type ThemeDefinition,
} from "../render/themes.js";
import { createAnalyticsSetting } from "./analytics-setting.js";
import { node } from "./dom.js";

/** Shared device preferences on the landing page and in a room. */
export function createRiderOptions(
  mixer: HTMLElement,
  onTheme?: (theme: ThemeDefinition) => void,
) {
  const element = node("div", "", "settings-list");
  const privacy = createAnalyticsSetting();
  const style = node("section");
  const row = node("div", "", "settings-style");
  style.append(node("h3", "VISUAL STYLE", "settings-group"), row);
  let theme = selectedTheme();
  const choices = Object.values(themes).map((choice) => {
    const button = node("button", choice.label.toUpperCase());
    button.type = "button";
    button.setAttribute("aria-label", `Visual style: ${choice.label}`);
    button.onclick = () => {
      theme = choice;
      storeTheme(choice.id);
      applyThemeProperties(choice);
      onTheme?.(choice);
      refresh();
    };
    row.append(button);
    return { button, choice };
  });
  const fullscreen = node("button", "FULLSCREEN");
  fullscreen.type = "button";
  fullscreen.onclick = async () => {
    await (
      document.fullscreenElement
        ? document.exitFullscreen()
        : document.documentElement.requestFullscreen()
    ).catch(() => {});
    refresh();
  };
  function refresh() {
    for (const { button, choice } of choices)
      button.setAttribute("aria-pressed", String(theme.id === choice.id));
    fullscreen.hidden = !document.fullscreenEnabled;
    fullscreen.textContent = document.fullscreenElement
      ? "EXIT FULLSCREEN"
      : "FULLSCREEN";
    privacy.render();
    return element;
  }
  element.append(mixer, style, fullscreen, privacy.element);
  return { element, style, refresh };
}
