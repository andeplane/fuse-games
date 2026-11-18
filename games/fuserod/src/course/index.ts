/** Signed thousandths of the usable road half-width in Fuserod's driving view. */
export type Course = "strip" | "aqueduct" | "canyon";

export interface RoadFeature {
  kind: "bridge" | "guardrail" | "rock" | "rough" | "bank";
  start: number;
  end: number;
  lane: number;
}
/** An original Fuserod course. All distances are metres along the route. */
const features: Record<Course, readonly RoadFeature[]> = {
  strip: [],
  aqueduct: [{ kind: "bank", start: 0, end: 1680, lane: 0 }],
  canyon: [
    { kind: "guardrail", start: 270, end: 421, lane: 1 },
    { kind: "rock", start: 604, end: 612, lane: -0.28 },
    { kind: "bridge", start: 935, end: 994, lane: 0 },
    { kind: "rough", start: 1430, end: 1505, lane: 0 },
    { kind: "rock", start: 1752, end: 1760, lane: 0.45 },
    { kind: "guardrail", start: 1880, end: 2050, lane: 1 },
    { kind: "bridge", start: 2340, end: 2390, lane: 0 },
    { kind: "rough", start: 2640, end: 2705, lane: 0 },
  ],
};
export const courseFeatures = (route: Course): readonly RoadFeature[] =>
  features[route];

/** Angle of the driver's vehicle (negative left), relative to the channel floor.
 * The DOS camera uses the opposite sign to rotate the world. The two slopes have
 * different widths, capped wheel heights and gearing. */
export function aqueductBank(lateral: number) {
  const camera = 2118 + Math.round(lateral * 927);
  const left = camera - 110,
    right = camera + 520;
  if (left <= 1480)
    return -Math.trunc((Math.min(180, 1480 - left) * 108) / 400);
  if (right >= 3320)
    return Math.trunc((Math.min(136, right - 3320) * 90) / 400);
  return 0;
}

/** Update the driver's camera and motor once per moving road frame. The DOS
 * projection scales all four near-row probes identically, so their lateral
 * order can be compared directly on Fuserod's level channel floor. */
export function channelStep(oldX: number, x: number, speed: number) {
  const previous = 2118 + Math.round((oldX * 927) / 1000);
  const camera = 2118 + Math.round((x * 927) / 1000);
  const left = camera - 110,
    right = camera + 520;
  let shift = 0;
  if (left <= 1480) shift = left < 1300 ? 40 : 15;
  else if (right >= 3320) shift = right > 3456 ? -40 : -15;
  let roll = aqueductBank(x / 1000);
  const side = (wheel: number) => (wheel < 2360 ? -1 : wheel > 2440 ? 1 : 0);
  const leftSide = side(left),
    rightSide = side(right);
  if (leftSide === 0 || leftSide + side(previous - 110) === 0) roll = 4;
  if (rightSide === 0 || rightSide + side(previous + 520) === 0) roll = -4;
  return {
    x: shift === 0 ? x : Math.round(((camera + shift - 2118) * 1000) / 927),
    speed: roll !== 0 && speed > 10 ? speed - 2 : speed,
    roll,
  };
}

/** True for a faster car closing on a rival directly ahead. Both gaps use
 * original 1/64-segment units. A moving pair can cross between snapshots. */
export function rearEndContact(
  route: Course,
  rearX: number,
  leadX: number,
  gapBefore: number,
  gapAfter: number,
  rearStep: number,
  leadStep: number,
) {
  const width = route === "aqueduct" ? 927 : 850;
  const lateral = Math.abs(
    Math.round((leadX * width) / 1000) - Math.round((rearX * width) / 1000),
  );
  return (
    gapBefore > 0 && gapAfter <= 64 && rearStep > leadStep && lateral < 180
  );
}

/** Distances in the DOS routine
 * are measured from the driver's camera; the car's left and right extents differ. */
export function courseContact(
  route: Course,
  x: number,
  speed: number,
  positionMetres = 0,
) {
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
    const feature = courseFeatures(route).find(
      (f) => positionMetres >= f.start && positionMetres < f.end,
    );
    const bridge = feature?.kind === "bridge";
    const edgeL = bridge ? 2000 : 1500,
      edgeR = bridge ? 2800 : 3300;
    const verge = route === "canyon" ? 150 : 260;
    crashed = left <= edgeL - verge || right >= edgeR + verge;
    if (bridge && (left < edgeL + (verge >> 2) || right > edgeR - (verge >> 1)))
      crashed = true;
    if (!crashed) {
      shoulder = left < edgeL || right > edgeR;
      if (feature?.kind === "rough" && speed > 60) crashed = true;
      if (
        feature?.kind === "rock" &&
        Math.abs(x / 1000 - feature.lane) <= 0.14 &&
        speed > 30
      )
        crashed = true;
      if (
        (route === "strip" && right >= edgeR - 180) ||
        (feature?.kind === "guardrail" && right >= edgeR)
      ) {
        if (speed >= 40) crashed = true;
        else {
          const shove = route === "strip" ? 200 : 300;
          x = Math.round(((camera - shove - 2380) * 1000) / 850);
          speed = Math.max(0, speed - 10);
        }
      }
    }
  }
  return { x, speed, shoulder, crashed };
}
