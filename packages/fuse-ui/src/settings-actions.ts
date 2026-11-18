import { button, el } from "./dom.js";

export type SettingsScope = "room" | "player";
export const settingsLabel = (scope: SettingsScope): string =>
  scope === "room" ? "Room settings" : "Player options";

/** Shared, decorative line icons; the visible text always names the scope. */
export function settingsActionMarkup(scope: SettingsScope): string {
  const paths =
    scope === "room"
      ? '<path d="M4 7h16M4 17h16M8 4v6M16 14v6"/>'
      : '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>';
  return `<svg class="fui-settings-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">${paths}</svg><span>${settingsLabel(scope)}</span>`;
}

export function labelSettingsAction(
  node: HTMLButtonElement,
  scope: SettingsScope,
): void {
  node.classList.add("fui-settings-action");
  node.innerHTML = settingsActionMarkup(scope);
  node.setAttribute("aria-label", settingsLabel(scope));
}

let nextOptions = 0;

/** Personal preferences in a shared disclosure. Outside press and Escape dismiss it. */
export function createPlayerOptions(options: {
  document: Document;
  content: readonly Node[];
  /** Name of the specific preference when this disclosure is a contextual shortcut. */
  label?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const doc = options.document;
  const element = el("span", "", "fui-player-options", doc);
  const toggle = button("", "fui-button fui-player-options-toggle", doc);
  labelSettingsAction(toggle, "player");
  const label = options.label ?? settingsLabel("player");
  toggle.querySelector("span")!.textContent = label;
  toggle.setAttribute("aria-label", label);
  const panel = el("section", "", "fui-player-options-panel", doc);
  panel.id = `fui-player-options-${++nextOptions}`;
  panel.hidden = true;
  panel.setAttribute("aria-label", label);
  panel.append(...options.content);
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", panel.id);
  const set = (open: boolean) => {
    if (panel.hidden === !open) return;
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    options.onOpenChange?.(open);
  };
  toggle.onclick = () => set(panel.hidden);
  const outside = (event: Event) => {
    if (!panel.hidden && !element.contains(event.target as Node | null))
      set(false);
  };
  const key = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || panel.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    set(false);
    toggle.focus();
  };
  doc.addEventListener("pointerdown", outside);
  element.addEventListener("keydown", key);
  element.append(toggle, panel);
  return {
    element,
    button: toggle,
    panel,
    close: () => set(false),
    dispose() {
      set(false);
      toggle.onclick = null;
      doc.removeEventListener("pointerdown", outside);
      element.removeEventListener("keydown", key);
    },
  };
}
