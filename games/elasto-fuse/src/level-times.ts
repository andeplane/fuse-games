import {
  FINISHED,
  RACE_LIMIT,
  RULES,
  createWorld,
  isInput,
  isLevel,
  levelOf,
  stepRider,
} from "./engine/index.js";

export type InputChange = [step: number, bits: number];

export interface LevelRun {
  rules: string;
  level: number;
  steps: number;
  inputs: readonly InputChange[];
}

export interface LevelTime {
  name: string;
  steps: number;
}

/** Replay a bounded solo trace and derive its finishing time. The client never submits a rank or time. */
export function verifiedTime(raw: unknown): number | undefined {
  if (!raw || typeof raw !== "object") return;
  const { rules, level, steps, inputs } = raw as Partial<LevelRun>;
  if (
    rules !== RULES ||
    !isLevel(level) ||
    typeof steps !== "number" ||
    !Number.isInteger(steps) ||
    steps < 1 ||
    steps > RACE_LIMIT ||
    !Array.isArray(inputs) ||
    inputs.length > steps
  )
    return;
  let prior = -1;
  for (const change of inputs) {
    if (!Array.isArray(change) || change.length !== 2) return;
    const [at, bits] = change;
    if (!Number.isInteger(at) || at <= prior || at >= steps || !isInput(bits))
      return;
    prior = at;
  }

  const world = createWorld(["solo"], level, 0);
  const compiled = levelOf(world);
  const rider = world.riders[0]!;
  let bits = 0;
  let index = 0;
  for (let step = 0; step < steps; step++) {
    const change = inputs[index];
    if (change?.[0] === step) {
      bits = change[1];
      index++;
    }
    stepRider(world, compiled, 0, bits);
    if (rider.status === FINISHED)
      return step === steps - 1 ? rider.run : undefined;
  }
}
