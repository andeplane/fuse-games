"""Where a chart gets busy: a small model over the whole song that predicts, every half second, how many steps a
chart has there compared with its own average.

The placement model (`onset.py`) looks a few seconds each way and knows which sounds are steps; asked for N steps
it spreads them fairly evenly. Human charts do not: they thin out in a calm verse and stream through a solo. This
model reads a pooled summary of the song at 2 frames a second (band energies, onset strength and note rate per
band, the placement model's own probability mass) and learns that shape from the pack charts.

  python density.py pool    – pooled features and targets for every cached song → $CHARTNET_WORK/pool/<key>.npz
  python density.py train   – train → profile.pt; prints the held-out correlation with the human charts
  python density.py eval    – held-out correlation only
"""
from __future__ import annotations

import glob
import json
import os
import random
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

from data import DIFFS, band_rhythm, beat_phase, diff_index, song_title
from features import FPS

ROOT = Path(os.environ.get("CHARTNET_WORK", Path.home() / "projects/personal/fusemania-songs/chartnet"))
DEV = torch.device("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")
NAME = os.environ.get("CHARTNET_PROFILE", "profile")  # the weights' file name
HOP = 0.5  # seconds between profile frames
WIN = 2.0  # seconds each frame summarises
N_FEAT = 16 + 8 + 8 + 8 + 3 + 2


def _peaks(x: np.ndarray) -> np.ndarray:
    return np.where((x > np.r_[-1, x[:-1]]) & (x >= np.r_[x[1:], -1]))[0]


def pooled(logmel: np.ndarray, onset: np.ndarray, prob_c: np.ndarray, prob_h: np.ndarray) -> np.ndarray:
    """(frames at 2 Hz, N_FEAT): band energy, band onset strength (mean and peak), band note rate, full-band onset
    statistics, and the placement model's probability mass for a Challenge and a Hard chart."""
    n = len(logmel)
    flux = band_rhythm(logmel)[:, :8]  # log1p onset strength in 8 bands
    energy = logmel[:, 64:128].astype(np.float32).reshape(n, 16, 4).mean(2)
    marks = np.zeros((n, 8), np.float32)  # 1 where a band has a clear onset
    for b in range(8):
        pk = _peaks(flux[:, b])
        thr = 1.5 * (np.median(flux[pk, b]) if len(pk) else 0.0)
        marks[pk[flux[pk, b] > thr], b] = 1.0
    full = np.log1p(np.maximum(onset[:n], 0))
    pk = _peaks(full)
    full_marks = np.zeros(n, np.float32)
    full_marks[pk[full[pk] > 1.5 * np.median(full[pk])]] = 1.0
    out = []
    half = int(WIN * FPS / 2)
    for c in range(0, n, int(HOP * FPS)):
        a, b = max(c - half, 0), min(c + half, n)
        sec = (b - a) / FPS
        out.append(np.concatenate([energy[a:b].mean(0), flux[a:b].mean(0), flux[a:b].max(0), marks[a:b].sum(0) / sec,
                                   [full[a:b].mean(), full[a:b].max(), full_marks[a:b].sum() / sec],
                                   [prob_c[a:b].sum() / sec, prob_h[a:b].sum() / sec]]))
    return np.array(out, np.float32)


def target(chart: dict, n_frames: int) -> tuple[np.ndarray, float]:
    """Steps per second around each profile frame divided by the chart's own average, and that average."""
    t = np.array([x for _, x, r in chart["rows"] if any(ch in "124" for ch in r)])
    nps = len(t) / max(t[-1] - t[0], 1.0)
    centres = np.arange(0, n_frames) * HOP
    rate = np.array([np.sum((t >= c - WIN / 2) & (t < c + WIN / 2)) / WIN for c in centres])
    inside = (centres >= t[0]) & (centres <= t[-1])  # before the first and after the last step nothing is learned
    return np.where(inside, rate / nps, -1.0).astype(np.float32), float(nps)


def pool_all(cache: str = "cache") -> None:
    import gen2
    from onset import predict
    from data import Song
    stats_, om, cfg = gen2.placement_model()
    out = ROOT / ("pool" if cache == "cache" else "pool_fuse")
    out.mkdir(exist_ok=True)
    files = sorted(glob.glob(str(ROOT / cache / "*.json")))
    for i, j in enumerate(files):
        key = Path(j).stem
        if (out / f"{key}.npz").exists():
            continue
        meta = json.loads(Path(j).read_text())
        z = np.load(j[:-5] + ".npz")
        raw = z["feats"]
        f = np.concatenate([raw, band_rhythm(raw).astype(np.float16)], axis=1) if cfg["n_in"] > 192 else raw
        f = ((f.astype(np.float32) - stats_[0]) / stats_[1]).astype(np.float16)
        s = Song(key, f, beat_phase(meta, len(f)), z["onset"], meta)
        x = pooled(raw, z["onset"], predict(om, s, "Challenge", 6.0), predict(om, s, "Hard", 4.0))
        charts = [(diff_index(c["difficulty"]),) + target(c, len(x)) for c in meta["charts"]
                  if c["difficulty"] in DIFFS and sum(any(ch in "124" for ch in r) for _, _, r in c["rows"]) > 40]
        np.savez(out / f"{key}.npz", x=x, diffs=np.array([c[0] for c in charts]),
                 nps=np.array([c[2] for c in charts], np.float32),
                 y=np.array([c[1] for c in charts], np.float32).reshape(len(charts), len(x)))
        if i % 200 == 0:
            print(i, "of", len(files), key, x.shape, flush=True)


class _Res(nn.Module):
    def __init__(self, h: int, dil: int):
        super().__init__()
        self.c = nn.Sequential(nn.Conv1d(h, h, 3, padding=dil, dilation=dil), nn.GELU(), nn.BatchNorm1d(h),
                               nn.Conv1d(h, h, 1), nn.Dropout(0.1))

    def forward(self, x):
        return x + self.c(x)


class ProfileNet(nn.Module):
    """Dilated convolutions over the 2 Hz frames: each output sees about a minute either way."""

    def __init__(self, n_in: int = N_FEAT, h: int = 128):
        super().__init__()
        self.inp = nn.Conv1d(n_in + len(DIFFS) + 1, h, 1)
        self.body = nn.Sequential(*[_Res(h, d) for d in (1, 2, 4, 8, 16, 32, 64, 1, 2, 4)])
        self.out = nn.Conv1d(h, 1, 1)

    def forward(self, x: torch.Tensor, diff: torch.Tensor, nps: torch.Tensor) -> torch.Tensor:
        n = x.shape[1]
        d = nn.functional.one_hot(diff, len(DIFFS)).float()[:, None].expand(-1, n, -1)
        z = torch.cat([x, d, torch.log(nps)[:, None, None].expand(-1, n, 1)], -1).transpose(1, 2)
        return nn.functional.softplus(self.out(self.body(self.inp(z))).squeeze(1))


LEAD = os.environ.get("CHARTNET_LEAD", "0") == "1"  # add `lead.py`'s six measures to the inputs


def with_lead(x: np.ndarray, key: str, folder: str) -> np.ndarray | None:
    """The pooled features with the lead measures appended (None when the song has none)."""
    path = ROOT / ("lead" if folder == "pool" else "lead_fuse") / f"{key}.npy"
    if not path.exists():
        return None
    lead = np.load(path)
    if len(lead) < len(x):
        lead = np.pad(lead, ((0, len(x) - len(lead)), (0, 0)), mode="edge")
    return np.concatenate([x, lead[:len(x)]], axis=1)


def load_pool(keys: set[str] | None = None, exclude_titles: set[str] | None = None, folder: str = "pool",
              need_lead: bool = False):
    ex = []
    for p in sorted(glob.glob(str(ROOT / folder / "*.npz"))):
        key = Path(p).stem
        if keys is not None and key not in keys:
            continue
        if exclude_titles and song_title(key) in exclude_titles:
            continue
        if need_lead and not (ROOT / "lead" / f"{key}.npy").exists():
            continue
        z = np.load(p)
        if LEAD:
            x = with_lead(z["x"], key, folder)
            if x is None:
                continue
            for d, nps, y in zip(z["diffs"], z["nps"], z["y"]):
                ex.append((key, x, int(d), float(nps), y))
            continue
        for d, nps, y in zip(z["diffs"], z["nps"], z["y"]):
            ex.append((key, z["x"], int(d), float(nps), y))
    return ex


def correlation(model: ProfileNet, exs, stats, only=("Hard", "Challenge")) -> dict[str, float]:
    """Mean per-chart correlation between the predicted and the human chart's local density."""
    model.eval()
    res: dict[str, list[float]] = {}
    with torch.no_grad():
        for _, x, d, nps, y in exs:
            if DIFFS[d] not in only:
                continue
            m = y >= 0
            if m.sum() < 20 or y[m].std() < 1e-6:
                continue
            p = model(torch.tensor((x - stats[0]) / stats[1])[None].to(DEV), torch.tensor([d]).to(DEV),
                      torch.tensor([nps], dtype=torch.float32).to(DEV))[0].cpu().numpy()
            res.setdefault(DIFFS[d], []).append(float(np.corrcoef(p[m], y[m])[0, 1]))
    return {k: round(float(np.nanmean(v)), 3) for k, v in res.items()}


def held_out():
    t1 = set(json.loads((ROOT / "test_keys.json").read_text()))
    t2 = set(json.loads((ROOT / "test2_keys.json").read_text()))
    return t1, t2


def train(steps: int = 6000) -> None:
    t1, t2 = held_out()
    titles = {song_title(k) for k in t1 | t2}
    need = os.environ.get("CHARTNET_NEED_LEAD", "0") == "1"  # the same songs as a run with CHARTNET_LEAD=1
    tr = [e for e in load_pool(exclude_titles=titles, need_lead=need) if e[0] not in t1 | t2]
    allx = np.concatenate([e[1] for e in tr[::7]])
    stats = (allx.mean(0), allx.std(0) + 1e-5)
    np.savez(ROOT / f"{NAME}_stats.npz", mean=stats[0], std=stats[1])
    te1, te2 = load_pool(t1, need_lead=need), load_pool(t2, need_lead=need)
    print(len(tr), "training charts;", len(te1), "and", len(te2), "held-out charts", DEV, "inputs", allx.shape[1], flush=True)
    model = ProfileNet(allx.shape[1]).to(DEV)
    opt = torch.optim.AdamW(model.parameters(), 2e-3, weight_decay=1e-3)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, 3e-3, total_steps=steps)
    L = 240  # two minutes
    for step in range(steps):
        model.train()
        X, D, N, Y = [], [], [], []
        for _, x, d, nps, y in random.sample(tr, 48):
            st = random.randint(0, max(0, len(x) - L))
            xs, ys = (x[st:st + L] - stats[0]) / stats[1], y[st:st + L]
            pad = L - len(xs)
            X.append(np.pad(xs, ((0, pad), (0, 0))))
            Y.append(np.pad(ys, (0, pad), constant_values=-1))
            D.append(d)
            N.append(nps)
        y = torch.tensor(np.stack(Y)).to(DEV)
        p = model(torch.tensor(np.stack(X), dtype=torch.float32).to(DEV), torch.tensor(D).to(DEV),
                  torch.tensor(N, dtype=torch.float32).to(DEV))
        m = y >= 0
        loss = nn.functional.smooth_l1_loss(p[m], y[m])
        opt.zero_grad()
        loss.backward()
        nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        sched.step()
        if step % 500 == 0 or step == steps - 1:
            print(step, round(loss.item(), 4), "DDR/ITG", correlation(model, te1, stats), "community",
                  correlation(model, te2, stats), flush=True)
    torch.save(model.state_dict(), ROOT / f"{NAME}.pt")


def load_model() -> tuple[ProfileNet, tuple[np.ndarray, np.ndarray]]:
    st = np.load(ROOT / f"{NAME}_stats.npz")
    model = ProfileNet(len(st["mean"])).to(DEV)
    model.load_state_dict(torch.load(ROOT / f"{NAME}.pt", map_location="cpu"))
    return model.eval(), (st["mean"], st["std"])


@torch.no_grad()
def busy(model: ProfileNet, stats, x: np.ndarray, diff: str, nps: float) -> np.ndarray:
    """The predicted profile for one song: local density over the chart's average, one value per HOP seconds."""
    return model(torch.tensor((x - stats[0]) / stats[1])[None].to(DEV), torch.tensor([diff_index(diff)]).to(DEV),
                 torch.tensor([nps], dtype=torch.float32).to(DEV))[0].cpu().numpy()


if __name__ == "__main__":
    if sys.argv[1] == "pool":
        pool_all(sys.argv[2] if len(sys.argv) > 2 else "cache")
    elif sys.argv[1] == "train":
        train(int(sys.argv[2]) if len(sys.argv) > 2 else 6000)
    else:
        t1, t2 = held_out()
        m, st = load_model()
        print("DDR/ITG", correlation(m, load_pool(t1), st), "community", correlation(m, load_pool(t2), st))
