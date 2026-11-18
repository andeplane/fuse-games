---
name: fuse-replicate-game
description: Extract and verify the gameplay engine of a user-owned or authorized reference game for a Fuse port. Use for engine extraction, game-behavior analysis, deterministic ports, or original Fuse games inspired by genre mechanics.
---

# Extract a gameplay engine for Fuse

Identify the source revision or shipped build and the requested result. An engine extraction can end with a portable simulation and evidence. A full Fuse port also needs a playable integration. Port the user's own games, and reuse engine code only where permitted. For a third-party game used as inspiration, study general mechanics and build a distinct game with original design, art, levels, names, and audio.

## Establish the reference behavior

- Prefer source and existing tests for a source port. When the answer depends on a shipped build or observed runtime behavior, use the available `reverse-engineer-anything` skill for targeted analysis. Measure behavior against a known build with scripted inputs or a local emulator as appropriate.
- Pin the source revision or build digest and record the reference tool/build, initial state, seed, input sequence, tick schedule, expected output, and covered cases. Distinguish measured behavior from source interpretation and inference. Use the first divergent tick and field to investigate discrepancies.
- Start with one reproducible gameplay slice. Then probe timing and units, input hold and release, update order, collisions and boundaries, RNG, bots, scoring, and the round or campaign transitions that affect play. Choose cases that distinguish competing explanations. Retain permitted, compact fixtures and rerun commands, and record unverified rules. Keep private binaries and restricted extracted assets out of source control, build output, public screenshots, and ordinary previews.

## Extract and validate

- Separate the engine from menus, rendering, audio, network, storage, and wall-clock time. Port reusable source if permitted. Expose explicit initialization, a deterministic tick over inputs and immutable configuration, a read-only view, and validated snapshot/restore. Include mutable gameplay state such as RNG, clock phase, held input, and bot state in the snapshot.
- Preserve measured timing, numeric semantics and update order for an authorized parity port. If Fuse's log and the source simulation use different rates, derive a deterministic number of simulation steps per log tick and checkpoint the phase when needed. Use the same simulation for live play, prediction and replay.
- Compare fixed scenarios and full round traces against the independent reference. Test input transitions, collision edges, reset, and snapshot restore followed by continued play. Report parity only for measured scenarios and list remaining differences or gaps.
- For a playable Fuse port, use `$fuse-create-game` for menus, portal, analytics and service registration. Adapt the engine behind the shared netcode contract, scope controls to the current seat and round, and render from views that reflect rollback. Run the applicable browser flow and verify convergence after a reconnect or rollback. Keep the engine standalone when the request is extraction only.

## Fuse Drivers example

The Iron Man Off Road investigation started with small motion and terrain probes, expanded to complete race traces, then exercised browser peers and checkpoint recovery. For the related standalone-to-Fuse port and its tick-rate adapter, see `docs/design/fuse-drivers-port.md` in the Fuse checkout. If the local `codex/offroad-reference` branch is available, inspect `3d8c0ad9` for motion traces and `3c2a7bd1` for whole-race coverage.
