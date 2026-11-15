import { RoomRuntime, type Callbacks, type RuntimeOptions } from "fuse-netcode";
import type { Settings } from "../engine/index.js";
import { isInput, validLoadout } from "../engine/index.js";
import {
  PLAY,
  LOADOUT,
  BEGIN_LOADOUT,
  fuseroGame,
  type Entry,
  type Room,
  type View,
} from "./game.js";

export type FuseroCallbacks = Callbacks<View, never, Settings>;

/**
 * The Fusero room: the netcode's runtime plus this device's held controls. A change of the held bits is logged
 * for the round this device sees; a new round (or match) logs them again, since the fold starts every round with
 * nothing held.
 */
export class FuseroRuntime extends RoomRuntime<
  Room,
  Entry,
  View,
  never,
  Settings
> {
  private bits = 0;
  private sent = { matchId: "", round: -1, bits: 0 };
  constructor(
    code: string,
    settings: Settings,
    callbacks: FuseroCallbacks,
    options: RuntimeOptions = {},
  ) {
    super(fuseroGame, code, settings, callbacks, options);
  }
  /** Native /weapons: keep the worm in the world while its player selects a new inventory. */
  beginLoadout(): boolean {
    const room = this.world?.state,
      seat = this.player();
    if (
      !room ||
      room.stage !== "running" ||
      !seat?.connected ||
      seat.watcher ||
      !room.world?.worms.some((worm) => worm.id === this.id)
    )
      return false;
    this.input(0);
    this.append(BEGIN_LOADOUT, room.matchId, room.round);
    this.sendPackets(this.deps.now());
    return true;
  }
  /** Confirm the native five-slot inventory, through the player's own scoped stream. */
  loadout(ids: readonly number[]): boolean {
    const room = this.world?.state;
    const seat = this.player();
    if (
      !room ||
      (room.stage !== "lobby" && room.stage !== "running") ||
      !seat?.connected ||
      seat.watcher ||
      !validLoadout(ids, room.stage === "lobby" ? room.settings : room.play) ||
      (room.stage === "running" &&
        !room.world?.worms.some(
          (worm) => worm.id === this.id && !worm.weaponsReady,
        ))
    )
      return false;
    this.append(LOADOUT, room.matchId, room.round, [...ids]);
    this.sendPackets(this.deps.now());
    return true;
  }
  /** Holds `bits` from now on; logs them if the room is in a round and this device flies in it. */
  input(bits: number): void {
    this.bits = isInput(bits) ? bits : 0;
    this.flush();
  }
  /** Re-logs the held bits when the round has moved on since they were last logged. */
  flush(): void {
    const room = this.world?.state;
    if (
      !room ||
      room.stage !== "running" ||
      !this.player()?.connected ||
      !room.world?.worms.some((c) => c.id === this.id)
    )
      return;
    const { matchId, round, bits } = this.sent;
    if (matchId === room.matchId && round === room.round && bits === this.bits)
      return;
    this.sent = { matchId: room.matchId, round: room.round, bits: this.bits };
    this.append(PLAY, room.matchId, room.round, this.bits);
    this.sendPackets(this.deps.now());
  }
  /** What this device holds right now, logged or not: the screen leads its own pilot with it. */
  get heldNow(): number {
    return this.bits;
  }
  /** The newest simulated room, for reports and tests; the screen renders from frames. */
  roomState(): Room | undefined {
    return this.world?.state;
  }
  get self(): string {
    return this.id;
  }
  /** The log was reset (a resync): forget what was logged, not what is held, so `flush` logs the keys still down. */
  protected resetControls(): void {
    this.sent = { matchId: "", round: -1, bits: 0 };
  }
  protected releaseControls(): void {
    this.input(0);
  }
  protected absentControls(): void {
    this.resetControls();
  }
}
