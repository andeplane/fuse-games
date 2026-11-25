# Fuseheads

A one- or two-player cooperative platform game based on Bonkheads Deluxe. Headbutt platforms to stun the pests above, then touch a stunned pest to kick it away. Clear each arena to advance. Jump to climb back into play after losing a troll.

## Play

Open **Play → Single player**, choose the original or bonus levels, and select **Start game**. For two players sharing a keyboard, choose **Two on one keyboard** in the same dialog. For separate devices choose **Host room**, take a seat, and share the invitation. The host can enable **Shared TV** to use phones as controllers. A single occupied seat can start a room.

| Mode                      | Move                     | Jump           |
| ------------------------- | ------------------------ | -------------- |
| Solo or own device        | Left/right arrows or A/D | Space, Up or W |
| Shared keyboard, player 1 | A/D                      | W or Space     |
| Shared keyboard, player 2 | Left/right arrows        | Up             |
| Touch                     | Left and Right buttons   | Jump button    |

A cleared ruler at an underworld boundary saves progress in a local game. **Continue** in the single-player dialog restores that pack, player count, scores and remaining lives.

## Implementation

The new TypeScript engine advances at 30 steps per second. The room adapter runs one or two simulation steps per 50 ms Fuse log tick. Input, spawn schedules, randomness and actor state are checkpointed. The renderer reads a world snapshot and draws from a replaceable sprite atlas, world backgrounds and HUD sheet under `src/art`.

The original campaign contains 144 playable rounds and a separate finale scene. The bonus pack contains 54 rounds. A played level is one analytics round.

Run `pnpm exec tsx --test games/fuseheads/tests/*.test.ts` for the engine and room checks. Run `pnpm build` and `pnpm exec tsx scripts/fuseheads-smoke.ts` for the headless browser flow. Reference evidence and its limits are in [the reference notes](../../docs/design/fuseheads-reference.md) and [the level decoder notes](src/levels/README.md).
