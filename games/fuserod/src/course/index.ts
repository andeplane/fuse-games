/** Signed thousandths of the usable road half-width in Fuserod's driving view. */
export type Course = "strip" | "aqueduct" | "canyon";

/** A clear road segment with the two default verges. Distances in the DOS routine
 * are measured from the driver's camera; the car's left and right extents differ. */
export function courseContact(route: Course, x: number, speed: number) {
  let shoulder = false;
  let crashed = false;
  if (route === "aqueduct") {
    // Centre the usable channel on Fuse lane zero. The DOS aqueduct updates the
    // left and right probe positions before it calls its separate wall check.
    const camera = 2118 + Math.round((x * 927) / 1000);
    crashed = camera - 110 < 1081 || camera + 520 >= 3565;
  } else {
    const camera = 2380 + Math.round((x * 850) / 1000);
    const left = camera - 30;
    const right = camera + 70;
    const edgeL = 1500,
      edgeR = 3300;
    const verge = route === "canyon" ? 150 : 260;
    crashed = left <= edgeL - verge || right >= edgeR + verge;
    if (!crashed) {
      shoulder = left < edgeL || right > edgeR;
      if (route === "strip" && right >= edgeR - 180) {
        if (speed >= 40) crashed = true;
        else {
          // A low-speed scrape nudges the camera 200 units away from the rail.
          x = Math.round(((camera - 200 - 2380) * 1000) / 850);
          speed = Math.max(0, speed - 10);
        }
      }
    }
  }
  return { x, speed, shoulder, crashed };
}
