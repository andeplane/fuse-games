import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  deterministicViolations,
  imports,
  sourceFiles,
  syntax,
} from "../../../tests/fixtures/source-guards.js";

const game = fileURLToPath(new URL("../", import.meta.url));
const engine = path.join(game, "src/engine");

const inside = (base: string, target: string) => {
  const relative = path.relative(base, target);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
};

test("the engine imports nothing outside its own folder, and nothing in the game imports a package", () => {
  const files = sourceFiles(path.join(game, "src"));
  assert.ok(files.some((file) => inside(engine, file)));
  for (const file of files)
    for (const specifier of imports(syntax(file))) {
      assert.ok(
        specifier.startsWith("."),
        `${file}: imports ${specifier}, and the game is headless and self-contained`,
      );
      const target = path.resolve(path.dirname(file), specifier);
      assert.ok(
        inside(path.join(game, "src"), target),
        `${file}: ${specifier} leaves the game`,
      );
      if (inside(engine, file))
        assert.ok(
          inside(engine, target),
          `${file}: the engine imports ${specifier}`,
        );
    }
});

test("the bot and the terminal client reach the engine through its index only", () => {
  for (const folder of ["src/bots", "src/cli"])
    for (const file of sourceFiles(path.join(game, folder)))
      for (const specifier of imports(syntax(file))) {
        const target = path.resolve(path.dirname(file), specifier);
        if (inside(engine, target))
          assert.equal(
            path.basename(target),
            "index.js",
            `${file}: reaches into the engine's ${path.basename(target)}`,
          );
      }
});

test("the engine keeps to deterministic whole-number arithmetic: no clock, no Math, no floating division", () => {
  for (const file of sourceFiles(engine)) {
    const source = syntax(file);
    assert.deepEqual(deterministicViolations(source), [], file);
    const code = source.text.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
    assert.doesNotMatch(code, /\bMath\./, file);
    assert.doesNotMatch(code, /\bDate\b|\bperformance\b/, file);
    // Division is `div` and `ceilDiv` in math.ts and nowhere else.
    if (path.basename(file) !== "math.ts")
      assert.doesNotMatch(
        code,
        /[\w)\]]\s\/\s[\w(]/,
        `${file}: divides outside math.ts`,
      );
  }
});
