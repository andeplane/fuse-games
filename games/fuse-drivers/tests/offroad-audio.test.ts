import assert from "node:assert/strict";
import { test } from "node:test";
import { createOffroadAudio } from "../src/app/offroad-audio.js";
import { createOffroadMotion } from "../src/game/offroad/motion.js";

function fixture() {
  const cues: number[][] = [],
    motor: number[][] = [];
  const speaker = createOffroadAudio({
    tone({ frequency }) {
      cues.push([frequency]);
    },
    jingle(notes) {
      cues.push([...notes]);
    },
    hum: () => ({
      set(pitch, volume) {
        motor.push([pitch, volume]);
      },
    }),
  });
  const truck = {
    slot: 0,
    motion: createOffroadMotion(0, 0, 0),
    nitrosUsed: 0,
    cash: 0,
    wallTicks: 0,
    contactMask: 0,
    finishedTick: 0,
    laps: 0,
  };
  const race = {
    phase: "racing" as const,
    tick: 41,
    pickups: { active: null },
    trucks: [truck],
  };
  return { speaker, cues, motor, truck, race };
}

test("GO, motor, nitro and finish follow the race only once across repeated render frames", () => {
  const { speaker, cues, motor, truck, race } = fixture();
  speaker.observe("m1", { ...race, tick: 39, phase: "countdown" }, 0, 0);
  speaker.observe("m1", race, 0, 0);
  speaker.observe("m1", race, 0, 0);
  assert.equal(cues.length, 1);
  assert.ok(motor.at(-1)![1]! > 0);
  const spent = {
    ...truck,
    nitrosUsed: 1,
    motion: { ...truck.motion, nitros: 24, speed: 120 },
  };
  speaker.observe("m1", { ...race, tick: 42, trucks: [spent] }, 0, 0);
  assert.equal(cues.length, 2);
  assert.ok(motor.at(-1)![0]! > motor[0]![0]!);
  speaker.observe(
    "m1",
    { ...race, tick: 43, phase: "finished", trucks: [spent] },
    0,
    0,
  );
  assert.equal(cues.length, 3);
  assert.equal(motor.at(-1)![1], 0);
});

test("recoveries and rollbacks reset cue edges and never replay a contact", () => {
  const { speaker, cues, truck, race } = fixture();
  speaker.observe("m1", race, 0, 0);
  const hit = { ...race, tick: 42, trucks: [{ ...truck, contactMask: 3 }] };
  speaker.observe("m1", hit, 0, 0);
  speaker.observe("m1", race, 0, 1);
  speaker.observe("m1", hit, 0, 1);
  speaker.observe("m1", { ...hit, tick: 43 }, 0, 1);
  assert.equal(cues.length, 1);
  speaker.observe(
    "m1",
    { ...race, tick: 105, trucks: [{ ...truck, cash: 4 }] },
    0,
    1,
  );
  assert.equal(cues.length, 1);
  speaker.observe("m2", { ...hit, tick: 140 }, 0, 0);
  assert.equal(cues.length, 1);
});

test("self occupancy is quiet, cash pickup sounds, leaving stops the motor", () => {
  const { speaker, cues, motor, truck, race } = fixture();
  speaker.observe("m1", race, 0, 0);
  speaker.observe(
    "m1",
    { ...race, tick: 42, trucks: [{ ...truck, contactMask: 1 }] },
    0,
    0,
  );
  assert.deepEqual(cues, []);
  speaker.observe(
    "m1",
    { ...race, tick: 43, trucks: [{ ...truck, cash: 1 }] },
    0,
    0,
  );
  assert.equal(cues.length, 1);
  speaker.stop();
  assert.equal(motor.at(-1)![1], 0);
});
