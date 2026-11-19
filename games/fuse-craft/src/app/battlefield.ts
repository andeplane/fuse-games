import type { BuildKind, Player, World } from "../engine/types.js";
import { renderBoard, type BoardAnimation } from "../render/board.js";
import type { BoardCamera, CameraFactory } from "../render/camera.js";
import type { LightRenderer } from "../render/light-field.js";
import type { BuildingSprites } from "../render/sprite-raster.js";
import {
  renderPlacementPreview,
  type PlacementPreview,
} from "./placement-preview.js";

export interface BattlefieldDependencies {
  debug: boolean;
  animationClock(): number;
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(handle: number): void;
  sprites?: Readonly<Record<string, string>>;
  buildingSprites?: BuildingSprites;
  createCamera?: CameraFactory;
  createLightRenderer?(canvas: HTMLCanvasElement): LightRenderer | null;
}

interface BoardPresentation {
  selectedCell: number | null;
  owner: Player | undefined;
  placement: BuildKind | null;
  preview: PlacementPreview | null;
  reducedMotion: boolean;
  edgeScroll: boolean;
}

/** Owns presentation resources for the mounted battlefield across redraws. */
export function createBattlefield(
  root: HTMLElement,
  deps: BattlefieldDependencies,
) {
  let lightCanvas: HTMLCanvasElement | null = null;
  let light: LightRenderer | undefined;
  let camera: BoardCamera | null = null;
  let animation: BoardAnimation | null = null;
  let frame: number | null = null;
  let activeLoop: FrameRequestCallback | null = null;

  function setLightCanvas(next: HTMLCanvasElement | null): void {
    if (next === lightCanvas) return;
    light?.destroy?.();
    lightCanvas = next;
    light = next ? (deps.createLightRenderer?.(next) ?? undefined) : undefined;
  }

  function resetCamera(): void {
    camera?.dispose();
    camera = null;
  }

  function stopSession(): void {
    activeLoop = null;
    if (frame !== null) deps.cancelFrame(frame);
    frame = null;
    animation = null;
    resetCamera();
  }

  function start(): void {
    if (activeLoop) return;
    const animate: FrameRequestCallback = (now) => {
      if (activeLoop !== animate) return;
      animation?.animate(now);
      updateMinimap();
      if (activeLoop === animate) frame = deps.requestFrame(animate);
    };
    activeLoop = animate;
    frame = deps.requestFrame(animate);
  }

  function updateMinimap(): void {
    const view = root
      .querySelector("#nd-board")
      ?.getAttribute("viewBox")
      ?.split(" ");
    const outline = root.querySelector(".minimap-view");
    if (!view || !outline) return;
    ["x", "y", "width", "height"].forEach((key, index) =>
      outline.setAttribute(key, view[index]!),
    );
  }

  return {
    get camera(): BoardCamera | null {
      return camera;
    },
    resetCamera,
    updateMinimap,
    // A relaunch can reuse the mounted canvas after restarting the loop and camera.
    stopSession,
    unmount(): void {
      stopSession();
      setLightCanvas(null);
    },
    start,
    update(
      svg: SVGSVGElement,
      world: Readonly<World>,
      state: BoardPresentation,
    ): void {
      setLightCanvas(root.querySelector<HTMLCanvasElement>("#nd-light"));
      animation = renderBoard(
        svg,
        world,
        state.selectedCell,
        deps.debug,
        state.reducedMotion,
        deps.animationClock(),
        deps.sprites,
        deps.buildingSprites,
        light,
      );
      root.classList.toggle("is-placing", state.placement !== null);
      renderPlacementPreview(
        svg,
        world,
        state.owner,
        state.placement,
        state.preview,
        deps.sprites,
      );
      const viewport = root.querySelector<HTMLElement>("#nd-viewport");
      if (!camera && viewport && deps.createCamera) {
        camera = deps.createCamera(svg, viewport);
        camera.setEdgeScroll(state.edgeScroll);
        const brain = world.structures.find(
          (structure) =>
            structure.ownerId === state.owner?.id && structure.kind === "brain",
        );
        if (brain) camera.focusCell(world.map.width, brain.cell);
        svg.focus?.({ preventScroll: true });
      }
      camera?.refresh();
    },
  };
}
