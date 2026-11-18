import QRCode from "qrcode";
import {
  button,
  createInviteCard,
  createNameEntry,
  createRoster,
  createRoomLayout,
  createSharedTvOption,
  el,
  requestedRoomSlot,
} from "fuse-ui";
import type { FuserodRuntime } from "./runtime.js";
import type { FuserodSettings, FuserodView } from "../game/index.js";
import { createAttract } from "./attract.js";
export function raceLobby(opts: {
  code: string;
  link: string;
  displayLink: string;
  name: string;
  saveName: (v: string) => void;
  runtime: () => FuserodRuntime;
  socialName: () => string | undefined;
}) {
  const { runtime } = opts;
  let own: { slot: number; name: string } | undefined;
  let occupied = new Set<number>();
  let current: FuserodSettings;
  const element = el("section"),
    roster = createRoster({ emptyText: "Waiting for drivers" });
  const add = button("+ ADD BOT"),
    start = button("START RACE", "fui-button-primary");
  const invite = createInviteCard({
    code: opts.code,
    link: opts.link,
    qr: (text) => QRCode.toDataURL(text, { margin: 1, width: 360 }),
  });
  const name = createNameEntry({
    initial: opts.name,
    normalize: (s) => Array.from(s.trim()).slice(0, 18).join(""),
    onInput: opts.saveName,
    onSubmit: (value) => {
      opts.saveName(value);
      const slot = requestedRoomSlot(name.form);
      runtime().command({
        type: "join",
        name: value,
        slot: slot !== undefined && !occupied.has(slot) ? slot : undefined,
      });
    },
  });
  const tv = createSharedTvOption({
    onChange: (display) =>
      runtime().command({
        type: "settings",
        settings: { ...current, display },
      }),
    onOpenScreen: () => window.open(opts.displayLink, "_blank", "noopener"),
  });
  const select = el("select"),
    label = el("label", "Race ");
  const events = [
    ["street", "strip", "Street drag"],
    ["timed", "strip", "Quarter-mile time trial"],
    ["grudge", "strip", "Bracket drag"],
    ["duel", "aqueduct", "Aqueduct duel"],
    ["duel", "canyon", "Canyon duel"],
  ] as const;
  for (const [variant, route, title] of events) {
    const option = el("option", title);
    option.value = variant + "-" + route;
    select.append(option);
  }
  label.append(select);
  const dialLabel = el("label", "Dial-in (seconds) "),
    dial = el("input");
  dial.type = "number";
  dial.min = "0";
  dial.max = "80";
  dial.step = "0.05";
  dialLabel.append(dial);
  const gearboxLabel = el("label", " Automatic transmission"),
    automatic = el("input");
  automatic.type = "checkbox";
  gearboxLabel.prepend(automatic);
  automatic.onchange = () =>
    runtime().command({
      type: "settings",
      settings: { ...current, automatic: automatic.checked },
    });
  dial.onchange = () => {
    if (dial.reportValidity())
      runtime().command({
        type: "settings",
        settings: {
          ...current,
          dialInTicks: Math.round(Number(dial.value) * 20),
        },
      });
  };
  select.onchange = () => {
    const event = events.find(([v, r]) => v + "-" + r === select.value);
    if (event)
      runtime().command({
        type: "settings",
        settings: {
          ...current,
          route: event[1],
          variant: event[0],
          dialInTicks: 0,
        },
      });
  };
  start.onclick = () => runtime().command({ type: "action", action: "start" });
  add.onclick = () =>
    runtime().command({
      type: "bot",
      action: "add",
      slot: requestedRoomSlot(add),
    });
  element.append(invite.element, roster.element);
  element.hidden = true;
  createRoomLayout({
    element,
    roster,
    join: name.form,
    ownSlot: () => own?.slot,
    onMove: (slot) => {
      if (own) runtime().command({ type: "join", slot, name: own.name });
    },
    capacity: 5,
    primaryAction: start,
    addAI: add,
    settings: [label, dialLabel, gearboxLabel],
    extras: [tv.element],
    actionsInHeader: true,
    heading: "Race room",
    background: createAttract,
    playerName: opts.socialName,
  });
  return {
    element,
    render(
      frame: FuserodView,
      settings: FuserodSettings,
      me: string,
      host: boolean,
      display: boolean,
      manager: string,
    ) {
      current = settings;
      const players = frame.players.filter((p) => !p.watcher);
      occupied = new Set(players.map((p) => p.slot));
      own = players.find((p) => p.id === me);
      name.form.hidden = !!own || display || !me;
      select.value = settings.variant + "-" + settings.route;
      select.disabled = !host || display;
      dialLabel.hidden = settings.variant !== "grudge";
      dial.disabled = select.disabled;
      if (document.activeElement !== dial)
        dial.value = String(settings.dialInTicks / 20);
      automatic.checked = settings.automatic;
      automatic.disabled = select.disabled;
      add.hidden = !host || display || players.length >= 5;
      start.hidden = !host || display;
      start.disabled = !players.some((p) => p.connected || p.bot);
      roster.update(
        players.map((p) => ({
          id: p.id,
          slot: p.slot,
          name: p.name,
          status: p.bot
            ? "AI driver"
            : !p.connected
              ? "Offline"
              : p.id === me
                ? "You"
                : "Ready",
          host: p.id === manager,
          ready: p.bot || p.connected,
        })),
      );
      for (const [id, row] of roster.entries()) {
        if (
          !host ||
          !players.find((p) => p.id === id)?.bot ||
          row.querySelector(".rod-remove")
        )
          continue;
        const remove = button("×", "rod-remove");
        remove.setAttribute("aria-label", "Remove bot");
        remove.onclick = () =>
          runtime().command({ type: "bot", action: "remove", id });
        row.append(remove);
      }
      tv.update(settings.display, host && !display);
    },
  };
}
