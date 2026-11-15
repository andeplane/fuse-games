"""Separated instruments as an input for the placement model (needs a CUDA GPU and `pip install --no-deps demucs`
plus dora-search, einops, julius, lameenc, openunmix).

Demucs (htdemucs) splits a song into drums, bass, vocals and other. Per placement frame (100 a second), 8 numbers:
  0-3  log1p of the onset-strength maximum within about +-23 ms of the frame:      drums, bass, vocals, other
  4-7  the stem's share of the summed stem RMS over the 2 s around the frame:      drums, bass, vocals, other

  python stems.py packs [workers]   every song in $CHARTNET_WORK/cache (after extract.py) -> $CHARTNET_WORK/stems/<key>.npy
  python stems.py files <folder>    audio files named <song id>.<ext> (the game's own songs) -> the same folder

`CHARTNET_EXTRA=stems` then makes `data.load` append the columns, for `onset.py` (training) and `gen2.py`
(scoring and generation). Songs without a file are left out. The model is loaded once per process."""
import numpy as np

NAME = "stems"
STEMS = ("drums", "bass", "vocals", "other")
HOP = 256                 # onset envelope hop at 22.05 kHz: 11.6 ms
N_FFT = 1024
BATCH = 8                 # Demucs chunks (7.8 s each) per forward pass: about 3.7 GB of GPU memory
GPU_STORE_MAX_S = 900     # songs longer than this keep the separated audio in RAM instead of on the GPU
_CACHE = {}


def _model():
    if "model" not in _CACHE:
        import librosa
        import torch
        from demucs.pretrained import get_model
        torch.set_num_threads(2)
        bag = get_model("htdemucs")
        m = bag.models[0] if hasattr(bag, "models") and len(bag.models) == 1 else bag
        m.eval().to("cuda")
        _CACHE["model"] = m
        _CACHE["order"] = [m.sources.index(s) for s in STEMS]
        _CACHE["mel"] = torch.from_numpy(librosa.filters.mel(sr=22050, n_fft=N_FFT, n_mels=128)).to("cuda")
    return _CACHE["model"], _CACHE["order"]


def _apply(m, mix, batch, overlap=0.25):
    """demucs.apply.apply_model(split=True, shifts=0) with its default chunks and cross-fade, but several chunks per
    forward pass. mix is (1, 2, T) and may live on the CPU; the result (sources, 2, T) lives where mix does."""
    import torch
    from demucs.apply import TensorChunk
    from demucs.utils import center_trim
    length = mix.shape[-1]
    seg = int(m.samplerate * m.segment)
    stride = int((1 - overlap) * seg)
    w = torch.cat([torch.arange(1, seg // 2 + 1), torch.arange(seg - seg // 2, 0, -1)]).float().to(mix.device)
    w = w / w.max()
    out = torch.zeros(len(m.sources), 2, length, device=mix.device)
    sw = torch.zeros(length, device=mix.device)
    offs = list(range(0, length, stride))
    for i in range(0, len(offs), batch):
        chunks = [TensorChunk(mix, o, seg) for o in offs[i:i + batch]]
        res = m(torch.cat([c.padded(seg) for c in chunks]).to("cuda")).to(mix.device)
        for c, o, r in zip(chunks, offs[i:i + batch], res):
            n = c.shape[-1]
            out[..., o:o + n] += w[:n] * center_trim(r, n)
            sw[o:o + n] += w[:n]
    return out / sw


def separate(y, sr):
    """Mono float32 audio at sr -> torch (4, len(y)) mono stems at sr, in STEMS order, on the GPU (or CPU if long)."""
    import torch
    import torchaudio.functional as AF
    m, order = _model()
    n = len(y)

    def run(store, batch):
        x = AF.resample(torch.from_numpy(np.ascontiguousarray(y, dtype=np.float32)).to("cuda"), sr, m.samplerate)
        std = (x.std() + 1e-8).to(store)
        mix = ((x - x.mean()) / std.to("cuda")).expand(2, -1)[None].contiguous().to(store)   # stereo: the channel twice
        del x
        out = _apply(m, mix, batch)[order].mean(1) * std
        st = AF.resample(out, m.samplerate, sr)
        return torch.nn.functional.pad(st, (0, max(0, n - st.shape[1])))[:, :n]

    try:
        return run("cuda" if n / sr <= GPU_STORE_MAX_S else "cpu", BATCH)
    except torch.cuda.OutOfMemoryError:
        torch.cuda.empty_cache()
        return run("cpu", 2)


def onset_envelopes(st):
    """(4, n) stems at 22.05 kHz -> (4, frames) onset strength on the GPU. Same numbers as librosa.onset.onset_strength
    on a 128-band mel spectrogram (n_fft 1024, hop 256), except that all stems share one loudness floor (80 dB under
    the loudest mel bin of any stem), so a nearly silent stem does not turn its leakage into onsets."""
    import torch
    win = torch.hann_window(N_FFT, device="cuda")
    S = []
    for s in st:                                                   # one stem at a time keeps long songs small
        X = torch.stft(s.to("cuda"), N_FFT, hop_length=HOP, window=win, center=True, pad_mode="constant", return_complex=True)
        S.append(_CACHE["mel"] @ (X.real ** 2 + X.imag ** 2))
    S = torch.stack(S)
    D = 10.0 * torch.log10(torch.clamp(S, min=max(float(S.max()), 1e-10) * 1e-8))
    e = torch.relu(D[..., 1:] - D[..., :-1]).mean(1)
    return torch.nn.functional.pad(e, (1 + N_FFT // (2 * HOP), 0))[..., :D.shape[-1]]     # librosa's lag and centring shift


def extract(y, sr, slot_times):
    """The 8 columns at each of `slot_times` (seconds), for mono audio `y` at 22.05 kHz."""
    import torch
    slot_times = np.asarray(slot_times, dtype=np.float64)
    out = np.zeros((len(slot_times), 8), dtype=np.float32)
    n = len(y)
    if n < sr // 4 or not len(slot_times):
        return out
    assert sr == 22050, sr
    with torch.no_grad():
        st = separate(y, sr)
        env = onset_envelopes(st)
        env = torch.nn.functional.max_pool1d(env[None], 5, stride=1, padding=2)[0].cpu().numpy()   # max over +-2 frames
        cs = torch.cumsum(st.double() ** 2, dim=1).cpu().numpy()
    del st
    # the envelope peaks about one frame after a sharp attack (measured on noise bursts), so centre the window there
    fr = np.clip(np.round(slot_times * sr / HOP).astype(int) + 1, 0, env.shape[1] - 1)
    out[:, :4] = np.log1p(np.maximum(env[:, fr], 0)).T
    cs = np.concatenate([np.zeros((4, 1)), cs], axis=1)
    c = np.round(slot_times * sr).astype(int)
    a, b = np.clip(c - sr, 0, n), np.clip(c + sr, 0, n)
    rms = np.sqrt(np.maximum(cs[:, b] - cs[:, a], 0) / np.maximum(b - a, 1))
    tot = rms.sum(0)
    out[:, 4:] = np.where(tot > 1e-4, rms / np.maximum(tot, 1e-9), 0).T
    out[(slot_times < 0) | (slot_times > n / sr)] = 0
    return out


def _frames(y, n: int):
    from features import FPS, SR
    return np.nan_to_num(extract(y, SR, np.arange(n) / FPS)).astype(np.float16)


def _one(job):
    import io
    import zipfile
    from extract import AUDIO_EXT, CACHE
    from features import load_audio
    zpath, d, key = job
    out = CACHE.parent / "stems" / f"{key}.npy"
    if out.exists():
        return "skip"
    try:
        n = len(np.load(CACHE / f"{key}.npz")["onset"])
        with zipfile.ZipFile(zpath) as z:
            files = [f for f in z.namelist() if f.startswith(d + "/") and f.lower().endswith(AUDIO_EXT)]
            name = sorted(files, key=lambda f: -z.getinfo(f).file_size)[0]
            y = load_audio(io.BytesIO(z.read(name)), suffix=name.rsplit(".", 1)[-1])
        np.save(out, _frames(y, n))
        return "ok"
    except Exception as e:  # noqa: BLE001  (one unreadable song must not stop the run)
        return f"fail {key}: {type(e).__name__}: {e}"


def main() -> None:
    import sys
    from concurrent.futures import ProcessPoolExecutor
    from pathlib import Path
    from extract import CACHE, PACKS, songs_in_zip
    from features import HOP, load_audio
    out = CACHE.parent / "stems"
    out.mkdir(exist_ok=True)
    if sys.argv[1] == "files":
        for p in sorted(Path(sys.argv[2]).glob("*.*")):
            y = load_audio(str(p), suffix=p.suffix[1:])
            np.save(out / f"{p.stem}.npy", _frames(y, 1 + len(y) // HOP))  # data.load fits it to the song's frames
            print(p.stem, flush=True)
        return
    have = {p.stem for p in CACHE.glob("*.npz")}
    jobs = []
    for zpath in sorted(PACKS.rglob("*.zip")):
        for d, _, _ in songs_in_zip(zpath):
            key = f"{zpath.stem}__{d.rsplit('/', 1)[-1]}".replace(" ", "_").replace("/", "_")
            if key in have:
                jobs.append((str(zpath), d, key))
    print(len(jobs), "songs", flush=True)
    with ProcessPoolExecutor(int(sys.argv[2]) if len(sys.argv) > 2 else 3) as ex:
        for i, msg in enumerate(ex.map(_one, jobs)):
            if msg.startswith("fail") or i % 100 == 0:
                print(i, msg, flush=True)


if __name__ == "__main__":
    main()
