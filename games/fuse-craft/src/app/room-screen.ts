import { roomLayoutMarkup } from "fuse-ui";
import { ROOM_MAPS } from "../online/maps.js";
import type { RoomSeat, RoomSnapshot } from "./contracts.js";
import { escapeMarkup as escape } from "./escape-markup.js";
import { openingOptions } from "./setup-screen.js";

interface RoomScreenState {
  room: RoomSnapshot;
  roomQr: { code: string; url: string } | null;
  playerName: string;
  friendsAvailable: boolean;
  colors: readonly string[];
}

function roomSeatMarkup(
  seat: RoomSeat,
  room: RoomSnapshot,
  colors: readonly string[],
  managedLobby: boolean,
): string {
  return `<li class="fui-roster-row room-seat${seat.connected ? "" : " away"}" style="--rider-color:${colors[seat.slot] ?? "#63cfff"}"><div class="fui-roster-info"><strong class="fui-roster-name">${escape(seat.name)}${seat.id === room.self ? " (you)" : ""}</strong>${seat.id === room.managerId ? '<span class="fui-roster-host">HOST</span>' : ""}<small class="fui-roster-status">${seat.bot ? "AI" : seat.connected ? "" : "Away"}</small></div>${seat.bot ? "" : `<span id="seat-friend-${escape(seat.id)}" class="seat-friend" data-member="${escape(seat.id)}" data-fui-preserve></span>`}${managedLobby && seat.bot ? `<button data-action="remove-bot" data-bot-id="${escape(seat.id)}" class="secondary small" aria-label="Remove ${escape(seat.name)}">REMOVE</button>` : ""}</li>`;
}

function roomStatus(
  room: RoomSnapshot,
  occupied: number,
  capacity: number,
): string {
  if (room.stage === "connecting") return "Connecting to the room…";
  if (occupied > capacity)
    return `Too many players for this map: it seats ${capacity}. Pick a larger map or ask someone to leave.`;
  return room.status;
}

function roomInvitation({
  room,
  roomQr,
  friendsAvailable,
}: RoomScreenState): string {
  return `<div class="fui-invite">${roomQr?.code === room.code ? `<img class="fui-invite-qr" src="${escape(roomQr.url)}" alt="Scan to join this room"><p class="fui-invite-caption">SCAN TO JOIN</p>` : ""}<strong class="fui-room-code">${escape(room.code)}</strong><button data-action="copy-room-link">COPY LINK</button>${friendsAvailable ? '<button class="fui-room-invite-friends" data-action="invite-friends">INVITE FRIENDS</button>' : ""}</div>`;
}

export function roomScreenMarkup(
  state: RoomScreenState,
  header: () => string,
  closedHeader: () => string,
): string {
  const { room, playerName, colors } = state;
  if (room.closed)
    return `${closedHeader()}<main class="setup-layout"><section class="nd-panel"><h2>${room.closed === "kicked" ? "The host removed you from the room" : "The room has ended"}</h2><div class="button-row"><button data-action="leave-room" class="primary">Back to menu</button></div></section></main>`;
  const players = room.seats.filter((seat) => !seat.watcher);
  const seated = players.some((seat) => seat.id === room.self);
  const capacity = ROOM_MAPS.find((map) => map.id === room.mapId)?.seats ?? 2;
  const ready = players.filter((seat) => seat.connected).length;
  const canStart = room.manager && ready >= 2 && ready <= capacity;
  const lobby = room.stage === "lobby";
  const managedLobby = room.manager && lobby;
  const disabled = managedLobby ? "" : "disabled";
  const slotPlayers = players.map((seat) => ({
    slot: seat.slot,
    html: roomSeatMarkup(seat, room, colors, managedLobby),
  }));
  const status = roomStatus(room, players.length, capacity);
  return (
    header() +
    roomLayoutMarkup({
      actionsInHeader: true,
      heading: "Room",
      occupied: players.length,
      occupiedSlots: players.map((seat) => seat.slot),
      slotPlayers,
      canJoin: !seated,
      // Seated already: any open seat is a move, and the team colour is the seat's.
      canMove: seated && lobby,
      canAddAI: managedLobby && players.length < capacity,
      slotColors: colors,
      capacity,
      // The code once, by the QR code, as in every game's room.
      invite: roomInvitation(state),
      players: `<ul class="room-seats fui-roster"></ul>`,
      join: `${seated ? "" : `<div class="join-row"><label for="player-name">Your name</label><input id="player-name" data-field="player-name" maxlength="32" autocomplete="nickname" value="${escape(playerName)}" placeholder="Name"><button data-action="join-seat" class="primary">Join</button></div>`}`,
      settings: `<label for="room-map">Map</label><select id="room-map" data-field="room-map" ${disabled}>${ROOM_MAPS.map((map) => `<option value="${map.id}" ${map.id === room.mapId ? "selected" : ""}>${escape(map.title)} · ${map.seats} players</option>`).join("")}</select><label for="room-strategy">Bot opening</label><select id="room-strategy" data-field="room-strategy" ${disabled}>${openingOptions(room.aiStrategy)}</select><label class="toggle-field"><input type="checkbox" data-field="room-powerups" ${room.powerups ? "checked" : ""} ${disabled}> Random powerups</label>`,
      primaryAction: room.manager
        ? `<button data-action="start-room" class="primary" ${canStart ? "" : "disabled"}>START MATCH</button>`
        : undefined,
      mainMenu:
        '<button class="fui-back" data-action="leave-room" aria-label="Back">Back</button>',
      actions: !room.manager
        ? '<p class="room-note">Waiting for the host to start…</p>'
        : "",
      status: `<p class="room-status" role="status">${escape(status)}</p>`,
    })
  );
}
