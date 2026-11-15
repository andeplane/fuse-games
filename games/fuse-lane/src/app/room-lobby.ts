import {
  button,
  createInviteCard,
  createRoomLayout,
  createRoster,
  createSharedTvOption,
  el,
  requestedRoomSlot,
  type RoomFriends,
} from "fuse-ui";
import { LEVELS, WEEK_SECONDS } from "../game/index.js";
import type { Art } from "./art.js";
import { GOAL_PRESETS } from "./menu.js";
import type { LobbyModel } from "./presenter.js";
import { text } from "./screen.js";

/**
 * An online room's lobby, the shared `fuse-ui` room: Back, Settings and START in its header, the invitation (QR, code,
 * link) with INVITE FRIENDS and Shared TV under it, who is in (face, name, how they are, HOST), and the connection
 * line at its foot. Settings holds the goals you play for and, for the host, the AI's level and the week's length.
 * Every choice goes back as a command through `actions`; what shows is always the last frame's model.
 */
export interface LobbyActions {
  playerName?(): string | undefined;
  /** A seated player asks for another open seat: the face and the goals are the player's and go along. */
  move?(name: string, slot: number): void;
  addBot(slot?: number): void;
  removeBot(id: string): void;
  start(): void;
  /** One goal for all four, as the menu's presets do. */
  goal(goal: number): void;
  level(level: number): void;
  weekSeconds(seconds: number): void;
  /** The host's Shared TV tick; false when the room did not take it, and the box goes back. */
  shared(display: boolean): boolean;
  /** Opens the room's TV screen on another screen. */
  openTv(): void;
}

export interface RoomLobbyOptions {
  art: Art;
  code: string;
  link: string;
  qr(value: string): Promise<string>;
  /** This screen is the room's TV (`?display=1`): phones join from its code. */
  tv: boolean;
  actions: LobbyActions;
  /** The room's line (connection, failures), shown at the room's foot. */
  status: HTMLElement;
  /** INVITE FRIENDS beside the invitation and ADD FRIEND on a seat, where the page has accounts. */
  friends?: RoomFriends;
}

/** The preset all four of these goals match, or 0 when they were set one by one. */
export function presetOf(goals: readonly number[]): number {
  const first = goals[0] ?? 0;
  return goals.every((goal) => goal === first) &&
    GOAL_PRESETS.some((preset) => preset.goal === first)
    ? first
    : 0;
}

export function createRoomLobby(options: RoomLobbyOptions) {
  const { art, actions } = options;
  const element = el("section", "", "fl-lobby");
  element.classList.toggle("tv", options.tv);
  const invite = createInviteCard({
    code: options.code,
    link: options.link,
    qr: options.qr,
    caption: options.tv ? "SCAN WITH YOUR PHONE TO PLAY" : "SCAN TO JOIN",
  });
  const title = (words: string) => el("h2", words, "fl-menu-title");

  const roster = createRoster({
    emptyText: "Nobody has joined yet",
    avatar: (key) => art.element(`avatar-${key}-portrait`, 40),
  });

  const segmented = <T>(
    choices: readonly { label: string; value: T }[],
    pick: (value: T) => void,
  ) => {
    const row = el("div", "", "fl-segmented");
    const all = choices.map((choice) => {
      const go = button(choice.label, "fl-segment");
      go.onclick = () => pick(choice.value);
      row.append(go);
      return { go, value: choice.value };
    });
    return {
      row,
      render(current: T, enabled: boolean) {
        for (const { go, value } of all) {
          go.classList.toggle("on", value === current);
          go.setAttribute("aria-pressed", String(value === current));
          go.disabled = !enabled;
        }
      },
    };
  };
  const goals = segmented(
    GOAL_PRESETS.map((preset) => ({
      label: `${preset.label} · ${preset.goal}`,
      value: preset.goal as number,
    })),
    (goal) => actions.goal(goal),
  );
  const level = segmented(
    LEVELS.map((label, value) => ({ label, value })),
    (value) => actions.level(value),
  );
  const week = segmented(
    WEEK_SECONDS.map((seconds) => ({
      label: `${seconds}s`,
      value: seconds as number,
    })),
    (seconds) => actions.weekSeconds(seconds),
  );
  const goalsBlock = el("div", "", "fl-field"),
    levelBlock = el("div", "", "fl-field"),
    weekBlock = el("div", "", "fl-field");
  goalsBlock.append(
    title("YOUR GOALS"),
    el(
      "p",
      "Each player picks their own: reach all four in the same week to win.",
      "fl-hint",
    ),
    goals.row,
  );
  levelBlock.append(title("AI LEVEL"), level.row);
  weekBlock.append(
    title("WEEK LENGTH"),
    el(
      "p",
      "Real seconds. Everyone plays the week at the same time.",
      "fl-hint",
    ),
    week.row,
  );

  const note = el("p", "", "fl-lobby-note");
  note.setAttribute("role", "status");
  const addBot = button("+ ADD AI", "fl-add-bot"),
    start = button("START MATCH", "fui-button-primary fl-start");
  addBot.onclick = () => actions.addBot(requestedRoomSlot(addBot));
  start.onclick = () => actions.start();
  // Shared TV is the room's choice, made in the room: the host turns it on here and opens the screen beside it.
  const sharedTv = createSharedTvOption({
    className: "fl-shared-tv",
    onChange: (display) => actions.shared(display),
    onOpenScreen: () => actions.openTv(),
  });
  /** This device's own seat, as the last frame had it. */
  let ownSeat: { name: string; slot: number } | undefined;
  const layout = createRoomLayout({
    ownSlot: () => ownSeat?.slot,
    ...(actions.move
      ? {
          onMove: (slot: number) => {
            if (ownSeat) actions.move?.(ownSeat.name, slot);
          },
        }
      : {}),
    primaryAction: start,
    playerName: actions.playerName,
    background: async (host) =>
      (await import("./attract.js")).createAttract(host),
    element,
    invite: invite.element,
    roster,
    capacity: 5,
    addAI: addBot,
    settings: [goalsBlock, levelBlock, weekBlock],
    actions: [note],
    actionsInHeader: true,
    heading: "Room",
    status: options.status,
    extras: [sharedTv.element],
    ...(options.friends ? { friends: options.friends } : {}),
  });

  return {
    element,
    attachJoin: layout.attachJoin,
    /** `managerId` is the member who holds START: its row carries HOST. */
    render(model: LobbyModel, managerId: string): void {
      ownSeat = model.own;
      layout.update(
        model.members.length,
        5,
        model.members.flatMap((member) =>
          member.slot === undefined ? [] : [member.slot],
        ),
      );
      roster.update(
        model.members.map((member) => ({
          ...member,
          host: member.id === managerId,
          status:
            member.status === "BOT"
              ? `AI · ${LEVELS[model.level] ?? ""}`
              : member.status === "AWAY"
                ? "Away"
                : "Ready",
        })),
      );
      for (const [id, row] of roster.entries()) {
        let remove = row.querySelector<HTMLButtonElement>(".fl-remove");
        if (!remove) {
          remove = button("REMOVE", "fl-remove");
          remove.onclick = () => actions.removeBot(id);
          row.append(remove);
        }
        const member = model.members.find((member) => member.id === id);
        row.classList.toggle("away", member?.status === "AWAY");
        remove.hidden = !model.removable.includes(id);
        remove.setAttribute("aria-label", `Remove ${member?.name ?? "AI"}`);
      }
      sharedTv.update(model.shared, model.canShare);
      goalsBlock.hidden = !model.canPickGoals;
      goals.render(presetOf(model.goals), model.canPickGoals);
      const bots = model.members.some((member) => member.status === "BOT");
      levelBlock.hidden = !bots || !model.canSetLevel;
      level.render(model.level, model.canSetLevel);
      week.render(model.weekSeconds, model.canSetWeek);
      addBot.hidden = !model.canAddBot;
      start.hidden = !model.showStart;
      start.disabled = !model.canStart;
      text(note, model.note);
      note.hidden = !model.note;
    },
  };
}
