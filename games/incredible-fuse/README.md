# The Incredible Fuse

Build a working chain reaction from a tray of spare parts. Each puzzle begins with fixed machinery and a goal. Arrange the available parts, connect sockets, then run the machine. Rewind restores the starting arrangement for another try. Free workshop opens the whole parts tray for experiments.

## Play

Run `pnpm install --frozen-lockfile` and `pnpm dev` from the repository root, then open `/incrediblefuse/?mute` on the printed local origin.

- Choose **Play → Single player**, select a puzzle, then choose **Start puzzle**. Choose **Free workshop** to build your own machine.
- Choose a part in the tray, then click or tap its position on the board. Select a movable part to reposition, flip or remove it. Select a socket-bearing part, choose its connection type, and select the other endpoint.
- With the board focused, arrows move the cursor, Enter places or selects, F flips, Delete removes, and Space runs or rewinds. Cmd/Ctrl+Z undoes an edit.
- In a room, up to five builders work on one shared machine. One person can also start a room alone. Shared TV opens a read-only board while seated players edit on their devices.
- In a solo free workshop, **Save machine** downloads an editable Fuse blueprint. To reopen one, use **Open a saved machine** in Single player. The same picker accepts locally supplied v1.02 DOS freeform `.TIM` files and describes conversion differences before opening them. The file stays on that device.

A scored puzzle is one round and one cooperative match. A rewind is another attempt in the same round. Everyone who participates shares the result. Free workshop has no victory condition.

## Implementation

The deterministic machine, part definitions, connections, and puzzles live in `src/game/`. The room log runs at 20 Hz. A checkpointed phase schedules the machine steps at the measured DOS timer cadence. The editor sends commands through the same room fold in solo and online play. The renderer draws original parts from the current machine view.

The [reference study](../../docs/design/incredible-fuse-reference.md) gives the pinned build, motion and contact probes, and the graphics inventory. Run the focused rules and recovery tests with `pnpm exec tsx --test games/incredible-fuse/tests/*.test.ts`.
