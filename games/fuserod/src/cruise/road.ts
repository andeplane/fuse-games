import {
  advanceMotor,
  createMotor,
  motorGears,
  type MotorControls,
  type MotorState,
  type MotorTune,
} from "../motor/index.js";

/** Original Fuse town layout, measured in the race motor's 1/64-segment units. */
export const STOPS = {
  garage: { name: "Workshop", marker: 0 },
  diner: { name: "Drive-in", marker: 1220 },
  strip: { name: "Drag strip", marker: 2760 },
  station: { name: "Service station", marker: 3900 },
} as const;
export type TownStop = keyof typeof STOPS;
const LOOP = 5200;
const CURB = 215;
export const metres = (units: number) => (units * 402.336) / 5120;

export interface CruiseDrive {
  motor: MotorState;
  start: TownStop;
  destination: TownStop;
  target: number;
  lateral: number;
}

export function createDrive(
  start: TownStop,
  destination: TownStop,
): CruiseDrive {
  return setDestination(
    { motor: createMotor(), start, destination, target: 0, lateral: 0 },
    destination,
  );
}

export function setDestination(
  state: CruiseDrive,
  destination: TownStop,
): CruiseDrive {
  const here = STOPS[state.start].marker + state.motor.position;
  const forward = (((STOPS[destination].marker - here) % LOOP) + LOOP) % LOOP;
  return { ...state, destination, target: state.motor.position + forward };
}

export function distanceToStop(state: CruiseDrive): number {
  return state.target - state.motor.position;
}

export function canPark(state: CruiseDrive): boolean {
  return Math.abs(distanceToStop(state)) <= CURB && state.motor.speed <= 5;
}

export function continueDrive(state: CruiseDrive): CruiseDrive {
  return {
    ...state,
    motor: {
      ...createMotor(state.motor.seed),
      position: state.motor.position,
      engaged: state.motor.position > 0,
    },
  };
}

export function townCurve(state: CruiseDrive): number {
  const angle =
    (((STOPS[state.start].marker + state.motor.position) % LOOP) / LOOP) *
    Math.PI *
    2;
  return Math.sin(angle * 2) * 0.28 + Math.sin(angle * 3) * 0.12;
}

export function driveTick(
  state: CruiseDrive,
  input: MotorControls,
  tune: MotorTune,
  assist: boolean,
): CruiseDrive {
  const old = state.motor;
  const up =
    input.throttle &&
    (old.gear === 0 || (old.rpm >= 4250 && old.gear < motorGears(tune)));
  const down = old.gear > 1 && old.rpm < 1500;
  const shift = assist
    ? old.pendingShift
      ? 0
      : up
        ? 1
        : down
          ? -1
          : 0
    : input.shift;
  const motor = advanceMotor(
    old,
    {
      ...input,
      throttle: input.throttle && old.speed < 38,
      shift,
      shoulder: Math.abs(state.lateral) > 1,
    },
    tune,
  );
  const steering = (motor.wheel / 24) * Math.min(1, motor.speed / 20) * 0.065;
  const lateral = Math.max(
    -1.18,
    Math.min(
      1.18,
      state.lateral + steering - (townCurve(state) * motor.speed) / 19000,
    ),
  );
  const target =
    state.target + (motor.position > state.target + CURB ? LOOP : 0);
  return { ...state, motor, lateral, target };
}
