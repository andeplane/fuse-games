import { INPUT_MASK, KEY } from "../game/canal.js";
import { playtestInputBlocked } from "fuse-ui/playtest-input";
import { tacticalMapControls } from "./map-controls.js";
import {
  bindings,
  CAMERA,
  standardPadBits,
  shoulderControls,
} from "./bindings.js";
export { CONTROLS, TOUCH_CONTROLS } from "./bindings.js";
export function createControls(
  send: (bits: number) => void,
  active: () => boolean,
  changeCamera: () => void,
) {
  const pad = document.createElement("div");
  pad.className = "dockside-controls";
  const held = new Map<string, number>(),
    shoulders = shoulderControls(),
    map = tacticalMapControls();
  const binds = new Map(
    bindings.flatMap((b) => b.codes.map((code) => [code, b.bit] as const)),
  );
  let previous = 0,
    sent = 0,
    controller = 0,
    blockedPad = false;
  function emit(bits: number) {
    if (bits !== sent) {
      sent = bits;
      send(bits);
    }
  }
  function publish(cancelled = 0) {
    const raw = [...held.values()].reduce((a, b) => a | b, controller);
    const routed = map.read(raw);
    if (routed & ~previous & CAMERA) changeCamera();
    previous = raw;
    if (map.open) {
      shoulders.clear();
      emit(0);
      return;
    }
    const bits = shoulders.read(routed & INPUT_MASK, cancelled);
    emit(bits);
    if (bits & (KEY.launch | KEY.lock)) emit(bits & ~(KEY.launch | KEY.lock));
  }
  function release() {
    held.clear();
    shoulders.clear();
    map.read(0);
    previous = 0;
    controller = 0;
    blockedPad = true;
    emit(0);
  }
  const available = () =>
    active() &&
    !document.hidden &&
    !document.querySelector("dialog[open]") &&
    !playtestInputBlocked(document);
  function poll() {
    if (!available() || !document.hasFocus()) {
      if (previous || controller) release();
      return;
    }
    const gamepad = Array.from(navigator.getGamepads?.() ?? []).find(
      (p) => p?.connected && p.mapping === "standard",
    );
    const bits = gamepad ? standardPadBits(gamepad) : 0;
    if (!gamepad && controller) {
      shoulders.clear();
    }
    if (blockedPad && bits) return;
    blockedPad = false;
    if (bits !== controller) {
      controller = bits;
      publish();
    }
  }
  function keydown(e: KeyboardEvent) {
    const bit = binds.get(e.code);
    if (
      !bit ||
      !available() ||
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      e.target instanceof HTMLButtonElement
    )
      return;
    e.preventDefault();
    if (!held.has(e.code) && !e.repeat) {
      held.set(e.code, bit);
      publish();
    }
  }
  function keyup(e: KeyboardEvent) {
    if (held.delete(e.code)) {
      e.preventDefault();
      publish();
    }
  }
  for (const indexes of [
    [2, 0, 3, 4, 1, 5],
    [6, 7, 8, 9, 10, 11, 12, 13, 14],
  ]) {
    const box = document.createElement("div");
    pad.append(box);
    for (const i of indexes) {
      const { bit, touch, action } = bindings[i]!;
      const b = document.createElement("button");
      b.className = "fui-button";
      b.textContent = touch;
      if (bit === CAMERA) b.classList.add("dockside-camera-control");
      b.setAttribute("aria-label", action);
      box.append(b);
      b.onpointerdown = (e) => {
        if (!available()) return;
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        held.set("p" + e.pointerId, bit);
        publish();
      };
      b.onpointerup = (e) => {
        if (held.delete("p" + e.pointerId)) publish();
      };
      b.onpointercancel = b.onlostpointercapture = (e) => {
        if (held.delete("p" + e.pointerId)) publish(bit);
      };
      b.onclick = (e) => {
        if (!e.detail && available()) {
          held.set("a", bit);
          publish();
          held.delete("a");
          publish();
        }
      };
    }
  }
  const visibility = () => {
    if (document.hidden) release();
  };
  document.addEventListener("keydown", keydown);
  document.addEventListener("keyup", keyup);
  window.addEventListener("blur", release);
  document.addEventListener("visibilitychange", visibility);
  return {
    pad,
    map,
    release,
    resetMatch() {
      release();
      map.reset();
    },
    poll,
    dispose() {
      release();
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", visibility);
    },
  };
}
