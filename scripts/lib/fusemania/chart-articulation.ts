import {
  rhythmGrid,
  type ChartProfile,
  type Row,
  type Song,
} from "./chart-shape.js";

function jumpCandidates(
  song: Song,
  profile: ChartProfile,
  slots: readonly number[],
) {
  const { difficulty, tuning } = profile;
  const { slotsPerBeat, perBar } = song;
  const { phraseOffset, levelOf, beatGap } = rhythmGrid(song);
  const gaps = slots.map((slot, at) => {
    const before = at > 0 ? beatGap(slot, slots[at - 1]!) : 8;
    const after = at + 1 < slots.length ? beatGap(slot, slots[at + 1]!) : 8;
    return { clear: Math.min(before, after), wide: Math.max(before, after) };
  });
  // Jumps on the accents: kick and snare or cymbal together, the more so on a bar line and a phrase start.
  const accent = (slot: number): number => {
    const bar = Math.floor(slot / perBar);
    const drums =
      0.5 * (song.low[slot]! + Math.max(song.mid[slot]!, song.high[slot]!));
    return (
      drums +
      (slot % perBar === 0 ? 0.15 : 0) +
      (slot % perBar === 0 && phraseOffset(bar) === 0 ? 0.25 : 0)
    );
  };
  const jumpable = slots
    .map((slot, at) => {
      const level = levelOf(slot);
      return {
        slot,
        at,
        value: accent(slot),
        level,
        beat: level === "Q" ? String((slot % perBar) / slotsPerBeat) : "off",
      };
    })
    .filter(
      ({ level, at, value }) =>
        value >= 0.45 &&
        level !== "S" &&
        (difficulty !== "Easy" || level === "Q") &&
        gaps[at]!.wide >= tuning.jump.wide &&
        // Off the beat the rows either side are an eighth away at best.
        gaps[at]!.clear >=
          (level === "Q"
            ? tuning.jump.clear
            : Math.min(tuning.jump.clear, 0.5)),
    )
    .sort((a, b) => b.value - a.value || a.slot - b.slot);
  return { gaps, jumpable };
}

/** Assign the chart's jump budget to accents the surrounding rows leave room for. */
export function markJumps(
  song: Song,
  profile: ChartProfile,
  slots: readonly number[],
  rows: Row[],
): number {
  const { difficulty, tuning, reference, jumpShare } = profile;
  const { perBar } = song;
  const { beatGap } = rhythmGrid(song);
  const { gaps, jumpable } = jumpCandidates(song, profile, slots);
  // As many jumps as published charts have, and on the beats of the bar they have them on: the strongest accents
  // of each beat first, then whatever accents are left.
  const jumpBudget = Math.round(jumpShare * slots.length);
  const jumpsInBar = new Map<number, number>();
  let jumps = 0;
  const makeJump = (slot: number, at: number): boolean => {
    const bar = Math.floor(slot / perBar);
    const inBar = jumpsInBar.get(bar) ?? 0;
    if (rows[at]!.jump || inBar >= tuning.jump.perBar) return false;
    // Where a jump needs room, it needs twice as much from the next jump.
    if (
      tuning.jump.wide > 0 &&
      rows.some(
        (row, other) =>
          row.jump && beatGap(slots[other]!, slot) < 2 * tuning.jump.wide,
      )
    )
      return false;
    // Never two jumps on neighbouring rows below Challenge.
    if (
      difficulty !== "Challenge" &&
      (rows[at - 1]?.jump === true || rows[at + 1]?.jump === true)
    )
      return false;
    rows[at]!.jump = true;
    jumpsInBar.set(bar, inBar + 1);
    jumps++;
    return true;
  };
  const allocate = (candidates: typeof jumpable, quota: number) => {
    const until = Math.min(jumpBudget, jumps + quota);
    for (const { slot, at } of candidates) {
      if (jumps >= until) break;
      makeJump(slot, at);
    }
  };
  for (const beat of ["0", "1", "2", "3", "off"]) {
    const quota = Math.round(
      jumpBudget * (reference.tables.jump_beat?.[beat] ?? 0.2),
    );
    allocate(
      jumpable.filter((candidate) => candidate.beat === beat),
      quota,
    );
  }
  allocate(jumpable, jumpBudget);
  // The last row is the song's last hit: a jump from Medium up.
  if (difficulty !== "Easy" && gaps.at(-1)!.clear >= tuning.jump.clear)
    rows.at(-1)!.jump = true;
  return jumps;
}

interface HoldCandidate {
  slot: number;
  at: number;
  length: number;
}

function sustain(song: Song, slot: number): number {
  // Slots until the sound stops or a new note starts.
  const reference = Math.max(song.level[slot + 1] ?? 0, song.level[slot]!);
  let length = 1;
  while (
    slot + length < song.slots &&
    length < 4 * song.slotsPerBeat + 1 &&
    song.tone[slot + length]! < 0.5 &&
    song.level[slot + length]! >= 0.55 * reference &&
    song.level[slot + length]! >= 0.12
  )
    length++;
  return length;
}

function holdCandidates(
  song: Song,
  profile: ChartProfile,
  rows: readonly Row[],
): HoldCandidate[] {
  const { levelOf } = rhythmGrid(song);
  return rows
    .map(({ slot }, at) => ({ slot, at, length: sustain(song, slot) }))
    .filter(
      ({ slot, at, length }) =>
        song.tone[slot]! >= 0.4 &&
        levelOf(slot) !== "S" &&
        length >= song.slotsPerBeat &&
        at < rows.length - 1 &&
        (!rows[at]!.jump || profile.difficulty === "Challenge"),
    )
    .sort(
      (a, b) =>
        b.length * song.tone[b.slot]! - a.length * song.tone[a.slot]! ||
        a.slot - b.slot,
    );
}

function fitHold(config: {
  song: Song;
  rows: readonly Row[];
  candidate: HoldCandidate;
  most: number;
  tuning: ChartProfile["tuning"];
}) {
  const {
    song,
    rows,
    candidate: { slot, at, length },
    most,
    tuning,
  } = config;
  const { slotsPerBeat } = song;
  const { beatGap } = rhythmGrid(song);
  const half = slotsPerBeat % 2 === 0 ? slotsPerBeat / 2 : slotsPerBeat;
  const { rowsInside, clears } = tuning.hold;
  const clearable = most > 1 ? clears : 0;
  // The tail lands on a beat or an eighth, before the sound stops: on the song's grid, wherever the head is (a
  // head on a triplet's second note still lets go on a beat).
  const onGrid = (at: number): number => Math.floor(at / half) * half;
  let end = onGrid(slot + Math.min(length - 1, most * slotsPerBeat));
  // Rows while it is held go to the other foot: only so many, none of them fast, and never a jump (a hand).
  let inside = 0;
  // On the easier charts a long freeze is held alone, as published ones are: a row or two under it give way.
  const dropped: number[] = [];
  for (
    let next = at + 1;
    next < rows.length && rows[next]!.slot <= end;
    next++
  ) {
    if (rows[next]!.dropped === true) continue;
    const gap = beatGap(rows[next]!.slot, rows[next - 1]!.slot);
    const fixed = rows[next]!.jump || rows[next]!.holdEnd !== undefined;
    if (inside >= rowsInside || fixed || gap < 0.45) {
      if (!fixed && dropped.length < clearable && next < rows.length - 1) {
        dropped.push(next);
        continue;
      }
      // Let go an eighth (a beat, on a triplet grid) before the row that cannot be taken while holding.
      end = onGrid(rows[next]!.slot - half);
      break;
    }
    inside++;
  }
  return { end, inside, dropped };
}

function leavesRoomForHold(
  rows: readonly Row[],
  holds: readonly [number, number][],
  candidate: { slot: number; end: number; half: number; inside: number },
): boolean {
  const { slot, end, half, inside } = candidate;
  // Leave a breath between freezes on the same chart.
  if (
    holds.some(
      ([from, through]) => slot <= through + half && end + half >= from,
    )
  )
    return false;
  if (inside > 0) return true;
  // A freeze held alone needs a breath before the next step.
  const after = rows.find((row) => row.slot > end && row.dropped !== true);
  return !after || after.slot - end >= half;
}

/** Assign freezes to sustained notes, leaving room for the other foot. */
export function markHolds(
  song: Song,
  profile: ChartProfile,
  rows: Row[],
  jumps: number,
): void {
  const { tuning, reference } = profile;
  const { slotsPerBeat } = song;
  // Freezes on sustained notes: a new pitch that rings on with no new pitch after it.
  const half = slotsPerBeat % 2 === 0 ? slotsPerBeat / 2 : slotsPerBeat;
  // As many freezes as published charts have, and no longer: one beat, two or up to four, as often as theirs are.
  const holdBudget = Math.round(
    (reference.scalars.hold_share?.p50 ?? 0.04) * (rows.length + jumps),
  );
  const lengths = reference.tables.hold_beats ?? {};
  const one = lengths["<=1"] ?? 0.45,
    two = lengths["<=2"] ?? 0.3,
    four = lengths["<=4"] ?? 0.2;
  const holdable = holdCandidates(song, profile, rows);
  let holds = 0;
  const heldUntil: [number, number][] = [];
  // The long ones first, wherever the music and the rows around leave room for one, then the shorter.
  const tiers: readonly (readonly [number, number, number])[] = [
    [4, 2, Math.round((holdBudget * four) / (one + two + four))],
    [2, 1, Math.round((holdBudget * (two + four)) / (one + two + four))],
    [1, 0, holdBudget],
  ];
  for (const [most, over, quota] of tiers)
    for (const candidate of holdable) {
      const { slot, at } = candidate;
      if (holds >= quota) break;
      if (rows[at]!.holdEnd !== undefined || rows[at]!.dropped === true)
        continue;
      const { end, inside, dropped } = fitHold({
        song,
        rows,
        candidate,
        most,
        tuning,
      });
      const duration = end - slot;
      if (duration < slotsPerBeat || duration <= over * slotsPerBeat) continue;
      if (!leavesRoomForHold(rows, heldUntil, { slot, end, half, inside }))
        continue;
      rows[at]!.holdEnd = end;
      for (const gone of dropped) rows[gone]!.dropped = true;
      heldUntil.push([slot, end]);
      holds++;
    }
}
