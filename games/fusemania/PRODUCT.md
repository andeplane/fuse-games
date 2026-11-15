# Fusemania

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Rhythm-game players finding songs, comparing chart scores and opening a song's leaderboard on desktop or phone.

## Product Purpose

Play four-lane rhythm charts alone or with friends. The scores experience lets players find a song, compare the best verified scores across four difficulty slots, and inspect the players on a chart's leaderboard.

## Capabilities and Constraints

- Keep the shared Fuse navigation and game identity.
- Show at most the four hardest charts in the scores list and song leaderboard; never expose an extra-chart menu.
- Use one sortable song list with a song-pack column instead of pack groups.
- Support sorting by difficulty score and popularity from actual recorded plays.
- Keep score verification and actual chart identities intact.

## Evidence on Hand

The catalog, verified score service, existing song selection and shared UI components are the implementation sources. User screenshots document the superseded scores page.

## Product Principles

- A song leads directly to its leaderboard.
- Sorting compares the entire visible catalog.
- Missing scores and unavailable charts are distinct states.
- Never fabricate activity or rankings.
