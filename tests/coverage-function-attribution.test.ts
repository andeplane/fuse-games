import assert from "node:assert/strict";
import { test } from "node:test";
import { attributeFunctionCoverage } from "../scripts/lib/coverage-function-attribution.js";

const declaration = "const check = (value: number) => value > 0;";
const source = [declaration, declaration, declaration, declaration].join("\n");
const start = declaration.indexOf("(");
const end = declaration.length;
const range = (line: number, from = start, to = end) => ({
  loc: { start: { line, column: from }, end: { line, column: to } },
});

test("credits a positive Node call to the matching browser function only", () => {
  const browser = [range(1), range(2), range(3)];
  const report = {
    fnMap: { 0: range(1), 1: range(2), 2: range(3), 3: range(4) },
    f: { 0: 0, 1: 0, 2: 4, 3: 0 },
    s: { 0: 0 },
    b: { 0: [0, 7] },
  };
  const hits = [
    [
      [range(1, start + 1), 12],
      [range(2, start + 1, end - 1), 8],
      [range(3, start + 1), 15],
      [range(4, start + 1), 25],
    ] as const,
  ];
  assert.equal(
    attributeFunctionCoverage("check.ts", source, report, browser, hits),
    1,
  );
  assert.deepEqual(report.f, { 0: 12, 1: 0, 2: 4, 3: 0 });
  assert.deepEqual(report.s, { 0: 0 });
  assert.deepEqual(report.b, { 0: [0, 7] });
});

test("keeps ambiguous and unexecuted ranges uncovered", () => {
  const browser = [range(1), range(2), range(3)];
  const report = {
    fnMap: { 0: range(1), 1: range(2), 2: range(3), 3: range(3) },
    f: { 0: 0, 1: 0, 2: 0, 3: 0 },
  };
  const hits = [
    [
      [range(1), 0],
      [range(2, start), 7],
      [range(2, start + 1), 2],
      [range(3, start + 1), 3],
      [range(42), 9],
    ] as const,
  ];
  assert.equal(
    attributeFunctionCoverage("check.ts", source, report, browser, hits),
    0,
  );
  assert.deepEqual(report.f, { 0: 0, 1: 0, 2: 0, 3: 0 });
});
