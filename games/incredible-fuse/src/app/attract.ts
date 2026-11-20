import { demoCanvas } from "fuse-ui";
import {
  applyMachine,
  createMachine,
  PUZZLES,
  stepMachine,
} from "../game/machine.js";
import { SHOWCASE_PUZZLE } from "../game/machine-showcase.js";
import { paintMachine } from "./bench.js";

/** Plays a working ramp solution through the same fixed-step rules as the workshop. */
export function createAttract(host: HTMLElement) {
  const canvas = demoCanvas(host, 960, 600);
  function reset() {
    const machine = createMachine(PUZZLES.indexOf(SHOWCASE_PUZZLE));
    applyMachine(machine, { type: "place", kind: "ramp", x: 110, y: 130 });
    return machine;
  }
  let machine = reset();
  let ticks = 0;
  let hold = 0;
  return {
    tick: () => ticks,
    advance() {
      ticks++;
      if (machine.mode === "running") {
        stepMachine(machine);
      } else if (++hold >= 24) {
        if (machine.mode === "build") applyMachine(machine, { type: "run" });
        else machine = reset();
        hold = 0;
      }
    },
    render: () => paintMachine(canvas, machine),
    dispose: () => canvas.remove(),
  };
}
