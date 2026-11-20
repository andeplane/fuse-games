"""Generate charts with the learned models and compare them with human and rule-based charts.

  python gen.py eval   – held-out pack songs: step-placement F1 and pattern statistics (human vs learned vs rule-based)
  python gen.py fuse   – the 20 Fuse songs: write chartnet/<id>.ssc and pattern statistics vs the current rule charts
"""
from __future__ import annotations

import json
import zlib
import sys
import os
from pathlib import Path

import numpy as np
import torch

from chart_file import fixup, measure_text, notes_text, playable, ssc
from chart_stats import mean_stats, stats
from data import beat_phase, load, split
from features import FPS
from onset import OnsetNet, f1, predict
from placement import SNAP, place
from simfile import DIFFS, Timing
from steps import StepNet, gap_class, phase_class

ROOT = Path(os.environ.get("CHARTNET_WORK", Path.home() / "projects/personal/fusemania-songs/chartnet"))
SP = ROOT  # rule-baseline.ts writes rulegen/out.json here
FUSE_DIFFS = ["Easy", "Medium", "Hard", "Challenge"]
TARGET_NPS = {"Easy": 1.5, "Medium": 2.3, "Hard": 3.2, "Challenge": 4.7}


def timing(meta) -> Timing:
    return Timing(meta["offset"], [tuple(x) for x in meta["bpms"]], [tuple(x) for x in meta.get("stops", [])])


@torch.no_grad()
def choose_steps(model: StepNet, beats, tm: Timing, feats, diff: str, temp=float(__import__("os").environ.get("TEMP_STEPS", "1.0")), seed=0):
    g = torch.Generator().manual_seed(seed)
    rows, h, prev = [], None, 16
    allowed = torch.tensor([bin(m).count("1") <= 2 for m in range(16)])
    allowed[0] = False
    di = torch.tensor([DIFFS.index(diff)])
    for i, b in enumerate(beats):
        pg = b - beats[i - 1] if i else 8.0
        ng = beats[i + 1] - b if i + 1 < len(beats) else 8.0
        cond = torch.tensor([[[gap_class(pg), gap_class(ng), phase_class(b)]]])
        fr = min(max(int(round(tm.beat_to_time(b) * FPS)), 0), len(feats) - 1)
        au = torch.tensor(feats[fr][None, None], dtype=torch.float32)
        logits, h = model(torch.tensor([[prev]]), cond, au, di, h)
        logits = logits[0, 0] / temp
        logits[~allowed] = -1e9
        tok = int(torch.multinomial(torch.softmax(logits, -1), 1, generator=g))
        rows.append((b, tm.beat_to_time(b), "".join("1" if tok >> c & 1 else "0" for c in range(4))))
        prev = tok
    return rows


# ---------------------------------------------------------------- main
def models():
    st = np.load(ROOT / "feat_stats.npz")
    om = OnsetNet(192, True).to("mps")
    om.load_state_dict(torch.load(ROOT / "onset_phase.pt"))
    sm = StepNet(192)
    sm.load_state_dict(torch.load(ROOT / "steps.pt"))
    sm.eval()
    thr = json.loads((ROOT / "onset_phase_results.json").read_text())["learned"]["thr"]
    return (st["mean"], st["std"]), om, sm, thr


def eval_packs():
    stats_, om, sm, thr = models()
    songs, _ = load("cache", stats_)
    _, _, te = split(songs)
    rule = json.loads((SP / "rulegen" / "out.json").read_text())
    hyb_path = SP / "rulegen" / "out_hybrid.json"
    hybrid = json.loads(hyb_path.read_text()) if hyb_path.exists() else {}
    res = {d: {"human": [], "learned": [], "learned_rulegrid": [], "rule": [], "hybrid": []} for d in DIFFS}
    f1s = {d: {k: [0, 0, 0] for k in ("learned", "learned_rulegrid", "rule", "hybrid")} for d in DIFFS}
    tol = 2
    for s in te:
        r = rule.get(s.key)
        for c in s.meta["charts"]:
            d = c["difficulty"]
            if d not in DIFFS:
                continue
            true = np.array([int(round(t * FPS)) for _, t, row in c["rows"] if any(x in "124" for x in row)])
            res[d]["human"].append(stats(c["rows"]))
            variants = [("learned", s.meta, s.phase)]
            if r:
                variants.append(("learned_rulegrid", r, beat_phase(r, len(s.feats))))
            for name, grid, phase in variants:
                s_phase, s.phase = s.phase, phase
                prob = predict(om, s, d)
                s.phase = s_phase
                tm = timing(grid)
                beats = place(prob, tm, d, thr)
                rows = choose_steps(sm, beats, tm, s.feats, d)
                res[d][name].append(stats(rows))
                a, b, cc = f1(np.array([int(round(t * FPS)) for _, t, _ in rows]), true, tol)
                f1s[d][name] = [x + y for x, y in zip(f1s[d][name], (a, b, cc))]
            for name, src in (("rule", r), ("hybrid", hybrid.get(s.key))):
                if not src:
                    continue
                rd = "Easy" if d == "Beginner" else d
                rc = next((x for x in src["charts"] if x["difficulty"] == rd), None)
                if rc:
                    res[d][name].append(stats(rc["rows"]))
                    pred = np.array([int(round(t * FPS)) for _, t, row in rc["rows"] if any(x in "124" for x in row)])
                    a, b, cc = f1(pred, true, tol)
                    f1s[d][name] = [x + y for x, y in zip(f1s[d][name], (a, b, cc))]
    out = {}
    for d in DIFFS:
        out[d] = {"stats": {k: mean_stats(v) for k, v in res[d].items() if v}, "f1": {}}
        for k, (tp, npred, ntrue) in f1s[d].items():
            if ntrue:
                p, rr = tp / max(npred, 1), tp / ntrue
                out[d]["f1"][k] = {"f1": round(2 * p * rr / max(p + rr, 1e-9), 3), "precision": round(p, 3), "recall": round(rr, 3)}
    (ROOT / "eval_results.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


def song_swings(meta: dict) -> bool:
    """A chart uses a triplet subdivision that is off the eighth-note grid."""
    return any(abs(b * 3 - round(b * 3)) < 1e-3 and abs(b * 2 - round(b * 2)) > 1e-3
               for chart in meta["charts"] for b, _, _ in chart["rows"])


def fuse_beats(model, song, grid, diff, threshold, swing):
    # The pack difficulty determines density; the learned model picks the positions.
    target = int(TARGET_NPS[diff] * 0.9 * len(song.feats) / FPS)
    return place(predict(model, song, diff), grid, diff, threshold, n_target=target, swing=swing)


def fuse():
    stats_, om, sm, thr = models()
    songs, _ = load("cache_fuse", stats_)
    outdir = ROOT / "out_fuse"
    outdir.mkdir(exist_ok=True)
    meters = {"Easy": 3, "Medium": 6, "Hard": 9, "Challenge": 11}
    agg = {d: {"rule": [], "learned": []} for d in FUSE_DIFFS}
    for s in songs:
        tm = timing(s.meta)
        swing = song_swings(s.meta)
        charts = []
        for d in FUSE_DIFFS:
            beats = fuse_beats(om, s, tm, d, thr, swing)
            rows = choose_steps(sm, beats, tm, s.feats, d, seed=zlib.crc32((s.key + d).encode()))
            charts.append((d, meters[d], rows))
            agg[d]["learned"].append(stats(rows))
            rc = next((x for x in s.meta["charts"] if x["difficulty"] == d), None)
            if rc:
                agg[d]["rule"].append(stats(rc["rows"]))
        (outdir / f"{s.key}.ssc").write_text(ssc(s.meta["ssc_head"], charts))
        print(s.key, [(d, len(r)) for d, _, r in charts], flush=True)
    out = {d: {k: mean_stats(v) for k, v in agg[d].items()} for d in FUSE_DIFFS}
    (ROOT / "fuse_results.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


def placement():
    """Learned rhythm only, as beats per difficulty, for scripts/chartnet/hybrid.ts (the rule generator's arrows)."""
    stats_, om, _, thr = models()
    songs, _ = load("cache_fuse", stats_)
    out = {}
    for s in songs:
        tm = timing(s.meta)
        swing = song_swings(s.meta)
        out[s.key] = {}
        for d in FUSE_DIFFS:
            out[s.key][d] = [round(b, 4) for b in fuse_beats(om, s, tm, d, thr, swing)]
        print(s.key, {d: len(v) for d, v in out[s.key].items()}, flush=True)
    Path(sys.argv[2]).write_text(json.dumps(out, sort_keys=True) + "\n")


def placement_eval():
    """Learned rhythm for the held-out pack songs on the rule generator's own beat grid (rulegen/out.json)."""
    stats_, om, _, thr = models()
    songs, _ = load("cache", stats_)
    _, _, te = split(songs)
    rule = json.loads((SP / "rulegen" / "out.json").read_text())
    out = {}
    for s in te:
        r = rule.get(s.key)
        if not r:
            continue
        s.phase = beat_phase(r, len(s.feats))
        out[s.key] = {d: [round(b, 4) for b in place(predict(om, s, d), timing(r), d, thr)] for d in FUSE_DIFFS}
    (SP / "rulegen" / "placement.json").write_text(json.dumps(out))


if __name__ == "__main__":
    if sys.argv[1] == "fixup":
        fixup(sys.argv[2:])
    else:
        {"eval": eval_packs, "fuse": fuse, "placement": placement, "placement-eval": placement_eval}[sys.argv[1]]()
