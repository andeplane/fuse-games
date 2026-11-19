import type { Stage } from "./game.js";
import type { SeatRecord } from "./management.js";
import { uint32 } from "./wire.js";

interface CheckpointBaseFields {
  matchId: unknown;
  stage: unknown;
  settings: unknown;
  seats: unknown;
  play: unknown;
  held: unknown;
  roster: unknown;
  simulationTick: unknown;
}

interface CheckpointBaseOptions<RoomStage extends Stage, Settings, Entrant> {
  stages: readonly RoomStage[];
  minStepsPerTick: number;
  maxStepsPerTick?: number;
  validMatchId(value: unknown): value is string;
  parseSettings(raw: unknown): Settings | undefined;
  decodeSeats(raw: unknown): Map<string, SeatRecord> | undefined;
  decodeHeld(raw: unknown): Record<string, number> | undefined;
  decodeRoster(raw: unknown): Entrant[] | undefined;
}

/** Decode the common fields of a checkpoint. Wire order and cross-field rules belong to each game. */
export function createCheckpointBaseDecoder<
  RoomStage extends Stage,
  Settings,
  Entrant,
>({
  stages,
  minStepsPerTick,
  maxStepsPerTick = minStepsPerTick,
  validMatchId,
  parseSettings,
  decodeSeats,
  decodeHeld,
  decodeRoster,
}: CheckpointBaseOptions<RoomStage, Settings, Entrant>) {
  return (raw: CheckpointBaseFields, tick: number) => {
    const { matchId, simulationTick } = raw;
    if (
      !validMatchId(matchId) ||
      !uint32(simulationTick) ||
      simulationTick < tick * minStepsPerTick ||
      simulationTick > tick * maxStepsPerTick
    )
      return;
    const stage = stages.find((known) => known === raw.stage);
    const settings = parseSettings(raw.settings);
    const seats = decodeSeats(raw.seats);
    const play = parseSettings(raw.play);
    const held = decodeHeld(raw.held);
    const roster = decodeRoster(raw.roster);
    if (!stage || !settings || !seats || !play || !held || !roster) return;
    return {
      simulationTick,
      matchId,
      stage,
      seats,
      settings,
      play,
      held,
      roster,
    };
  };
}
