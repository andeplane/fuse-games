import { RoomRuntime, type Callbacks, type RuntimeOptions } from "fuse-netcode";
import {
  ADVANCE,
  PLAY,
  cyberfuseGame,
  validBits,
  type CyberfuseRoom,
  type CyberfuseEntry,
  type CyberfuseView,
  type CyberfuseEvent,
  type CyberfuseSettings,
} from "../game/index.js";
export type CyberfuseCallbacks = Callbacks<
  CyberfuseView,
  CyberfuseEvent,
  CyberfuseSettings
>;
export class CyberfuseRuntime extends RoomRuntime<
  CyberfuseRoom,
  CyberfuseEntry,
  CyberfuseView,
  CyberfuseEvent,
  CyberfuseSettings
> {
  private bits = 0;
  private sent:
    | {
        match: string;
        round: number;
        bits: number;
        generation: number | undefined;
      }
    | undefined;
  constructor(
    code: string,
    settings: CyberfuseSettings,
    callbacks: CyberfuseCallbacks,
    options: RuntimeOptions = {},
  ) {
    super(cyberfuseGame, code, settings, callbacks, options);
  }
  input(bits: number): void {
    this.bits = validBits(bits) ? bits : 0;
    this.flush();
  }
  flush(): void {
    const r = this.world?.state,
      p = this.player();
    if (
      !r ||
      r.stage !== "running" ||
      !p?.connected ||
      this.hiddenState ||
      !r.roster.some((entry) => entry.id === this.id)
    )
      return;
    if (
      this.sent?.match === r.matchId &&
      this.sent.round === r.round &&
      this.sent.bits === this.bits &&
      this.sent.generation === p.generation
    )
      return;
    this.sent = {
      match: r.matchId,
      round: r.round,
      bits: this.bits,
      generation: p.generation,
    };
    this.append(PLAY, r.matchId, r.round, this.bits);
    this.sendPackets(this.deps.now());
  }
  nextMission(): boolean {
    const r = this.world?.state;
    if (!r || r.stage !== "between" || !this.managing) return false;
    this.append(ADVANCE, r.matchId, r.round);
    this.sendPackets(this.deps.now());
    return true;
  }
  protected resetControls() {
    this.sent = undefined;
  }
  protected releaseControls() {
    this.input(0);
  }
  protected absentControls() {
    this.bits = 0;
    this.sent = undefined;
  }
  roomState() {
    return this.world?.state;
  }
  get self() {
    return this.id;
  }
}
