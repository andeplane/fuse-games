import type { WorldView } from "../engine/view.js";
import { createCueWatch, type Cue } from "./cues.js";
import { lookOf, type LookId, type Theme } from "./looks.js";
import {
  createScene,
  type Scene,
  type SceneCanvas,
  type SceneOptions,
} from "./scene.js";

/**
 * The picture of a match in whichever look this device chose. It owns the canvases inside its host: one for the 2D
 * look, or two for a 3D one (the world, and the flat layer of names and scores over it). The 3D renderer is a large
 * module, so it is fetched the first time a 3D look is asked for; until it arrives the picture keeps what it had, and
 * the sound still hears what happens. A device that cannot draw 3D falls back to the 2D look.
 */
export interface Show extends Scene {
  look(): LookId;
  setLook(id: LookId): void;
}
/** A 3D picture: what the lazily fetched module makes. */
export interface Stage extends Scene {
  setTheme(theme: Theme): void;
}
export type StageFactory<C> = (
  world: C,
  overlay: C,
  theme: Theme,
  options: SceneOptions & { board?: boolean; onContextLost?: () => void },
) => Stage;
/** A canvas the picture puts in its host and takes out again. */
export interface Layer extends SceneCanvas {
  remove(): void;
}
export interface ShowOptions<C extends Layer> extends SceneOptions {
  look: LookId;
  /** Without the board a 3D look shows no scores (the menu's demo). */
  board?: boolean;
  /** Makes a canvas in the host; `name` says which layer it is. */
  layer(name: "flat" | "world" | "overlay"): C;
  /** Fetches the 3D renderer. */
  load(): Promise<StageFactory<C>>;
  /** Hears the look actually shown, when 3D could not be drawn and the 2D look took over. */
  onFallback?(id: LookId, error: unknown): void;
}

export function createShow<C extends Layer>(options: ShowOptions<C>): Show {
  let wanted = options.look;
  let scene: Scene | undefined;
  /** What is on the page now. */
  let flat: C | undefined;
  let stage: { made: Stage; world: C; overlay: C } | undefined;
  let fetching: Promise<StageFactory<C>> | undefined;
  let destroyed = false;
  /** While nothing is drawn yet, the sound still gets its cues. */
  let unseen: ((view: WorldView) => Cue[]) | undefined = createCueWatch();

  const dropFlat = () => {
    if (!flat) return;
    scene?.destroy();
    flat.remove();
    flat = undefined;
    scene = undefined;
  };
  const dropStage = () => {
    if (!stage) return;
    stage.made.destroy();
    stage.world.remove();
    stage.overlay.remove();
    stage = undefined;
    scene = undefined;
  };
  const showFlat = () => {
    dropStage();
    if (flat) return;
    flat = options.layer("flat");
    scene = createScene(flat, options);
    unseen = undefined;
  };
  const fallBack = (error: unknown) => {
    wanted = "classic";
    showFlat();
    options.onFallback?.(wanted, error);
  };
  const apply = () => {
    if (destroyed) return;
    const theme = lookOf(wanted).theme;
    if (!theme) return showFlat();
    if (stage) return stage.made.setTheme(theme);
    const fetch = (fetching ??= options.load());
    fetch.then(
      (factory) => {
        // The look may have changed, or the page gone, while the renderer was on its way.
        const now = lookOf(wanted).theme;
        if (destroyed || !now || stage) {
          if (stage && now) stage.made.setTheme(now);
          return;
        }
        const world = options.layer("world"),
          overlay = options.layer("overlay");
        try {
          const made = factory(world, overlay, now, {
            ...options,
            // The GPU dropped the canvas: the flat look takes over, as on a device that never had 3D.
            onContextLost: () => {
              if (stage?.world === world)
                fallBack(new Error("the 3D picture lost its GPU context"));
            },
          });
          dropFlat();
          stage = { made, world, overlay };
          scene = made;
          unseen = undefined;
        } catch (error) {
          world.remove();
          overlay.remove();
          fallBack(error);
        }
      },
      (error: unknown) => {
        // Several look changes may wait on one fetch: only the first to hear of its failure acts on it.
        if (fetching !== fetch) return;
        fetching = undefined;
        if (!destroyed && lookOf(wanted).theme) fallBack(error);
      },
    );
  };
  apply();

  return {
    look: () => wanted,
    setLook(id) {
      if (id === wanted) return;
      wanted = id;
      apply();
    },
    resize: () => scene?.resize(),
    draw(view, nowMs, local, names) {
      if (destroyed) return [];
      if (scene) return scene.draw(view, nowMs, local, names);
      return (unseen ??= createCueWatch())(view);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      dropFlat();
      dropStage();
    },
  };
}
