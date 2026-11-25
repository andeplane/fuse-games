import { button, el } from "./dom.js";
import { createDialog } from "./dialog.js";
import { escapeIsTaken } from "./back.js";
import { menuKeys } from "./menu-keys.js";
import { ALL_SONGS, type Song, type MusicMedia } from "fuse-music";
import { createRadio } from "./radio.js";
import { browserPlaytestFor } from "./playtest.js";
import { safeStorage } from "./safe-storage.js";
import { installTouchGuard } from "./touch-guard.js";

export interface TopBarOptions {
  element: HTMLElement;
  brand?: HTMLElement;
  account?: HTMLElement;
  gameId?: string;
  /** This game's master switch: music and effects change together. */
  sound?: TopBarSound;
  /** Local controls, refreshed each time Player options opens. */
  playerOptions?: () => HTMLElement;
  /** Release an active binding capture or calibration when leaving Player options. */
  onPlayerOptionsClose?: () => void;
  /** Existing radio playback controls for a game that supplies its own music player. */
  radioControls?: HTMLElement;
  /** Omit for the full shared catalogue, pass a game's selection, or false for a custom radio UI. */
  music?: readonly Song[] | false;
  /** The browser media boundary; tests and embedded hosts can supply their own player surface. */
  createMusicMedia?: () => MusicMedia;
  /** Release held inputs on open. On close a running game can focus its play surface. */
  onOpenChange?: (open: boolean) => void;
}
export interface TopBarSound {
  enabled(): boolean;
  setEnabled(enabled: boolean): void;
  readonly forcedMute?: boolean;
  onChange?(changed: () => void): () => void;
}
interface InstalledBar {
  refresh(options: TopBarOptions): void;
  openRadio(): void;
}
const installed = new WeakMap<HTMLElement, InstalledBar>();
const bindings = new WeakMap<HTMLElement, () => void>();
const radios = new WeakMap<Document, ReturnType<typeof createRadio>>();

/** Opens the shared Radio view from a game's keyboard shortcut. */
export function openTopBarRadio(element: HTMLElement): void {
  installed.get(element)?.openRadio();
}

/** Shared overlay navigation. Existing game/account controls retain their handlers and game-specific data. */
/** The keys that press a focused button. */
const PRESSES = new Set([" ", "Enter"]);

export function createTopBar(options: TopBarOptions): HTMLElement {
  const root = options.element;
  const previous = installed.get(root);
  if (
    previous &&
    root.classList.contains("fui-top-bar") &&
    root.querySelector(":scope > .fui-top-bar-left")
  ) {
    previous.refresh(options);
    return root;
  }
  if (previous) installed.delete(root);
  const doc = root.ownerDocument;
  // Every game has a top bar, so every game gets the phone guard: no selection, callouts or double-tap zoom.
  installTouchGuard(doc);
  const customRadio = options.music === false;
  let radio = customRadio ? undefined : radios.get(doc);
  if (
    !radio &&
    !customRadio &&
    options.gameId &&
    doc.defaultView &&
    (options.createMusicMedia || typeof doc.defaultView.Audio === "function")
  ) {
    const win = doc.defaultView;
    const preview = new URLSearchParams(win.location?.search ?? "").has("mute");
    radio = createRadio(
      doc,
      import.meta.env?.BASE_URL ?? "/",
      options.createMusicMedia ?? (() => new win.Audio()),
      preview,
      options.music || ALL_SONGS,
      safeStorage(() => win.localStorage),
      true,
    );
    radios.set(doc, radio);
    win.addEventListener("pagehide", (event) => {
      if (!event.persisted) radio?.destroy();
    });
    for (const type of [
      "pointerdown",
      "pointerup",
      "touchend",
      "keydown",
      "click",
    ])
      doc.addEventListener(type, () => radio?.player.unlock(), {
        passive: true,
      });
  }
  const left = el("div", "", "fui-top-bar-left", doc);
  const right = el("div", "", "fui-top-bar-right", doc);
  const context = el("div", "", "fui-top-bar-context", doc);
  const account = button("Sign in", "fui-top-bar-account", doc);
  account.hidden = true;
  const sound = button("Sound on", "fui-top-bar-sound", doc);
  sound.hidden = true;
  const toggle = button("", "fui-top-bar-toggle", doc);
  toggle.setAttribute("aria-label", "Open game menu");
  toggle.setAttribute("aria-haspopup", "dialog");
  toggle.setAttribute("aria-expanded", "false");
  toggle.innerHTML =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const menu = createDialog({ title: "Game menu", document: doc });
  menu.dialog.classList.add("fui-top-bar-menu");
  menu.body.classList.add("fui-top-bar-actions");
  // Heard on the dialog: the bar keeps its keys from the page, and a modal holds the focus in here anyway.
  menuKeys(menu.dialog, {
    scope: menu.dialog,
    document: doc,
    items: () =>
      [
        ...menu.dialog.querySelectorAll<HTMLElement>(
          "button, a[href], input, select",
        ),
      ].filter(
        (item) =>
          item.checkVisibility?.({ visibilityProperty: true }) !== false,
      ),
  });
  const radioEntry = button("Radio", "fui-top-bar-radio", doc);
  const optionsEntry = button(
    "Player options",
    "fui-top-bar-player-options",
    doc,
  );
  const detailClass = "fui-dialog-body fui-top-bar-actions fui-top-bar-detail";
  const channel = el("div", "", detailClass, doc);
  const preferences = el("div", "", detailClass, doc);
  const master = button("", "fui-player-sound", doc);
  const custom = el("div", "", "fui-player-custom", doc);
  preferences.append(master, custom);
  if (radio) {
    channel.append(radio.element);
    preferences.insertBefore(radio.volumeControl, custom);
  }
  channel.hidden = preferences.hidden = true;
  menu.body.append(radioEntry, optionsEntry);
  menu.dialog.append(channel, preferences);
  let activeEntry: HTMLButtonElement | undefined;
  let transport = options.radioControls ?? radio?.element;
  let playerOptions = options.playerOptions;
  let onPlayerOptionsClose = options.onPlayerOptionsClose;
  const gameMenu = () => {
    if (activeEntry === optionsEntry) onPlayerOptionsClose?.();
    activeEntry = undefined;
    channel.hidden = preferences.hidden = true;
    menu.body.hidden = false;
  };
  const back = () => {
    const from = activeEntry;
    if (!from) return menu.dialog.close();
    gameMenu();
    menu.show({ title: "Game menu" });
    from.focus();
  };
  menu.back.onclick = back;
  menu.dialog.addEventListener("cancel", (event) => {
    if (activeEntry) {
      event.preventDefault();
      back();
    }
  });
  const enter = (entry: HTMLButtonElement, detail: HTMLElement) => {
    if (activeEntry) gameMenu();
    activeEntry = entry;
    menu.body.hidden = true;
    detail.hidden = false;
    menu.show({ title: entry.textContent! });
    menu.back.focus();
  };
  radioEntry.onclick = () => {
    if (transport && transport.parentElement !== channel)
      channel.replaceChildren(transport);
    enter(radioEntry, channel);
  };
  optionsEntry.onclick = () => {
    if (radio && radio.volumeControl.parentElement !== preferences)
      preferences.insertBefore(radio.volumeControl, custom);
    if (playerOptions) custom.replaceChildren(playerOptions());
    enter(optionsEntry, preferences);
  };
  const owned = new Set<Node>([left, right, context, menu.dialog]);
  let source: HTMLElement | undefined;
  let soundControl: TopBarSound | undefined;
  let releaseSound: (() => void) | undefined;
  const renderSound = () => {
    radio?.setMuted(Boolean(soundControl && !soundControl.enabled()));
    sound.hidden = !soundControl;
    const on = Boolean(
      soundControl && !soundControl.forcedMute && soundControl.enabled(),
    );
    const label = on ? "🔊 Sound on" : "🔇 Sound off";
    if (sound.textContent !== label) sound.textContent = label;
    sound.setAttribute("aria-label", on ? "Sound on" : "Sound off");
    sound.setAttribute("aria-pressed", String(on));
    sound.disabled = Boolean(soundControl?.forcedMute);
    sound.title = soundControl?.forcedMute
      ? "Sound off for this preview"
      : "Toggle music and sound effects";
    master.textContent = on ? "Sound on" : "Sound off";
    master.hidden = sound.hidden;
    master.disabled = sound.disabled;
    master.setAttribute("aria-pressed", String(on));
  };
  let onOpenChange = options.onOpenChange;
  let report: HTMLButtonElement | undefined;
  let recording: HTMLButtonElement | undefined;
  let releaseAccount: (() => void) | undefined;
  const refresh = (next: TopBarOptions) => {
    onOpenChange = next.onOpenChange ?? onOpenChange;
    playerOptions = next.playerOptions ?? playerOptions;
    custom.hidden = !playerOptions;
    onPlayerOptionsClose = next.onPlayerOptionsClose ?? onPlayerOptionsClose;
    if (next.radioControls) {
      transport = next.radioControls;
      if (root.contains(transport) && transport.parentElement !== channel)
        channel.replaceChildren(transport);
    }
    radioEntry.hidden = !transport;
    if (next.sound && next.sound !== soundControl) {
      releaseSound?.();
      soundControl = next.sound;
      releaseSound = soundControl.onChange?.(renderSound);
    }
    renderSound();
    const portal = root.querySelector<HTMLElement>(".fui-portal");
    const brand =
      next.brand ??
      root.querySelector<HTMLElement>(
        '[class*="brand"], .landing-logo, .wordmark',
      ) ??
      ([...root.children].find((node) => node.tagName === "A") as
        HTMLElement | undefined);
    const profile =
      next.account ??
      root.querySelector<HTMLButtonElement>(".fui-social > button");
    if (portal && portal.parentElement !== left) left.prepend(portal);
    if (brand && brand !== left && brand.parentElement !== left) {
      brand.classList.add("fui-top-bar-brand");
      left.append(brand);
    }
    if (
      profile &&
      (profile !== source || bindings.get(profile) !== releaseAccount)
    ) {
      source = profile;
      profile.classList.add("fui-top-bar-account-source");
      bindings.get(profile)?.();
      const sync = () => {
        const text = profile.textContent?.trim() || "Sign in";
        if (account.textContent !== text) account.textContent = text;
        account.title = text.replace(/\s+/g, " ");
        account.disabled = profile.hasAttribute("disabled");
        account.hidden = false;
      };
      sync();
      const Observer = doc.defaultView?.MutationObserver;
      const observer = Observer ? new Observer(sync) : undefined;
      observer?.observe(profile, {
        childList: true,
        characterData: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["disabled"],
      });
      releaseAccount = () => observer?.disconnect();
      bindings.set(profile, releaseAccount);
    }
    for (const child of [...root.childNodes]) {
      if (owned.has(child)) continue;
      if (
        child.nodeType === 1 &&
        (child as HTMLElement).matches(".fui-audio")
      ) {
        const panel = (child as HTMLElement).querySelector<HTMLElement>(
          ".fui-audio-panel",
        );
        if (panel) {
          for (const trigger of (
            child as HTMLElement
          ).querySelectorAll<HTMLElement>(".fui-audio-toggle, .fui-audio-more"))
            trigger.hidden = true;
          panel.hidden = false;
          preferences.insertBefore(child, custom);
          continue;
        }
      }
      if (
        child.nodeType === 1 &&
        !(child as HTMLElement).matches(
          "button,input,select,a,details,[data-fui-menu-content]",
        ) &&
        !(child as HTMLElement).querySelector("button,input,select,a,details")
      ) {
        context.append(child);
        continue;
      }
      menu.body.append(child);
    }
    root.classList.add("fui-top-bar");
    optionsEntry.hidden =
      !playerOptions &&
      !soundControl &&
      !radio &&
      preferences.childElementCount === 2;
    root.dataset.fuiPreserve = "true";
    if (next.gameId) root.dataset.gameId = next.gameId;
    if (next.gameId && !report) {
      const playtest = browserPlaytestFor(doc, next.gameId);
      report = button("Report · Ctrl+X", "fui-playtest-trigger", doc);
      report.onclick = () => {
        if (menu.dialog.open) menu.dialog.close();
        playtest?.openReport();
      };
      menu.body.append(report);
      if (playtest) {
        recording = button(
          "Start recording",
          "fui-playtest-recording-toggle",
          doc,
        );
        recording.hidden = true;
        recording.onclick = () => {
          if (menu.dialog.open) menu.dialog.close();
          playtest.toggleRecording();
        };
        playtest.watchRecording((state) => {
          if (!recording) return;
          recording.hidden = !state.available;
          recording.disabled = state.busy;
          recording.textContent = state.busy
            ? "Recording…"
            : state.active
              ? "Stop recording"
              : "Start recording";
          recording.setAttribute("aria-pressed", String(state.active));
        });
        menu.body.append(recording);
      }
    }
    for (const trigger of menu.body.querySelectorAll<HTMLElement>(
      ".fui-game-menu-trigger",
    ))
      trigger.textContent = "Game controls";
    // The ways out of a match (Back to lobby, Main menu) are the menu's first rows, not a level down under Game
    // controls where nobody finds them. The game menu still shows or hides them, and still runs them.
    const exits = [
      ...menu.body.querySelectorAll<HTMLElement>(".fui-game-menu-exit"),
    ];
    if (exits.length) menu.body.prepend(...exits);
  };
  right.append(sound, account, toggle);
  refresh(options);
  root.append(left, right, context, menu.dialog);
  // Header controls keep native keyboard activation while the match continues
  // behind them. Keyup still reaches the game so previously held keys release.
  // The context is the game's own content, lent to the bar (a roster, the host's actions): a key pressed with
  // focus left there after a click is still the game's, or Space would press that button again instead of the bomb.
  // So is a game menu the game keeps in the bar itself rather than in the dialog: Escape closes it and the arrows
  // walk it from the document, where it listens. Space and Enter press the focused button and stay here, or they
  // would fire in the match as well.
  root.addEventListener("keydown", (event) => {
    const target = event.target as Element | null;
    const games =
      context.contains(target) ||
      (!PRESSES.has(event.key) &&
        !menu.dialog.contains(target) &&
        !!target?.closest?.(".fui-game-menu"));
    if (!games) event.stopPropagation();
  });
  const shown = (node: HTMLElement) =>
    node.isConnected &&
    !node.closest("[hidden]") &&
    node.checkVisibility?.({ visibilityProperty: true }) !== false;
  /**
   * The menu button a match keeps on the screen when it hides this bar: a game menu (Bombers' MENU), or with `menus`
   * any on-screen menu button (`data-fui-menu-button`, the phone layout's ☰ MENU).
   */
  const gameTrigger = (menus = false) =>
    [
      ...doc.querySelectorAll<HTMLElement>(
        menus
          ? ".fui-game-menu-trigger, [data-fui-menu-button]"
          : ".fui-game-menu-trigger",
      ),
    ].find((trigger) => !menu.dialog.contains(trigger) && shown(trigger));
  // A ☰ is always on the screen, top right. A match that hides this bar for room (a phone held sideways, a full-screen
  // arena) gets this floating one instead, which opens the same menu: Back to lobby and Main menu are never out of reach.
  const float = el("div", "", "fui-top-bar-float", doc);
  const floatToggle = button("", "fui-top-bar-toggle", doc);
  floatToggle.setAttribute("aria-label", "Open game menu");
  floatToggle.setAttribute("aria-haspopup", "dialog");
  floatToggle.innerHTML = toggle.innerHTML;
  float.append(floatToggle);
  float.hidden = true;
  // Keys pressed in the menu while it is lent to the floating ☰ stay in the menu, as they do in the bar.
  float.addEventListener("keydown", (event) => event.stopPropagation());
  floatToggle.onclick = () => {
    float.append(menu.dialog);
    toggle.click();
  };
  const placeFloat = () => {
    if (menu.dialog.open) return;
    if (menu.dialog.parentElement !== root) root.append(menu.dialog);
    const wanted =
      root.isConnected &&
      !doc.body?.classList.contains("at-entrance") &&
      !shown(toggle) &&
      !gameTrigger(true) &&
      // A page can hold a second bar (Hook Havok's), whose ☰ or floating ☰ already answers.
      ![...doc.querySelectorAll<HTMLElement>(".fui-top-bar-toggle")].some(
        (other) => other !== toggle && other !== floatToggle && shown(other),
      );
    if (wanted && float.parentElement !== doc.body) doc.body?.append(float);
    if (float.hidden === wanted) float.hidden = !wanted;
  };
  // Whether the bar is shown is each game's CSS (a phone turned sideways, a match starting): the ☰ in the bar changes
  // size when it goes (to nothing) or comes back, and that is when the floating one is placed.
  const view = doc.defaultView;
  const Resize = view?.ResizeObserver;
  // A game's own on-screen menu can arrive a moment after the bar goes, so the place is looked at again then.
  const settle = () => {
    placeFloat();
    for (const wait of [250, 1000]) view?.setTimeout(placeFloat, wait);
  };
  if (Resize) new Resize(settle).observe(toggle);
  view?.addEventListener("resize", placeFloat);
  // Escape nobody else used opens this menu, as a pause key does: in a match that is where Back to lobby and
  // Main menu are. Escape that closes a dialog, the game menu or the portal, or that a page uses as Back, is theirs.
  // The page's own listeners may come after this one, so the answer waits for the press to finish.
  doc.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" || event.repeat) return;
      if (escapeIsTaken(event, doc)) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest?.(
          "input, textarea, select, [contenteditable], .fui-game-menu",
        )
      )
        return;
      doc.defaultView?.setTimeout(() => {
        if (event.defaultPrevented || menu.dialog.open) return;
        if (!root.isConnected || doc.querySelector("dialog[open]")) return;
        if (shown(toggle)) return toggle.click();
        // A match that hides the bar keeps the game menu on the screen instead (Bombers' MENU): Escape opens that.
        const trigger = gameTrigger();
        if (trigger) return trigger.click();
        placeFloat();
        if (!float.hidden) floatToggle.click();
        else gameTrigger(true)?.click();
      }, 0);
    },
    true,
  );
  toggle.onclick = () => {
    renderSound();
    onOpenChange?.(true);
    menu.show({ title: "Game menu" });
    toggle.setAttribute("aria-expanded", "true");
  };
  // A game's own menu lives in this dialog as "Game controls". Its closing actions close the dialog before they run,
  // and a dialog closed any other way (Escape, Close) collapses that menu: otherwise the game stays paused for input
  // behind a menu nobody can see, and focus cannot return to the arena while the modal holds the page inert.
  menu.body.addEventListener(
    "click",
    (event) => {
      const target = event.target as Element | null;
      if (target?.closest?.("[data-fui-menu-dismiss]") && menu.dialog.open)
        menu.dialog.close();
    },
    true,
  );
  menu.dialog.addEventListener("close", () => {
    if (menu.dialog.parentElement !== root) root.append(menu.dialog);
    gameMenu();
    renderSound();
    toggle.setAttribute("aria-expanded", "false");
    for (const trigger of menu.body.querySelectorAll<HTMLElement>(
      '.fui-game-menu-trigger[aria-expanded="true"]',
    ))
      trigger.click();
    // Native close normally restores the opener. Preserve focus moved by a game action or another
    // dialog, and let a running game choose its keyboard input surface after the fallback.
    const active = doc.activeElement;
    if (!active || active === doc.body || menu.dialog.contains(active))
      (float.hidden ? toggle : floatToggle).focus();
    onOpenChange?.(false);
  });
  account.onclick = () => {
    source?.click();
    if (menu.dialog.open) menu.dialog.close();
  };
  sound.onclick = () => {
    if (soundControl && !soundControl.forcedMute) {
      soundControl.setEnabled(!soundControl.enabled());
      renderSound();
    }
  };
  master.onclick = () => sound.click();
  menu.body.addEventListener("click", () => {
    if (
      [...doc.querySelectorAll<HTMLDialogElement>("dialog[open]")].some(
        (dialog) => dialog !== menu.dialog,
      ) &&
      menu.dialog.open
    )
      menu.dialog.close();
  });
  installed.set(root, {
    refresh,
    openRadio() {
      if (radioEntry.hidden || activeEntry === radioEntry) return;
      if (!menu.dialog.open) toggle.click();
      radioEntry.click();
    },
  });
  return root;
}
