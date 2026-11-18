import { RoomRuntime, type Callbacks, type RuntimeOptions } from "fuse-netcode";
import {
  fuserodGame,
  released,
  type DriveInput,
  type FuserodEntry,
  type FuserodRoom,
  type FuserodSettings,
  type FuserodView,
} from "../game/index.js";
export type FuserodCallbacks = Callbacks<FuserodView, never, FuserodSettings>;
export class FuserodRuntime extends RoomRuntime<
  FuserodRoom,
  FuserodEntry,
  FuserodView,
  never,
  FuserodSettings
> {
  private lastMatch = "";
  private held: DriveInput = released();
  constructor(
    code: string,
    settings: FuserodSettings,
    callbacks: FuserodCallbacks,
    options: RuntimeOptions = {},
  ) {
    super(fuserodGame, code, settings, callbacks, options);
  }
  get self(): string {
    return this.id;
  }
  input(control: DriveInput): boolean {
    const room = this.world?.state;
    if (
      room?.stage !== "running" ||
      !this.player()?.connected ||
      !room.race?.racers.some((r) => r.id === this.id && !r.motor.broken)
    )
      return false;
    if (
      room.matchId === this.lastMatch &&
      !control.shift &&
      control.steer === this.held.steer &&
      control.throttle === this.held.throttle &&
      control.brake === this.held.brake
    )
      return false;
    this.append(
      0,
      room.matchId,
      control.throttle,
      control.brake,
      control.steer,
      control.shift,
    );
    this.lastMatch = room.matchId;
    this.held = { ...control, shift: 0 };
    this.sendPackets(this.deps.now());
    return true;
  }
  cancel(): void {
    this.input(released());
    this.resetControls();
  }
  protected resetControls(): void {
    this.held = released();
    this.lastMatch = "";
  }
  protected releaseControls(): void {
    this.cancel();
  }
  protected absentControls(): void {
    this.resetControls();
  }
}
