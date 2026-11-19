import assert from "node:assert/strict";
import test from "node:test";
import { createScene, type SceneCanvas } from "../src/render/scene.js";

test("only a changed pixel dimension resets the court canvas", () => {
  let clientWidth = 600;
  let clientHeight = 400;
  let ratio = 2;
  let width = 300;
  let height = 150;
  const writes: [string, number][] = [];
  const canvas: SceneCanvas = {
    get clientWidth() {
      return clientWidth;
    },
    get clientHeight() {
      return clientHeight;
    },
    get width() {
      return width;
    },
    set width(value) {
      width = value;
      writes.push(["width", value]);
    },
    get height() {
      return height;
    },
    set height(value) {
      height = value;
      writes.push(["height", value]);
    },
    getContext: () => null,
  };
  const scene = createScene(canvas, { pixelRatio: () => ratio });
  scene.resize();
  scene.resize();
  scene.resize();
  assert.deepEqual(writes.splice(0), [
    ["width", 1200],
    ["height", 800],
  ]);

  clientHeight = 450;
  scene.resize();
  assert.deepEqual(writes.splice(0), [["height", 900]]);

  clientWidth = 0;
  scene.resize();
  assert.deepEqual(writes.splice(0), [["width", 1]]);

  clientWidth = 600;
  ratio = 1.5;
  scene.resize();
  assert.deepEqual(writes.splice(0), [
    ["width", 900],
    ["height", 675],
  ]);
});
