import { requestedRoomSlot } from "fuse-ui";
import {
  createInviteCard,
  createNameEntry,
  createRoster,
  createRoomLayout,
  createSharedTvOption,
  type RoomFriends,
  elementsFor,
} from "fuse-ui";
import type { RoomCommand } from "fuse-netcode";
import { ballGame, type Settings } from "../online/game.js";
import { colorCss } from "../render/present.js";
import { roomModel } from "./room-model.js";
import { NAME_KEY, rememberShared, type Store } from "./session.js";
import { avatarChoice, chosenAvatar } from "./avatars.js";
import { ARENA_MAPS, MAP_IDS, type MapId } from "../engine/maps.js";

export function roomPanel(
  root: HTMLElement,
  options: {
    code: string;
    link: string;
    displayLink: string;
    display: boolean;
    store: Store;
    qr(link: string): Promise<string>;
    /** Whether the room took the command: a refused Shared TV tick goes back to what the room has. */
    command(command: RoomCommand<Settings>): boolean;
    /** The room's line (connection, failures), shown at the room's foot. */
    status: HTMLElement;
    /** INVITE FRIENDS beside the invitation and ADD FRIEND on a seat, where the page has accounts. */
    friends?: RoomFriends;
  },
) {
  const document = root.ownerDocument,
    el = elementsFor(document);
  const element = el("section", "", "room-panel");
  const invite = createInviteCard({
    document,
    code: options.code,
    link: options.link,
    qr: options.qr,
  });
  const roster = createRoster({ document, emptyText: "Nobody has joined yet" });
  const name = createNameEntry({
    document,
    initial: options.store.getItem(NAME_KEY) ?? "",
    normalize: (s) => ballGame.seating.seatName(s) ?? "",
    onSubmit(value) {
      options.store.setItem(NAME_KEY, value);
      options.command({
        type: "join",
        ...(requestedRoomSlot(name.form) === undefined
          ? {}
          : { slot: requestedRoomSlot(name.form) }),
        name: value,
        avatarId: chosenAvatar(options.store),
      });
    },
  });
  name.form.prepend(avatarChoice(document, options.store));
  const add = el("button", "+ ADD BOT", "quiet-button");
  add.onclick = () =>
    options.command({
      type: "bot",
      action: "add",
      slot: requestedRoomSlot(add),
    });
  const start = el("button", "START MATCH", "primary fui-button-primary");
  start.onclick = () => options.command({ type: "action", action: "start" });
  // Shared TV is the room's choice, made in the room: the manager turns it on here and opens the screen beside it.
  const sharedTv = createSharedTvOption({
    document,
    className: "shared-tv",
    onChange: (display) => {
      const sent = options.command({
        type: "settings",
        settings: { display, mapId: map.value as MapId },
      });
      if (sent) rememberShared(options.store, options.code, display);
      return sent;
    },
    onOpenScreen: () =>
      document.defaultView?.open(options.displayLink, "_blank", "noopener"),
  });
  const tvBox = sharedTv.element.querySelector("input");
  const note = el("p", "Connecting to the room…", "room-note");
  const map = el("select", "", "map-select");
  for (const mapId of MAP_IDS) {
    const option = el("option", ARENA_MAPS[mapId].label);
    option.value = mapId;
    map.append(option);
  }
  const mapChoice = el("label", "", "map-choice");
  mapChoice.append(el("span", "ARENA"), map);
  map.onchange = () =>
    options.command({
      type: "settings",
      // The box holds a Shared TV choice the room has not answered yet; the last frame would send the old one back.
      settings: {
        display: tvBox?.checked ?? lastDisplay,
        mapId: map.value as MapId,
      },
    });
  element.append(invite.element, name.form, roster.element);
  root.append(element);
  /** This device's own seat in the lobby, as the last frame had it. */
  let ownSeat: { name: string; slot: number } | undefined;
  createRoomLayout({
    // Seated already: any open seat is a move, and the base's colour follows it.
    ownSlot: () => ownSeat?.slot,
    onMove: (slot) => {
      if (ownSeat) options.command({ type: "join", name: ownSeat.name, slot });
    },
    primaryAction: start,
    playerName: () => options.store.getItem(NAME_KEY) ?? undefined,
    background: async (host) =>
      (await import("./attract.js")).createAttract(host),
    element,
    roster,
    capacity: 5,
    join: name.form,
    addAI: add,
    settings: [mapChoice],
    actions: [note],
    actionsInHeader: true,
    heading: "Room",
    status: options.status,
    extras: [sharedTv.element],
    ...(options.friends ? { friends: options.friends } : {}),
  });
  let key = "";
  let lastDisplay = false;
  name.form.hidden = true;
  return {
    element,
    render(model: ReturnType<typeof roomModel>) {
      // Every frame, not only a changed one: a choice the room never answers has to fall back by itself.
      sharedTv.update(
        model.display,
        model.manage && model.lobby && !options.display,
      );
      const next = JSON.stringify(model);
      if (next === key) return;
      key = next;
      element.hidden = !model.lobby;
      lastDisplay = model.display;
      ownSeat = model.own;
      map.querySelectorAll<HTMLOptionElement>("option").forEach((option) => {
        option.selected = option.value === model.mapId;
      });
      map.disabled = !model.manage;
      name.form.hidden = !model.askName;
      add.hidden = !model.canAdd;
      start.hidden = !model.manage;
      start.disabled = !model.canStart;
      note.textContent = model.note;
      roster.update(
        model.players.map((p) => ({ ...p, color: colorCss(p.color) })),
      );
      for (const [id, row] of roster.entries()) {
        let remove = row.querySelector<HTMLButtonElement>(".remove-bot");
        if (!remove) {
          remove = el("button", "REMOVE", "quiet-button remove-bot");
          remove.setAttribute("aria-label", "Remove bot");
          remove.onclick = () =>
            options.command({ type: "bot", action: "remove", id });
          row.append(remove);
        }
        remove.hidden = !model.players.find((p) => p.id === id)?.removable;
      }
    },
  };
}
