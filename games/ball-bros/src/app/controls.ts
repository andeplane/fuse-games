import type { Steering } from "../engine/state.js";

export const BALL_GUIDE = {
  goal: "Keep the rally alive. Your blocks break on impact; one hit to the core ends your round. Even your own ball can hurt you.",
  controls: [
    { keys: "A / D · ← / →", action: "Orbit left or right" },
    { keys: "W / ↑", action: "Reach out for an early interception" },
    { keys: "S / ↓", action: "Pull in for tighter coverage" },
    { keys: "SPACE", action: "Launch the ball" },
  ],
  touchControls: [
    { keys: "LEFT / RIGHT", action: "Hold to orbit" },
    { keys: "OUT / IN", action: "Hold to reach out or pull in" },
    { keys: "LAUNCH", action: "Tap to launch the ball" },
  ],
} as const;

export type Button = "left" | "right" | "inward" | "outward" | "launch";
/** Multiple keys/pointers may hold one action; releasing one never cancels another. */
export class Controls {
  private sources = new Map<string, Button>();
  constructor(
    private readonly send: (
      steer: Steering,
      radial: Steering,
      launch: boolean,
    ) => void,
  ) {}
  get steering(): Steering {
    const held = [...this.sources.values()];
    return ((held.includes("right") ? 1 : 0) -
      (held.includes("left") ? 1 : 0)) as Steering;
  }
  get radial(): Steering {
    const held = [...this.sources.values()];
    return ((held.includes("outward") ? 1 : 0) -
      (held.includes("inward") ? 1 : 0)) as Steering;
  }
  press(source: string, button: Button): void {
    if (this.sources.has(source)) return;
    this.sources.set(source, button);
    this.send(this.steering, this.radial, button === "launch");
  }
  release(source: string): void {
    if (this.sources.delete(source))
      this.send(this.steering, this.radial, false);
  }
  cancel(): void {
    this.sources.clear();
    this.send(0, 0, false);
  }
}
export function keyboardButton(code: string): Button | undefined {
  if (code === "KeyA" || code === "ArrowLeft") return "left";
  if (code === "KeyD" || code === "ArrowRight") return "right";
  if (code === "KeyW" || code === "ArrowUp") return "outward";
  if (code === "KeyS" || code === "ArrowDown") return "inward";
  if (code === "Space") return "launch";
  return;
}

/** Text entry keeps its keys; focused buttons/links retain native Space activation. */
export function gameplayKey(
  code: string,
  editable: boolean,
  interactive: boolean,
): Button | undefined {
  return editable || (interactive && code === "Space")
    ? undefined
    : keyboardButton(code);
}
