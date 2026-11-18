import { button, el } from "fuse-ui";
import {
  validWorkshopBlueprint,
  type WorkshopBlueprint,
} from "../game/machine.js";
import { parseTimWorkshop } from "../game/tim-import.js";

const STORAGE_KEY = "incredible-fuse-local-workshop-v1";
const MAX_FILE_BYTES = 256 * 1024;

export function readLocalWorkshop(): WorkshopBlueprint | undefined {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored || stored.length > MAX_FILE_BYTES) return;
    const blueprint: unknown = JSON.parse(stored);
    return validWorkshopBlueprint(blueprint) ? blueprint : undefined;
  } catch {
    return;
  }
}

/** Only the normalized workbench is kept for this tab. The DOS file stays on the device. */
export function localWorkshopPicker({
  onOpen,
}: {
  onOpen: () => void;
}): HTMLElement {
  const details = el("details", "", "machine-import");
  const summary = el("summary", "Open a DOS machine");
  const label = el("label", "Choose a local .TIM freeform machine");
  const file = el("input");
  file.type = "file";
  file.accept = ".tim";
  label.append(file);
  const status = el("p");
  status.setAttribute("role", "status");
  const open = button("Open workbench", "fui-button");
  open.hidden = true;
  let selected: WorkshopBlueprint | undefined;
  file.onchange = async () => {
    const input = file.files?.[0];
    open.hidden = true;
    selected = undefined;
    status.textContent = "";
    if (!input) return;
    try {
      if (input.size > MAX_FILE_BYTES)
        throw new Error("Choose a .TIM machine smaller than 256 KiB.");
      const parsed = parseTimWorkshop(
        new Uint8Array(await input.arrayBuffer()),
      );
      if (file.files?.[0] !== input) return;
      selected = parsed.blueprint;
      status.textContent = [
        selected.parts.length + " parts loaded.",
        ...parsed.warnings,
      ].join(" ");
      open.hidden = false;
    } catch (error) {
      if (file.files?.[0] === input)
        status.textContent =
          error instanceof Error
            ? error.message
            : "The machine could not be opened.";
    }
  };
  open.onclick = () => {
    if (!selected) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(selected));
    } catch {
      status.textContent =
        "Allow session storage for this tab to open the machine.";
      return;
    }
    onOpen();
  };
  details.append(summary, label, status, open);
  return details;
}
