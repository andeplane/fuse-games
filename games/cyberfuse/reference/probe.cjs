/* Run against an unpacked, unmodified DOS release. See dos-probes.md. */
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
require("emulators");

const [directory, scenario] = process.argv.slice(2);
const modes = [
  "extraction",
  "spawn-in-exit",
  "ordnance",
  "campaign",
  "password",
  "coop-password",
  "dogfight",
];
const fixture = ["extraction", "spawn-in-exit", "ordnance"].includes(scenario);
if (!directory || !modes.includes(scenario))
  throw Error("Usage: node probe.cjs DOS-DIRECTORY " + modes.join("|"));
const keys = {
  left: 263,
  right: 262,
  up: 265,
  down: 264,
  enter: 257,
  ctrl: 341,
  tab: 258,
  kp0: 320,
  kp2: 322,
  kp6: 326,
  kp8: 328,
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// An authored CPN v6 scenario: a central 20×20 map with clear floor. The
// western edge is the extraction zone, or the entire map for the startup probe.
function extractionCampaign() {
  const header = Buffer.alloc(292);
  header.writeInt32LE(690304);
  header.writeInt32LE(6, 4);
  header.write("Extraction probe", 8);
  header.write("Fuse", 48);
  header.write("Wait inside extraction.", 88);
  header.writeInt32LE(1, 288);
  const mission = Buffer.alloc(1324);
  mission.write("Extraction");
  mission.write("Hold position.", 60);
  const size = scenario === "dogfight" ? 8 : 20;
  for (const [offset, value] of [
    [6, size],
    [7, size],
    [12, 6],
    [13, 6],
    [14, scenario === "spawn-in-exit" ? 57 : scenario === "ordnance" ? 10 : 25],
    [15, 57],
  ])
    mission.writeInt32LE(value, 460 + 4 * offset);
  if (scenario === "extraction") {
    // Survey 1%. The game updates exploration after checking objectives on
    // its very first frame. This gives every possible spawn a pending goal.
    mission.writeInt32LE(1, 524);
    mission.write("Survey this room", 528);
    mission.writeInt32LE(4, 588);
    mission.writeInt32LE(100, 596);
    mission.writeInt32LE(1, 600);
  }
  return Buffer.concat([header, mission, Buffer.alloc(4)]);
}

// Detect displayed words using bright pixels in the game's own FONT.PX at
// runtime. No reference images or font payloads are embedded in this probe.
function readFont(buffer) {
  const glyphs = [];
  for (let p = 768; p < buffer.length;) {
    const size = buffer.readUInt16LE(p);
    p += 2;
    const glyph = buffer.subarray(p, p + size);
    p += size;
    glyphs.push(
      size
        ? {
            width: glyph.readUInt16LE(0),
            height: glyph.readUInt16LE(2),
            pixels: glyph.subarray(4),
          }
        : null,
    );
  }
  return glyphs;
}

async function main() {
  const read = (name) => fs.readFileSync(path.join(directory, name));
  assert.equal(
    createHash("sha256").update(read("CDOGS.EXE")).digest("hex"),
    "1a9420f29c7bd9c99b8c5083f583636c7b236c3f52e5ee1fba968a8d30647f1e",
  );
  const options = [
    "0 0 0 0 0 0 0 0 0",
    "0",
    "203 205 200 208 29 28",
    "0",
    "75 77 72 80 82 156",
    "15",
    "64 64 4 0",
    "0",
    ".",
    "0",
    "0 0",
    "100",
    "100",
    "100",
    "",
  ].join("\r\n");
  const file = (name, bytes) => ({
    path: name,
    contents: new Uint8Array(bytes),
  });
  const files = fs
    .readdirSync(directory)
    .filter(
      (n) =>
        /\.(EXE|PX|DSD|RAW|CPN)$/i.test(n) && (!fixture || !n.endsWith(".CPN")),
    )
    .map((n) => file(n, read(n)));
  files.push(file("OPTIONS.CNF", Buffer.from(options)));
  if (fixture) files.push(file("PROBE.CPN", extractionCampaign()));
  if (scenario === "dogfight")
    files.push(file("PROBE.DF", extractionCampaign()));
  const em = global.emulators;
  em.pathPrefix = path.dirname(require.resolve("emulators")) + "/";
  const dosboxConf =
    "[dosbox]\nmemsize=16\n[cpu]\ncore=normal\ncycles=fixed 20000\n[joystick]\njoysticktype=none\n[mixer]\nnosound=true\n[autoexec]\n@echo off\nmount c .\nc:\nCDOGS.EXE\n";
  const ci = await em.dosboxDirect([
    { dosboxConf, jsdosConf: { version: "8.5.3" } },
    ...files,
  ]);
  ci.mute();
  const glyphs = readFont(read("FONT.PX"));
  let frame = null;
  ci.events().onFrame((rgb, rgba) => {
    frame = rgb ?? rgba;
  });
  function word(text, x, y) {
    if (!frame || ci.width() !== 320) return false;
    const stride = frame.length / (320 * 200);
    for (const char of text) {
      const glyph = glyphs[char.charCodeAt(0)];
      if (!glyph) return false;
      for (let r = 0; r < glyph.height; r++)
        for (let c = 0; c < glyph.width; c++) {
          if (glyph.pixels[r * glyph.width + c] !== 255) continue;
          const i = ((y + r) * 320 + x + c) * stride;
          if (Math.max(frame[i], frame[i + 1], frame[i + 2]) < 185)
            return false;
        }
      x += glyph.width - 1;
    }
    return true;
  }
  const wait = async (label, x, y, timeout = 9500) => {
    const deadline = performance.now() + timeout;
    while (!word(label, x, y)) {
      if (performance.now() > deadline) {
        if (process.env.DOS_PROBE_DEBUG && frame) {
          const w = ci.width(),
            h = ci.height(),
            stride = frame.length / (w * h);
          const pixels = Buffer.alloc(w * h * 3);
          for (let i = 0; i < w * h; i++)
            for (let c = 0; c < 3; c++)
              pixels[3 * i + c] = frame[i * stride + c];
          fs.writeFileSync(
            process.env.DOS_PROBE_DEBUG,
            Buffer.concat([
              Buffer.from("P6\n" + w + " " + h + "\n255\n"),
              pixels,
            ]),
          );
        }
        throw Error("Missing DOS frame text: " + label + " at " + x + "," + y);
      }
      await sleep(12);
    }
    console.log("DOS " + label);
  };
  const key = async (keyName, n = 1) => {
    for (let i = 0; i < n; i++) {
      ci.sendKeyEvent(keys[keyName], true);
      await sleep(83);
      ci.sendKeyEvent(keys[keyName], false);
      await sleep(96);
    }
  };
  const both = async (a, b, n = 1) => {
    for (let i = 0; i < n; i++) {
      for (const k of [a, b]) ci.sendKeyEvent(keys[k], true);
      await sleep(83);
      for (const k of [a, b]) ci.sendKeyEvent(keys[k], false);
      await sleep(96);
    }
  };
  const hold = async (names, ms) => {
    for (const name of names) ci.sendKeyEvent(keys[name], true);
    await sleep(ms);
    for (const name of names) ci.sendKeyEvent(keys[name], false);
    await sleep(95);
  };
  async function password(code) {
    await key("down");
    await key("ctrl");
    await wait("Enter code", 50, 5);
    let cursor = 36;
    for (const next of [...code]
      .map((c) => "abcdefghijklmnopqrstuvwxyz0123456789".indexOf(c))
      .concat(36)) {
      while (next - cursor >= 10) {
        await key("down");
        cursor += 10;
      }
      while (cursor - next >= 10) {
        await key("up");
        cursor -= 10;
      }
      await key(next > cursor ? "right" : "left", Math.abs(next - cursor));
      cursor = next;
      await key("ctrl");
    }
  }
  try {
    await sleep(2100);
    await key("enter");
    await wait("v1.06", 20, 20);
    const two = scenario === "coop-password" || scenario === "dogfight";
    if (two) await key("down", scenario === "dogfight" ? 2 : 1);
    await key("enter");
    await wait(
      scenario === "dogfight" ? "Pick a dogfight scenario" : "Select campaign",
      50,
      30,
    );
    if (fixture || scenario === "dogfight") await key("down", 2);
    await key("enter");
    if (scenario !== "dogfight") {
      await wait(fixture ? "Extraction probe" : "Ogre Rampage", 50, 5);
      await sleep(650);
      await key("enter");
    }
    await wait("Done", two ? 50 : 125, 160);
    if (two) await both("ctrl", "kp0");
    else await key("ctrl");
    if (scenario !== "dogfight") {
      await wait("Start campaign", 125, 50);
      if (scenario.endsWith("password")) {
        await password(two ? "u5sahj" : "q4skdb");
        await wait("Mission 2", 50, 5);
        return;
      }
      await key("ctrl");
      await wait("Mission 1", 50, 5);
      if (scenario === "campaign") await wait("Maintain integrity", 50, 15);
      await sleep(650);
      await key("ctrl");
    }
    const x = two ? 50 : 125;
    await wait("Shotgun", x, 50);
    if (scenario === "campaign") {
      await key("ctrl");
      await wait("Knife", 125, 66);
    }
    if (two) {
      await both("down", "kp2", 12);
      await both("ctrl", "kp0");
    } else {
      await key("down", 12);
      await key("ctrl");
    }
    if (scenario === "dogfight") {
      for (let score = 1; score <= 5; score++) {
        if (score > 1) {
          await wait("Shotgun", 50, 50);
          await both("ctrl", "kp0");
        }
        await wait("500 hp", 5, 32);
        await wait("500 hp", 250, 32);
        await hold(["down", "kp8"], 1600);
        await hold(["left", "kp6"], 2200);
        await hold(["down", "kp2"], 1800);
        await hold(["right"], 1800);
        ci.sendKeyEvent(keys.right, true);
        ci.sendKeyEvent(keys.ctrl, true);
        await wait("Pickup in 5 seconds", 100, 95, 35000);
        ci.sendKeyEvent(keys.ctrl, false);
        ci.sendKeyEvent(keys.right, false);
        await wait("Pickup in 1 seconds", 100, 95);
        await wait(String(score), 60, 100);
        await wait("0", 210, 100);
        await sleep(650);
        await key("ctrl");
      }
      await wait("Winner!", 125, 100);
      return;
    }
    if (scenario === "spawn-in-exit") {
      await wait("Completed mission", 125, 50);
      await wait("Time bonus: 60 secs", 100, 100);
      return;
    }
    await wait("200 hp", 5, 32);
    if (scenario === "ordnance") {
      for (const [weapon, first, second] of [
        ["Shotgun", -5, -10],
        ["Machine gun", -11, -12],
      ]) {
        await wait(weapon, 5, 14);
        ci.sendKeyEvent(keys.ctrl, true);
        await wait("Score: " + first, 5, 23);
        const start = performance.now();
        await wait("Score: " + second, 5, 23);
        const duration = Math.round(performance.now() - start);
        ci.sendKeyEvent(keys.ctrl, false);
        console.log(weapon + " shot interval, host milliseconds:", duration);
        if (weapon === "Shotgun") await key("enter");
      }
      return;
    }
    if (scenario === "campaign") {
      await wait("Shotgun", 5, 14);
      for (const name of ["Machine gun", "Knife", "Shotgun"]) {
        await key("enter");
        await wait(name, 5, 14);
      }
      return;
    }
    ci.sendKeyEvent(keys.left, true);
    await wait("Pickup in 5 seconds", 100, 95);
    ci.sendKeyEvent(keys.left, false);
    const start = performance.now();
    for (const n of [4, 3, 2, 1])
      await wait("Pickup in " + n + " seconds", 100, 95);
    await wait("Completed mission", 125, 50);
    console.log(
      "Countdown to summary, host milliseconds:",
      Math.round(performance.now() - start),
    );
  } finally {
    await ci.exit();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
