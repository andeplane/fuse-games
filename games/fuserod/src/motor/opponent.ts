import {
  motorGears,
  motorTopSpeed,
  type Grade,
  type MotorControls,
  type MotorState,
  type MotorTune,
} from "./index.js";

export type PatrolState = 0 | 1 | 2 | 3 | 4;
export interface RivalContext {
  route: "strip" | "aqueduct" | "canyon";
  playerSpeed: number;
  playerPosition: number;
  /** The beginning of a change in yaw. The original only brakes once per turn. */
  turning: boolean;
  slowSection?: boolean;
  police?: boolean;
  streetDrag?: boolean;
  king?: boolean;
}

const segment = (position: number) => Math.floor(position / 64);

/** Return the cap imposed by the DOS rival decision, or null to continue accelerating. */
export function rivalSpeedCap(
  speed: number,
  position: number,
  vmax: number,
  context: RivalContext,
): number | null {
  if (context.route === "strip" && !context.streetDrag) return null;
  if (context.route === "canyon" && context.slowSection && speed > 59)
    return 59;
  const gap = segment(position) - segment(context.playerPosition);
  if (context.route !== "aqueduct" && context.turning) {
    const cap = vmax - (gap > 0 ? 30 : 3);
    return speed > cap ? cap : null;
  }
  const slower = Math.trunc((vmax * (context.police ? 60 : 70)) / 100);
  if (gap > 12) {
    const cap =
      context.playerSpeed >= 97 || context.king
        ? Math.trunc((vmax * 80) / 100)
        : slower;
    if (speed > cap) return cap;
  } else if (Math.abs(gap) < 5) {
    // The original test uses the absolute segment, including the start offset.
    const start =
      context.route === "aqueduct" ? 8 : context.streetDrag ? 200 : 370;
    const cap = Math.max(
      context.playerSpeed + 16,
      segment(context.playerPosition) + start >= 30 ? slower : 0,
    );
    if (speed > cap) return cap;
  }
  if (
    context.police &&
    context.playerSpeed > 50 &&
    speed > context.playerSpeed + 32
  )
    return context.playerSpeed + 32;
  return null;
}

/** Feed the recovered pace and shift decisions through the same pedals as a human driver. */
export function recoveredRivalControls(
  state: MotorState,
  tune: MotorTune,
  rank: Grade,
  context: RivalContext,
): Pick<MotorControls, "throttle" | "brake" | "shift"> {
  const cap = rivalSpeedCap(
    state.speed,
    state.position,
    motorTopSpeed(tune),
    context,
  );
  const brake = cap !== null;
  const shiftRpm = [4500, 5000, 5200][tune.power ?? 0]! + (rank - 1) * 200;
  const up =
    state.gear === 0 ||
    (!brake && state.rpm >= shiftRpm && state.gear < motorGears(tune));
  const top = state.gear === motorGears(tune) && state.rpm >= 5400;
  return {
    throttle: !brake && !top,
    brake,
    shift: state.pendingShift ? 0 : up ? 1 : 0,
  };
}

/** 0 absent, 1 waiting, 2 pursuing, 3 siren, 4 pulled over. Advance once per road frame. */
export function policeStep(
  state: PatrolState,
  patrolPosition: number,
  playerPosition: number,
  rivalPosition: number,
): PatrolState {
  const player = segment(playerPosition);
  const rival = segment(rivalPosition);
  if (state === 1 && player >= segment(patrolPosition))
    return player < rival + 7 ? 0 : 2;
  if (state === 2 && player <= rival + 15) return 3;
  if (state === 3 && player < rival - 2) return 4;
  return state;
}

/** Original solo finish decision. Ties after signed truncation favor the driver. */
export function finishAhead(
  playerPosition: number,
  rivalPosition: number,
): boolean {
  const whole = (segment(rivalPosition) - segment(playerPosition)) * 8;
  return (
    whole + Math.trunc(((rivalPosition % 64) - (playerPosition % 64)) / 8) <= 0
  );
}

/** Delay after the shared start tree for the faster dial-in, in original PIT interrupts. */
export function bracketDelay(
  dialInTenths: number,
  otherDialInTenths: number,
): number {
  return 7 * Math.max(0, otherDialInTenths - dialInTenths);
}

/** The original solo event tests the driver's dial-in against the race clock when
 * either car reaches the finish. Going under it reverses the bracket result. */
export function bracketAdvance(
  driverAhead: boolean,
  dialInTenths: number,
  raceTenths: number,
): boolean {
  return dialInTenths > raceTenths ? !driverAhead : driverAhead;
}

/** Lateral steering increment for a road span already marked as obstructed. All coordinates
 * use the DOS road scale (the street's nominal left/right edges are 1500 and 3300). */
export function trafficDodge(
  x: number,
  target: number,
  leftEdge: number,
  rightEdge: number,
  blocked: { left: number; right: number } | null,
): number {
  if (!blocked) return Math.trunc((target - x) / 8);
  const { left, right } = blocked;
  const near = x - 130;
  const far = x + 170;
  if (far < left || near > right) return 0;
  const toLeft = far - left + 100;
  const toRight = right - near + 100;
  let delta: number;
  if (left - 300 < leftEdge) delta = toRight;
  else if (right + 300 > rightEdge) delta = -toLeft;
  else if (toRight < toLeft)
    delta = x + toRight < rightEdge ? toRight : -toLeft;
  else delta = x - toLeft <= leftEdge ? toRight : -toLeft;
  return Math.trunc(delta / 8);
}
