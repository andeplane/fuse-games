import { INPUT_JUMP, INPUT_LEFT, INPUT_RIGHT } from "../game/simulation.js";

const bindings = [
  { bit: INPUT_LEFT, label: "Left", keys: ["ArrowLeft", "KeyA"] },
  { bit: INPUT_RIGHT, label: "Right", keys: ["ArrowRight", "KeyD"] },
  { bit: INPUT_JUMP, label: "Jump", keys: ["Space", "ArrowUp", "KeyW"] },
] as const;

export const touchControls = bindings.map(({ label }) => ({
  keys: label,
  action:
    label === "Jump"
      ? "Jump and bonk overhead platforms"
      : "Move " + label.toLowerCase(),
}));
export const controls = [
  { keys: "← → / A D", action: "Move. Keep steering in midair." },
  {
    keys: "Space / ↑ / W",
    action: "Jump. Hit a platform from underneath to stun pests on top.",
  },
];
export const coopControls = [
  { keys: "Player 1 · A D / W", action: "Move and jump" },
  { keys: "Player 2 · ← → / ↑", action: "Move and jump" },
];
export const goal =
  "Bump pests from below, then walk into them to kick them away before they wake. Clear every pest to advance.";
export const padBindings = bindings;

/** Track independent fingers and physical keys so releasing one binding never releases another. */
export function createInputs(
  localPair: boolean,
  send: (mask: number, slot: number) => void,
) {
  const held = new Map<string, { bit: number; slot: number }>();
  const mask = (slot: number) =>
    [...held.values()].reduce(
      (bits, entry) => (entry.slot === slot ? bits | entry.bit : bits),
      0,
    );
  function set(source: string, slot: number, bit: number, down: boolean) {
    const before = mask(slot);
    if (down) held.set(source, { slot, bit });
    else held.delete(source);
    const after = mask(slot);
    if (before !== after) send(after, slot);
  }
  return {
    key(code: string, down: boolean) {
      const binding = bindings.find(({ keys }) =>
        keys.some((key) => key === code),
      );
      if (!binding) return false;
      set(
        code,
        localPair && code.startsWith("Arrow") ? 1 : 0,
        binding.bit,
        down,
      );
      return true;
    },
    touch(bit: number, down: boolean) {
      set("touch-" + bit, 0, bit, down);
    },
    clear() {
      const slots = new Set([...held.values()].map((entry) => entry.slot));
      held.clear();
      slots.forEach((slot) => send(0, slot));
    },
  };
}
