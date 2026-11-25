interface LeadRequest<Stage> {
  key: string;
  identity?: object;
  start(): Stage;
  advance(previous: Stage, base: Stage, index: number): Stage | undefined;
  steps(): number;
  limit?: number;
  tolerance?: number;
}

/** A frame's step and its neighbors. The stage chain is extended only as far as the frame needs. */
export function createLeadChain<Stage extends object>() {
  let key: string | undefined,
    identity: object | undefined,
    ended = false;
  let stages: Stage[] = [];
  return ({
    key: nextKey,
    identity: nextIdentity,
    start,
    advance,
    steps,
    limit = Infinity,
    tolerance = 1e-9,
  }: LeadRequest<Stage>) => {
    if (nextKey !== key || nextIdentity !== identity) {
      const base = start();
      key = nextKey;
      identity = nextIdentity;
      stages = [base];
      ended = false;
    }
    const reach = (count: number): Stage | undefined => {
      while (stages.length <= count && !ended && stages.length <= limit) {
        const next = advance(
          stages[stages.length - 1]!,
          stages[0]!,
          stages.length - 1,
        );
        if (next === undefined) ended = true;
        else stages.push(next);
      }
      return stages[count];
    };
    const ahead = steps();
    if (!Number.isFinite(ahead)) {
      const index = stages.length - 1;
      return {
        current: stages[index]!,
        previous: stages[index - 1],
        next: undefined,
        part: 0,
      };
    }
    const whole = Math.floor(ahead + tolerance);
    const part = ahead - whole;
    const reached = reach(whole);
    const index = reached ? whole : stages.length - 1;
    const next = reached && part > 0.001 ? reach(whole + 1) : undefined;
    return { current: stages[index]!, previous: stages[index - 1], next, part };
  };
}

/** Convert a presentation clock's lead in log ticks to engine steps, using each tick's actual length. */
export function leadStepsAhead(
  ahead: number,
  counts: readonly number[],
): number {
  return counts.reduce(
    (sum, count, index) =>
      sum + Math.max(0, Math.min(1, ahead - index)) * count,
    0,
  );
}
