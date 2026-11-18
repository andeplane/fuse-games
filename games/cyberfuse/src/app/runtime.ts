import {
  RoomRuntime,
  browserDependencies,
  type RuntimeDependencies,
  type Callbacks,
  type RuntimeOptions,
} from "fuse-netcode";
import {
  ADVANCE,
  EQUIP,
  armory,
  validLoadout,
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

/** The solo room's existing hidden-page clock also handles a map/menu pause.
 * Combining the two reasons keeps focus changes from waking a paused mission. */
function soloVisibility(base: RuntimeDependencies) {
  let inspecting = false;
  let notify: (() => void) | undefined;
  const dependencies: RuntimeDependencies = {
    now: () => base.now(),
    token: () => base.token(),
    generation: () => base.generation(),
    schedule: (fn, interval) => base.schedule(fn, interval),
    hidden: () => inspecting || base.hidden(),
    onVisibilityChange(fn) {
      notify = fn;
      const stop = base.onVisibilityChange(fn);
      return () => {
        notify = undefined;
        stop();
      };
    },
  };
  return {
    dependencies,
    set(value: boolean) {
      inspecting = value;
      notify?.();
    },
  };
}
export class CyberfuseRuntime extends RoomRuntime<
  CyberfuseRoom,
  CyberfuseEntry,
  CyberfuseView,
  CyberfuseEvent,
  CyberfuseSettings
> {
  private readonly bits = new Map<string, number>();
  private readonly sent = new Map<
    string,
    {
      match: string;
      round: number;
      bits: number;
      generation: number | undefined;
    }
  >();
  private readonly soloInspection:
    ReturnType<typeof soloVisibility> | undefined;
  private inspecting = false;
  constructor(
    code: string,
    settings: CyberfuseSettings,
    callbacks: CyberfuseCallbacks,
    options: RuntimeOptions = {},
  ) {
    const visibility = options.transport
      ? undefined
      : soloVisibility(options.dependencies ?? browserDependencies);
    super(
      cyberfuseGame,
      code,
      settings,
      callbacks,
      visibility
        ? { ...options, dependencies: visibility.dependencies }
        : options,
    );
    this.soloInspection = visibility;
  }
  input(bits: number) {
    this.localInput(this.id, bits);
  }
  localInput(id: string, bits: number): boolean {
    if (!this.owns(id) || this.hiddenState || this.inspecting) return false;
    this.bits.set(id, validBits(bits) ? bits : 0);
    this.flush();
    return true;
  }
  private owns(id: string) {
    return (
      !!id &&
      (id === this.id || (this.solo && this.localPlayerIds.includes(id)))
    );
  }
  private submit(id: string, ...body: unknown[]) {
    if (id !== this.id) return this.appendLocal(id, ...body);
    this.append(...body);
    return true;
  }
  flush(): void {
    if (!this.hiddenState && !this.inspecting) this.flushHeld();
  }
  private flushHeld(): void {
    const room = this.world?.state;
    if (!room || room.stage !== "running") return;
    let changed = false;
    for (const p of room.roster) {
      const seat = room.seats.get(p.id);
      if (!this.owns(p.id) || !seat?.connected) continue;
      const bits = this.bits.get(p.id) ?? 0,
        last = this.sent.get(p.id);
      if (
        last?.match === room.matchId &&
        last.round === room.round &&
        last.bits === bits &&
        last.generation === seat.generation
      )
        continue;
      if (this.submit(p.id, PLAY, room.matchId, room.round, bits)) {
        this.sent.set(p.id, {
          match: room.matchId,
          round: room.round,
          bits,
          generation: seat.generation,
        });
        changed = true;
      }
    }
    if (changed) this.sendPackets(this.deps.now());
  }
  setInspectionPaused(value: boolean): void {
    if (this.inspecting === value) return;
    this.inspecting = value;
    if (value) this.releaseControls();
    this.soloInspection?.set(value);
  }
  equip(weaponIds: number[]): boolean {
    return this.localEquip(this.id, weaponIds);
  }
  localEquip(id: string, weaponIds: number[]): boolean {
    const room = this.world?.state,
      seat = room?.seats.get(id);
    if (
      !this.owns(id) ||
      !room ||
      !seat?.connected ||
      seat.watcher ||
      this.hiddenState ||
      !validLoadout(weaponIds)
    )
      return false;
    const shop = armory(room);
    if (
      !shop ||
      !weaponIds.every((w) => shop.spec.allowedWeapons.includes(w)) ||
      (room.stage === "between" && !room.roster.some((p) => p.id === id))
    )
      return false;
    if (
      !this.submit(id, EQUIP, room.matchId, room.round, shop.key, [
        ...weaponIds,
      ])
    )
      return false;
    this.sendPackets(this.deps.now());
    return true;
  }
  nextMission(): boolean {
    const r = this.world?.state;
    if (!r || r.stage !== "between" || !this.managing) return false;
    this.append(ADVANCE, r.matchId, r.round);
    this.sendPackets(this.deps.now());
    return true;
  }
  protected resetControls() {
    this.sent.clear();
  }
  protected releaseControls() {
    this.bits.clear();
    this.flushHeld();
  }
  protected absentControls() {
    this.bits.clear();
    this.sent.clear();
  }
  roomState() {
    return this.world?.state;
  }
  get self() {
    return this.id;
  }
}
