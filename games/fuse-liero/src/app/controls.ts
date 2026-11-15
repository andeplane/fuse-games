import {
  LEFT,
  RIGHT,
  UP,
  DOWN,
  JUMP,
  FIRE,
  ROPE,
  NEXT,
} from "../engine/index.js";

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
  KeyQ: NEXT,
  KeyE: NEXT,
};

/** Track sources separately: releasing one finger must not release another finger or a held key. */
export class HeldControls {
  private sources = new Map<string, number>();
  constructor(private send: (bits: number) => void) {}
  set(source: string, bits: number): void {
    if (bits) this.sources.set(source, bits);
    else this.sources.delete(source);
    this.send([...this.sources.values()].reduce((all, bit) => all | bit, 0));
  }
  release(): void {
    this.sources.clear();
    this.send(0);
  }
}
