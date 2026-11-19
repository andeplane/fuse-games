import type { SeatRecord } from "./management.js";
import { uint32 } from "./wire.js";

interface SeatDecoderOptions {
  capacity: number;
  playerKey: (value: unknown) => value is string;
  validName: (value: unknown) => value is string;
  validAvatar: (value: unknown, bot: boolean) => value is string;
}

const SEAT_KEYS = [
  "id",
  "name",
  "slot",
  "avatarId",
  "connected",
  "bot",
  "watcher",
  "generation",
  "away",
];

/** Decode one object seat from a checkpoint, leaving game-specific values to the caller. */
export function createSeatDecoder({
  capacity,
  playerKey,
  validName,
  validAvatar,
}: SeatDecoderOptions): (raw: unknown) => SeatRecord | undefined {
  return function decodeSeat(raw) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return;
    if (Object.keys(raw).some((key) => !SEAT_KEYS.includes(key))) return;
    const {
      id,
      name,
      slot,
      avatarId,
      connected,
      bot,
      watcher,
      generation,
      away,
    } = raw as Record<string, unknown>;
    if (
      !playerKey(id) ||
      !validName(name) ||
      typeof connected !== "boolean" ||
      typeof bot !== "boolean" ||
      (watcher !== undefined && watcher !== true) ||
      (away !== undefined && away !== true) ||
      (away === true && connected) ||
      (watcher ? slot !== -1 : !uint32(slot) || slot >= capacity) ||
      (watcher ? avatarId !== "" : !validAvatar(avatarId, bot)) ||
      (bot ? generation !== undefined || watcher === true : !uint32(generation))
    )
      return;
    return {
      id,
      name,
      slot: slot as number,
      avatarId: avatarId as string,
      connected,
      bot,
      ...(watcher ? { watcher: true } : {}),
      ...(generation !== undefined ? { generation: generation as number } : {}),
      ...(away ? { away: true } : {}),
    };
  };
}

/** Decode the full seat list, keeping checkpoint order and enforcing unique players and occupied slots. */
export function createSeatListDecoder(
  options: SeatDecoderOptions & { maxWatchers: number },
): (raw: unknown) => Map<string, SeatRecord> | undefined {
  const { capacity, maxWatchers } = options;
  const decodeSeat = createSeatDecoder(options);
  return function decodeSeats(raw) {
    if (!Array.isArray(raw) || raw.length > capacity + maxWatchers) return;
    const seats = new Map<string, SeatRecord>();
    const occupied = new Set<number>();
    let watchers = 0;
    for (const item of raw) {
      const seat = decodeSeat(item);
      if (!seat || seats.has(seat.id)) return;
      if (seat.watcher) {
        if (++watchers > maxWatchers) return;
      } else {
        if (occupied.has(seat.slot)) return;
        occupied.add(seat.slot);
      }
      seats.set(seat.id, seat);
    }
    return seats;
  };
}
