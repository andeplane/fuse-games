import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function tournament(output: string, maps: string, extra: string[]): string {
  const args = [
    "--import",
    "tsx",
    "scripts/fuse-craft-tournament.ts",
    "--maps",
    maps,
    "--seconds",
    "1",
    "--strategies",
    "balanced",
    "--out",
    output,
  ];
  return execFileSync(process.execPath, [...args, ...extra], {
    encoding: "utf8",
    stdio: "pipe",
  });
}

test("tournament resumes missing seats without replacing results or mixing configurations", () => {
  const output = mkdtempSync(join(tmpdir(), "fuse-tournament-"));
  const run = (extra: string[] = []) =>
    tournament(output, "close-quarters", extra);
  try {
    run();
    const path = join(output, "results.jsonl");
    const original = readFileSync(path, "utf8");
    assert.equal(original.trim().split("\n").length, 2);
    assert.throws(() => run(), /Output already exists/);
    writeFileSync(path, original.split("\n")[0] + "\n");
    assert.match(run(["--resume"]), /Resuming 1 completed matches/);
    assert.equal(readFileSync(path, "utf8"), original);
    assert.match(run(["--resume"]), /Resuming 2 completed matches/);
    assert.equal(readFileSync(path, "utf8"), original);
    const manifestPath = join(output, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, seconds: 2 }));
    assert.throws(() => run(["--resume"]), /configuration differs/);
    assert.equal(readFileSync(path, "utf8"), original);
    writeFileSync(
      manifestPath,
      JSON.stringify({
        ...manifest,
        harnessVersion: manifest.harnessVersion + 1,
      }),
    );
    assert.throws(() => run(["--resume"]), /configuration differs/);
    writeFileSync(
      manifestPath,
      JSON.stringify({ ...manifest, simulationDirty: "engine changed" }),
    );
    assert.throws(() => run(["--resume"]), /original run is dirty/);
    writeFileSync(manifestPath, JSON.stringify(manifest));
    writeFileSync(path, original + original.split("\n")[0] + "\n");
    assert.throws(() => run(["--resume"]), /invalid or duplicate result/);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test("resume accepts only the matches selected by a legacy all-prefixed map list", () => {
  const output = mkdtempSync(join(tmpdir(), "fuse-tournament-map-list-"));
  const run = (extra: string[] = []) =>
    tournament(output, "all,close-quarters", extra);
  try {
    run();
    const results = join(output, "results.jsonl");
    const original = readFileSync(results, "utf8");
    const rows = original
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      rows.map((row) => row.key),
      [
        "close-quarters-balanced-balanced-0",
        "close-quarters-balanced-balanced-1",
      ],
    );
    writeFileSync(
      results,
      original +
        JSON.stringify({ ...rows[0], key: "open-front-balanced-balanced-0" }) +
        "\n",
    );
    assert.throws(() => run(["--resume"]), /invalid or duplicate result/);
    writeFileSync(results, original);
    assert.match(run(["--resume"]), /Resuming 2 completed matches/);
    assert.equal(readFileSync(results, "utf8"), original);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
