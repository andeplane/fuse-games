import { button, el } from "fuse-ui";
import { playtestInputBlocked } from "fuse-ui/playtest-input";

const bindings = [
  {
    label: "Left",
    keys: ["ArrowLeft", "KeyA"],
    hint: "← / A",
    action: "Steer left",
  },
  {
    label: "Right",
    keys: ["ArrowRight", "KeyD"],
    hint: "→ / D",
    action: "Steer right",
  },
  {
    label: "Brake",
    keys: ["ArrowDown", "KeyS"],
    hint: "↓ / S",
    action: "Brake",
  },
  {
    label: "Gas",
    keys: ["ArrowUp", "KeyW"],
    hint: "↑ / W",
    action: "Open the throttle",
  },
  { label: "Gear −", keys: ["KeyZ"], hint: "Z", action: "Shift down" },
  {
    label: "Gear +",
    keys: ["KeyX", "Space"],
    hint: "X / Space",
    action: "Shift up",
  },
] as const;
export const controls = bindings.map((b) => ({
  keys: b.hint,
  action: b.action,
}));
export const touchControls = bindings.map((b) => ({
  keys: b.label,
  action: b.action,
}));
export const goal =
  "Start in neutral. In a manual, shift into first and shift up as the revs climb. An automatic selects drive when you press the gas. Launch on your green light and brake for bends. In bracket racing, beat your rival without going quicker than your dial-in. Leaving early or crossing lanes costs the heat.";
export interface DriveInput {
  throttle: boolean;
  brake: boolean;
  steer: -1 | 0 | 1;
  shift: -1 | 0 | 1;
}

export function drivingControls(
  active: () => boolean,
  send: (input: DriveInput) => void,
) {
  const element = el("div", "", "rod-pad");
  const held = new Map<string, number>();
  const buttons = bindings.map((b) => button(b.label, "rod-pedal"));
  element.append(...buttons);
  const pressed = (i: number) => [...held.values()].includes(i);
  const update = (shift: -1 | 0 | 1 = 0) => {
    buttons.forEach((b, i) => b.classList.toggle("pressed", pressed(i)));
    send({
      throttle: pressed(3),
      brake: pressed(2),
      steer: pressed(0) === pressed(1) ? 0 : pressed(0) ? -1 : 1,
      shift,
    });
  };
  const press = (source: string, i: number) => {
    if (!active() || held.has(source)) return;
    held.set(source, i);
    update(i === 4 ? -1 : i === 5 ? 1 : 0);
  };
  const release = (source: string) => {
    if (held.delete(source)) update();
  };
  const clear = () => {
    if (held.size) {
      held.clear();
      update();
    }
  };
  const listeners = new AbortController();
  const options = { signal: listeners.signal };
  buttons.forEach((b, i) => {
    b.onpointerdown = (e) => {
      if (e.button !== 0 || !active()) return;
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      press("p" + e.pointerId, i);
    };
    b.onpointerup =
      b.onlostpointercapture =
      b.onpointercancel =
        (e) => release("p" + e.pointerId);
    b.onclick = (e) => {
      if (e.detail === 0 && active()) {
        press("assist", i);
        release("assist");
      }
    };
  });
  document.addEventListener(
    "keydown",
    (e) => {
      if (
        !active() ||
        playtestInputBlocked(document) ||
        document.querySelector("dialog[open]") ||
        e.metaKey ||
        e.altKey ||
        e.ctrlKey ||
        (e.target instanceof HTMLElement &&
          e.target.closest("input,select,textarea,[contenteditable=true]"))
      )
        return;
      const i = bindings.findIndex((b) =>
        (b.keys as readonly string[]).includes(e.code),
      );
      if (i < 0) return;
      e.preventDefault();
      if (!e.repeat) press(e.code, i);
    },
    options,
  );
  document.addEventListener("keyup", (e) => release(e.code), options);
  window.addEventListener("blur", clear, options);
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) clear();
    },
    options,
  );
  return {
    element,
    clear,
    dispose() {
      clear();
      listeners.abort();
    },
  };
}
