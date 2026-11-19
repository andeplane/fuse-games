import { uint32 } from "./wire.js";

interface Entrant<Slot extends number> {
  id: string;
  name: string;
  slot: Slot;
  bot: boolean;
}

interface RosterPolicy<Slot extends number> {
  validLength: (length: number) => boolean;
  playerKey: (value: unknown) => value is string;
  validName: (value: unknown) => value is string;
  slotAt: (index: number) => Slot;
}

/** Decode three-field entrants in wire order, using the game's roster and slot rules. */
export function createRosterDecoder<Slot extends number>({
  validLength,
  playerKey,
  validName,
  slotAt,
}: RosterPolicy<Slot>): (raw: unknown) => Entrant<Slot>[] | undefined {
  return (raw) => {
    if (!Array.isArray(raw) || !validLength(raw.length)) return;
    const seen = new Set<string>();
    const roster: Entrant<Slot>[] = [];
    for (const item of raw) {
      if (!Array.isArray(item) || item.length !== 3) return;
      const [id, name, bot] = item as unknown[];
      if (
        !playerKey(id) ||
        !validName(name) ||
        typeof bot !== "boolean" ||
        seen.has(id)
      )
        return;
      seen.add(id);
      roster.push({ id, name, slot: slotAt(roster.length), bot });
    }
    return roster;
  };
}

type RosterMember = Pick<Entrant<number>, "id" | "bot">;

/** Finishers are human IDs in strictly increasing order, as written by the fold. */
export function decodeHumanFinishers(
  raw: unknown,
  roster: readonly RosterMember[],
): string[] | undefined {
  if (!Array.isArray(raw) || raw.length > roster.length) return;
  const humans = new Set(
    roster.filter((member) => !member.bot).map((member) => member.id),
  );
  const finishers: string[] = [];
  let previous: string | undefined;
  for (const id of raw as unknown[]) {
    if (
      typeof id !== "string" ||
      !humans.has(id) ||
      (previous !== undefined && previous >= id)
    )
      return;
    finishers.push(id);
    previous = id;
  }
  return finishers;
}

/** Decode a decision naming one winner from the roster. Null is an undecided match. */
export function decodeSingleWinner(
  raw: unknown,
  roster: readonly RosterMember[],
): { clock: number; winner: string; finishers: string[] } | null | undefined {
  if (raw === null) return null;
  if (!Array.isArray(raw) || raw.length !== 3) return;
  const [clock, winner, rawFinishers] = raw as unknown[];
  if (!uint32(clock) || clock === 0 || typeof winner !== "string") return;
  if (!roster.some((entrant) => entrant.id === winner)) return;
  const finishers = decodeHumanFinishers(rawFinishers, roster);
  if (!finishers) return;
  return { clock, winner, finishers };
}
