import assert from "node:assert/strict";
import test from "node:test";
import { createWorkshop, validMachine } from "../src/game/machine.js";
import { MAX_TIM_BYTES, parseTimWorkshop } from "../src/game/tim-import.js";

const NIL = 65535;
type Pair = [number, number];
interface DiskPart {
  type: number;
  position?: Pair;
  size?: Pair;
  flags?: number;
  belt?: Pair;
  rope?: [number, number, number, number];
  adjacent?: Pair;
  plugs?: Pair;
  owner?: number;
}
/** Small synthetic byte records, independent of the private DOS save files. */
function file(records: DiskPart[], moving = 0): Uint8Array {
  const words = [0xaced, 0x102, 67, 272, 0, records.length - moving, moving, 0];
  for (const p of records) {
    const size = p.size ?? [16, 16];
    words.push(
      p.type,
      0,
      p.flags ?? 0,
      0,
      0,
      0,
      ...size,
      ...size,
      ...(p.position ?? [40, 60]),
      0,
      p.belt ? 1 : 0,
      0,
      0,
      ...(p.belt ?? []),
    );
    if (p.rope) {
      const [a, b, slotA, slotB] = p.rope;
      words.push(1, 0, a, b, slotA | (slotB << 8));
    } else words.push(0, 0);
    words.push(0, 0, ...(p.adjacent ?? [NIL, NIL]), ...(p.plugs ?? [NIL, NIL]));
    if (p.type === 7) words.push(p.owner ?? NIL);
  }
  const buffer = new Uint8Array(words.length * 2);
  const view = new DataView(buffer.buffer);
  words.forEach((word, i) => view.setUint16(i * 2, word, true));
  return buffer;
}

test("imports view geometry, flips, atmosphere and unique electrical and drive connections", () => {
  const bytes = file(
    [
      { type: 5, size: [52, 17], position: [20, 30] },
      { type: 21, plugs: [2, NIL] },
      { type: 50, plugs: [NIL, 1], flags: 0x10 },
      { type: 8, belt: [2, 0] },
      { type: 9 },
    ],
    1,
  );
  const { blueprint, warnings } = parseTimWorkshop(bytes);
  assert.equal(blueprint.air, 67);
  assert.equal(blueprint.gravity, 272);
  assert.deepEqual(blueprint.parts[0], {
    id: 1,
    kind: "belt",
    width: 52,
    height: 17,
    x: 46,
    y: 38.5,
    flip: false,
    fixed: false,
    mobile: false,
  });
  assert.equal(blueprint.parts[2]?.flip, true);
  assert.equal(blueprint.parts.at(-1)?.mobile, true);
  assert.deepEqual(blueprint.links, [
    { kind: "wire", a: 2, b: 3 },
    { kind: "belt", a: 1, b: 3 },
  ]);
  assert.ok(validMachine(createWorkshop(blueprint)));
  assert.ok(warnings.length > 0);
});

test("routes both segments of a pull cord through the serialized pulley", () => {
  const layout: DiskPart[] = [
    { type: 31, adjacent: [1, NIL] },
    { type: 7, owner: 3, adjacent: [2, 0] },
    { type: 3, adjacent: [NIL, 1] },
    { type: 10, rope: [0, 2, 0, 1] },
  ];
  const { blueprint } = parseTimWorkshop(file(layout));
  assert.deepEqual(blueprint.links, [
    { kind: "rope", a: 1, b: 2 },
    { kind: "rope", a: 2, b: 3 },
  ]);
  assert.ok(validMachine(createWorkshop(blueprint)));
  assert.throws(
    () =>
      parseTimWorkshop(
        file([layout[0]!, { ...layout[1]!, owner: 2 }, ...layout.slice(2)]),
      ),
    /route/,
  );
});

test("rejects partial records, foreign versions, invalid indices, unrepresentable connectors and oversized imports", () => {
  const source = file([{ type: 28 }]);
  for (let cut = 0; cut < source.length; cut++)
    assert.throws(() => parseTimWorkshop(source.subarray(0, cut)));
  assert.throws(
    () => parseTimWorkshop(Uint8Array.from([...source, 0])),
    /follows/,
  );
  const foreign = source.slice();
  foreign[2] = 3;
  assert.throws(() => parseTimWorkshop(foreign), /v1.02/);
  assert.throws(() => parseTimWorkshop(file([{ type: 400 }])), /type 400/);
  assert.throws(
    () => parseTimWorkshop(file([{ type: 8, belt: [0, 7] }])),
    /missing part/,
  );
  assert.throws(
    () => parseTimWorkshop(file([{ type: 8, belt: [0, NIL] }])),
    /loose end/,
  );
  assert.throws(
    () => parseTimWorkshop(file([{ type: 9, plugs: [1, NIL] }, { type: 1 }])),
    /sockets/,
  );
  assert.throws(
    () => parseTimWorkshop(file([{ type: 4, position: [1600, 20] }])),
    /outside/,
  );
  assert.throws(
    () => parseTimWorkshop(new Uint8Array(MAX_TIM_BYTES + 1)),
    /limit/,
  );
});
