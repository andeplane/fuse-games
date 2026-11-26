import assert from "node:assert/strict";
import test from "node:test";
import {
  STOPS,
  canPark,
  continueDrive,
  createDrive,
  distanceToStop,
  driveTick,
  setDestination,
} from "../src/cruise/road.js";
import { isMotorState, type MotorControls } from "../src/motor/index.js";

const pedal: MotorControls = {
  throttle: true,
  brake: false,
  steer: 0,
  shift: 0,
};
test("every town destination can be reached and parked at using only the pedals", () => {
  for (const stop of Object.keys(STOPS) as (keyof typeof STOPS)[]) {
    const start = stop === "garage" ? "station" : "garage";
    let drive = createDrive(start, stop);
    assert.equal(canPark(drive), false);
    for (let i = 0; i < 3000 && !canPark(drive); i++) {
      const distance = distanceToStop(drive);
      const brake = Math.abs(distance) < 180;
      drive = driveTick(drive, { ...pedal, throttle: !brake, brake }, {}, true);
    }
    assert.ok(canPark(drive), stop);
    assert.ok(!drive.motor.broken && drive.motor.steps > 0);
  }
});
test("passing an entrance keeps it on the next circuit and a new destination resolves ahead", () => {
  let d = createDrive("garage", "diner");
  const initialTarget = d.target;
  for (let i = 0; i < 3000 && d.target === initialTarget; i++)
    d = driveTick(d, pedal, {}, true);
  assert.ok(d.target > initialTarget && distanceToStop(d) > 0);
  const s = setDestination(d, "strip");
  assert.equal(s.motor, d.motor);
  assert.ok(s.target < d.target);
});
test("manual cruise stays neutral until shifted, and steering/restart preserve road position", () => {
  let d = createDrive("station", "garage");
  for (let i = 0; i < 5; i++) d = driveTick(d, pedal, {}, false);
  assert.equal(d.motor.speed, 0);
  d = driveTick(d, { ...pedal, shift: 1 }, {}, false);
  for (let i = 0; i < 32; i++)
    d = driveTick(d, { ...pedal, steer: 1 }, {}, false);
  assert.ok(d.motor.speed > 0 && d.lateral > 0);
  const recovered = continueDrive(d);
  assert.equal(recovered.motor.position, d.motor.position);
  assert.ok(isMotorState(recovered.motor));
  assert.equal(recovered.motor.speed, 0);
});
