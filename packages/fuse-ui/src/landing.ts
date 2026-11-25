import { el, partClass, type PartClasses } from "./dom.js";
import type { SettingsScope } from "./settings-actions.js";
import { createMainMenu } from "./main-menu.js";
import type { AttractFactory } from "./attract.js";
import { createQrScanButton, type QrScanner } from "./qr-scan.js";

export type JoinByCodePart = "root" | "input" | "button" | "scan" | "rejoin";

const JOIN_BY_CODE_CLASSES: Record<JoinByCodePart, string> = {
  root: "fui-join-code",
  input: "fui-join-code-input",
  button: "fui-join-code-button",
  scan: "fui-join-code-scan",
  rejoin: "fui-join-code-rejoin",
};

export interface JoinByCodeOptions {
  /** Accepts a normalised (trimmed, upper-case) code. The room service's rule, e.g. `validRoomCode`. */
  valid(code: string): boolean;
  /** A valid code was entered. */
  onJoin(code: string): void;
  /** JOIN was pressed with a code `valid` refused; show the message. */
  onInvalid(message: string): void;
  buttonText?: string;
  placeholder?: string;
  invalidMessage?: string;
  maxLength?: number;
  /** The last room this browser was in, one tap away (REJOIN AB42XY) after JOIN. Omit when there is none. */
  rejoin?: { code: string; onRejoin(code: string): void; title?: string };
  /**
   * The camera behind SCAN QR CODE. Default: this browser's; the button is left out where there is no camera to
   * ask for. Pass `undefined` to leave it out.
   */
  scanner?: QrScanner | undefined;
  /**
   * A scanned invitation to another game on this site: go there. Default: load the link. A room of this game
   * joins through `onJoin`, as a typed code does.
   */
  onOtherGame?: (link: URL) => void;
  classes?: PartClasses<JoinByCodePart>;
  document?: Document;
}

export interface JoinByCode {
  row: HTMLElement;
  input: HTMLInputElement;
  button: HTMLButtonElement;
  /** SCAN QR CODE, after JOIN; absent where the device has no camera to ask for. */
  scan: HTMLButtonElement | undefined;
  rejoin: HTMLButtonElement | undefined;
}

/**
 * A room-code field, JOIN and SCAN QR CODE. Enter in the field presses JOIN. The code is trimmed and upper-cased
 * before checks; a scanned room invitation joins as its code typed would.
 */
export function createJoinByCode(options: JoinByCodeOptions): JoinByCode {
  const doc = options.document ?? document;
  const c = (part: JoinByCodePart) =>
    partClass(JOIN_BY_CODE_CLASSES, options.classes, part);
  const row = el("div", "", c("root"), doc),
    input = el("input", "", c("input"), doc),
    button = el("button", options.buttonText ?? "JOIN ROOM", c("button"), doc);
  input.placeholder = options.placeholder ?? "Room code";
  input.maxLength = options.maxLength ?? 10;
  input.autocapitalize = "characters";
  input.setAttribute("aria-label", options.placeholder ?? "Room code");
  button.onclick = () => {
    const value = input.value.trim().toUpperCase();
    if (options.valid(value)) options.onJoin(value);
    else
      options.onInvalid(
        options.invalidMessage ?? "Enter a room code, for example AB42XY",
      );
  };
  input.onkeydown = (event) => {
    if (event.key === "Enter") button.click();
  };
  row.append(input, button);
  const scan = createQrScanButton({
    valid: options.valid,
    onRoom: (room) => {
      input.value = room.code;
      options.onJoin(room.code);
    },
    ...(options.onOtherGame ? { onOtherGame: options.onOtherGame } : {}),
    ...("scanner" in options ? { scanner: options.scanner } : {}),
    className: c("scan"),
    document: doc,
  });
  if (scan) row.append(scan);
  let rejoin: HTMLButtonElement | undefined;
  if (options.rejoin) {
    const last = options.rejoin;
    rejoin = el("button", `REJOIN ${last.code}`, c("rejoin"), doc);
    if (last.title) rejoin.title = last.title;
    rejoin.onclick = () => last.onRejoin(last.code);
    row.append(rejoin);
  }
  return { row, input, button, scan, rejoin };
}

export interface LandingOptions {
  howToPlay?: import("./main-menu.js").MainMenuOptions["howToPlay"];
  settingsScope?: SettingsScope;
  background?: AttractFactory;
  /** The game's name, the card's heading. */
  title: string;
  /** One line under the title. */
  tagline?: string;
  /** Start a room on the room service; a rejection is shown on the card and CREATE ROOM comes back. */
  onCreate(): Promise<void> | void;
  /** Play alone against bots. Omit to leave SOLO out. */
  onSolo?: () => void;
  continuePlay?: import("./main-menu.js").MainMenuOptions["continuePlay"];
  /** Join-by-code rules and destination. */
  valid(code: string): boolean;
  onJoin(code: string): void;
  createText?: string;
  soloText?: string;
  /**
   * Keep the solo button in the single-player dialog's bar, beside CLOSE, with `soloActions` before it, rather than
   * under the details. For a game whose details are long enough to scroll: the button that starts play must not
   * be at the end of them. The details then go in `soloDetails`.
   */
  soloInBar?: boolean;
  /** With `soloInBar`: what else sits in the bar, before the solo button. */
  soloActions?: readonly Node[];
  document?: Document;
}

export interface LandingCard {
  element: HTMLElement;
  create: HTMLButtonElement;
  solo: HTMLButtonElement | undefined;
  /** Where a game puts what a single player chooses before playing; shown in the single-player dialog. */
  soloDetails: HTMLElement;
  join: JoinByCode;
  /** One `role="alert"` line for create and join failures. */
  error: HTMLElement;
  menu: ReturnType<typeof createMainMenu>;
}

/**
 * The first screen of a room game: title, CREATE ROOM, JOIN by code and SOLO. A game with its own landing page (as
 * Fuse Riders has) can use `createJoinByCode` alone.
 */
export function createLandingCard(options: LandingOptions): LandingCard {
  const doc = options.document ?? document;
  const element = el("main", "", "fui-landing", doc),
    heading = el("h1", options.title, "fui-landing-title", doc),
    actions = el("div", "", "fui-landing-actions", doc),
    hostOptions = el("div", "", "fui-play-host-options", doc),
    create = el(
      "button",
      options.createText ?? "CREATE ROOM",
      "fui-button fui-button-primary",
      doc,
    ),
    error = el("p", "", "fui-landing-error", doc);
  create.type = "button";
  error.setAttribute("role", "alert");
  element.append(heading);
  if (options.tagline)
    element.append(el("p", options.tagline, "fui-landing-tagline", doc));
  const runCreate = async () => {
    create.disabled = true;
    error.textContent = "";
    try {
      await options.onCreate();
    } catch (failure) {
      error.textContent =
        failure instanceof Error ? failure.message : String(failure);
      throw failure;
    } finally {
      create.disabled = false;
    }
  };
  create.onclick = () => {
    void runCreate().catch(() => {});
  };
  const join = createJoinByCode({
    valid: options.valid,
    onJoin: (code) => {
      error.textContent = "";
      options.onJoin(code);
    },
    onInvalid: (message) => {
      error.textContent = message;
    },
    document: doc,
  });
  hostOptions.append(create);
  create.hidden = true;
  actions.append(hostOptions);
  let solo: HTMLButtonElement | undefined;
  const singlePlayerOptions = el("div", "", "fui-single-player-options", doc);
  if (options.onSolo) {
    const onSolo = options.onSolo;
    solo = el("button", options.soloText ?? "PLAY SOLO", "fui-button", doc);
    solo.type = "button";
    solo.onclick = () => onSolo();
    if (!options.soloInBar) singlePlayerOptions.append(solo);
    actions.append(singlePlayerOptions);
  }
  element.append(actions, error);
  const menu = createMainMenu({
    background: options.background,
    title: options.title,
    settingsScope: options.settingsScope,
    description: options.tagline,
    howToPlay: options.howToPlay,
    play: element,
    onPlay: runCreate,
    continuePlay: options.continuePlay,
    onSinglePlayer: options.onSolo,
    singlePlayerContent: () =>
      solo && singlePlayerOptions.children.length > (options.soloInBar ? 0 : 1)
        ? [singlePlayerOptions]
        : [],
    ...(solo && options.soloInBar
      ? { singlePlayerActions: [...(options.soloActions ?? []), solo] }
      : {}),
    joinContent: [join.row, error],
    hostingOptions: hostOptions,
    document: doc,
  });
  const updateHostingOptions = () => {
    hostOptions.hidden = ![...hostOptions.children].some(
      (node) => node !== create,
    );
  };
  updateHostingOptions();
  const Observer = doc.defaultView?.MutationObserver;
  if (Observer)
    new Observer(updateHostingOptions).observe(hostOptions, {
      childList: true,
    });
  return {
    element: menu.element,
    create,
    solo,
    soloDetails: singlePlayerOptions,
    join,
    error,
    menu,
  };
}
