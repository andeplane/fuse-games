"""Snap model peaks to the beat grid and allocate a chart's local step budgets."""
from __future__ import annotations

from bisect import bisect_left
from dataclasses import dataclass
import math
import os

import numpy as np

from features import FPS
from onset import peaks
from simfile import Timing

MIN_GAP = {"Beginner": 0.4, "Easy": 0.3, "Medium": 0.16, "Hard": 0.095, "Challenge": 0.07}
SNAP = {"Beginner": [1], "Easy": [2], "Medium": [2], "Hard": [4, 3], "Challenge": [4, 3]}
BUSY_POWER = float(os.environ.get("CHARTNET_BUSY_POWER", "1"))
BUSY_HOP = 0.5  # seconds between samples of the busy-ness profile
RUN_BONUS = float(os.environ.get("CHARTNET_RUN_BONUS", "1"))
RUN_SHARE = {"Challenge": float(os.environ.get("CHARTNET_RUN_SHARE", "0.05"))}
END_MARGIN = 0.5  # seconds before the end of the audio where the last step may fall
QUOTA_SECONDS = 2.0


def only_24th(beat: float) -> bool:
    """A position on the 24th grid that is neither an eighth, a 12th nor a 16th."""
    sixths = beat * 6
    return abs(sixths - round(sixths)) < 1e-6 and round(sixths) % 6 in (1, 5)


def keep_24th_runs(beats: list[float], need: int = 5) -> list[float]:
    have = {round(beat * 6) for beat in beats if abs(beat * 6 - round(beat * 6)) < 1e-6}
    return [beat for beat in beats if not only_24th(beat) or
            sum((math.floor(beat + 1e-6) * 6 + j) in have for j in range(6)) >= need]


@dataclass(frozen=True)
class Placement:
    difficulty: str
    threshold: float
    target: int | None = None
    swing: bool = False
    snap24: bool = False

    def subdivisions(self) -> list[int]:
        swing_grid = [3] if self.swing and self.difficulty in ("Medium", "Hard", "Challenge") else []
        return SNAP[self.difficulty] + swing_grid + ([6] if self.snap24 else [])


@dataclass(frozen=True)
class Peak:
    beat: float
    time: float
    probability: float


def _window(time: float) -> int:
    return max(int(time // QUOTA_SECONDS), 0)


class Selection:
    """Selected beats, indexed by beat, by time and by quota window."""

    def __init__(self, gap: float, quotas: np.ndarray | None):
        self.gap = gap
        self.quotas = quotas
        self.times: list[float] = []
        self.beats: dict[float, float] = {}
        self.spent: dict[int, int] = {}

    def add(self, beat: float, time: float, *, forced: bool = False) -> None:
        if not forced and beat in self.beats:
            return
        window = _window(time)
        quotas = self.quotas
        if not forced and quotas is not None and window < len(quotas) and self.spent.get(window, 0) >= quotas[window]:
            return
        index = bisect_left(self.times, time)
        neighbours = self.times[max(index - 1, 0):index + 1]
        if any(abs(time - other) < self.gap for other in neighbours):
            return
        self.times.insert(index, time)
        self.beats[beat] = time
        self.spent[window] = self.spent.get(window, 0) + 1

    def drop(self, beat: float) -> None:
        time = self.beats.pop(beat)
        del self.times[bisect_left(self.times, time)]
        self.spent[_window(time)] -= 1


def snap_peaks(prob: np.ndarray, timing: Timing, chart: Placement) -> list[Peak]:
    candidates = peaks(prob, chart.threshold if chart.target is None else 0.0)
    candidates = candidates[np.argsort(-prob[candidates])]
    subdivisions = chart.subdivisions()
    last = len(prob) / FPS - END_MARGIN
    snapped = []
    for frame in candidates:
        beat = timing.time_to_beat(frame / FPS)
        best = min((round(beat * sub) / sub for sub in subdivisions), key=lambda snap: abs(snap - beat))
        if best < 0 or abs(best - beat) > 0.2:
            continue
        time = timing.beat_to_time(best)
        if time < last:
            snapped.append(Peak(best, time, float(prob[frame])))
    return snapped


def _fill(selection: Selection, peaks_: list[Peak], chart: Placement) -> None:
    target = chart.target
    if target is None:
        for peak in peaks_:
            selection.add(peak.beat, peak.time)
        return
    share = RUN_SHARE.get(chart.difficulty, 0.0)
    first = int(round(target * (1 - share)))
    rest = []
    for peak in peaks_:
        if len(selection.beats) >= first:
            rest.append(peak)
        else:
            selection.add(peak.beat, peak.time)

    # Reserve the last share for peaks that can extend already selected 16th streams.
    def score(peak: Peak) -> float:
        beat = peak.beat
        return peak.probability * (1 + RUN_BONUS * ((beat - 0.25) in selection.beats)
                                   + RUN_BONUS * ((beat + 0.25) in selection.beats))

    while len(selection.beats) < target and rest:
        best = max(range(len(rest)), key=lambda index: score(rest[index]))
        peak = rest.pop(best)
        selection.add(peak.beat, peak.time)


def _replace_isolated_24ths(selection: Selection, peaks_: list[Peak], target: int | None) -> None:
    kept = keep_24th_runs(sorted(selection.beats))
    for beat in set(selection.beats) - set(kept):
        selection.drop(beat)
    if target is None:
        return
    for peak in peaks_:
        if len(selection.beats) >= target:
            break
        if not only_24th(peak.beat):
            selection.add(peak.beat, peak.time)


def _select(prob: np.ndarray, timing: Timing, chart: Placement, forced=(), quotas=None) -> list[float]:
    selection = Selection(MIN_GAP[chart.difficulty], quotas)
    for beat in forced:
        if beat >= 0:
            selection.add(beat, timing.beat_to_time(beat), forced=True)
    snapped = snap_peaks(prob, timing, chart)
    _fill(selection, snapped, chart)
    if chart.snap24:
        _replace_isolated_24ths(selection, snapped, chart.target)
    return sorted(selection.beats)


def _whole(shares: np.ndarray, total: int) -> np.ndarray:
    """Scale shares to whole numbers adding to total. Largest remainders get the leftovers."""
    if shares.sum() <= 0:
        return np.zeros(len(shares), int)
    exact = shares * total / shares.sum()
    out = np.floor(exact).astype(int)
    for index in np.argsort(-(exact - out))[: total - out.sum()]:
        out[index] += 1
    return out


def _quotas(length: int, timing: Timing, own: list[float], forced: list[float],
            busy: np.ndarray | None, scale: list[tuple[float, float, float]]) -> np.ndarray:
    windows = int(length / FPS // QUOTA_SECONDS) + 1

    def count(beats: list[float]) -> np.ndarray:
        return np.bincount([min(_window(timing.beat_to_time(beat)), windows - 1) for beat in beats], minlength=windows)

    shares = count(own).astype(float)
    if busy is not None and BUSY_POWER > 0:
        per = int(round(QUOTA_SECONDS / BUSY_HOP))
        profile = np.array([busy[w * per:(w + 1) * per].mean() if w * per < len(busy) else 1.0
                            for w in range(windows)])
        shares *= np.clip(profile, 0.05, 4.0) ** BUSY_POWER
    quota = _whole(shares, len(own))
    for start, end, factor in scale:
        for window in range(_window(start), min(int(end // QUOTA_SECONDS) + 1, windows)):
            quota[window] = int(round(quota[window] * factor))
    return np.maximum(quota, count([beat for beat in forced if beat >= 0])) if forced else quota


def place(prob: np.ndarray, tm: Timing, diff: str, thr: float, n_target: int | None = None, swing: bool = False,
          snap24: bool = False, forced: list[float] | None = None, busy: np.ndarray | None = None,
          scale: list[tuple[float, float, float]] | None = None) -> list[float]:
    """Place strongest peaks on the grid. Review guidance can reserve or scale local step budgets."""
    chart = Placement(diff, thr, n_target, swing, snap24)
    forced = forced or []
    scale = scale or []
    steer = busy is not None and BUSY_POWER > 0
    if n_target is None or not (steer or forced or scale):
        return _select(prob, tm, chart, forced)
    own = _select(prob, tm, chart)
    quotas = _quotas(len(prob), tm, own, forced, busy, scale)
    return _select(prob, tm, Placement(diff, thr, int(quotas.sum()), swing, snap24), forced, quotas)
