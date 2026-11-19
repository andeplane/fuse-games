import {
  RoomRuntime,
  type RoomCommand,
  type Callbacks,
  type RuntimeOptions,
} from "fuse-netcode";
import {
  EDIT,
  incredibleFuseGame,
  privateWorkshopGame,
  type IncredibleFuseEntry,
  type IncredibleFuseEvent,
  type IncredibleFuseRoom,
  type IncredibleFuseSettings,
  type IncredibleFuseView,
} from "../game/index.js";
import {
  FREE_WORKSHOP,
  validCommand,
  type MachineCommand,
  type WorkshopBlueprint,
} from "../game/machine.js";

export type IncredibleFuseCallbacks = Callbacks<
  IncredibleFuseView,
  IncredibleFuseEvent,
  IncredibleFuseSettings
>;
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
    blueprint?: WorkshopBlueprint,
  ) {
    if (
      blueprint &&
      (options.transport || settings.puzzleIndex !== FREE_WORKSHOP)
    )
      throw new Error("Imported layouts require a solo free workshop");
    super(
      blueprint ? privateWorkshopGame(blueprint) : incredibleFuseGame,
      code,
      settings,
      callbacks,
      options,
    );
  }
  override command(command: RoomCommand<IncredibleFuseSettings>): boolean {
    return command.type !== "bot" && super.command(command);
  }
  play(command: MachineCommand): boolean {
    const room = this.world?.state;
    if (
      !room ||
      room.stage !== "running" ||
      this.hiddenState ||
      !this.player()?.connected ||
      !validCommand(command)
    )
      return false;
    this.append(EDIT, room.matchId, room.round, structuredClone(command));
    this.sendPackets(this.deps.now());
    return true;
  }
  roomState(): IncredibleFuseRoom | undefined {
    return this.world?.state;
  }
  get self(): string {
    return this.id;
  }
}
