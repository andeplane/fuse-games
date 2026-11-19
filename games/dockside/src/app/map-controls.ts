import { FIELD, KEY, type Point } from "../game/canal.js";
import { MAP } from "./bindings.js";
export function tacticalMapControls() {
  const directions = KEY.up | KEY.down | KEY.left | KEY.right;
  let open = false,
    previous = 0,
    blocked = 0,
    held = 0,
    tapped = 0,
    recenter = false,
    lastTick = -1;
  let center: Point | undefined;
  return {
    get open() {
      return open;
    },
    read(raw: number) {
      const pressed = raw & ~previous;
      previous = raw;
      blocked &= raw;
      if (pressed & MAP) {
        open = !open;
        blocked = raw;
        center = undefined;
        held = 0;
        tapped = 0;
        recenter = false;
        lastTick = -1;
        return 0;
      }
      const available = raw & ~blocked;
      if (!open) return available;
      held = available & directions;
      tapped |= pressed & held;
      if (pressed & available & KEY.modifier) recenter = true;
      return 0;
    },
    frame(pilot: Point, tick: number) {
      if (!open) return;
      if (recenter) {
        center = { x: pilot.x, z: pilot.z };
        recenter = false;
      }
      const motion = tapped | (tick !== lastTick ? held : 0);
      tapped = 0;
      lastTick = tick;
      if (motion) {
        center ??= { x: 0, z: 0 };
        const dx =
          Number(!!(motion & KEY.right)) - Number(!!(motion & KEY.left));
        const dz = Number(!!(motion & KEY.down)) - Number(!!(motion & KEY.up));
        center.x = Math.max(-FIELD.x, Math.min(FIELD.x, center.x + dx * 80));
        center.z = Math.max(-FIELD.z, Math.min(FIELD.z, center.z + dz * 80));
      }
      return center;
    },
  };
}
