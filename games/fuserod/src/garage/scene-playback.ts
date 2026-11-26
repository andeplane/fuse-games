import { END_FRAMES, END_STEP_MS, HOP_STEP_MS } from "../art/character-motion";

export function scenePlayback(
  canvas: HTMLCanvasElement,
  scene: string,
  paint: (frame: number) => void,
) {
  const doc = canvas.ownerDocument;
  const win = doc.defaultView;
  const motion = win?.matchMedia?.("(prefers-reduced-motion: reduce)");
  const animated = scene === "diner" || scene === "champion";
  const step = scene === "champion" ? END_STEP_MS : HOP_STEP_MS;
  const still = scene === "champion" ? END_FRAMES - 1 : 76;
  let frame = 0;
  let timer: number | undefined;
  let disposed = false;
  const stop = () => {
    win?.clearTimeout(timer);
    timer = undefined;
  };
  const visible = () => !disposed && !doc.hidden && canvas.isConnected;
  const draw = () => {
    if (visible()) paint(animated && motion?.matches ? still : frame);
  };
  const resume = () => {
    stop();
    if (!visible()) return;
    draw();
    if (
      !win ||
      !animated ||
      motion?.matches ||
      (scene === "champion" && frame === END_FRAMES - 1)
    )
      return;
    timer = win.setTimeout(() => {
      frame++;
      resume();
    }, step);
  };
  const observer = win?.ResizeObserver
    ? new win.ResizeObserver(draw)
    : undefined;
  observer?.observe(canvas);
  doc.addEventListener("visibilitychange", resume);
  motion?.addEventListener("change", resume);
  queueMicrotask(resume);
  return () => {
    disposed = true;
    stop();
    observer?.disconnect();
    doc.removeEventListener("visibilitychange", resume);
    motion?.removeEventListener("change", resume);
  };
}
