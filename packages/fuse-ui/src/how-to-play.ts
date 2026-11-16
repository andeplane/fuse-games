import { el } from "./dom.js";

export interface ControlHint {
  keys: string;
  action: string;
}

/** Use the same control data as the running game's controls menu. */
export interface HowToPlayOptions {
  controlsTitle?: string;
  keycaps?: boolean;
  goal: string;
  controls: readonly ControlHint[];
  touchControls?: readonly ControlHint[];
  rules?: readonly string[];
  document?: Document;
}

export function createControlList(
  controls: readonly ControlHint[],
  document: Document,
  keyboard = true,
): HTMLElement {
  const list = el("dl", "", "fui-controls-list", document);
  for (const hint of controls) {
    const row = el("div", "", "fui-controls-row", document);
    const term = el("dt", "", "", document);
    term.append(el(keyboard ? "kbd" : "span", hint.keys, "", document));
    row.append(term, el("dd", hint.action, "", document));
    list.append(row);
  }
  return list;
}

/** Content only: the shared menu owns the dialog, scrolling, focus and Back/Escape. */
export function createHowToPlay(options: HowToPlayOptions): HTMLElement {
  const doc = options.document ?? document;
  const root = el("section", "", "fui-how-to-play", doc);
  if (options.goal)
    root.append(el("p", options.goal, "fui-controls-goal", doc));
  root.append(
    el("h3", options.controlsTitle ?? "Controls", "", doc),
    createControlList(options.controls, doc, options.keycaps ?? true),
  );
  if (options.touchControls?.length)
    root.append(
      el("h3", "Touch controls", "", doc),
      createControlList(options.touchControls, doc, false),
    );
  if (options.rules?.length) {
    const list = el("ul", "", "", doc);
    for (const rule of options.rules) list.append(el("li", rule, "", doc));
    root.append(el("h3", "How it works", "", doc), list);
  }
  return root;
}
