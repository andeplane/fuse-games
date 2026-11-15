import type { PlayFrame } from "fuse-ui/play-metrics";
import type { View } from "../online/game.js";

/** A song is a round; a playlist remains one match through its song-select intermissions. */
export function fusemaniaPlayFrame(
  frame: View,
  viewer: { self: string; mode: string },
): PlayFrame {
  const players = frame.stage === "lobby"
    ? frame.seats.filter(seat => !seat.watcher)
    : frame.roster;
  const roundActive = frame.stage === "running" && !!frame.world && frame.world.ms >= 0 && frame.world.phase === "playing";
  const session = frame.session;
  return {
    matchId: session?.id ?? frame.matchId,
    round: session ? Math.min(session.length, session.done + (frame.stage === "over" ? 0 : 1)) : 1,
    roundActive,
    roundEnded: frame.stage === "over",
    active: roundActive,
    ended: frame.stage === "over" && (!session || session.done === session.length),
    playerCount: players.length,
    botCount: players.filter(player => player.bot).length,
    seated: players.some(player => player.id === viewer.self),
    mode: viewer.mode,
  };
}
