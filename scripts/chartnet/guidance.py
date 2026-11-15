"""Review notes from the chart lab as guidance: where Anders marks a time span and a frequency band ("this piano
solo should be a stream run"), the steps there follow that band's onsets; where he tapped a rhythm in record mode,
the steps follow his taps.

The lab saves `notes.json` (see `games/fusemania/src/lab/notes.ts`): per note a song id, a time span in seconds and
beats, and a frequency band in Hz. `forced_beats` turns each note into the grid positions inside the span where that
band has an onset; `gen.place` puts those first and fills the rest of the chart around them.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import librosa
import numpy as np

from features import FPS, N_MELS

# The lab writes its notes and taps on the labeller's machine; `labels/` here is the copy the committed charts were
# made from (`watch_notes.py` refreshes it), so the charts can be regenerated anywhere.
LIVE = Path(os.environ.get("CHARTNET_NOTES",
                           Path.home() / "projects/personal/fuse-riders/artifacts/chart-lab-notes/notes.json"))
SNAPSHOT = Path(__file__).parent / "labels" / "notes.json"
NOTES = LIVE if LIVE.exists() else SNAPSHOT
LAG = 3  # the rise in a mel band peaks ~30 ms after the onset
MEL_HZ = librosa.mel_frequencies(n_mels=N_MELS + 2, fmin=27.5, fmax=11000)[1:-1]


def notes_for(song: str) -> list[dict]:
    if not NOTES.exists():
        return []
    notes = json.loads(NOTES.read_text()).get("notes", [])
    return [n for n in notes if n.get("song") == song and n.get("lowHz") is not None and n.get("highHz") is not None]


def band_flux(logmel: np.ndarray, low_hz: float, high_hz: float) -> np.ndarray:
    """Onset strength of one frequency band: the summed frame-to-frame rise of its mel bins (short window)."""
    bins = np.where((MEL_HZ >= low_hz) & (MEL_HZ <= high_hz))[0]
    if len(bins) == 0:
        bins = np.array([int(np.argmin(np.abs(MEL_HZ - (low_hz + high_hz) / 2)))])
    m = logmel[:, bins].astype(np.float32)
    return np.r_[0.0, np.maximum(m[1:] - m[:-1], 0).sum(1)]


TAP_SHIFT = 0.025  # seconds his taps run behind the sound (measured against the model on Final Chase)
TAP_WINDOW = 2.0  # beats


def _tap_times(song: str) -> np.ndarray:
    path = NOTES.parent / "taps" / f"{song}.json"
    if not path.exists():
        return np.array([])
    return np.array(sorted(t["time"] for t in json.loads(path.read_text()).get("taps", [])))


def tap_alignment(times: np.ndarray, tm, subdivisions: list[int]) -> tuple[float, float]:
    """How well the taps sit on the grid: (mean distance to the nearest grid position divided by what random taps
    would give, the shift in seconds that fits best). Under about 0.65 the taps can be trusted one by one."""
    best = (9.0, 0.0)
    for shift in np.arange(-0.06, 0.101, 0.005):
        beats = np.array([tm.time_to_beat(t - shift) for t in times])
        dist = np.min([np.abs(beats * s - np.round(beats * s)) / s for s in subdivisions], axis=0).mean()
        best = min(best, (float(dist), float(shift)))
    # random taps: the mean distance to the nearest position of the union grid
    grid = np.unique(np.concatenate([np.arange(s) / s for s in subdivisions] + [[1.0]]))
    u = np.linspace(0, 1, 2001)
    rand = float(np.abs(u[:, None] - grid[None]).min(1).mean())
    return best[0] / rand, best[1]


def tapped_beats(song: str, tm, subdivisions: list[int], prob: np.ndarray, share: float = 1.0) -> list[float]:
    """The rhythm tapped in the chart lab's record mode (`taps/<song>.json` beside the notes). Only the timing of
    the taps is read, not the panels.

    Where the taps sit clearly on the grid (Burning Heat: 12 ms from the nearest 12th or 16th, random taps would be
    22 ms) and the chart takes all of them (`share` 1), each tap becomes the step on its grid position. Otherwise
    (Final Chase: the taps scatter over a whole sixteenth; or an easier chart that takes a share) they only say how
    many steps a stretch should have: every `TAP_WINDOW` beats get that many, on the grid positions where the
    placement model's step probability `prob` is highest, at least a fifth of a beat apart."""
    times = _tap_times(song)
    if len(times) == 0:
        return []
    ratio, shift = tap_alignment(times, tm, subdivisions)
    beats = np.array([tm.time_to_beat(t - (shift if ratio < 0.65 else TAP_SHIFT)) for t in times])
    if ratio < 0.65 and share >= 1.0:
        return sorted({min((round(b * s) / s for s in subdivisions), key=lambda x: abs(x - b)) for b in beats})
    out: list[float] = []
    n = len(prob)
    for w in np.arange(np.floor(beats[0] / TAP_WINDOW) * TAP_WINDOW, beats[-1] + 1e-6, TAP_WINDOW):
        count = int(round(share * np.sum((beats >= w) & (beats < w + TAP_WINDOW))))
        if count == 0:
            continue
        cands: dict[float, float] = {}
        for sub in subdivisions:
            for k in range(int(round(w * sub)), int(round((w + TAP_WINDOW) * sub))):
                f = int(round(tm.beat_to_time(k / sub) * FPS))
                if 0 <= f < n:
                    cands[k / sub] = max(cands.get(k / sub, 0.0), float(prob[max(f - 2, 0):f + 3].max()))
        picked: list[float] = []
        for b in sorted(cands, key=lambda x: -cands[x]):
            if len(picked) >= count:
                break
            if all(abs(b - q) >= 0.2 for q in picked):
                picked.append(b)
        out += picked
    return sorted(out)


def forced_beats(song: str, logmel: np.ndarray, tm, subdivisions: list[int], prob: np.ndarray,
                 share: float = 1.0, strength: float = 0.3) -> list[float]:
    """Steps the review material asks for: the tapped rhythm where there is one (`tapped_beats`), and inside each
    marked span without taps the grid positions (1/sub beats) where the note's band has an onset at least
    `strength` times the span's strongest."""
    taps = tapped_beats(song, tm, subdivisions, prob, share)
    out: set[float] = set(taps)
    n = len(logmel)
    for note in notes_for(song):
        flux = band_flux(logmel, note["lowHz"], note["highHz"])
        b0, b1 = tm.time_to_beat(note["start"]), tm.time_to_beat(note["end"])
        if sum(b0 <= b <= b1 for b in taps) >= 2:
            continue  # he tapped this span: his count stands
        cands: dict[float, float] = {}
        for sub in subdivisions:
            for k in range(int(np.ceil(b0 * sub - 1e-6)), int(np.floor(b1 * sub + 1e-6)) + 1):
                f = int(round(tm.beat_to_time(k / sub) * FPS)) + LAG
                if 0 <= f < n:
                    cands[k / sub] = float(flux[max(f - 1, 0):f + 2].max())
        if not cands:
            continue
        top = max(cands.values())
        out |= {b for b, v in cands.items() if v >= strength * top and top > 0}
    return sorted(out)


def opening_beat(onset: np.ndarray, tm, subdivisions: list[int], lead_in: float = 1.0) -> float | None:
    """The first clear, sharp sound of the song after the lead-in, on the chart's grid: a chart starts there.
    `onset` is the onset strength per frame; a sharp sound is a peak at least twice the median peak."""
    pk = np.where((onset > np.r_[-1, onset[:-1]]) & (onset >= np.r_[onset[1:], -1]))[0]
    if len(pk) == 0:
        return None
    for f in pk[onset[pk] > 2.0 * np.median(onset[pk])]:
        b = tm.time_to_beat((f - LAG) / FPS)
        best = min((round(b * s) / s for s in subdivisions), key=lambda x: abs(x - b))
        if tm.beat_to_time(best) >= lead_in + 0.02:
            return best
    return None


def _all_notes(song: str) -> list[dict]:
    if not NOTES.exists():
        return []
    return [n for n in json.loads(NOTES.read_text()).get("notes", []) if n.get("song") == song]


def has_taps(song: str) -> bool:
    return (NOTES.parent / "taps" / f"{song}.json").exists()


def noted_opening(song: str, onset: np.ndarray, tm, subdivisions: list[int]) -> float | None:
    """Where a note says the chart should start ("this would be a good first", or tagged `start`): the strongest
    onset inside that span, on the grid. The chart has no step before it."""
    for note in _all_notes(song):
        text = note.get("text", "").lower()
        if "good first" not in text and "start" not in [t.lower() for t in note.get("tags", [])]:
            continue
        a, b = int(note["start"] * FPS), int(note["end"] * FPS) + 1
        if b <= a or a >= len(onset):
            continue
        f = a + int(np.argmax(onset[a:b])) - LAG
        beat = tm.time_to_beat(f / FPS)
        return min((round(beat * s) / s for s in subdivisions), key=lambda x: abs(x - beat))
    return None


def jump_beats(song: str, logmel: np.ndarray, tm, beats: list[float], strength: float = 0.4) -> set[float]:
    """Steps that should be jumps: inside a span whose note asks for jumps ("nice rhythm for jumps", tagged
    `jumps`), the placed steps that sit on an onset of the note's band (bass and drum hits, usually)."""
    out: set[float] = set()
    n = len(logmel)
    for note in _all_notes(song):
        if "jump" not in note.get("text", "").lower() and "jumps" not in [t.lower() for t in note.get("tags", [])]:
            continue
        if note.get("lowHz") is None or note.get("highHz") is None:
            continue
        flux = band_flux(logmel, note["lowHz"], note["highHz"])
        b0, b1 = tm.time_to_beat(note["start"]), tm.time_to_beat(note["end"])
        inside = [b for b in beats if b0 - 1e-6 <= b <= b1 + 1e-6]
        val = {}
        for b in inside:
            f = int(round(tm.beat_to_time(b) * FPS)) + LAG
            val[b] = float(flux[max(f - 1, 0):f + 2].max()) if 0 <= f < n else 0.0
        if val and max(val.values()) > 0:
            top = max(val.values())
            out |= {b for b, v in val.items() if v >= strength * top}
    return out


def verdicts(song: str) -> tuple[list[tuple[float, float]], list[tuple[float, float, float]]]:
    """Verdicts on the current chart, from notes whose text starts with `good` or `bad`:
    (locked spans in seconds, the chart stays exactly as it is there;
     density changes as (start, end, factor): "bad: too many" thins the span, "bad: too few" fills it)."""
    locked, scale = [], []
    for note in _all_notes(song):
        text = note.get("text", "").strip().lower()
        if text.startswith("good"):
            locked.append((note["start"], note["end"]))
        elif text.startswith("bad"):
            if any(k in text for k in ("too many", "too much", "too dense", "fewer", "less")):
                scale.append((note["start"], note["end"], 0.5))
            elif any(k in text for k in ("too few", "too little", "too sparse", "more", "empty")):
                scale.append((note["start"], note["end"], 1.7))
    return locked, scale


def keep_locked(new_rows, old_rows, locked: list[tuple[float, float]]):
    """`new_rows` with every locked span's rows taken from `old_rows` instead (both are (beat, time, row))."""
    if not locked:
        return new_rows
    inside = lambda t: any(a <= t <= b for a, b in locked)  # noqa: E731
    rows = [r for r in new_rows if not inside(r[1])] + [r for r in old_rows if inside(r[1])]
    return sorted(rows, key=lambda r: r[0])
