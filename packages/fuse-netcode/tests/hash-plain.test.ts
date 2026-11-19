import assert from "node:assert/strict";
import test from "node:test";
import { hashPlain } from "../src/index.js";

test("plain data keeps the desync digests recorded by both games", () => {
  assert.equal(hashPlain({}), "1b87f0ac0fef2272");
  assert.equal(
    hashPlain({
      text: "ø🧪",
      numbers: [-0, NaN, Infinity, 0.1 + 0.2],
      flags: [null, true, false],
    }),
    "679276dfeaf484e7",
  );
  assert.equal(
    hashPlain(
      new Map<string, unknown>([
        ["z", [1, 2]],
        ["a", "before z"],
        ["drop", undefined],
      ]),
    ),
    "4437f7f0ea426975",
  );
  assert.equal(
    hashPlain({
      terrain: new Uint32Array([0, 1, 4294967295]),
      state: new Uint8Array([1, 2, 255]),
    }),
    "8e4170b4568f0afe",
  );
});

test("desync hashes normalize key order, absent fields, negative zero and NaN", () => {
  assert.equal(
    hashPlain({ a: 1, b: [2, "x"] }),
    hashPlain({ b: [2, "x"], a: 1 }),
  );
  assert.equal(
    hashPlain(
      new Map([
        ["a", "a"],
        ["b", "b"],
      ]),
    ),
    hashPlain(
      new Map([
        ["b", "b"],
        ["a", "a"],
      ]),
    ),
  );
  assert.equal(hashPlain({ a: 1, gone: undefined }), hashPlain({ a: 1 }));
  assert.equal(hashPlain(-0), hashPlain(0));
  assert.equal(hashPlain(NaN), hashPlain(0 / 0));
});

test("desync hashes distinguish types, exact float bits and nested values", () => {
  assert.notEqual(hashPlain(0.1 + 0.2), hashPlain(0.3));
  assert.notEqual(
    hashPlain(new Uint32Array([1, 2])),
    hashPlain(new Uint32Array([1, 3])),
  );
  assert.notEqual(hashPlain(new Uint32Array([1, 2])), hashPlain([1, 2]));
  assert.equal(hashPlain(new Uint8Array([1, 2])), hashPlain([1, 2]));
  assert.notEqual(hashPlain([1, [2]]), hashPlain([[1], 2]));
  assert.notEqual(hashPlain("1"), hashPlain(1));
  assert.notEqual(hashPlain([null, true, "x"]), hashPlain([null, false, "x"]));
  assert.notEqual(hashPlain({ a: 1, events: [1] }), hashPlain({ a: 1 }));
});

test("desync hashes reject functions and maps with non-string keys", () => {
  assert.throws(() => hashPlain({ f: () => 0 }), TypeError);
  assert.throws(() => hashPlain(new Map([[1, 1]])), TypeError);
});
