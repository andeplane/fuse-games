import { gamepadButtonDown, type GamepadLike } from "fuse-ui/gamepad";
import { ATTACK, DOWN, JUMP, LEFT, MAGIC, RIGHT, UP } from "../engine/input.js";
import { directionBits } from "./pad.js";

/** How far (0–1) the left stick must lean before it steers, so a worn stick resting off centre does not walk. */
export const STICK_DEAD_ZONE = 0.35;
/** Standard mapping: the d-pad's up, down, left and right buttons. */
const DPAD: readonly (readonly [number, number])[] = [
  [12, UP],
  [13, DOWN],
  [14, LEFT],
  [15, RIGHT],
];
/** The face buttons: A (Cross) attacks, B (Circle) jumps, X (Square) and Y (Triangle) cast magic. */
const FACE: readonly (readonly [number, number])[] = [
  [0, ATTACK],
  [1, JUMP],
  [2, MAGIC],
  [3, MAGIC],
];

/**
 * The bits `pad` holds: the left stick (past its dead zone, 8-way) or the d-pad walks, the face buttons fight. An
 * unmapped pad has no known d-pad, so only its stick and first four buttons count.
 */
export function gamepadBits(pad: GamepadLike): number {
  let bits = directionBits(pad.axes[0] ?? 0, pad.axes[1] ?? 0, STICK_DEAD_ZONE);
  for (const [button, bit] of FACE)
    if (gamepadButtonDown(pad.buttons[button])) bits |= bit;
  if (pad.mapping === "standard")
    for (const [button, bit] of DPAD)
      if (gamepadButtonDown(pad.buttons[button])) bits |= bit;
  return bits;
}
