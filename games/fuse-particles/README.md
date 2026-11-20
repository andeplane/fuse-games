# Fuseparticles

Particles spawn automatically, drift, ricochet off walls and damage opposing cores. Spend gold on particle upgrades, research and towers. A match is one round. The last core standing wins, or the core with the most health at the time limit. Equal health at the limit is a draw.

Run `pnpm dev` from the repository root and open `/fuseparticles/?mute` on the printed origin. Choose **Single player** to set up a local match with AI. **Host room** opens an invitation, optional AI seats, and the Shared TV option. A room seats up to four people or AI in total.

Use **Q / W / E / A / S** to switch command categories and **1–8** to pick a numbered action. Tap the same commands on a phone. Pick tower sites from the arena or the numbered site list. Select any graph at the end of the match to enlarge it.

See [the design note](../../docs/design/fuse-particles.md) for rules and checkpoint ownership. Run the focused tests with `pnpm exec tsx --test games/fuse-particles/tests/*.test.ts`.
