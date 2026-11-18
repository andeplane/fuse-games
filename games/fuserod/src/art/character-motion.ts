// A step in Bob's two 77-step passes lasts five PC timer interrupts.
// The ending has 98 presented compositions. Presentation 62 switches the car sheet.
export const HOP_STEP_MS = (5 * 16384 * 1000) / 1193182;
export const END_STEP_MS = HOP_STEP_MS * 2;
export const END_FRAMES = 98;
const HOLD = 30;
const IDLE = 48;
export function carhopPose(tick: number) {
  const beat = tick % (154 + HOLD + IDLE);
  if (beat < 77) {
    const frame = beat < 72 ? 5 - (beat % 6) : beat - 66;
    return { returning: false, frame, progress: Math.min(1, beat / 71) };
  }
  if (beat < 77 + HOLD) return { returning: false, frame: 10, progress: 1 };
  const step = beat - 77 - HOLD;
  if (step >= 77) return undefined;
  return {
    returning: true,
    frame: step < 3 ? step : 3 + ((step - 3) % 7),
    progress: Math.max(0, (step - 3) / 73),
  };
}
