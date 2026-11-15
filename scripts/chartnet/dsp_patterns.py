"""Assign learned arrows to fixed DSP rhythms. Never loads a learned placement model."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
from types import SimpleNamespace
import zlib

import numpy as np
import torch

from arrows import ArrowNet, DEV, Feet, generate
from data import band_rhythm
from features import features_from_audio
from gen import ssc, playable


class FixedTiming:
    """Times sampled by the authoritative TS timing implementation at every 1/24 beat.

    All selected heads and hold tails lie on this grid, including triplets. Python never
    reparses DWI or reinterprets offsets/stops. Interpolation only handles floating-point noise.
    """
    def __init__(self, times, resolution=24):
        self.times = times
        self.resolution = resolution

    def beat_to_time(self, beat):
        index = beat * self.resolution
        lo = int(math.floor(index + 1e-8))
        if lo < 0 or lo + 1 >= len(self.times):
            raise ValueError("Pattern model requested timing outside the exported map")
        fraction = max(0.0, index - lo)
        return self.times[lo] + fraction * (self.times[lo + 1] - self.times[lo])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--jobs", required=True)
    parser.add_argument("--weights", required=True)
    parser.add_argument("--stats", required=True)
    parser.add_argument("--audio-cache", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--shard", default="0/1")
    parser.add_argument("--candidates", type=int, default=6)
    parser.add_argument("--skip-ids", default="")
    args = parser.parse_args()
    torch.set_num_threads(int(os.environ.get("CHARTNET_THREADS", "1")))
    shard, total = map(int, args.shard.split("/"))
    if total < 1 or not 0 <= shard < total:
        raise ValueError("Invalid shard")
    weights = Path(args.weights)
    state = torch.load(weights, map_location="cpu", weights_only=True)
    columns = state["au.0.weight"].shape[1]
    model = ArrowNet(columns, state["tok.weight"].shape[1],
                     len({key.split(".")[2] for key in state if key.startswith("tr.layers.")})).to(DEV)
    model.load_state_dict(state)
    stats = np.load(args.stats)
    pack_nps = {int(m): nps for m, nps in json.loads(
        (Path(__file__).resolve().parents[2] / "games/fusemania/charts/pack-meters.json").read_text())["nps"].items()}
    output = Path(args.out)
    output.mkdir(parents=True, exist_ok=True)
    jobs = json.loads(Path(args.jobs).read_text())
    skipped = set(args.skip_ids.split(","))
    for index, job in enumerate(jobs):
        if index % total != shard or job["id"] in skipped:
            continue
        audio_hash = job["audioHash"]
        suffix = job["audio"].rsplit(".", 1)[-1]
        audio = Path(args.audio_cache) / f"{job['id']}-{audio_hash[:12]}.{suffix}"
        if hashlib.sha256(audio.read_bytes()).hexdigest() != audio_hash:
            raise ValueError("Audio checksum mismatch")
        raw, _ = features_from_audio(audio)
        features = np.concatenate([raw, band_rhythm(raw)], axis=1) if columns == 208 else raw
        if features.shape[1] != columns or len(stats["mean"]) != columns:
            raise ValueError("Pattern model feature contract mismatch")
        song = SimpleNamespace(feats=((features - stats["mean"]) / stats["std"]).astype(np.float16))
        timing = FixedTiming(job["timeMap"], job.get("timingResolution", 24))
        charts, report, last_meter = [], [], 0
        for chart in job["charts"]:
            beats = chart["beats"]
            pattern = chart["pattern"]
            allowed = pattern["allowedPanels"]
            max_panels = pattern["maxPanels"]
            if (not allowed or any(type(c) is not int or c not in range(4) for c in allowed)
                    or type(max_panels) is not int or not 1 <= max_panels <= 2
                    or pattern["allowCrossovers"] is not False or pattern["allowHolds"] is not False):
                raise ValueError("Invalid fixed-rhythm pattern constraints")
            if not beats:
                raise ValueError(f"Empty {chart['level']} rhythm in {job['id']}")
            actual_nps = len(beats) / job["duration"]
            seed = zlib.crc32((job["id"] + chart["level"] + "dsp-v1").encode())
            with torch.inference_mode():
                rows = generate(model, song, beats, timing, chart["level"], actual_nps,
                                seed=seed, candidates=args.candidates if chart["level"] in ("Hard", "Challenge") else 1,
                                allowed_cols=allowed, max_panels=max_panels,
                                allow_crossovers=False, allow_holds=False)
            rows = playable(rows, timing, lead_in=0)
            feet = Feet()
            for beat, _, row in rows:
                cols = [c for c, kind in enumerate(row) if kind == "1"]
                if any(kind not in "01" for kind in row) or not cols or len(cols) > max_panels or any(c not in allowed for c in cols):
                    raise ValueError("Final chart violates panel/hold constraints")
                assigned, ev = feet.assign(cols, beat)
                if ev["crossover"] or ev["hand"] or any((foot == 0 and col == 3) or (foot == 1 and col == 0) for foot, col in zip(assigned, cols)):
                    raise ValueError("Final chart requires a crossover")
                feet.apply(cols, {}, beat)
            heads = [(b, time) for b, time, row in rows if any(c in "124" for c in row)]
            if len(heads) != len(beats) or any(abs(b - expected) > 1e-7 or abs(time - target) > 1e-6
                    for (b, time), expected, target in zip(heads, beats, chart["times"])):
                raise ValueError("Pattern generation changed the fixed DSP rhythm")
            active_nps = (len(heads) - 1) / max(heads[-1][1] - heads[0][1], 1.0)
            meter = max(last_meter, min(pack_nps, key=lambda m: abs(pack_nps[m] - active_nps)))
            last_meter = meter
            charts.append((chart["level"], meter, rows))
            report.append({"level": chart["level"], "rows": len(heads), "fixedTimingVerified": True,
                           "seed": seed, "realizedNps": actual_nps, "policy": chart["policy"],
                           "selection": chart.get("selection", "ai-policy"),
                           "pattern": pattern, "finalPatternVerified": True})
        text = ssc(job["head"], charts).replace("#CREDIT:ChartNet;", "#CREDIT:DSP rhythm + ChartNet patterns;")
        (output / f"{job['id']}.ssc").write_text(text)
        (output / f"{job['id']}.json").write_text(json.dumps({"id": job["id"], "charts": report,
             "weightsSha256": hashlib.sha256(weights.read_bytes()).hexdigest(), "torch": torch.__version__,
             "candidates": args.candidates, "audioSha256": audio_hash, "duration": job["duration"],
             "sscSha256": hashlib.sha256(text.encode()).hexdigest(),
             "generatorSources": {name: hashlib.sha256((Path(__file__).parent / name).read_bytes()).hexdigest()
                                  for name in ("dsp_patterns.py", "arrows.py", "gen.py", "data.py", "features.py", "feet.py", "steps.py")}}))
        print(job["id"], [(c[0], len(c[2])) for c in charts], flush=True)


if __name__ == "__main__":
    main()
