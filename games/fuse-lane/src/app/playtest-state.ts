import { fuseLaneView, type FuseLaneRoom } from "../game/index.js";

/** Capture game data only. Player references are indices local to this report. */
export function playtestState(room: FuseLaneRoom, me: string): string {
  const view = fuseLaneView(room);
  const playerIndex = (id: string) =>
    view.players.findIndex((player) => player.id === id);
  return JSON.stringify({
    version: 1,
    tick: view.tick,
    phase: view.phase,
    part: view.part,
    week: view.week,
    timerTicks: view.timerTicks,
    partTicks: view.partTicks,
    weekSeconds: view.weekSeconds,
    rng: room.rng,
    turns: view.turns,
    turn: view.turn,
    order: view.order.map(playerIndex),
    current: playerIndex(view.current),
    reporter: playerIndex(me),
    level: view.level,
    economy: view.economy,
    shelf: view.shelf,
    holders: Object.fromEntries(
      Object.entries(view.holders).map(([job, id]) => [job, playerIndex(id)]),
    ),
    ranking: view.ranking.map(playerIndex),
    winners: view.winners.map(playerIndex),
    players: view.players.map(({ id: _id, name: _name, state, ...player }) => {
      const { msg: _message, notices: _notices, ...gameplay } = state;
      return { ...player, state: gameplay };
    }),
  });
}
