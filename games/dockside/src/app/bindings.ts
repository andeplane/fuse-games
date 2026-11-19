import { KEY } from "../game/canal.js";
export const CAMERA = 1 << 15,
  MAP = 1 << 16;
function binding(
  bit: number,
  codes: string[],
  keys: string,
  pad: string,
  touch: string,
  action: string,
) {
  return { bit, codes, keys, pad, touch, action };
}
export const bindings = [
  binding(
    KEY.up,
    ["KeyW", "ArrowUp"],
    "W / ↑",
    "D-pad ↑",
    "▲",
    "Drive forward",
  ),
  binding(KEY.down, ["KeyS", "ArrowDown"], "S / ↓", "D-pad ↓", "▼", "Reverse"),
  binding(
    KEY.left,
    ["KeyA", "ArrowLeft"],
    "A / ←",
    "D-pad ←",
    "↶",
    "Rotate left",
  ),
  binding(
    KEY.right,
    ["KeyD", "ArrowRight"],
    "D / →",
    "D-pad →",
    "↷",
    "Rotate right",
  ),
  binding(KEY.jinkLeft, ["KeyQ"], "Q", "L2", "◀", "Jink left"),
  binding(KEY.jinkRight, ["KeyE"], "E", "R2", "▶", "Jink right"),
  binding(KEY.fire, ["KeyJ"], "J", "Square", "Laser", "Fire laser gun"),
  binding(KEY.missile, ["KeyK"], "K", "Cross", "Heavy", "Fire heavy missile"),
  binding(KEY.special, ["KeyL"], "L", "Circle", "Pulse", "Fire shock pulse"),
  binding(
    KEY.jump,
    ["Space"],
    "Space",
    "Triangle",
    "Jump",
    "Jump in walker / brake in travel form",
  ),
  binding(
    KEY.modifier,
    ["KeyF"],
    "F",
    "L1",
    "Act",
    "Tap on a factory pad to launch. Hold with movement for careful steps or short jinks, or with Jump to crouch in walker form",
  ),
  binding(
    KEY.lock,
    ["KeyR"],
    "R",
    "R1",
    "Lock",
    "Lock or cycle nearby enemies",
  ),
  binding(
    KEY.shift,
    ["ShiftLeft", "ShiftRight"],
    "Shift",
    "L1 + R1",
    "Form",
    "Transform chassis",
  ),
  binding(
    CAMERA,
    ["KeyC"],
    "C",
    "Select",
    "View",
    "Switch chase camera distance",
  ),
  binding(MAP, ["KeyM"], "M", "Start", "Map", "Expand or reduce tactical map"),
];
export const CONTROLS = bindings.map((b) => ({
  keys: b.keys + " · " + b.pad,
  action: b.action,
}));
export const TOUCH_CONTROLS = bindings.map((b) => ({
  keys: b.touch,
  action: b.action,
}));
const padBits = [
  KEY.missile,
  KEY.special,
  KEY.fire,
  KEY.jump,
  KEY.modifier,
  KEY.lock,
  KEY.jinkLeft,
  KEY.jinkRight,
  CAMERA,
  MAP,
  0,
  0,
  KEY.up,
  KEY.down,
  KEY.left,
  KEY.right,
];
export function standardPadBits(
  pad: Pick<Gamepad, "mapping" | "buttons" | "axes">,
) {
  if (pad.mapping !== "standard") return 0;
  let bits = padBits.reduce(
    (value, bit, i) => (pad.buttons[i]?.pressed ? value | bit : value),
    0,
  );
  const [x = 0, y = 0] = pad.axes;
  if (Math.abs(x) > 0.45) bits |= x < 0 ? KEY.left : KEY.right;
  if (Math.abs(y) > 0.45) bits |= y < 0 ? KEY.up : KEY.down;
  return bits;
}
/** Defer a single shoulder button's action until release so a staggered chord cannot launch or cycle. */
export function shoulderControls() {
  let previous = 0,
    chord = false,
    modified = false;
  return {
    clear() {
      previous = 0;
      chord = false;
      modified = false;
    },
    read(raw: number, cancelled = 0) {
      previous &= ~(cancelled & ~raw);
      const shoulders = KEY.modifier | KEY.lock,
        held = raw & shoulders;
      let bits = raw & ~shoulders;
      if (held === shoulders) chord = true;
      if (chord) {
        if (held === shoulders) bits |= KEY.shift;
        if (!held) chord = false;
      } else {
        if (held & KEY.modifier) {
          bits |= KEY.modifier;
          if (
            raw &
            (KEY.up | KEY.down | KEY.jinkLeft | KEY.jinkRight | KEY.jump)
          )
            modified = true;
        }
        if (previous & KEY.modifier && !(held & KEY.modifier)) {
          if (!modified) bits |= KEY.launch;
          modified = false;
        }
        if (previous & KEY.lock && !(held & KEY.lock)) bits |= KEY.lock;
      }
      if (!held) modified = false;
      previous = held;
      return bits;
    },
  };
}
