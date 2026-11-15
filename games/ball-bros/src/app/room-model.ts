import type { RoomView, Settings } from "../online/game.js";

export function roomModel(
  v: RoomView,
  me: string,
  manager: boolean,
  display: boolean,
  shared: boolean,
  settings: Settings,
  /** Who runs the room in this frame: their seat carries HOST. */
  managerId = "",
) {
  const seated = v.players.find((p) => p.id === me);
  const base = v.arena?.bases.find((b) => b.id === me);
  const lobby = v.stage === "lobby",
    over = v.stage === "over";
  const manage = manager && !display;
  return {
    lobby,
    over,
    askName: lobby && !display && !seated,
    controller: shared && !display && !lobby,
    controls:
      !display && !!seated?.connected && !!base?.alive && v.stage === "running",
    canStart:
      manage && v.players.filter((p) => p.connected || p.bot).length >= 2,
    canAdd: manage && lobby && v.players.length < 5,
    manage,
    mapId: settings.mapId,
    display: settings.display,
    name: display
      ? "TV DISPLAY"
      : seated
        ? `P${seated.slot + 1} ${seated.name.toUpperCase()}`
        : "WAITING FOR NEXT MATCH",
    slot: seated?.slot,
    // This device's own seat while the room waits: what a move to another open seat is asked with.
    own: lobby && seated ? { name: seated.name, slot: seated.slot } : undefined,
    note: lobby
      ? v.players.length < 2
        ? "Invite a friend or add a bot. Two players start a match."
        : manage
          ? "Everyone here? Start when your group is ready."
          : "Waiting for the room manager to start."
      : !seated && !display
        ? "Match in progress. You can join when the room returns to the lobby."
        : "",
    players: v.players.map((p) => ({
      id: p.id,
      slot: p.slot,
      name: `${p.name}${p.id === me ? " (you)" : ""}`,
      color: p.slot,
      status: p.bot ? "BOT" : p.connected ? "HERE" : "AWAY",
      host: p.id === managerId,
      removable: manage && lobby && p.bot,
    })),
  };
}
