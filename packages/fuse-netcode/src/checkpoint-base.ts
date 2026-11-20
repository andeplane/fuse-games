import type { Stage } from "./game.js";
import type { SeatRecord } from "./management.js";
import { orderedSeats } from "./seat-snapshot.js";
import { uint32 } from "./wire.js";

/** Fields through the roster in the shared checkpoint header. Each game owns the rest. */
export const CHECKPOINT_HEADER_FIELDS = 7;

interface CheckpointBaseOptions<
  RoomStage extends Stage,
  Settings extends object,
  Entrant,
> {
  stages: readonly RoomStage[];
  minStepsPerTick: number;
  maxStepsPerTick?: number;
  validMatchId(value: unknown): value is string;
  parseSettings(raw: unknown): Settings | undefined;
  decodeSeats(raw: unknown): Map<string, SeatRecord> | undefined;
  decodeHeld(raw: unknown): Record<string, number> | undefined;
  decodeRoster(raw: unknown): Entrant[] | undefined;
}

/**
 * Decode the common checkpoint header and clock after the caller checks its field count and log tick.
 * Each game owns the payload after the header.
 */
export function createCheckpointBaseDecoder<
  RoomStage extends Stage,
  Settings extends object,
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
  return (
    fields: readonly unknown[],
    simulationTick: unknown,
    tick: number,
  ) => {
    const [
      matchId,
      rawStage,
      rawSettings,
      rawSeats,
      rawPlay,
      rawHeld,
      rawRoster,
    ] = fields;
    if (
      !validMatchId(matchId) ||
      !uint32(simulationTick) ||
      simulationTick < tick * minStepsPerTick ||
      simulationTick > tick * maxStepsPerTick
    )
      return;
    const stage = stages.find((known) => known === rawStage);
    const settings = parseSettings(rawSettings);
    const seats = decodeSeats(rawSeats);
    const play = parseSettings(rawPlay);
    const held = decodeHeld(rawHeld);
    const roster = decodeRoster(rawRoster);
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

/** Encode string-keyed checkpoint values in code-unit order, independent of insertion order. */
export function checkpointEntries<T>(
  values: Readonly<Record<string, T>>,
): [string, T][] {
  return Object.entries(values).sort(([a], [b]) => (a < b ? -1 : 1));
}

interface CheckpointBase {
  matchId: string;
  stage: Stage;
  settings: object;
  seats: ReadonlyMap<string, SeatRecord>;
  play: object;
  held: Readonly<Record<string, number>>;
  roster: readonly { id: string; name: string; bot: boolean }[];
}

/** Encode the field order read by createCheckpointBaseDecoder. Games append their own fields. */
export function encodeCheckpointBase(room: CheckpointBase): unknown[] {
  return [
    room.matchId,
    room.stage,
    { ...room.settings },
    orderedSeats(room.seats.values()).map((seat) => ({ ...seat })),
    { ...room.play },
    checkpointEntries(room.held),
    room.roster.map(({ id, name, bot }) => [id, name, bot]),
  ];
}
