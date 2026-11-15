"""Bars that sound alike get the same rhythm.

Human charts repeat a rhythm when the music repeats: on held-out songs a bar and the earlier bar it sounds most like
share 0.77 to 0.90 of their steps. The placement model scores every moment on its own, so two bars that sound the
same can come out with slightly different scores and lose or gain a step. `share` blends each bar's step
probability with that of the bars that sound like it before any step is picked; the steps then fall the same way in
both. On held-out songs this lifts the overlap from 0.79 to 0.83 (DDR/ITG) and from 0.81 to 0.84 (community), the
human level or above, and leaves the timing score where it was (README, "The ladder, repeats, ...").
"""
from __future__ import annotations

import os

import numpy as np
from scipy.ndimage import maximum_filter1d

from features import FPS
from simfile import Timing

# How much of a bar's probability comes from its group (the bar itself and the bars that sound like it).
SHARE = float(os.environ.get("CHARTNET_SHARE", "0.5"))
# Two bars sound alike when their spectra, slot by slot, correlate at least this much.
SIMILAR = float(os.environ.get("CHARTNET_SIMILAR", "0.5"))
SLOTS = 16  # sixteenths in a bar
MEL = slice(64, 128)  # the log-mel block of the placement features that the comparison uses


def _frame(tm: Timing, beat: float) -> int:
    return int(round(tm.beat_to_time(beat) * FPS))


def bars(n_frames: int, tm: Timing) -> list[int]:
    """The bars (four beats from a multiple of four) that lie inside the audio."""
    last = int(tm.time_to_beat(n_frames / FPS) // 4)
    return [i for i in range(last) if _frame(tm, 4 * i) >= 0 and _frame(tm, 4 * i + 4) < n_frames]


def similarity(feats: np.ndarray, tm: Timing, which: list[int]) -> np.ndarray:
    """How alike each pair of bars sounds: the correlation of their spectra at the sixteenth slots, after taking
    out what all the song's bars have in common."""
    if not which:
        return np.zeros((0, 0), np.float32)
    at = np.array([[_frame(tm, 4 * i + k / 4) for k in range(SLOTS)] for i in which])
    mel = feats[np.clip(at, 0, len(feats) - 1)][:, :, MEL].astype(np.float32)
    v = mel.reshape(len(which), SLOTS, -1, 2).mean(3).reshape(len(which), -1)
    v = v - v.mean(0)
    v /= np.linalg.norm(v, axis=1, keepdims=True) + 1e-9
    return v @ v.T


def share(prob: np.ndarray, feats: np.ndarray, tm: Timing, alpha: float = SHARE, thr: float = SIMILAR) -> np.ndarray:
    """`prob` with every bar's part blended with the bars that sound like it (weight `alpha` on the group's mean,
    each bar weighted by how alike it sounds)."""
    which = bars(len(prob), tm)
    if alpha <= 0 or len(which) < 2:
        return prob
    sim = similarity(feats, tm, which)
    w = np.where(sim >= thr, sim, 0.0)
    np.fill_diagonal(w, 1.0)
    wide = maximum_filter1d(prob, 3)  # a borrowed peak may sit a frame off
    out = prob.copy()
    for a, i in enumerate(which):
        group = np.nonzero(w[a])[0]
        if len(group) < 2:
            continue
        f0, f1 = _frame(tm, 4 * i), _frame(tm, 4 * i + 4)
        acc = np.zeros(f1 - f0)
        for b in group:
            if b == a:
                acc += prob[f0:f1]
                continue
            g0, g1 = _frame(tm, 4 * which[b]), _frame(tm, 4 * which[b] + 4)
            src = np.clip(np.round(g0 + np.arange(f1 - f0) * (g1 - g0) / max(f1 - f0, 1)).astype(int), 0, len(prob) - 1)
            acc += w[a, b] * wide[src]
        out[f0:f1] = (1 - alpha) * prob[f0:f1] + alpha * acc / w[a, group].sum()
    return out


def consistency(beats: list[float], feats: np.ndarray, tm: Timing, n_frames: int, thr: float = SIMILAR) -> tuple[float, int]:
    """(sum of overlaps, number of pairs): for every bar with steps that sounds like an earlier bar (the most alike
    one, at least `thr`), the share of the two bars' steps that fall on the same place in the bar."""
    which = bars(n_frames, tm)
    if len(which) < 2:
        return 0.0, 0
    sim = similarity(feats, tm, which)
    steps: dict[int, set[int]] = {}
    for b in beats:
        slot = int(round(b * 12))  # 48ths of a bar: sixteenths and triplets
        steps.setdefault(slot // 48, set()).add(slot % 48)
    total, pairs = 0.0, 0
    for a, i in enumerate(which):
        if a == 0:
            continue
        b = int(np.argmax(sim[a, :a]))
        if sim[a, b] < thr:
            continue
        x, y = steps.get(i, set()), steps.get(which[b], set())
        if not x and not y:
            continue
        total += 2 * len(x & y) / (len(x) + len(y))
        pairs += 1
    return total, pairs
