import { RoomRuntime, type Callbacks, type RuntimeOptions } from "fuse-netcode";
import {
  HOLD,
  ROLL,
  incredibleFuseGame,
  type IncredibleFuseEntry,
  type IncredibleFuseEvent,
  type IncredibleFuseRoom,
  type IncredibleFuseSettings,
  type IncredibleFuseView,
} from "../game/index.js";

export type IncredibleFuseCallbacks = Callbacks<IncredibleFuseView, IncredibleFuseEvent, IncredibleFuseSettings>;

/**
 * The incredibleFuse room: the netcode's runtime plus ROLL and HOLD. Each press is logged for the turn this device sees, so a
 * press that arrives after the turn moved on (a timer hold, a rollback) names an old turn and the rules ignore it.
 */
export class IncredibleFuseRuntime extends RoomRuntime<
  IncredibleFuseRoom,
  IncredibleFuseEntry,
  IncredibleFuseView,
  IncredibleFuseEvent,
  IncredibleFuseSettings
> {
  constructor(
    code: string,
    settings: IncredibleFuseSettings,
    callbacks: IncredibleFuseCallbacks,
    options: RuntimeOptions = {},
  ) {
    super(incredibleFuseGame, code, settings, callbacks, options);
  }
  /** Logs ROLL or HOLD for the current turn; false when it is not this device's turn to act. */
  play(action: "roll" | "hold"): boolean {
    const room = this.world?.state;
    if (
      !room ||
      room.stage !== "running" ||
      room.turn !== this.id ||
      !this.player()?.connected ||
      (action === "hold" && room.turnTotal === 0)
    )
      return false;
    this.append(action === "roll" ? ROLL : HOLD, room.turnNo);
    this.sendPackets(this.deps.now());
    return true;
  }
  /** The newest simulated room, for the reports a device sends; the screen renders from the view. */
  roomState(): IncredibleFuseRoom | undefined {
    return this.world?.state;
  }
  /** This device's member id, once the room service admitted it ("solo" alone). */
  get self(): string {
    return this.id;
  }
}
