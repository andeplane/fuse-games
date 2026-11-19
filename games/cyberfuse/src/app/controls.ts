import { button, el } from "fuse-ui";
import { UP, RIGHT, DOWN, LEFT, FIRE, SPECIAL } from "../game/index.js";

const keys = new Map<string, number>([
  ["KeyW", UP],
  ["ArrowUp", UP],
  ["KeyD", RIGHT],
  ["ArrowRight", RIGHT],
  ["KeyS", DOWN],
  ["ArrowDown", DOWN],
  ["KeyA", LEFT],
  ["ArrowLeft", LEFT],
  ["ControlLeft", FIRE],
  ["Space", FIRE],
  ["ShiftLeft", SPECIAL],
  ["Enter", SPECIAL],
]);

const secondKeys = new Map<string, number>([
  ["KeyW", UP],
  ["KeyD", RIGHT],
  ["KeyS", DOWN],
  ["KeyA", LEFT],
  ["KeyF", FIRE],
  ["KeyG", SPECIAL],
  ["Numpad8", UP],
  ["Numpad6", RIGHT],
  ["Numpad2", DOWN],
  ["Numpad4", LEFT],
  ["Numpad0", FIRE],
  ["NumpadEnter", SPECIAL],
]);

export const guide = {
  goal: "Complete the mission objectives, then reach extraction with the surviving squad. In Dogfight, be the last operative standing.",
  controls: [
    { keys: "WASD / arrows", action: "Move and face one of eight directions" },
    {
      keys: "Space / Left Ctrl",
      action: "Hold to fire in the direction you face",
    },
    {
      keys: "Shift / Enter",
      action: "Tap to switch weapons, or hold with a direction to slide",
    },
    {
      keys: "Shared keyboard",
      action:
        "Player 1 uses arrows, Space and Shift. Player 2 uses WASD, F to fire and G to slide or switch. Keypad 8/4/2/6, 0 and keypad Enter also work for player 2.",
    },
    { keys: "M", action: "Show or hide the campaign map" },
    { keys: "Esc", action: "Open or close the game menu" },
  ],
  touchControls: [
    {
      keys: "Direction pad",
      action: "Drag from the centre to move, including diagonals",
    },
    { keys: "Fire", action: "Hold to fire" },
    {
      keys: "Slide / switch",
      action:
        "Hold while moving to slide, or tap while still to switch weapons",
    },
    { keys: "Map", action: "Show or hide the campaign map" },
  ],
};

export function bindControls(
  send: (bits: number) => void,
  active: () => boolean,
  map: () => void,
  second?: (bits: number) => void,
  inspecting: () => boolean = () => false,
) {
  const root = el("div", "", "cf-pad");
  const stick = el("div", "", "cf-stick");
  stick.setAttribute("aria-label", "Directional pad");
  stick.append(el("i"), el("span", "✦"));
  const fire = button("Fire", "cf-fire"),
    special = button("Slide / switch", "cf-special");
  root.append(stick, special, fire);
  const pressed = new Map<string, number>();
  const set = (id: string, bits: number) => {
    if (bits) pressed.set(id, bits);
    else pressed.delete(id);
    let one = 0,
      two = 0;
    for (const [code, part] of pressed) {
      if (second && secondKeys.has(code)) two |= part;
      else one |= part;
    }
    send(one);
    second?.(two);
  };
  const clear = () => {
    pressed.clear();
    send(0);
    second?.(0);
    stick.style.removeProperty("--dx");
    stick.style.removeProperty("--dy");
  };
  const down = (event: KeyboardEvent) => {
    if (
      !active() ||
      event.metaKey ||
      event.altKey ||
      (event.target instanceof HTMLElement &&
        event.target.closest(
          "input,textarea,select,button,[contenteditable=true]",
        ))
    )
      return;
    if (event.code === "KeyM") {
      event.preventDefault();
      if (!event.repeat) map();
      return;
    }
    if (inspecting()) return;
    const bit =
      (second ? secondKeys.get(event.code) : undefined) ?? keys.get(event.code);
    if (bit !== undefined) {
      event.preventDefault();
      if (!event.repeat) set(event.code, bit);
    }
  };
  const up = (event: KeyboardEvent) => {
    if (pressed.has(event.code)) {
      event.preventDefault();
      set(event.code, 0);
    }
  };
  const abort = new AbortController();
  const opts = { signal: abort.signal };
  document.addEventListener("keydown", down, opts);
  document.addEventListener("keyup", up, opts);
  window.addEventListener("blur", clear, opts);
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) clear();
    },
    opts,
  );
  const pads: ReadonlyArray<readonly [HTMLElement, number]> = [
    [fire, FIRE],
    [special, SPECIAL],
    [stick, 0],
  ];
  for (const [node, bit] of pads) {
    let current: number | null = null;
    const move = (e: PointerEvent) => {
      if (current !== e.pointerId) return;
      if (bit) {
        set(String(current), bit);
        return;
      }
      const rect = stick.getBoundingClientRect();
      const dx = ((e.clientX - rect.left) / rect.width) * 2 - 1,
        dy = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      const distance = Math.hypot(dx, dy);
      stick.style.setProperty(
        "--dx",
        String((dx / Math.max(1, distance)) * 30) + "%",
      );
      stick.style.setProperty(
        "--dy",
        String((dy / Math.max(1, distance)) * 30) + "%",
      );
      const x = Math.abs(dx) > distance * 0.38,
        y = Math.abs(dy) > distance * 0.38;
      set(
        String(current),
        distance < 0.15
          ? 0
          : (x ? (dx < 0 ? LEFT : RIGHT) : 0) | (y ? (dy < 0 ? UP : DOWN) : 0),
      );
    };
    node.addEventListener(
      "pointerdown",
      (e) => {
        if (!active() || inspecting() || current !== null) return;
        e.preventDefault();
        current = e.pointerId;
        node.setPointerCapture(current);
        move(e);
      },
      opts,
    );
    node.addEventListener("pointermove", move, opts);
    const release = (e: PointerEvent) => {
      if (e.pointerId !== current) return;
      set(String(current), 0);
      current = null;
      if (!bit) {
        stick.style.removeProperty("--dx");
        stick.style.removeProperty("--dy");
      }
    };
    for (const event of [
      "pointerup",
      "pointercancel",
      "lostpointercapture",
    ] as const)
      node.addEventListener(event, release, opts);
  }
  return {
    element: root,
    clear,
    dispose() {
      abort.abort();
      clear();
    },
  };
}
