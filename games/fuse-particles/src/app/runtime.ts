import { RoomRuntime, type Callbacks, type RuntimeOptions } from "fuse-netcode";
import {
  PLAY,
  fuseParticlesGame,
  type FuseParticlesEntry,
  type FuseParticlesRoom,
  type FuseParticlesSettings,
  type FuseParticlesView,
} from "../game/index.js";
import { canActBattle, type BattleAction } from "../game/simulation.js";
export type FuseParticlesCallbacks = Callbacks<
  FuseParticlesView,
  never,
  FuseParticlesSettings
>;
export class FuseParticlesRuntime extends RoomRuntime<
  FuseParticlesRoom,
  FuseParticlesEntry,
  FuseParticlesView,
  never,
  FuseParticlesSettings
> {
  constructor(
    code: string,
    settings: FuseParticlesSettings,
    callbacks: FuseParticlesCallbacks,
    options: RuntimeOptions = {},
  ) {
    super(fuseParticlesGame, code, settings, callbacks, options);
  }
  play(action: BattleAction): boolean {
    const room = this.world?.state;
    if (!room?.battle || room.stage !== "running" || !this.player()?.connected)
      return false;
    const index = room.fighters.findIndex((fighter) => fighter.id === this.id);
    if (index < 0 || !canActBattle(room.battle, index, action)) return false;
    this.append(PLAY, room.matchId, action);
    this.sendPackets(this.deps.now());
    return true;
  }
  roomState(): FuseParticlesRoom | undefined {
    return this.world?.state;
  }
}
