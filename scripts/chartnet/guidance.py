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

NOTES = Path(os.environ.get("CHARTNET_NOTES",
                            Path.home() / "projects/personal/fuse-riders/artifacts/chart-lab-notes/notes.json"))
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


def tapped_beats(song: str, tm, subdivisions: list[int], prob: np.ndarray, share: float = 1.0) -> list[float]:
    """The rhythm tapped in the chart lab's record mode (`taps/<song>.json` beside the notes).

    Taps are a person's timing: on Final Chase they scatter over a whole sixteenth, so snapping each one to the grid
    would put a third of them on the wrong line. What they do say reliably is how many steps a stretch should have.
    So every `TAP_WINDOW` beats get as many steps as were tapped there, on the grid positions where the placement
    model's step probability `prob` is highest. `share` scales the count for an easier chart. Only the timing of
    the taps is read, not the panels."""
    path = NOTES.parent / "taps" / f"{song}.json"
    if not path.exists():
        return []
    beats = np.array(sorted(tm.time_to_beat(t["time"] - TAP_SHIFT) for t in json.loads(path.read_text()).get("taps", [])))
    out: list[float] = []
    n = len(prob)
    for w in np.arange(np.floor(beats[0] / TAP_WINDOW) * TAP_WINDOW, beats[-1] + 1e-6, TAP_WINDOW) if len(beats) else []:
        count = int(round(share * np.sum((beats >= w) & (beats < w + TAP_WINDOW))))
        if count == 0:
            continue
        cands: dict[float, float] = {}
        for sub in subdivisions:
            for k in range(int(round(w * sub)), int(round((w + TAP_WINDOW) * sub))):
                f = int(round(tm.beat_to_time(k / sub) * FPS))
                if 0 <= f < n:
                    cands[k / sub] = max(cands.get(k / sub, 0.0), float(prob[max(f - 2, 0):f + 3].max()))
        out += sorted(cands, key=lambda x: -cands[x])[:count]
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
