import { createDialog } from "./dialog.js";
import { button, el } from "./dom.js";

/** A running camera scan: call it to stop the camera and the reading. */
export type StopQrScan = () => void;

/**
 * The camera behind SCAN QR CODE. `start` shows the camera in `video` and reports the text of each QR code it
 * reads, as often as it reads one; it rejects when the camera cannot be opened (no permission, no camera).
 */
export interface QrScanner {
  start(
    video: HTMLVideoElement,
    onText: (text: string) => void,
  ): Promise<StopQrScan>;
}

/** What the browser scanner needs from the page. A `Window` satisfies it. */
export interface QrScanHost {
  navigator: {
    mediaDevices?: {
      getUserMedia?(constraints: MediaStreamConstraints): Promise<MediaStream>;
    };
  };
  document: Document;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: never): void;
}

type ReadFrame = (video: HTMLVideoElement) => Promise<string | null>;

/** The widest frame handed to the JavaScript reader: a room's QR code reads well below this, and a phone stays cool. */
const MAX_FRAME = 640;
/** Milliseconds between two reads of the camera. */
const READ_EVERY_MS = 120;

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<readonly { rawValue: string }[]>;
}

/** The browser's own reader where it has one (Chrome on Android), else jsQR, loaded only when a scan starts. */
async function frameReader(host: QrScanHost): Promise<ReadFrame> {
  const Native = (
    host as {
      BarcodeDetector?: new (options: {
        formats: string[];
      }) => BarcodeDetectorLike;
    }
  ).BarcodeDetector;
  if (Native) {
    try {
      const detector = new Native({ formats: ["qr_code"] });
      return async (video) =>
        (await detector.detect(video))[0]?.rawValue ?? null;
    } catch {
      /* A detector without QR support: read the frames ourselves. */
    }
  }
  const { default: jsQR } = await import("jsqr");
  const canvas = host.document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  return async (video) => {
    const width = video.videoWidth,
      height = video.videoHeight;
    if (!context || !width || !height) return null;
    const scale = Math.min(1, MAX_FRAME / Math.max(width, height));
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(image.data, image.width, image.height)?.data ?? null;
  };
}

/**
 * The device's camera as a `QrScanner`, or `undefined` where the page has no camera access (an insecure origin, an
 * old browser), so the caller can leave SCAN QR CODE out.
 */
export function browserQrScanner(
  host: QrScanHost = window,
): QrScanner | undefined {
  const media = host.navigator.mediaDevices;
  if (typeof media?.getUserMedia !== "function") return undefined;
  return {
    async start(video, onText) {
      const stream = await media.getUserMedia!({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
      let stopped = false,
        timer: unknown;
      const stop = () => {
        if (stopped) return;
        stopped = true;
        host.clearTimeout(timer as never);
        for (const track of stream.getTracks()) track.stop();
        video.srcObject = null;
      };
      try {
        // iOS plays a video inline only when told to, and only a muted one without a tap.
        video.playsInline = true;
        video.muted = true;
        video.srcObject = stream;
        await video.play();
        const read = await frameReader(host);
        const tick = async () => {
          if (stopped) return;
          try {
            const text = await read(video);
            if (text && !stopped) onText(text);
          } catch {
            /* A frame that could not be read: the next one may be. */
          }
          if (!stopped)
            timer = host.setTimeout(() => void tick(), READ_EVERY_MS);
        };
        void tick();
      } catch (failure) {
        stop();
        throw failure;
      }
      return stop;
    },
  };
}

/** A room found in a scanned QR code. `link` is the invitation itself when the code held one. */
export interface ScannedRoom {
  code: string;
  link?: URL;
}

/**
 * The room a scanned text names: an invitation link (`…?room=AB42XY`) or a bare room code. `valid` is the room
 * service's rule; anything else (another site's QR code, a link without a room) is `null`.
 */
export function roomFromScan(
  text: string,
  valid: (code: string) => boolean,
): ScannedRoom | null {
  const trimmed = text.trim();
  let link: URL | undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:" || parsed.protocol === "http:")
      link = parsed;
  } catch {
    /* Not a link: perhaps the code alone. */
  }
  const code = (link ? (link.searchParams.get("room") ?? "") : trimmed)
    .trim()
    .toUpperCase();
  if (!valid(code)) return null;
  return link ? { code, link } : { code };
}

export interface QrScanButtonOptions {
  /** The room service's rule for a room code, e.g. `validRoomCode`. */
  valid(code: string): boolean;
  /** A QR code for a room of this game was read. The camera is already off and the scan dialog closed. */
  onRoom(room: ScannedRoom): void;
  /**
   * A scanned invitation to another game's page on this site, whose room is not one of this game's: go there.
   * Default: load the link.
   */
  onOtherGame?: (link: URL) => void;
  /** The camera. Default: this browser's, and no button where it has none. */
  scanner?: QrScanner | undefined;
  text?: string;
  className?: string;
  document?: Document;
}

/** True when a scanned invitation is for another game's page on this site. */
function otherGame(
  room: ScannedRoom,
  here: Location | undefined,
): room is ScannedRoom & { link: URL } {
  const path = (value: string) => value.replace(/(index\.html)?$/, "");
  return (
    !!room.link &&
    !!here &&
    room.link.origin === here.origin &&
    path(room.link.pathname) !== path(here.pathname)
  );
}

const POINT = "Point the camera at the room's QR code.";

function cameraFailure(failure: unknown): string {
  const name = failure instanceof Error ? failure.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "The camera is blocked. Allow camera access for this site, then try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "No camera was found on this device. Type the room code instead.";
  return "The camera could not be started. Try again, or type the room code.";
}

/**
 * SCAN QR CODE: opens the camera in a dialog and reports the room of the first room invitation it reads. Returns
 * `undefined` where there is no camera to ask for, so a caller appends it only when it exists.
 */
export function createQrScanButton(
  options: QrScanButtonOptions,
): HTMLButtonElement | undefined {
  const doc = options.document ?? document;
  const scanner =
    "scanner" in options
      ? options.scanner
      : doc.defaultView
        ? browserQrScanner(doc.defaultView as unknown as QrScanHost)
        : undefined;
  if (!scanner) return undefined;
  const trigger = button(
    options.text ?? "SCAN QR CODE",
    options.className ?? "fui-qr-scan-button",
    doc,
  );
  const shell = createDialog({
    title: "Scan QR code",
    classes: { root: "fui-dialog fui-qr-scan" },
    document: doc,
  });
  const video = el("video", "", "fui-qr-scan-video", doc),
    status = el("p", POINT, "fui-qr-scan-status", doc),
    retry = button("TRY AGAIN", "fui-qr-scan-retry", doc);
  video.setAttribute("playsinline", "");
  video.muted = true;
  status.setAttribute("role", "status");
  retry.hidden = true;
  shell.body.append(video, status, retry);
  // Each opening is one attempt: a camera that answers after the dialog closed is switched off again.
  let attempt = 0,
    stop: StopQrScan | undefined;
  const end = () => {
    attempt++;
    stop?.();
    stop = undefined;
  };
  const begin = () => {
    end();
    const mine = attempt;
    status.textContent = POINT;
    delete status.dataset.tone;
    retry.hidden = true;
    video.hidden = false;
    scanner
      .start(video, (text) => {
        if (mine !== attempt) return;
        const room = roomFromScan(text, options.valid);
        if (!room) {
          status.textContent =
            "That QR code is not a room invitation. Scan the one on the host's screen.";
          status.dataset.tone = "error";
          return;
        }
        shell.dialog.close();
        const here = doc.defaultView?.location;
        if (!otherGame(room, here)) options.onRoom(room);
        else if (options.onOtherGame) options.onOtherGame(room.link);
        else here!.assign(room.link.href);
      })
      .then(
        (running) => {
          if (mine === attempt) stop = running;
          else running();
        },
        (failure: unknown) => {
          if (mine !== attempt) return;
          status.textContent = cameraFailure(failure);
          status.dataset.tone = "error";
          video.hidden = true;
          retry.hidden = false;
        },
      );
  };
  retry.onclick = begin;
  shell.dialog.addEventListener("close", () => {
    end();
    shell.dialog.remove();
  });
  trigger.onclick = () => {
    if (shell.dialog.open) return;
    // In the page's top layer, over the dialog the button may sit in.
    doc.body.append(shell.dialog);
    shell.dialog.showModal();
    begin();
  };
  return trigger;
}
