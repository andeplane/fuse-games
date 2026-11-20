import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceMotor,
  createMotor,
  isMotorState,
  slowMotor,
} from "../src/motor/index.js";
import {
  bracketAdvance,
  bracketDelay,
  finishAhead,
  policeStep,
  recoveredRivalControls,
  rivalSpeedCap,
  trafficDodge,
  type PatrolState,
  type RivalContext,
} from "../src/motor/opponent.js";

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

test("patrol state transition grid matches DOS race_step", () => {
  const values = [];
  for (const state of [0, 1, 2, 3] as const)
    for (const player of [49, 50, 51])
      for (const gap of [-16, -15, -8, -7, -6, -3, -2, 2, 3, 15, 16])
        values.push(
          policeStep(state, 50 * 64, player * 64, (player + gap) * 64),
        );
  assert.equal(
    digest(values),
    "3dfa77cdee4d7367172e7e7c032118255aa1bcb32c899e1dbeca57777d782786",
  );
  let chase: PatrolState = 1;
  for (const [p, o] of [
    [50, 40],
    [60, 49],
    [65, 68],
  ] as const)
    chase = policeStep(chase, 3200, p * 64, o * 64);
  assert.equal(chase, 4);
});

test("close finishes and segment boundaries match DOS finish_stats", () => {
  const values = [];
  for (let a = 60; a < 75; a++)
    for (let b = 56; b < 82; b++) values.push(finishAhead(a, b));
  assert.equal(
    digest(values),
    "8eaa4836eed6cbeda6cf85b74f7b8c0c88bd8756246feaffd5760e052e4fc762",
  );
});

test("rival pace decisions match original traffic, turn, chase and leader-gap branches", () => {
  const values = [];
  for (const mode of [1, 4, 8, 16]) {
    const start = mode === 1 ? 200 : mode === 16 ? 370 : 8;
    for (let i = 0; i < 96; i++) {
      const player = 12 + (i % 30);
      const rival = player + [-14, -3, 3, 5, 14, 20][i % 6]!;
      const context: RivalContext = {
        route: mode === 16 ? "canyon" : mode === 8 ? "aqueduct" : "strip",
        playerSpeed: [40, 57, 96, 97][i % 4]!,
        playerPosition: player * 64,
        turning: i % 3 === 0,
        slowSection: i % 7 === 0,
        police: i % 5 === 0,
        king: i % 11 === 0,
        streetDrag: start === 200,
      };
      values.push(
        rivalSpeedCap(
          [49, 59, 60, 79, 100, 115][i % 6]!,
          rival * 64,
          110,
          context,
        ),
      );
    }
  }
  assert.equal(
    digest(values),
    "2539c71845b171f6815b7040487cd0f45ebad511ac5aef8f6dd0deb9bbb2aeea",
  );
});

test("obstruction clearance steers to the open side within the original road boundaries", () => {
  const values = [];
  for (let x = 1500; x <= 3300; x += 100)
    for (const [left, right] of [
      [1500, 1800],
      [1880, 2050],
      [2100, 2750],
      [2800, 3200],
    ] as const)
      values.push(trafficDodge(x, 2400, 1500, 3300, { left, right }));
  assert.equal(
    digest(values),
    "09bdea3fa95b3c33e6b8af0f67bf5931e0dd9901e9171458695e5902eaf72ebc",
  );
  assert.equal(trafficDodge(2200, 2440, 1500, 3300, null), 30);
});

test("ordinary rival pedals finish a quarter-mile heat for each rank and survive checkpoint replay", () => {
  for (const rank of [0, 1, 2] as const) {
    const tune = { power: rank, gearbox: rank, tires: rank };
    let s = createMotor(17);
    let replay = structuredClone(s);
    for (let t = 0; t < 2000 && s.position < 5120; t++) {
      const controls = recoveredRivalControls(s, tune, rank, {
        route: "strip",
        turning: false,
        playerPosition: 0,
        playerSpeed: 0,
      });
      s = advanceMotor(s, { ...controls, steer: 0 }, tune);
      replay = advanceMotor(replay, { ...controls, steer: 0 }, tune);
      if (t % 13 === 0) replay = structuredClone(replay);
    }
    assert.deepEqual(s, replay);
    assert.ok(s.position >= 5120 && !s.broken);
    const slowed = slowMotor(s, 12, tune);
    assert.equal(slowed.speed, 12);
    assert.ok(slowed.rpm < s.rpm);
    assert.ok(isMotorState(slowed));
    assert.equal(isMotorState({ ...slowed, extra: {} }), false);
    assert.equal(isMotorState({ ...slowed, engaged: false }), false);
  }
});

test("original bracket start handicap and breakout outcome for both finishing orders", () => {
  const values = [140, 170, 205, 250];
  const outcomes = [false, true].flatMap((ahead) =>
    values.flatMap((dial) =>
      values.map((actual) => bracketAdvance(ahead, dial, actual)),
    ),
  );
  const delays = values.flatMap((dial) =>
    values.map((other) => bracketDelay(dial, other)),
  );
  assert.equal(
    digest(outcomes),
    "ff8a18bcf380b179070294456ad22b6b6c9c841e773af97184f44961b83ebe21",
  );
  assert.equal(
    digest(delays),
    "715b4e89119da788b6fb248ab820cf83e7ce9c72f393bfb08be8a5c092902127",
  );
});
