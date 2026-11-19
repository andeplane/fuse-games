import { gamepadButtonDown, type GamepadLike } from "fuse-ui/gamepad";
import { DUCK, JUMP } from "../engine/input.js";

/** How far (0–1) the left stick must lean before it counts. */
export const STICK_DEAD_ZONE = 0.5;
/** Buttons that jump: A (Cross), Y (Triangle) and the right shoulder; and that duck: B (Circle), X (Square), the left one. */
const JUMP_BUTTONS = [0, 3, 5] as const,
  DUCK_BUTTONS = [1, 2, 4] as const;
/** Standard mapping: the d-pad's up and down. */
const DPAD_UP = 12,
  DPAD_DOWN = 13;

/** The bits `pad` holds: stick or d-pad up and A or Y jump; stick or d-pad down and B or X duck. */
export function gamepadBits(pad: GamepadLike): number {
  const y = pad.axes[1] ?? 0;
  let bits = 0;
  if (Number.isFinite(y)) {
    if (y < -STICK_DEAD_ZONE) bits |= JUMP;
    else if (y > STICK_DEAD_ZONE) bits |= DUCK;
  }
  for (const button of JUMP_BUTTONS)
    if (gamepadButtonDown(pad.buttons[button])) bits |= JUMP;
  for (const button of DUCK_BUTTONS)
    if (gamepadButtonDown(pad.buttons[button])) bits |= DUCK;
  if (pad.mapping === "standard") {
    if (gamepadButtonDown(pad.buttons[DPAD_UP])) bits |= JUMP;
    if (gamepadButtonDown(pad.buttons[DPAD_DOWN])) bits |= DUCK;
  }
  return bits;
}
