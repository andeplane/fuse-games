import type { LookId } from "../render/looks.js";
import { createShow, type Show } from "../render/show.js";

/**
 * The match's picture on a real page: canvases made inside `host`, and the 3D renderer fetched as its own chunk the
 * first time a 3D look is shown, so the menus do not wait for it.
 */
export function createPicture(
  host: HTMLElement,
  options: {
    look: LookId;
    fullStage?: () => boolean;
    reducedMotion?: boolean;
    /** Without the board a 3D look shows no scores (the menu's demo). */
    board?: boolean;
    onFallback?: (id: LookId, error: unknown) => void;
  },
): Show {
  return createShow<HTMLCanvasElement>({
    ...options,
    layer(name) {
      const canvas = host.ownerDocument.createElement("canvas");
      canvas.className = `fs-layer fs-layer-${name}`;
      host.append(canvas);
      return canvas;
    },
    load: () =>
      import("../render/three/stage.js").then((stage) => stage.createStage3d),
  });
}
