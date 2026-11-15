import {
  LEFT,
  RIGHT,
  UP,
  DOWN,
  JUMP,
  FIRE,
  ROPE,
  NEXT,
  PREV,
  CARVE,
  SLOT1,
  SLOT2,
  SLOT3,
  SLOT4,
  SLOT5,
  SELECT_MOD,
  STRAFE,
} from "../engine/classic/physics-types.js";

export const KEY_BITS: Readonly<Record<string, number>> = {
  ArrowLeft: LEFT,
  KeyA: LEFT,
  ArrowRight: RIGHT,
  KeyD: RIGHT,
  ArrowUp: UP,
  KeyW: UP,
  ArrowDown: DOWN,
  KeyS: DOWN,
  Space: JUMP,
  KeyF: FIRE,
  KeyJ: FIRE,
  KeyR: ROPE,
  KeyK: ROPE,
  KeyQ: PREV,
  KeyE: NEXT,
  KeyG: CARVE,
  KeyC: CARVE,
  ControlLeft: CARVE,
  ControlRight: CARVE,
  ShiftLeft: SELECT_MOD,
  ShiftRight: SELECT_MOD,
  AltLeft: STRAFE,
  AltRight: STRAFE,
  Digit1: SLOT1,
  Digit2: SLOT2,
  Digit3: SLOT3,
  Digit4: SLOT4,
  Digit5: SLOT5,
  Enter: FIRE,
};

/** Track sources separately: releasing one finger must not release another finger or a held key. */
export class HeldControls {
  private sources = new Map<string, number>();
  private touchWalking = new Set<string>();
  private lastCarveAt: number;
  private carvePulse = false;
  constructor(
    private send: (bits: number) => void,
    private now: () => number,
  ) {
    this.lastCarveAt = now();
  }
  private emit(): void {
    this.send([...this.sources.values()].reduce((all, bit) => all | bit, 0));
  }
  set(source: string, bits: number): void {
    if (bits) this.sources.set(source, bits);
    else this.sources.delete(source);
    this.emit();
  }
  /** Native TouchControls walk-to-carve throttle, recorded as ordinary input edges. */
  setTouch(source: string, bits: number): void {
    if (bits & (LEFT | RIGHT)) this.touchWalking.add(source);
    else this.touchWalking.delete(source);
    this.set(source, bits);
    this.update();
  }
  update(enabled = true): void {
    if (this.carvePulse) {
      this.sources.delete("touch-auto-carve");
      this.carvePulse = false;
      this.emit();
    }
    const selecting = [...this.sources.values()].some(
      (bits) => (bits & SELECT_MOD) !== 0,
    );
    if (
      enabled &&
      this.touchWalking.size &&
      !selecting &&
      this.now() - this.lastCarveAt >= 200
    ) {
      this.lastCarveAt = this.now();
      this.sources.set("touch-auto-carve", CARVE);
      this.carvePulse = true;
      this.emit();
    }
  }
  release(): void {
    this.sources.clear();
    this.touchWalking.clear();
    this.carvePulse = false;
    this.send(0);
  }
}
