import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createJoinByCode,
  createMainMenu,
  createQrScanButton,
  roomFromScan,
  type QrScanner,
} from "fuse-ui";
import { event, page } from "./dom-fixture.js";

const valid = (code: string) => /^[A-Z0-9]{4,10}$/.test(code);

/** linkedom has no dialog methods: open and close flip `open` and fire close as a browser does. */
function modal(window: { Event: typeof Event }) {
  return (dialog: HTMLDialogElement) => {
    dialog.showModal = () => {
      dialog.open = true;
    };
    dialog.close = () => {
      if (!dialog.open) return;
      dialog.open = false;
      dialog.dispatchEvent(event(window, "close"));
    };
  };
}

/** A camera the test drives: `read` hands it a QR code's text, `fail` makes the next start reject. */
function fakeCamera() {
  let onText: ((text: string) => void) | undefined;
  const camera = {
    starts: 0,
    stops: 0,
    failNext: undefined as Error | undefined,
    scanner: {
      start: async (
        _video: HTMLVideoElement,
        report: (text: string) => void,
      ) => {
        camera.starts++;
        if (camera.failNext) {
          const failure = camera.failNext;
          camera.failNext = undefined;
          throw failure;
        }
        onText = report;
        return () => {
          camera.stops++;
          onText = undefined;
        };
      },
    } satisfies QrScanner,
    read: (text: string) => onText?.(text),
  };
  return camera;
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Opening the button's dialog: the dialog is appended to the body on click, so patch it then. */
function openScan(
  scan: HTMLButtonElement,
  document: Document,
  patch: (dialog: HTMLDialogElement) => void,
) {
  const before = new Set(document.querySelectorAll("dialog"));
  const append = document.body.append.bind(document.body);
  document.body.append = (...nodes: (Node | string)[]) => {
    for (const node of nodes)
      if (
        typeof node !== "string" &&
        (node as Element).tagName === "DIALOG" &&
        !before.has(node as HTMLDialogElement)
      )
        patch(node as HTMLDialogElement);
    append(...nodes);
  };
  scan.click();
  document.body.append = append;
  return document.querySelector<HTMLDialogElement>("dialog.fui-qr-scan")!;
}

test("a scanned invitation link or a bare code names its room; anything else is not a room", () => {
  assert.deepEqual(
    roomFromScan("https://fusegames.ai/fuse-riders/?room=ab42xy", valid),
    {
      code: "AB42XY",
      link: new URL("https://fusegames.ai/fuse-riders/?room=ab42xy"),
    },
  );
  assert.deepEqual(roomFromScan("  ab42xy ", valid), { code: "AB42XY" });
  assert.equal(roomFromScan("https://example.com/menu", valid), null);
  assert.equal(roomFromScan("https://example.com/?room=no!", valid), null);
  assert.equal(roomFromScan("javascript:alert(1)?room=AB42XY", valid), null);
  assert.equal(roomFromScan("", valid), null);
});

test("Join room puts the cursor in the room code field, not on Back", () => {
  const { document, window } = page();
  const join = createJoinByCode({
    valid,
    onJoin() {},
    onInvalid() {},
    scanner: undefined,
    document,
  });
  const menu = createMainMenu({
    title: "Fuse",
    play: document.createElement("div"),
    joinContent: [join.row],
    document,
  });
  document.body.append(menu.element);
  modal(window)(menu.dialog);
  // linkedom keeps no focus: record which control was focused last.
  let focused = "";
  for (const [name, node] of [
    ["code", join.input],
    ["join", join.button],
    ...[...menu.element.querySelectorAll<HTMLElement>("button")].map(
      (b) => [b.textContent ?? "", b] as const,
    ),
  ] as const)
    node.focus = () => {
      focused = name;
    };
  menu.play.click();
  menu.joinRoom.click();
  assert.equal(menu.dialog.open, true);
  assert.equal(focused, "code");
  menu.dispose();
});

test("SCAN QR CODE sits after JOIN and joins the scanned room with the camera off", async () => {
  const { document, window } = page();
  const camera = fakeCamera();
  const joined: string[] = [];
  const join = createJoinByCode({
    valid,
    onJoin: (code) => joined.push(code),
    onInvalid() {},
    scanner: camera.scanner,
    document,
  });
  document.body.append(join.row);
  assert.deepEqual(
    [...join.row.children],
    [join.input, join.button, join.scan],
  );
  assert.equal(join.scan!.textContent, "SCAN QR CODE");
  const dialog = openScan(join.scan!, document, modal(window));
  await settle();
  assert.equal(dialog.open, true);
  assert.equal(camera.starts, 1);
  // Another QR code says so and keeps looking.
  camera.read("https://example.com/menu");
  assert.equal(dialog.open, true);
  assert.match(
    dialog.querySelector(".fui-qr-scan-status")!.textContent!,
    /not a room invitation/,
  );
  // A bare code (no link) is this game's room.
  camera.read("ab42xy");
  assert.deepEqual(joined, ["AB42XY"]);
  assert.equal(join.input.value, "AB42XY");
  assert.equal(dialog.open, false);
  assert.equal(camera.stops, 1);
  assert.equal(document.querySelector("dialog.fui-qr-scan"), null);
});

test("a blocked camera says how to fix it and TRY AGAIN starts it again", async () => {
  const { document, window } = page();
  const camera = fakeCamera();
  const failure = new Error("denied");
  failure.name = "NotAllowedError";
  camera.failNext = failure;
  const rooms: string[] = [];
  const scan = createQrScanButton({
    valid,
    onRoom: (room) => rooms.push(room.code),
    scanner: camera.scanner,
    document,
  })!;
  const dialog = openScan(scan, document, modal(window));
  await settle();
  const status = dialog.querySelector<HTMLElement>(".fui-qr-scan-status")!,
    retry = dialog.querySelector<HTMLButtonElement>(".fui-qr-scan-retry")!;
  assert.match(status.textContent!, /Allow camera access/);
  assert.equal(retry.hidden, false);
  retry.click();
  await settle();
  assert.equal(camera.starts, 2);
  assert.equal(retry.hidden, true);
  // Closing with Back turns the camera off and reports nothing.
  dialog.close();
  assert.equal(camera.stops, 1);
  camera.read("AB42XY");
  assert.deepEqual(rooms, []);
});

test("a camera that answers after the dialog closed is switched off at once", async () => {
  const { document, window } = page();
  let release: (() => void) | undefined;
  let stops = 0;
  const scanner: QrScanner = {
    start: () =>
      new Promise((resolve) => {
        release = () => resolve(() => stops++);
      }),
  };
  const scan = createQrScanButton({ valid, onRoom() {}, scanner, document })!;
  const dialog = openScan(scan, document, modal(window));
  dialog.close();
  release!();
  await settle();
  assert.equal(stops, 1);
});

test("no camera to ask for: no SCAN QR CODE button", () => {
  const { document } = page();
  const join = createJoinByCode({
    valid,
    onJoin() {},
    onInvalid() {},
    scanner: undefined,
    document,
  });
  assert.equal(join.scan, undefined);
  assert.equal(join.row.children.length, 2);
});
