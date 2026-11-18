import type { Callbacks, RoomCommand, SeatRecord } from "fuse-netcode";
import {
  advance,
  createMatch,
  getView,
  isAction,
  quantize,
  TURN_TICKS,
  type Action,
  type Fact,
  type Match,
} from "../engine/index.js";
import {
  DEFAULT_SETTINGS,
  type BirdsSettings,
  type BirdsView,
} from "../online/game.js";
import type { Play, Session } from "../online/runtime.js";

const names = ["Pip", "Ember", "Skye", "Flint", "Ash"];
function seat(slot: number, name: string, bot: boolean): SeatRecord {
  return {
    slot,
    name,
    bot,
    id: bot ? `ai-${slot}` : "solo",
    avatarId: "owl",
    connected: true,
    generation: 1,
  };
}
function botShot(match: Match): Play {
  const bird = match.players[match.active]!;
  const targets = match.players.filter((p) => p.hp > 0 && p.id !== bird.id);
  const decision = (match.seed + Math.imul(match.turn, 2654435761)) >>> 0;
  const target = targets[decision % targets.length];
  const aim = match.preparation.witnesses.find(
    (w) => w.from === bird.id && w.to === target?.id && w.wind === match.wind,
  );
  if (!aim) return { type: "pass" };
  // Birds stay on their initial perches. Use an opening trajectory with a small,
  // repeatable aiming error; live terrain and wind still resolve the actual shot.
  return {
    type: "launch",
    weapon: bird.ammo && decision % 4 === 0 ? "scatter" : "pebble",
    ...quantize(aim.vx + (((decision >>> 8) % 9) - 4) * 16, aim.vy),
  };
}
interface Options {
  name: string;
  seed: number;
  active(): boolean;
  schedule(tick: () => void): () => void;
}
export class SoloBattle implements Session {
  private seats: SeatRecord[];
  private match: Match | null = null;
  private round = 0;
  private pending?: Action;
  private cancel?: () => void;
  constructor(
    private callbacks: Callbacks<BirdsView, Fact, BirdsSettings>,
    private options: Options,
  ) {
    this.seats = [seat(0, options.name, false), seat(1, names[1]!, true)];
  }
  get admitted() {
    return !!this.cancel;
  }
  start() {
    if (this.cancel) return;
    this.cancel = this.options.schedule(() => this.step());
    this.callbacks.ready("solo", true);
    this.callbacks.status("Solo · you and the AI");
    this.publish();
  }
  stop() {
    this.cancel?.();
    this.cancel = undefined;
    this.pending = undefined;
  }
  private step() {
    const match = this.match;
    if (
      !this.admitted ||
      !this.options.active() ||
      !match ||
      ["over", "fault"].includes(match.phase)
    )
      return;
    const bird = match.players[match.active]!;
    if (
      match.phase === "aiming" &&
      bird.id !== "solo" &&
      match.deadline - match.tick <= TURN_TICKS - 18
    )
      this.queue(botShot(match));
    const facts = advance(match, this.pending ? [this.pending] : []);
    this.pending = undefined;
    for (const fact of facts)
      this.callbacks.event(fact, match.id, match.round, match.step);
    this.publish();
  }
  private queue(play: Play) {
    const match = this.match;
    if (!this.admitted || this.pending || match?.phase !== "aiming")
      return false;
    const bird = match.players[match.active]!;
    const action = {
      ...play,
      actor: bird.id,
      round: match.round,
      turn: match.turn,
      ordinal: bird.ordinal + 1,
    };
    if (
      !isAction(action) ||
      (play.type === "launch" && play.weapon === "scatter" && !bird.ammo)
    )
      return false;
    this.pending = action;
    return true;
  }
  play(play: Play) {
    return (
      this.match?.players[this.match.active]?.id === "solo" && this.queue(play)
    );
  }
  command(command: RoomCommand<BirdsSettings>) {
    if (!this.admitted) return false;
    if (command.type === "action") {
      const finished =
        this.match?.phase === "over" || this.match?.phase === "fault";
      if (command.action === "lobby" && finished) this.match = null;
      else if (
        ((command.action === "start" && !this.match) ||
          (command.action === "rematch" && finished)) &&
        this.seats.length >= 2
      ) {
        this.round++;
        const seed = (this.options.seed + this.round - 1) >>> 0;
        this.match = createMatch(
          `solo-${seed}-${this.round}`,
          seed,
          this.seats,
          this.round,
        );
      } else return false;
      this.pending = undefined;
      this.callbacks.status(
        this.match ? "Battle started." : "Solo · you and the AI",
      );
    } else if (
      !this.match &&
      command.type === "bot" &&
      command.action === "remove"
    ) {
      const index = this.seats.findIndex((s) => s.bot && s.id === command.id);
      if (index < 0) return false;
      this.seats.splice(index, 1);
    } else if (
      !this.match &&
      (command.type === "join" ||
        (command.type === "bot" && command.action === "add"))
    ) {
      const slot =
        command.slot ??
        names.findIndex((_, i) => !this.seats.some((s) => s.slot === i));
      if (
        !Number.isInteger(slot) ||
        slot < 0 ||
        slot >= names.length ||
        this.seats.some((s) => s.slot === slot)
      )
        return false;
      if (command.type === "join")
        this.seats[0] = seat(slot, this.options.name, false);
      else this.seats.push(seat(slot, names[slot]!, true));
    } else return false;
    this.publish();
    return true;
  }
  private publish() {
    const world = this.match ? getView(this.match) : null;
    this.callbacks.state(
      {
        tick: world?.tick ?? 0,
        logTick: this.match?.tick ?? 0,
        matchId: world?.id ?? "",
        managerId: "solo",
        stage: !world
          ? "lobby"
          : world.phase === "over" || world.phase === "fault"
            ? "over"
            : "running",
        seats: [...this.seats],
        world,
        decided: null,
        history: [],
      },
      DEFAULT_SETTINGS,
    );
  }
}
