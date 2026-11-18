import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  advanceMotor,
  createMotor,
  isMotorState,
  motorGears,
  speedToStep,
  stepMotor,
  type Grade,
  type MotorControls,
} from "../src/motor/index.js";

const digest = (rows: unknown) =>
  createHash("sha256").update(JSON.stringify(rows)).digest("hex");
// Obtained from the original DOS instructions with reference/probe.py.
const original = [
  [
    "27564d5a8825bf5d07263deab1d340d3da7c90377f3985796f6a37ee0c0219d3",
    "63b6b35698584eab35060581cfdec88802946e6f3e4e24a57f8cebad58255e48",
  ],
  [
    "56427a7ca59a6ef9d553414ea4aa4c4f9e69c7e08a68e73244c54bb04b3724e2",
    "2dd8da4db76784896a6d4b1b1ac6ba69d5106d1cf6033f0bdfd04719d3a134e1",
  ],
  [
    "4b057d3e91ba91304ac37c2ca85504eda688551490171c7c05c6e756933e988e",
    "3a883f109bff74d8dfd9cb176a76c736c0777d5553d7c4427843eeb0e3fe2334",
  ],
] as const;
const finish = [
  "d9c595f65ed7d5e13a67c66d5530ffc95c2f6bb82b1b6f36f5bbfe720242b352",
  "5d50049ff2854b446dd1119b98f69d855620b85f26970760bdd1cc18a9b2f496",
  "66a426158d812ede27dd4f03c65f53b743488ec193db332dd94ae9097e2d6e15",
] as const;

for (const grade of [0, 1, 2] as const) {
  test(`DOS quarter-mile motion at grade ${grade} through the finish`, () => {
    const tune = { power: grade, gearbox: grade, tires: grade };
    let motor = createMotor(37);
    const frames = [];
    for (let t = 0; t < 2400 && motor.position < 5120; t++) {
      const shift =
        motor.gear === 0 ||
        (motor.rpm >= 4350 && motor.gear < motorGears(tune));
      motor = advanceMotor(
        motor,
        { throttle: true, brake: false, steer: 0, shift: shift ? 1 : 0 },
        tune,
      );
      frames.push([motor.rpm, motor.speed, motor.gear, motor.position]);
    }
    assert.equal(digest(frames), finish[grade]);
  });
  for (const shiftAtRedline of [true, false]) {
    test(`DOS motor trace for grade ${grade}, shifting ${shiftAtRedline}`, () => {
      const tune = { power: grade, gearbox: grade, tires: grade };
      let motor = createMotor(37);
      const rows = [];
      for (let i = 0; i < 170 && !motor.broken; i++) {
        const brake = i >= 95 && i < 108;
        const throttle = i < 135 && !brake;
        const upshift =
          motor.gear === 0 ||
          (shiftAtRedline &&
            motor.rpm >= 4350 &&
            motor.gear < motorGears(tune));
        motor = stepMotor(
          motor,
          {
            throttle,
            brake,
            shift: throttle && upshift ? 1 : 0,
            steer: i >= 38 && i < 49 ? 1 : i >= 52 && i < 64 ? -1 : 0,
            shoulder: i >= 75 && i < 79,
          },
          tune,
        );
        assert.ok(isMotorState(motor));
        rows.push([
          motor.rpm,
          motor.speed,
          motor.gear,
          motor.wheel,
          motor.band,
          motor.limiter,
          motor.engineWear,
          motor.gearWear,
          motor.failure,
        ]);
      }
      assert.equal(digest(rows), original[grade][shiftAtRedline ? 0 : 1]);
    });
  }
}

test("track progress matches the original fast-machine speed function at every speed and past its limits", () => {
  assert.equal(
    digest(Array.from({ length: 143 }, (_, i) => speedToStep(i - 1))),
    "0578fc927747a675c9ba5b9f095eb2a8637438dd5ce319d256987ca92e59674f",
  );
});

test("20 Hz checkpoint round trip preserves a queued shift and both independent timer phases through the finish", () => {
  const gas: MotorControls = {
    throttle: true,
    brake: false,
    steer: 0,
    shift: 0,
  };
  const tune = { power: 1 as Grade };
  const queued = advanceMotor(createMotor(), { ...gas, shift: 1 }, tune);
  assert.equal(queued.gear, 0);
  assert.equal(queued.pendingShift, 1);
  let left = queued;
  let right = structuredClone(queued);
  for (let t = 0; t < 2400 && left.position < 5120; t++) {
    const shift =
      left.rpm > 4300 && left.gear < motorGears(tune) && !left.pendingShift
        ? 1
        : 0;
    left = advanceMotor(left, { ...gas, shift }, tune);
    right = advanceMotor(right, { ...gas, shift }, tune);
    assert.deepEqual(left, right);
  }
  assert.ok(left.position >= 5120 && !left.broken);
  assert.equal(queued.position, 0);
  assert.equal(queued.pendingShift, 1);
  for (const patch of [
    { pendingShift: 2 },
    { pitIndex: 24 },
    { pitPhase: 327680 },
    { gear: 8 },
    { speed: Infinity },
    { failure: 17 },
  ])
    assert.equal(isMotorState({ ...queued, ...patch }), false);
});
