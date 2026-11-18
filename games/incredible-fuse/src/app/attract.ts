import { demoCanvas } from "fuse-ui";
import { applyMachine, createMachine, stepMachine } from "../game/machine.js";
import { paintMachine } from "./bench.js";

/** Plays a working ramp solution through the same fixed-step rules as the workshop. */
export function createAttract(host: HTMLElement) {
  const canvas = demoCanvas(host, 960, 600);
  function reset() {
    const machine = createMachine(0);
    applyMachine(machine, { type: "place", kind: "ramp", x: 160, y: 140 });
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
