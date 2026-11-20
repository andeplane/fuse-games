import {
  clamp,
  hash,
  noise,
  type ChartProfile,
  type Note,
  type Row,
  type Song,
  type Tuning,
} from "./chart-shape.js";
import { ARROWS, speedOf, type Reference } from "./reference.js";
import {
  jumpCost,
  prepareJumpLandings,
  priors,
  stepCost,
  type Landing,
  type State,
  type StepScoring,
} from "./chart-step-cost.js";

const MIRROR = [3, 1, 2, 0] as const;

/** A draw from the Gumbel distribution: added to log-likelihoods, the best choice is a fair sample of them. */
const gumbel = (uniform: number): number =>
  -Math.log(-Math.log(clamp(uniform, 1e-9, 1 - 1e-9)));

function mirrorBar(bar: readonly (readonly number[])[]): number[][] {
  return bar.map((columns) =>
    columns.map((column) => MIRROR[column]!).sort((a, b) => a - b),
  );
}

/** Match repeated bars to arrows already selected earlier in the same phrase. */
function phraseEcho(
  song: Song,
  rows: readonly Row[],
  seed: number,
  echo: number,
) {
  const { perBar } = song;
  const barOf = (at: number): number => Math.floor(rows[at]!.slot / perBar);
  const signature = new Map<number, string>();
  const firstRow = new Map<number, number>();
  rows.forEach((row, at) => {
    const bar = barOf(at);
    if (!firstRow.has(bar)) firstRow.set(bar, at);
    signature.set(
      bar,
      `${signature.get(bar) ?? ""}${row.slot % perBar}${row.jump ? "j" : ""},`,
    );
  });
  /** Arrows remembered for a bar signature within the current eight-bar phrase. */
  let memory = new Map<string, number[][]>();
  let memoryPhrase = -1;
  let echoStart = 0;
  let echoed: readonly (readonly number[])[] = [];

  /** The arrows of rows `from` to `to` on the path that ends in `state` after row `to`. */
  const pathColumns = (state: State, from: number, to: number): number[][] => {
    const out: number[][] = [];
    let walk: State | undefined = state;
    for (let at = to; at >= from && walk; at--, walk = walk.previous)
      out.unshift([...walk.columns]);
    return out;
  };

  return (at: number, best: () => State): readonly number[] | undefined => {
    const bar = barOf(at);
    if (firstRow.get(bar) !== at) return echoed[at - echoStart];
    // The bar before is settled enough to remember; then see whether this bar repeats one.
    const phrase = Math.floor((bar - song.analysis.phrase + 8) / 8);
    if (phrase !== memoryPhrase) {
      memory.clear();
      memoryPhrase = phrase;
    } else if (at > 0) {
      const previousBar = barOf(at - 1);
      const key = signature.get(previousBar)!;
      if (!memory.has(key))
        memory.set(
          key,
          pathColumns(best(), firstRow.get(previousBar)!, at - 1),
        );
    }
    const found = memory.get(signature.get(bar)!);
    echoStart = at;
    if (!found || found.length < 3 || noise(seed, bar, 5) >= echo) {
      echoed = [];
    } else {
      // The mirror image comes a little more often than the same arrows.
      echoed = noise(seed, bar, 7) < 0.55 ? mirrorBar(found) : found;
    }
    return echoed[0];
  };
}

interface BeamRow {
  row: Row;
  jumps: readonly Landing[];
  jumpHoldFoot: number;
  restCost: number;
  stepScoring: StepScoring;
}

interface BeamMove {
  cost: number;
  left: number;
  right: number;
  foot: number;
  columns: readonly number[];
}

type PushMove = (move: BeamMove) => void;

function advanceBeamState(
  state: State,
  context: BeamRow,
  holding: boolean,
  move: BeamMove,
): State {
  const { row } = context;
  const { cost, left, right, foot, columns } = move;
  const single = columns.length === 1;
  const holdFoot = single ? foot : context.jumpHoldFoot;
  const startsHold = row.holdEnd !== undefined;
  const heldFoot = holding ? state.holding : -1;
  const heldEnd = holding ? state.holdEnd : -1;
  const column = single ? columns[0]! : -1;
  const uses: [number, number, number, number] = [...state.uses];
  for (const used of columns) uses[used]!++;
  return {
    left,
    right,
    foot,
    recent: [column, state.recent[0], state.recent[1]],
    trill:
      single && column === state.recent[1] && column !== state.recent[0]
        ? state.trill + 1
        : 0,
    jacks: single && column === state.recent[0] ? state.jacks + 1 : 0,
    holding: startsHold ? holdFoot : heldFoot,
    holdEnd: row.holdEnd ?? heldEnd,
    uses,
    lastJump: single ? state.lastJump : columns[0]! * 4 + columns[1]!,
    cost: state.cost + cost,
    columns,
    holdColumn: startsHold ? [left, right][holdFoot]! : -1,
    previous: state,
  };
}

function addJumps(
  state: State,
  context: BeamRow,
  usageDenominator: number,
  push: PushMove,
): void {
  const {
    jumps,
    stepScoring: { tuning },
  } = context;
  for (const landing of jumps) {
    const { left, right, columns } = landing;
    push({
      cost: jumpCost(landing, state, tuning, usageDenominator),
      left,
      right,
      columns,
      foot: 1 - state.foot,
    });
  }
}

/** Try repeating the current arrow or moving the foot when the row allows it. */
function addSteps(
  state: State,
  context: BeamRow,
  foot: number,
  moveCost: number,
  usageDenominator: number,
  push: PushMove,
): void {
  const leftFoot = foot === 0;
  const from = leftFoot ? state.left : state.right;
  const other = leftFoot ? state.right : state.left;
  for (let column = 0; column < ARROWS.length; column++) {
    const extra = column === from ? 0 : moveCost;
    if (extra < 0) continue;
    const left = leftFoot ? column : state.left;
    const right = leftFoot ? state.right : column;
    const cost = stepCost(
      state,
      { from, other, column, left, right },
      context.stepScoring,
      usageDenominator,
    );
    if (cost !== undefined)
      push({ cost: cost + extra, left, right, foot, columns: [column] });
  }
}

function expandBeamState(next: State[], state: State, context: BeamRow) {
  const { row } = context;
  const holding = state.holding >= 0 && row.slot <= state.holdEnd;
  const usageDenominator =
    state.uses[0] + state.uses[1] + state.uses[2] + state.uses[3] + 6;
  const push: PushMove = (move) =>
    next.push(advanceBeamState(state, context, holding, move));
  if (row.jump && !holding) {
    addJumps(state, context, usageDenominator, push);
    return;
  }
  if (holding) {
    addSteps(state, context, 1 - state.holding, 0.25, usageDenominator, push);
    return;
  }
  addSteps(state, context, 1 - state.foot, 0, usageDenominator, push);
  addSteps(
    state,
    context,
    state.foot,
    context.restCost,
    usageDenominator,
    push,
  );
}

const BEAM = 20;

/** A dense key for four arrows, either foot, two recent arrows and the optional hold foot. */
function beamKey(state: State): number {
  const feet = (state.left * 4 + state.right) * 2 + state.foot;
  const recent = (feet * 5 + state.recent[0] + 1) * 5 + state.recent[1] + 1;
  return recent * 3 + state.holding + 1;
}

function keepBeam(next: State[]): State[] {
  next.sort((a, b) => a.cost - b.cost);
  // Keep the cheapest few, at most one per position of the feet.
  const seen = new Set<number>();
  const beam: State[] = [];
  for (const state of next) {
    const key = beamKey(state);
    if (seen.has(key)) continue;
    seen.add(key);
    beam.push(state);
    if (beam.length >= BEAM) break;
  }
  return beam;
}

function planSteps(
  song: Song,
  rows: readonly Row[],
  seed: number,
  tuning: Tuning,
  reference: Reference,
) {
  return {
    song,
    rows,
    seed,
    tuning,
    prior: priors(reference),
    jumpLandings: prepareJumpLandings(reference),
    afterJumpIn: reference.tables.after_jump?.in ?? 0.42,
  };
}

function contour(
  song: Song,
  current: number,
  previous: Row | undefined,
): number {
  if (!previous) return 0;
  const now = song.pitch[current]!;
  const before = song.pitch[previous.slot]!;
  if (now === 0 || before === 0) return 0;
  return now - before >= 2 ? 1 : before - now >= 2 ? -1 : 0;
}

/** Build per-row scoring once for all candidates in the beam. */
function prepareBeamRow(
  plan: ReturnType<typeof planSteps>,
  at: number,
  wanted: readonly number[] | undefined,
): BeamRow {
  const { song, rows, seed, tuning, prior, jumpLandings, afterJumpIn } = plan;
  const { slotsPerBeat } = song;
  const row = rows[at]!;
  const before = at > 0 ? rows[at - 1]!.slot : row.slot - 4 * slotsPerBeat;
  const gapBeats = (row.slot - before) / slotsPerBeat,
    gapSeconds = song.seconds[row.slot]! - song.seconds[Math.max(0, before)]!;
  const speed = speedOf(gapBeats);
  const stepScoring: StepScoring = {
    gapBeats,
    gapSeconds,
    direction: contour(song, row.slot, rows[at - 1]),
    prior: prior[speed],
    // If the previous step was at this speed too, the last two arrows predict the next.
    chained:
      at >= 2 &&
      speedOf((before - rows[at - 2]!.slot) / slotsPerBeat) === speed,
    wanted,
    tuning,
    afterJumpIn,
    sample: Array.from(ARROWS, (_, column) =>
      gumbel(noise(seed, row.slot, column)),
    ),
  };
  const jumps = row.jump
    ? jumpLandings.map((landing) => ({
        ...landing,
        sample: gumbel(noise(seed, row.slot, landing.key, 9)),
        echo:
          wanted?.length === 2 &&
          wanted[0] === landing.columns[0] &&
          wanted[1] === landing.columns[1],
      }))
    : [];
  const jumpHoldFoot = noise(seed, row.slot, 11) < 0.5 ? 0 : 1;
  const restCost = gapBeats >= 2 ? 0.4 : gapBeats >= 1 ? 1.5 : -1;
  return { row, jumps, jumpHoldFoot, stepScoring, restCost };
}

/** The arrows of every row. */
export function placeSteps(
  song: Song,
  profile: ChartProfile,
  rows: readonly Row[],
): Note[] {
  const { difficulty, tuning, reference } = profile;
  const seed = hash(`${song.analysis.id}/${difficulty}`);
  const plan = planSteps(song, rows, seed, tuning, reference);
  const echoed = phraseEcho(song, rows, seed, tuning.echo);

  const start: State = {
    left: 0,
    right: 3,
    foot: noise(seed, 1) < 0.5 ? 0 : 1,
    recent: [-1, -1, -1],
    trill: 0,
    jacks: 0,
    holding: -1,
    holdEnd: -1,
    uses: [0, 0, 0, 0],
    lastJump: -1,
    cost: 0,
    columns: [],
    holdColumn: -1,
    previous: undefined,
  };
  let beam: State[] = [start];
  const best = (): State => beam.reduce((a, b) => (b.cost < a.cost ? b : a));
  for (let at = 0; at < rows.length; at++) {
    const context = prepareBeamRow(plan, at, echoed(at, best));
    const next: State[] = [];
    for (const state of beam) expandBeamState(next, state, context);
    if (next.length === 0)
      throw new Error(
        `${song.analysis.id} ${difficulty}: no way to step row ${at} (slot ${context.row.slot})`,
      );
    beam = keepBeam(next);
  }

  return writeNotes(rows, best());
}

function writeNotes(rows: readonly Row[], best: State): Note[] {
  const notes: Note[] = [];
  let walk: State | undefined = best;
  for (let at = rows.length - 1; at >= 0 && walk; at--, walk = walk.previous) {
    const row = rows[at]!;
    for (const column of walk.columns)
      notes.push(
        row.holdEnd !== undefined && column === walk.holdColumn
          ? { slot: row.slot, column, kind: "hold", endSlot: row.holdEnd }
          : { slot: row.slot, column, kind: "tap" },
      );
  }
  return notes.sort((a, b) => a.slot - b.slot || a.column - b.column);
}
