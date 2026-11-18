import { RoomRuntime, type Callbacks, type RuntimeOptions } from "fuse-netcode";
import {
  INPUT,
  fuseheadsGame,
  validMask,
  parseSave,
  saveAfterRuler,
  decodeRoom,
  type FuseheadsSave,
  type FuseheadsRoom,
  type FuseheadsEntry,
  type FuseheadsView,
  type FuseheadsEvent,
  type FuseheadsSettings,
} from "../game/index.js";

export type FuseheadsCallbacks = Callbacks<
  FuseheadsView,
  FuseheadsEvent,
  FuseheadsSettings
>;
export class FuseheadsRuntime extends RoomRuntime<
  FuseheadsRoom,
  FuseheadsEntry,
  FuseheadsView,
  FuseheadsEvent,
  FuseheadsSettings
> {
  constructor(
    code: string,
    settings: FuseheadsSettings,
    callbacks: FuseheadsCallbacks,
    options: RuntimeOptions & { resume?: FuseheadsSave } = {},
  ) {
    const saved = options.resume && parseSave(options.resume);
    if (
      options.resume &&
      (!saved ||
        options.transport ||
        saved.pack !== settings.pack ||
        saved.players.length !== (options.localPlayers?.length ?? 1))
    ) {
      throw new Error(
        "Choose a valid local save for this pack and player count.",
      );
    }
    const game = saved
      ? {
          ...fuseheadsGame,
          createRoom: (id: string, configuration: FuseheadsSettings) => ({
            ...fuseheadsGame.createRoom(id, configuration),
            pendingSave: saved,
          }),
          checkpoint: {
            ...fuseheadsGame.checkpoint,
            decode: (fields: readonly unknown[], tick: number) =>
              decodeRoom(fields, tick, true),
          },
        }
      : fuseheadsGame;
    super(game, code, settings, callbacks, options);
  }
  savePoint(): FuseheadsSave | undefined {
    const room = this.world?.state;
    return this.solo && room ? saveAfterRuler(room) : undefined;
  }
  play(mask: number, localSlot?: number): boolean {
    const room = this.world?.state;
    if (!room || room.stage !== "running" || !validMask(mask)) return false;
    const id =
      localSlot === undefined ? this.id : this.localPlayerIds[localSlot];
    const seat = id && room.seats.get(id);
    if (
      !seat ||
      !seat.connected ||
      seat.watcher ||
      !room.participants.some((p) => p.id === id && p.slot === seat.slot)
    )
      return false;
    const body = [INPUT, room.matchId, room.round, mask];
    if (id === this.id) this.append(...body);
    else if (!this.appendLocal(id, ...body)) return false;
    this.sendPackets(this.deps.now());
    return true;
  }
  protected override releaseControls(): void {
    this.play(0);
    for (let i = 1; i < this.localPlayerIds.length; i++) this.play(0, i);
  }
  roomState(): FuseheadsRoom | undefined {
    return this.world?.state;
  }
  get self(): string {
    return this.id;
  }
}
