import { gamepadButtonDown, type GamepadLike } from "fuse-ui/gamepad";
import {
  BRAKE,
  GAS,
  RESTART,
  TURN,
  VOLT_LEFT,
  VOLT_RIGHT,
} from "../engine/input.js";

/** Standard mapping: A, B, X, Y, the bumpers, the triggers and the d-pad's left and right. */
export const BUTTONS: readonly (readonly [number, number])[] = [
  [0, GAS],
  [7, GAS],
  [1, BRAKE],
  [6, BRAKE],
  [4, VOLT_LEFT],
  [14, VOLT_LEFT],
  [5, VOLT_RIGHT],
  [15, VOLT_RIGHT],
  [2, TURN],
  [3, RESTART],
];
/** A trigger counts as held past this much of its travel. */
export const TRIGGER_POINT = 0.3;

/** The bits `pad` holds: A or RT gas, B or LT brake, LB/RB or the d-pad volts, X turn, Y restart. */
export function gamepadBits(pad: GamepadLike): number {
  let bits = 0;
  for (const [button, bit] of BUTTONS) {
    // Without the standard mapping a d-pad may be anything: only the face buttons, bumpers and triggers count.
    if (button >= 12 && pad.mapping !== "standard") continue;
    if (gamepadButtonDown(pad.buttons[button], TRIGGER_POINT)) bits |= bit;
  }
  return bits;
}
