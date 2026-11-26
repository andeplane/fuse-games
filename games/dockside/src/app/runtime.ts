import { RoomRuntime, type Callbacks, type RuntimeOptions } from "fuse-netcode";
import { INPUT_MASK } from "../game/canal.js";
import {
  PLAY,
  docksideGame,
  type Entry,
  type DocksideGame,
  type Room,
  type Settings,
  type View,
} from "../game/game.js";

export type DocksideCallbacks = Callbacks<View, never, Settings>;

/** Any number as held bits: unknown bits dropped. */
export const heldBits = (bits: number): number => bits & INPUT_MASK;

/**
 * The Dockside room: the netcode's runtime plus this device's held controls. A change of the held bits is logged
 * for the match this device sees; they stay held across a round, and a new match logs them again, since the fold
 * starts every match with nothing held.
 */
export class DocksideRuntime extends RoomRuntime<
  Room,
  Entry,
  View,
  never,
  Settings
> {
  private bits = 0;
  private sent = { matchId: "", bits: 0 };
  constructor(
    code: string,
    settings: Settings,
    callbacks: DocksideCallbacks,
    options: RuntimeOptions = {},
    game: DocksideGame = docksideGame,
  ) {
    super(game, code, settings, callbacks, options);
  }
  /** Holds `bits` (the pilot's movement and actions) from now on; logs them if this device plays in the match. */
  input(bits: number): void {
    this.bits = heldBits(bits);
    this.flush();
  }
  /** Re-logs the held bits when the match has moved on since they were last logged; call it from the state callback. */
  flush(): void {
    const room = this.world?.state;
    if (
      !room ||
      room.stage !== "running" ||
      !this.player()?.connected ||
      !room.world?.rigs.some((pilot) => pilot.id === this.id)
    )
      return;
    if (this.sent.matchId === room.matchId && this.sent.bits === this.bits)
      return;
    this.sent = { matchId: room.matchId, bits: this.bits };
    this.append(PLAY, room.matchId, this.bits);
    this.sendPackets(this.deps.now());
  }
  /** The newest simulated room, for confirmed result reporting. */
  roomState(): Room | undefined {
    return this.world?.state;
  }
  /** The log was reset (a resync): forget what was logged, not what is held, so `flush` logs the keys still down. */
  protected resetControls(): void {
    this.sent = { matchId: "", bits: 0 };
  }
  protected releaseControls(): void {
    this.input(0);
  }
  protected absentControls(): void {
    this.resetControls();
  }
}
