import { KEY } from "../game/canal.js";
import { playtestInputBlocked } from "fuse-ui/playtest-input";
export const CONTROLS = [
  { keys: "WASD / Arrows", action: "Move your rig" },
  { keys: "Shift", action: "Switch between walker and faster travel form" },
  { keys: "Space", action: "Fire at the nearest enemy in walker range" },
  { keys: "E", action: "Launch a drone on the marked factory pad" },
];
export const TOUCH_CONTROLS = [
  { keys: "Arrows", action: "Move your rig" },
  {
    keys: "FORM / FIRE / LAUNCH",
    action: "Transform, fire or buy a convoy on your pad",
  },
];
const binds: Record<string, number> = {
  KeyW: KEY.up,
  ArrowUp: KEY.up,
  KeyS: KEY.down,
  ArrowDown: KEY.down,
  KeyA: KEY.left,
  ArrowLeft: KEY.left,
  KeyD: KEY.right,
  ArrowRight: KEY.right,
  ShiftLeft: KEY.shift,
  ShiftRight: KEY.shift,
  Space: KEY.fire,
  KeyE: KEY.launch,
};
export function createControls(
  send: (bits: number) => void,
  active: () => boolean,
) {
  const pad = document.createElement("div");
  pad.className = "dockside-controls";
  const held = new Map<string, number>();
  const publish = () => send([...held.values()].reduce((a, b) => a | b, 0));
  function release() {
    held.clear();
    publish();
  }
  const available = () =>
    active() &&
    !document.querySelector("dialog[open]") &&
    !playtestInputBlocked(document);
  function keydown(e: KeyboardEvent) {
    const bit = binds[e.code];
    if (
      !bit ||
      !available() ||
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      e.target instanceof HTMLButtonElement
    )
      return;
    e.preventDefault();
    if (!held.has(e.code)) {
      held.set(e.code, bit);
      publish();
    }
  }
  function keyup(e: KeyboardEvent) {
    if (held.delete(e.code)) {
      e.preventDefault();
      publish();
    }
  }
  const groups = [
    [
      [KEY.up, "↑", "North"],
      [KEY.left, "←", "West"],
      [KEY.down, "↓", "South"],
      [KEY.right, "→", "East"],
    ],
    [
      [KEY.shift, "Form", "Transform"],
      [KEY.fire, "Fire", "Fire"],
      [KEY.launch, "Launch", "Launch drone"],
    ],
  ] as const;
  for (const group of groups) {
    const box = document.createElement("div");
    pad.append(box);
    for (const [bit, text, label] of group) {
      const b = document.createElement("button");
      b.className = "fui-button";
      b.textContent = text;
      b.setAttribute("aria-label", label);
      box.append(b);
      b.onpointerdown = (e) => {
        if (!available()) return;
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        held.set("p" + e.pointerId, bit);
        publish();
      };
      b.onlostpointercapture = (e) => {
        if (held.delete("p" + e.pointerId)) publish();
      };
      b.onclick = (e) => {
        if (!e.detail && available()) {
          held.set("a", bit);
          publish();
          held.delete("a");
          publish();
        }
      };
    }
  }
  const visibility = () => {
    if (document.hidden) release();
  };
  document.addEventListener("keydown", keydown);
  document.addEventListener("keyup", keyup);
  window.addEventListener("blur", release);
  document.addEventListener("visibilitychange", visibility);
  return {
    pad,
    release,
    dispose() {
      release();
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", visibility);
    },
  };
}
