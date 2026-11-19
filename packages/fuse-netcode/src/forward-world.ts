interface TickInputs<Held> {
  steps: number;
  heldAt(step: number): Held;
}

export interface ForwardWorldOptions<World, Held, Inputs> {
  copy(world: World): World;
  beginTick(world: World, inputs: Inputs): TickInputs<Held>;
  step(world: World, held: Held): void;
  decided(committed: World, speculative: World): boolean;
  canStep?(world: World): boolean;
}

interface ForwardSample<World> {
  copy: World;
  next?: World;
  part: number;
}

/** Play copies to the presentation clock. Outcomes only appear after the room folds them. */
export function forwardWorld<World, Held, Inputs>(
  world: World,
  ahead: number,
  inputs: Inputs,
  options: ForwardWorldOptions<World, Held, Inputs>,
): ForwardSample<World> {
  const ticks = Number.isFinite(ahead) ? Math.max(0, ahead) : 0;
  const first = run(world, ticks, inputs, options, Infinity);
  return first.crossed
    ? run(world, ticks, inputs, options, first.taken - 1)
    : first;
}

interface Run<World> extends ForwardSample<World> {
  taken: number;
  crossed: boolean;
}

const always = () => true;

function run<World, Held, Inputs>(
  world: World,
  ahead: number,
  inputs: Inputs,
  {
    copy: clone,
    beginTick,
    step,
    decided,
    canStep = always,
  }: ForwardWorldOptions<World, Held, Inputs>,
  limit: number,
): Run<World> {
  const copy = clone(world);
  let taken = 0;
  for (let left = ahead; left > 0; left -= 1) {
    const tick = beginTick(copy, inputs);
    const steps = Math.min(1, left) * tick.steps;
    const whole = Math.floor(steps);
    for (let i = 0; i < whole; i++) {
      if (taken >= limit || !canStep(copy))
        return { copy, taken, part: 0, crossed: false };
      step(copy, tick.heldAt(i));
      taken++;
      if (decided(world, copy)) return { copy, taken, part: 0, crossed: true };
    }
    const part = steps - whole;
    if (left <= 1 && part > 0.001 && taken < limit && canStep(copy)) {
      const held = tick.heldAt(whole);
      const next = clone(copy);
      step(next, held);
      if (!decided(world, next))
        return { copy, taken, next, part, crossed: false };
    }
  }
  return { copy, taken, part: 0, crossed: false };
}
