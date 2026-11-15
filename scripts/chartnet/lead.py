"""Does one instrument stand out? Six measures of the music picture at 2 frames a second.

In the chart lab the spans worth a stream look alike: one clear note at a time in the melody range while the drums
pull back. `lead_features` puts numbers on that: the audio is split into its harmonic and percussive parts, and the
harmonic part is read on a fine pitch grid (24 bins an octave) between 300 and 3000 Hz.

  python lead.py packs [workers]   – every pack song with a cached chart → $CHARTNET_WORK/lead/<key>.npy
  python lead.py fuse              – the game's songs → $CHARTNET_WORK/lead_fuse/<id>.npy
"""
from __future__ import annotations

import io
import os
import re
import sys
import zipfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import librosa
import numpy as np
import scipy.ndimage as ndi

from features import SR, load_audio

ROOT = Path(os.environ.get("CHARTNET_WORK", Path.home() / "projects/personal/fusemania-songs/chartnet"))
PACKS = ROOT.parent / "packs"
HOP = 512
POOL = 0.5  # seconds between output frames
NAMES = ["percussive loudness", "harmonic loudness 300-3000 Hz", "harmonic share", "lead note dominance",
         "few notes at once", "lead pitch movement"]


def lead_features(y: np.ndarray) -> np.ndarray:
    """(frames at 2 Hz, 6): see NAMES. Each value is the mean over the second around the frame."""
    fps = SR / HOP
    spec = librosa.stft(y, n_fft=2048, hop_length=HOP)
    harm, perc = librosa.decompose.hpss(spec, margin=2.0)
    h, p = np.abs(harm).sum(0), np.abs(perc).sum(0)
    yh = librosa.istft(harm, hop_length=HOP, length=len(y))
    fmin = librosa.note_to_hz("C3")
    cq = np.abs(librosa.cqt(yh, sr=SR, hop_length=HOP, fmin=fmin, n_bins=24 * 5, bins_per_octave=24))
    hz = fmin * 2 ** (np.arange(cq.shape[0]) / 24)
    mid = cq[(hz >= 300) & (hz <= 3000)]
    n = min(len(h), mid.shape[1])
    h, p, mid = h[:n], p[:n], mid[:, :n]
    total = mid.sum(0) + 1e-9
    lead = ndi.median_filter(mid.argmax(0), size=5)
    per_frame = np.stack([np.log1p(p), np.log1p(mid.sum(0)), h / (h + p + 1e-9), mid.max(0) / total,
                          (mid ** 2).sum(0) / total ** 2, np.r_[0, np.abs(np.diff(lead))] / 2 * fps], 1)
    half = int(fps * 0.5)
    step = POOL * fps
    out = [per_frame[max(int(i * step) - half, 0):int(i * step) + half + 1].mean(0)
           for i in range(int(n / step) + 1) if int(i * step) < n]
    return np.array(out, np.float32)


def _pack_song(args: tuple[str, str, str]) -> str:
    zpath, folder, key = args
    out = ROOT / "lead" / f"{key}.npy"
    if out.exists():
        return f"skip {key}"
    try:
        with zipfile.ZipFile(zpath) as z:
            files = [n for n in z.namelist() if n.startswith(folder + "/") and n.lower().endswith((".ogg", ".mp3", ".wav"))]
            name = sorted(files, key=lambda f: -z.getinfo(f).file_size)[0]
            data = z.read(name)
        np.save(out, lead_features(load_audio(io.BytesIO(data), suffix=name.rsplit(".", 1)[-1])))
        return f"ok {key}"
    except Exception as e:  # noqa: BLE001
        return f"fail {key}: {type(e).__name__}: {e}"


def packs(workers: int) -> None:
    from extract import songs_in_zip
    (ROOT / "lead").mkdir(exist_ok=True)
    have = {p.stem for p in (ROOT / "cache").glob("*.json")}
    only = set(Path(os.environ["CHARTNET_KEYS"]).read_text().split()) if os.environ.get("CHARTNET_KEYS") else None
    jobs = []
    for zpath in sorted(PACKS.rglob("*.zip")):
        for d, _, _ in songs_in_zip(zpath):
            key = f"{zpath.stem}__{d.rsplit('/', 1)[-1]}".replace(" ", "_").replace("/", "_")
            if (not have or key in have) and (only is None or key in only):
                jobs.append((str(zpath), d, key))
    print(len(jobs), "songs", flush=True)
    with ProcessPoolExecutor(workers) as ex:
        for i, msg in enumerate(ex.map(_pack_song, jobs)):
            if not msg.startswith("ok") or i % 50 == 0:
                print(i, msg, flush=True)


def fuse() -> None:
    from extract_fuse import show
    (ROOT / "lead_fuse").mkdir(exist_ok=True)
    src = show("scripts/lib/fusemania/songs.ts").decode()
    specs = [(m.group(1), f"public/music/{m.group(1)}.m4a") for m in re.finditer(r'radio\(\s*"([^"]+)"', src)]
    specs += [(m.group(2), f"public/music/{m.group(1)}/{m.group(2)}.mp3")
              for m in re.finditer(r'(?:game|packed)\(\s*"([^"]+)",\s*"([^"]+)"', src)]
    specs += [(m.group(1), f"games/killer-fuse/public/killer-fuse/audio/music/{m.group(1)}.mp3")
              for m in re.finditer(r'killerFuse\(\s*"([^"]+)"', src)]
    for sid, path in specs:
        out = ROOT / "lead_fuse" / f"{sid}.npy"
        if out.exists():
            continue
        try:
            np.save(out, lead_features(load_audio(io.BytesIO(show(path)), suffix=path.rsplit(".", 1)[-1])))
            print("ok", sid, flush=True)
        except Exception as e:  # noqa: BLE001
            print("fail", sid, type(e).__name__, e, flush=True)


if __name__ == "__main__":
    if sys.argv[1] == "packs":
        packs(int(sys.argv[2]) if len(sys.argv) > 2 else 8)
    else:
        fuse()
