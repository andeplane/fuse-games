"""Metrics shared by the original and density-conditioned ChartNet generators."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

STEP_SYMBOLS = "124"
BEAT_EPSILON = 1e-6


def active_rows(rows):
    return [(beat, time, pattern) for beat, time, pattern in rows if any(c in STEP_SYMBOLS for c in pattern)]


def step_columns(pattern: str) -> list[int]:
    return [col for col in range(4) if pattern[col] in STEP_SYMBOLS]


@dataclass
class Turns:
    """Foot assignment used by the original chart comparison."""

    foot: int | None = None
    last_col: int | None = None
    jack: int = 0
    cross: int = 0
    candle: int = 0
    singles: int = 0

    def step(self, col: int, gap: float) -> None:
        self.singles += 1
        if gap > 1.0 + BEAT_EPSILON:
            self.foot = None
        foot = self.assign(col)
        if gap <= 0.5 + BEAT_EPSILON:
            self.jack += self.last_col == col
            self.candle += {self.last_col, col} == {1, 2}
            if foot == self.foot and col in (0, 3) and self.last_col != col:
                self.cross += 1
                foot = 1 - foot
        self.foot, self.last_col = foot, col

    def assign(self, col: int) -> int:
        if col == 0:
            return 0
        if col == 3:
            return 1
        if self.foot is not None:
            return 1 - self.foot
        return 0 if self.last_col == 3 else 1


def _stats(rows, columns) -> dict:
    if len(rows) < 2:
        return {}
    duration = rows[-1][1] - rows[0][1]
    turns = Turns()
    run = longest = jumps = 0
    for index, ((beat, _, _), cols) in enumerate(zip(rows, columns)):
        gap = beat - rows[index - 1][0] if index else 9
        run = run + 1 if gap <= 0.25 + BEAT_EPSILON else 1
        longest = max(longest, run)
        if len(cols) == 1:
            turns.step(cols[0], gap)
        else:
            jumps += len(cols) >= 2
            turns.foot, turns.last_col = None, None

    use = np.array([sum(col in row for row in columns) for col in range(4)], float)
    use /= use.sum()
    patterns = [pattern for _, _, pattern in rows]
    grams = _four_rows(patterns)
    singles = max(turns.singles, 1)
    return {
        "nps": round(len(rows) / max(duration, 1), 2),
        "jump_share": round(jumps / len(rows), 3),
        "jack_share": round(turns.jack / singles, 3),
        "crossover_share": round(turns.cross / singles, 3),
        "candle_share": round(turns.candle / singles, 3),
        "column_entropy": round(float(-(use * np.log2(use + 1e-9)).sum()), 3),
        "distinct_4grams": round(len(set(grams)) / max(len(grams), 1), 3),
        "longest_16th_run": longest,
    }


def stats(rows) -> dict:
    steps = active_rows(rows)
    return _stats(steps, [step_columns(pattern) for _, _, pattern in steps])


def mean_stats(lst):
    keys = sorted({k for s in lst for k in s})
    return {k: round(float(np.mean([s[k] for s in lst if k in s])), 3) for k in keys}


def _four_rows(patterns: list[str]) -> list[tuple[str, ...]]:
    return [tuple(patterns[at:at + 4]) for at in range(len(patterns) - 3)]


def window_variety(toks: list[str], win: int = 64) -> float:
    """Mean distinct four-row pattern share across windows; independent of chart length."""
    if len(toks) < 8:
        return 1.0
    values = []
    for start in range(0, max(len(toks) - win, 0) + 1, win // 2):
        grams = _four_rows(toks[start:start + win])
        values.append(len(set(grams)) / max(len(grams), 1))
    return float(np.mean(values))


def _best_parity(beats: list[float], columns: list[list[int]]) -> float:
    """Evaluate both starting feet in one pass: every sideways step is wrong for exactly one parity."""
    last_beat = -99.0
    prev = None
    foot = left_wrong = right_wrong = total = singles = 0
    for beat, cols in zip(beats, columns):
        if len(cols) != 1 or beat - last_beat > 1.0 + BEAT_EPSILON:
            total += min(left_wrong, right_wrong)
            prev = None
            foot = left_wrong = right_wrong = 0
        last_beat = beat
        if len(cols) != 1:
            continue
        col = cols[0]
        singles += 1
        if prev is not None and prev != col:
            foot = 1 - foot
        if col in (0, 3):
            wrong = foot != (col == 3)
            left_wrong += wrong
            right_wrong += not wrong
        prev = col
    total += min(left_wrong, right_wrong)
    return round(total / max(singles, 1), 3)


def crossovers_best_parity(rows) -> float:
    steps = active_rows(rows)
    return _best_parity([beat for beat, _, _ in steps], [step_columns(row) for _, _, row in steps])


def _step_flow(steps, columns) -> dict:
    from feet import Feet

    feet = Feet()
    totals = {"crossover": 0.0, "jack": 0.0, "candle": 0.0}
    singles = 0
    for (beat, _, _), cols in zip(steps, columns):
        singles += len(cols) == 1
        events = feet.apply(cols, {}, beat)
        for key in totals:
            totals[key] += events[key]
    return {f"feet_{key}": round(value / max(singles, 1), 3) for key, value in totals.items()}


def _stream_share(beats: list[float], gap: float) -> float:
    return sum(b - a <= gap + BEAT_EPSILON for a, b in zip(beats, beats[1:])) / max(len(beats) - 1, 1)


def _peak_nps(times: list[float]) -> float:
    window = 2.0
    clock = np.asarray(times)
    if np.all(clock[:-1] <= clock[1:]):
        ends = np.searchsorted(clock, clock + window)
    else:
        # Negative stops can move time backwards. Retain the scalar comparison
        # for these charts: NumPy's batched search assumes ordered timestamps.
        ends = [np.searchsorted(clock, time + window) for time in clock]
    return round(int(max(ends - np.arange(len(clock)))) / window, 2)


def stats2(rows) -> dict:
    steps = active_rows(rows)
    if not steps:
        return {}
    beats, times, patterns = map(list, zip(*steps))
    columns = [step_columns(pattern) for pattern in patterns]
    out = _stats(steps, columns)
    out["hold_share"] = round(sum(any(c in "24" for c in r) for r in patterns) / len(steps), 3)
    out["hand_share"] = round(sum(len(cols) >= 3 for cols in columns) / len(steps), 3)
    out.update(_step_flow(steps, columns))
    out["crossover_best_parity"] = _best_parity(beats, columns)
    out["stream16_share"] = round(_stream_share(beats, 0.25), 3)
    out["stream24_share"] = round(_stream_share(beats, 1 / 6), 4)
    out["variety_w64"] = round(window_variety(patterns), 3)
    out["peak_nps_2s"] = _peak_nps(times)
    return out
