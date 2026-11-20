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

type RoundCheckpointHeader<Entrant extends { id: string; bot: boolean }> = Pick<
  CheckpointLifecycle,
  "stage" | "held"
> & {
  roster: readonly Entrant[];
};

interface RoundCheckpointDecoders<Entrant, Decision, World> {
  decodeDecided(
    raw: unknown,
    roster: readonly Entrant[],
  ): Decision | null | undefined;
  decodeWorld(raw: unknown): World | undefined;
  players(world: World): readonly { id: string }[];
}

/** Decode the decision and world, then enforce the shared lifecycle before the game's own checks. */
export function createCheckpointRoundDecoder<
  Entrant extends { id: string; bot: boolean },
  Decision,
  World extends { phase: string },
>({
  decodeDecided,
  decodeWorld,
  players,
}: RoundCheckpointDecoders<Entrant, Decision, World>) {
  return (
    header: RoundCheckpointHeader<Entrant>,
    rawDecided: unknown,
    rawWorld: unknown,
  ) => {
    const decided = decodeDecided(rawDecided, header.roster);
    const world = rawWorld === null ? null : decodeWorld(rawWorld);
    if (decided === undefined || world === undefined) return;
    if (
      !validCheckpointLifecycle(
        {
          stage: header.stage,
          roster: header.roster,
          held: header.held,
          hasDecision: decided !== null,
        },
        world && { players: players(world), over: world.phase === "over" },
      )
    )
      return;
    return { decided, world };
  };
}
