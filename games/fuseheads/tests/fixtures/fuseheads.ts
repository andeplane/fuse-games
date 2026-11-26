import { ACTION, JOIN, type StreamEntries } from "fuse-netcode";
import {
  createRoom,
  foldTick,
  isFuseheadsEntry,
  DEFAULT_SETTINGS,
  type FuseheadsRoom,
  type FuseheadsSettings,
  type FuseheadsEntry,
} from "../../src/game/index.js";

export function fold(
  room: FuseheadsRoom,
  bodies: Record<string, unknown[][]> = {},
  generation = 1,
) {
  const streams = new Map<string, StreamEntries<FuseheadsEntry>>();
  for (const [id, commands] of Object.entries(bodies)) {
    const entries = commands.map((args, i) => {
      const cmd = [i + 1, room.tick + 1, ...args];
      if (!isFuseheadsEntry(cmd)) throw Error("Invalid test command");
      return cmd;
    });
    streams.set(id, { generation, entries });
  }
  return foldTick(room, "a", streams);
}
export function started(settings: FuseheadsSettings = DEFAULT_SETTINGS) {
  const room = createRoom("lobby", settings);
  fold(room, {
    a: [
      [JOIN, "a", "Ada", 0, "robot", 1],
      [JOIN, "b", "Bo", 1, "robot", 1],
    ],
  });
  fold(room, { a: [[ACTION, "start", "expedition"]] });
  return room;
}
