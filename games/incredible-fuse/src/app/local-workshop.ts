import { button, el } from "fuse-ui";
import {
  validWorkshopBlueprint,
  type Machine,
  type WorkshopBlueprint,
} from "../game/machine.js";
import { MAX_TIM_BYTES, parseTimWorkshop } from "../game/tim-import.js";

const STORAGE_KEY = "incredible-fuse-local-workshop-v1";
export function downloadWorkshop(machine: Machine) {
  const { air, gravity, parts, links } = machine;
  const file = new Blob(
    [JSON.stringify({ version: 1, blueprint: { air, gravity, parts, links } })],
    { type: "application/json" },
  );
  const url = URL.createObjectURL(file);
  const link = el("a");
  link.href = url;
  link.download = "workshop.fuse-machine.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function parseWorkshopFile(name: string, data: ArrayBuffer) {
  if (name.toLowerCase().endsWith(".tim"))
    return parseTimWorkshop(new Uint8Array(data));
  let record: unknown;
  try {
    record = JSON.parse(new TextDecoder().decode(data));
  } catch {
    throw new Error("Choose a Fuse blueprint or a DOS .TIM machine.");
  }
  if (
    record &&
    typeof record === "object" &&
    "version" in record &&
    record.version === 1 &&
    "blueprint" in record &&
    validWorkshopBlueprint(record.blueprint)
  )
    return { blueprint: record.blueprint, warnings: [] };
  throw new Error("This blueprint is invalid or uses an unsupported version.");
}

export function readLocalWorkshop(): WorkshopBlueprint | undefined {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored || stored.length > MAX_TIM_BYTES) return;
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
  const summary = el("summary", "Open a saved machine");
  const label = el("label", "Choose a Fuse blueprint or a DOS .TIM machine");
  const file = el("input");
  file.type = "file";
  file.accept = ".tim,.json";
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
      if (input.size > MAX_TIM_BYTES)
        throw new Error("Choose a machine no larger than 256 KiB.");
      const parsed = parseWorkshopFile(input.name, await input.arrayBuffer());
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
