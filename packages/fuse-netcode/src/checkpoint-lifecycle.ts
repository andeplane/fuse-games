import type { Stage } from "./game.js";

interface CheckpointLifecycle {
  stage: Stage;
  roster: readonly { id: string; bot: boolean }[];
  held: Readonly<Record<string, number>>;
  hasDecision: boolean;
}

/** Check the relationships between already decoded checkpoint fields. */
export function validCheckpointLifecycle(
  { stage, roster, held, hasDecision }: CheckpointLifecycle,
  world: { players: readonly { id: string }[]; over: boolean } | null,
): boolean {
  const heldIds = Object.keys(held);
  if (world === null)
    return (
      stage === "lobby" && !hasDecision && !roster.length && !heldIds.length
    );
  if (stage === "lobby" || world.players.length !== roster.length) return false;
  // A multi-round game can have ended its current world without deciding the match.
  const matchOver = stage === "over";
  if (world.over !== (stage !== "running") || hasDecision !== matchOver)
    return false;
  if (matchOver && heldIds.length) return false;
  return (
    world.players.every((player, index) => player.id === roster[index]!.id) &&
    heldIds.every((id) =>
      roster.some((entrant) => entrant.id === id && !entrant.bot),
    )
  );
}
