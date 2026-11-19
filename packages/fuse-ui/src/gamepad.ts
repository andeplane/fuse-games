/** The part of a `Gamepad` this reads. */
export interface GamepadLike {
  readonly index: number;
  readonly connected: boolean;
  readonly mapping: string;
  readonly axes: readonly number[];
  readonly buttons: readonly {
    readonly pressed: boolean;
    readonly value: number;
  }[];
}

/** Where the pads come from: the browser's `navigator.getGamepads` (`browserGamepads`), a fake in tests. */
export interface GamepadSource {
  pads(): readonly (GamepadLike | null)[];
}

/** Treat digital presses and analog travel the same way. */
export function gamepadButtonDown(
  button: GamepadLike["buttons"][number] | undefined,
  threshold = 0.5,
): boolean {
  return button !== undefined && (button.pressed || button.value > threshold);
}

/**
 * One pad drives the local player. A connected pad takes over when its mapped
 * bits change to a nonzero value. The owner stays selected across neutral
 * polls until another pad presses or the owner disconnects.
 *
 * Inactive polls and letGo release controls. A pad held during that pause
 * must return to neutral before it can drive again.
 */
export class GamepadInput {
  private driver: number | undefined;
  /** Each connected pad's bits at the last poll, to tell which one has just pressed. */
  private seen = new Map<number, number>();
  /** The pads held when input was let go, which are read as neutral until they are. */
  private readonly latched = new Set<number>();
  constructor(
    private readonly source: GamepadSource,
    private readonly readBits: (pad: GamepadLike) => number,
    private readonly hold: (bits: number) => void,
  ) {}
  /** Lets go of everything the pads hold, now and until each lets go itself. */
  letGo(): void {
    this.poll(false);
  }
  /** Reads the pads and holds the driver's bits; while not `active` (a hidden page, MENU open) it holds none. */
  poll(active = true): void {
    const bits = new Map<number, number>();
    for (const pad of this.source.pads()) {
      if (!pad?.connected) continue;
      const held = this.readBits(pad);
      if (!held) this.latched.delete(pad.index);
      else if (!active) this.latched.add(pad.index);
      bits.set(pad.index, this.latched.has(pad.index) ? 0 : held);
    }
    for (const index of this.latched)
      if (!bits.has(index)) this.latched.delete(index);
    if (this.driver !== undefined && !bits.has(this.driver))
      this.driver = undefined;
    for (const [index, held] of bits)
      if (held && (this.driver === undefined || held !== this.seen.get(index)))
        this.driver = index;
    this.seen = bits;
    this.hold(
      active && this.driver !== undefined ? (bits.get(this.driver) ?? 0) : 0,
    );
  }
}

/** The part of `navigator` the browser's gamepads come through. */
export interface GamepadNavigator {
  getGamepads?: () => readonly (GamepadLike | null)[];
}

/**
 * `navigator.getGamepads` as a `GamepadSource`. A browser without the API, or a permissions policy that forbids it
 * (it throws), simply has no pads.
 */
export function browserGamepads(navigator: GamepadNavigator): GamepadSource {
  return {
    pads() {
      try {
        return navigator.getGamepads?.() ?? [];
      } catch {
        return [];
      }
    },
  };
}
