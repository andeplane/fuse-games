import { gamepadButtonDown, type GamepadLike } from "fuse-ui/gamepad";
import { JUMP, LEFT, RIGHT } from "../engine/input.js";

/** How far (0–1) the left stick must lean sideways before it walks. */
export const STICK_DEAD_ZONE = 0.35;
/** Face buttons that jump: A (Cross), B (Circle), X (Square), Y (Triangle); and the shoulders. */
const JUMP_BUTTONS = [0, 1, 2, 3, 4, 5] as const;
/** Standard mapping: the d-pad's up, left and right. */
const DPAD_UP = 12,
  DPAD_LEFT = 14,
  DPAD_RIGHT = 15;

/** The bits `pad` holds: the left stick or the d-pad walks, a face button or d-pad up jumps. */
export function gamepadBits(pad: GamepadLike): number {
  const x = pad.axes[0] ?? 0;
  let bits = 0;
  if (Number.isFinite(x)) {
    if (x < -STICK_DEAD_ZONE) bits |= LEFT;
    else if (x > STICK_DEAD_ZONE) bits |= RIGHT;
  }
  for (const button of JUMP_BUTTONS)
    if (gamepadButtonDown(pad.buttons[button])) bits |= JUMP;
  if (pad.mapping === "standard") {
    if (gamepadButtonDown(pad.buttons[DPAD_UP])) bits |= JUMP;
    if (gamepadButtonDown(pad.buttons[DPAD_LEFT]))
      bits = (bits & ~RIGHT) | LEFT;
    if (gamepadButtonDown(pad.buttons[DPAD_RIGHT]))
      bits = (bits & ~LEFT) | RIGHT;
  }
  return bits;
}
