import type { LogEntry, StreamEntries } from "./game.js";
import type { SeatRecord } from "./management.js";

interface HeldRoom {
  readonly seats: ReadonlyMap<string, SeatRecord>;
  readonly held: Record<string, number>;
}

/**
 * Fold player inputs for one log tick. A game selects the commands it accepts
 * and supplies fresh bot answers. Only connected players persist held input.
 */
export function foldHeldInput<Entry extends LogEntry>(
  room: HeldRoom,
  streams: ReadonlyMap<string, StreamEntries<Entry>>,
  tick: number,
  readBits: (entry: Entry) => number | undefined,
) {
  return (
    id: string,
    readBot: () => number,
  ): readonly [held: number, tapped: number] => {
    const seat = room.seats.get(id);
    if (seat?.bot) {
      const bits = readBot();
      delete room.held[id];
      return [bits, 0];
    }
    if (!seat?.connected) {
      delete room.held[id];
      return [0, 0];
    }

    const stream = streams.get(seat.id);
    const source =
      stream?.generation === seat.generation
        ? stream
        : stream?.retired?.find((old) => old.generation === seat.generation);

    let held = room.held[id] ?? 0;
    let tapped = 0;
    let lastSequence = -Infinity;
    for (const entry of source?.entries ?? []) {
      if (entry[1] !== tick) continue;
      const bits = readBits(entry);
      if (bits === undefined) continue;
      tapped |= bits;
      // The last logged command wins, even when the stream's entries arrived out of order.
      if (entry[0] >= lastSequence) {
        lastSequence = entry[0];
        held = bits;
      }
    }

    if (held) room.held[id] = held;
    else delete room.held[id];
    return [held, tapped];
  };
}
