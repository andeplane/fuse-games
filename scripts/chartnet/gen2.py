"""ChartNet v2: density-conditioned placement + learned arrows with foot-flow limits.

  python gen2.py eval [Hard,Challenge]  – held-out pack songs: human vs v2 vs hybrid vs rule-based
  python gen2.py fuse                   – the 20 Fuse songs → $CHARTNET_WORK/out_fuse2/<id>.ssc
"""
from __future__ import annotations

from dataclasses import dataclass
import json
import os
import sys
import zlib
from pathlib import Path

import numpy as np
import torch

from arrows import PENALTY, ArrowNet, generate
import data
from data import Song, load
from features import FPS
from bursts import burst_beats
from guidance import forced_beats, has_taps, jump_beats, keep_locked, noted_opening, opening_beat, verdicts
from chart_stats import active_rows, mean_stats, stats2
from chart_file import ssc
from gen import FUSE_DIFFS, song_swings, timing
from placement import SNAP, only_24th, place
from onset import DEV, OnsetNet, chart_nps, f1, predict
import repeats
from simfile import DIFFS, Timing

ROOT = Path(os.environ.get("CHARTNET_WORK", Path.home() / "projects/personal/fusemania-songs/chartnet"))
# What the Fuse charts aim at, in steps per second. Hard is what Challenge was until 2026-11-15 (the packs' meter 12),
# and Challenge is a new, much denser chart: as busy as the packs' 15s where the tempo allows it.
FUSE_NPS = {"Easy": 1.8, "Medium": 3.2, "Hard": 7.0, "Challenge": 10.0}
# The difficulty the models are asked for: a Fuse Hard is written the way the packs write a Challenge.
MODEL_DIFF = {"Easy": "Easy", "Medium": "Medium", "Hard": "Challenge", "Challenge": "Challenge"}
# Where a span judged good in the chart lab takes its rows from: the chart of the same name in games/fusemania/charts.
# CHARTNET_LOCK_FROM="Hard=Challenge,Challenge=" is for the one regeneration that moves the ladder (a Hard that was a
# Challenge keeps the spans judged good on that chart; the new Challenge has nothing to keep).
LOCK_FROM = {d: d for d in ("Easy", "Medium", "Hard", "Challenge")} | dict(
    pair.split("=") for pair in os.environ.get("CHARTNET_LOCK_FROM", "").split(",") if pair)
# A cover's Hard is its original's hardest chart; its Challenge is at most this many times busier.
COVER_STEP = 1.75
# A Hard is at most this share of what its song's Challenge reached, in steps a second.
HARD_SHARE = 0.78
# 24ths closer together than this many seconds are kept to the bursts the Hard chart has (see `fuse`).
FREE_24TH_GAP = 0.085
# The foot-flow costs of the new Challenge: in long streams the same arrow twice running costs more than at Hard's
# density, which brings jacks down to what the packs' charts of that density have (1.6% of steps, from 2.6%).
DENSE_PENALTY = {**PENALTY["Challenge"], "jack": float(os.environ.get("CHARTNET_DENSE_JACK", "1.5"))}


def runs_24th(beats: list[float]) -> list[list[float]]:
    """The runs of steps a 24th apart, each as its beats."""
    out: list[list[float]] = []
    run = beats[:1]
    for a, b in zip(beats, beats[1:]):
        if abs(b - a - 1 / 6) < 1e-6:
            run.append(b)
            continue
        if len(run) >= 2:
            out.append(run)
        run = [b]
    if len(run) >= 2:
        out.append(run)
    return out


def with_runs(beats: list[float], runs: list[list[float]]) -> list[float]:
    """`beats` with each run put in, in place of the steps it would crowd (closer than a 24th to its ends)."""
    for run in runs:
        beats = [b for b in beats if b <= run[0] - 1 / 6 + 1e-6 or b >= run[-1] + 1 / 6 - 1e-6] + run
    return sorted(set(beats))
# The meter a chart gets: the packs' meter whose median chart is as busy (steps a second, from 13,000 pack charts).
# Until 2026-11-15 the meters were fixed per difficulty and ran about three too high: a 15 here played like a pack 12.
PACK_NPS = {int(m): nps for m, nps in json.loads(
    (Path(__file__).resolve().parents[2] / "games/fusemania/charts/pack-meters.json").read_text())["nps"].items()}


def meter_for(nps: float) -> int:
    """The pack meter whose median chart has `nps` rows a second."""
    return min(PACK_NPS, key=lambda m: abs(PACK_NPS[m] - nps))


def set_meters(paths: list[str]) -> None:
    """Write each chart's meter into finished .ssc files, from the rows it has after `gen.py fixup`: the pack
    meter for its density, never below the chart before it."""
    import re
    from simfile import parse
    for path in paths:
        text = Path(path).read_text()
        sim = parse(text)
        head, *blocks = text.split("#NOTEDATA:")
        if len(blocks) != len(sim.charts):  # a chart the parser skips would shift every meter after it
            raise ValueError(f"{path}: {len(blocks)} charts in the file, {len(sim.charts)} parsed")
        last = 0
        for i, chart in enumerate(sim.charts):
            times = sorted({sim.timing.beat_to_time(b) for b, r in chart.rows if any(c in "124" for c in r)})
            if len(times) < 2:
                continue
            last = max(last, meter_for((len(times) - 1) / max(times[-1] - times[0], 1.0)))
            blocks[i] = re.sub(r"#METER:\d+;", f"#METER:{last};", blocks[i], count=1)
        Path(path).write_text("#NOTEDATA:".join([head, *blocks]))


def ladder(key: str) -> dict[str, float]:
    """A song's target density per difficulty: the ladder above, and for a cover built on its original's hardest
    chart. A slow song cannot hold a Challenge that busy; placement then fills what its grid allows."""
    target = dict(FUSE_NPS)
    if key in COVERS:
        top = COVERS[key]["nps"]
        target["Hard"] = top
        target["Challenge"] = min(target["Challenge"], COVER_STEP * top)
    cap_lower_difficulties(target)
    return target


def cap_lower_difficulties(target: dict[str, float]) -> None:
    target["Medium"] = min(target["Medium"], 0.6 * target["Hard"])
    target["Easy"] = min(target["Easy"], 0.65 * target["Medium"])


# Placement: peaks above the density model's validation threshold (it is told the density it should reach), or with
# PLACE_THR=0 the strongest peaks up to the target count.
THR = float(os.environ.get("PLACE_THR", "0"))
_COVERS_FILE = Path(__file__).resolve().parents[2] / "games/fusemania/charts/covers-challenge.json"
COVERS = {k: v for k, v in json.loads(_COVERS_FILE.read_text()).items() if k != "about"} if _COVERS_FILE.exists() else {}
# 24th bursts on Challenge: "learned" lets the placement model put steps on the 24th grid (kept only as runs),
# "rule" is the onset test in bursts.py, "both" and "off" as they say.
BURSTS = os.environ.get("CHARTNET_BURSTS", "both")
WEIGHTS = (os.environ.get("CHARTNET_ONSET", "onset_v3"), os.environ.get("CHARTNET_ARROWS", "arrows_c1"))


def with_bursts(beats: list[float], burst: list[int]) -> tuple[list[float], int]:
    """Each burst beat k becomes six 24ths (k, k + 1/6, ...); whatever was placed inside it gives way."""
    if not burst:
        return beats, 0
    keep = [b for b in beats if not any(k <= b < k + 1 for k in burst)]
    added = [k + j / 6 for k in burst for j in range(6)]
    return sorted(set(keep) | set(added)), len(burst)


def placement_model():
    cfg_path = ROOT / f"{WEIGHTS[0]}.json"
    cfg = json.loads(cfg_path.read_text()) if cfg_path.exists() else {"n_in": 192, "wide": False}
    data.BANDS = cfg["n_in"] > 192  # the features the weights were trained on
    st = np.load(ROOT / cfg.get("stats", "feat_stats.npz"))  # the normalisation the weights were trained with
    om = OnsetNet(cfg["n_in"], True, use_density=True, wide=cfg["wide"]).to(DEV)
    om.load_state_dict(torch.load(ROOT / f"{WEIGHTS[0]}.pt", map_location="cpu"))
    return (st["mean"], st["std"]), om, cfg


def busy_profiles():
    """The busy-ness model (`density.py`), or None when CHARTNET_BUSY=0 or it has not been trained."""
    if os.environ.get("CHARTNET_BUSY", "1") == "0" or not (ROOT / "profile.pt").exists():
        return None
    import density
    return density.load_model()


def busy_for(profiles, key: str, diff: str, nps: float, folder: str = "pool"):
    if profiles is None or not (ROOT / folder / f"{key}.npz").exists():
        return None
    import density
    return density.busy(profiles[0], profiles[1], np.load(ROOT / folder / f"{key}.npz")["x"], diff, nps)


def local_density_corr(a: np.ndarray, b: np.ndarray) -> float | None:
    """Correlation of two step lists' steps per 2 s window (hop 1 s): do they get busy in the same places?"""
    if len(a) < 20 or len(b) < 20:
        return None
    wins = np.arange(b[0], b[-1] - 2.0, 1.0)
    ra = np.array([np.sum((a >= w) & (a < w + 2)) for w in wins])
    rb = np.array([np.sum((b >= w) & (b < w + 2)) for w in wins])
    if len(wins) < 5 or ra.std() < 1e-9 or rb.std() < 1e-9:
        return None
    return float(np.corrcoef(ra, rb)[0, 1])


def accumulate_streams(totals: list[int], beats: list[float]) -> None:
    run = longest = 1
    adjacent = 0
    for before, after in zip(beats, beats[1:]):
        fast = after - before <= 0.25 + 1e-6
        adjacent += fast
        run = run + 1 if fast else 1
        longest = max(longest, run)
    totals[0] += adjacent
    totals[1] += max(len(beats) - 1, 1)
    totals[2] += longest
    totals[3] += 1


def place_eval(keys_file="test_keys.json"):
    """Step-timing F1 of the placement model alone on held-out songs, told each human chart's density and count."""
    stats_, om, _ = placement_model()
    profiles = busy_profiles()
    corr: dict = {}
    te, _ = load("cache", stats_, only=set(json.loads((ROOT / keys_file).read_text())))
    tot: dict = {}
    streams: dict = {}
    same: dict = {}
    for s in te:
        tm = timing(s.meta)
        for c in s.meta["charts"]:
            d = c["difficulty"]
            true = np.array([int(round(t * FPS)) for _, t, r in c["rows"] if any(x in "124" for x in r)])
            prob = repeats.share(predict(om, s, d, chart_nps(c)), s.feats, tm)
            beats = place(prob, tm, d, 0.0, n_target=len(true),
                          snap24=d == "Challenge" and BURSTS in ("learned", "both"),
                          busy=busy_for(profiles, s.key, d, chart_nps(c)))
            r = local_density_corr(np.array([tm.beat_to_time(b) for b in beats]), true / FPS)
            if r is not None:
                corr.setdefault(d, []).append(r)
            got = f1(np.array([int(round(tm.beat_to_time(b) * FPS)) for b in beats]), true)
            for name, bs in (("gen", beats), ("human", sorted(b for b, _, r in c["rows"] if any(x in "124" for x in r)))):
                if d in ("Hard", "Challenge"):
                    got_c = repeats.consistency(list(bs), s.feats, tm, len(prob))
                    same[name] = [x + y for x, y in zip(same.get(name, [0.0, 0]), got_c)]
                accumulate_streams(streams.setdefault((d, name), [0, 0, 0, 0]), bs)
            for k in (d, "all"):
                t = tot.setdefault(k, [0, 0, 0])
                t[:] = [x + y for x, y in zip(t, got)]
    out = {}
    for k, (tp, npred, ntrue) in tot.items():
        p, r = tp / max(npred, 1), tp / max(ntrue, 1)
        out[k] = round(2 * p * r / max(p + r, 1e-9), 3)
    print(WEIGHTS[0], keys_file, " ".join(f"{k}={out[k]}" for k in ["all"] + [d for d in DIFFS if d in out]))
    print("   busy where the human chart is busy (correlation per chart):",
          " ".join(f"{d}={np.mean(v):.2f}" for d, v in corr.items()))
    print(f"   same rhythm on bars that sound alike (Hard and Challenge, sharing {repeats.SHARE}):",
          " ".join(f"{n}={v[0] / max(v[1], 1):.3f}" for n, v in same.items()),
          f"({same.get('gen', [0.0, 0])[1]} bar pairs)")
    for d in ("Hard", "Challenge"):
        print("  ", d, " ".join(f"{n}: 16th-stream share {streams[d, n][0] / streams[d, n][1]:.3f}, longest run "
                                f"{streams[d, n][2] / streams[d, n][3]:.1f};" for n in ("gen", "human") if (d, n) in streams))
    return out


def models():
    stats_, om, cfg = placement_model()
    sd = torch.load(ROOT / f"{WEIGHTS[1]}.pt", map_location="cpu")
    n_audio = sd["au.0.weight"].shape[1]
    am = ArrowNet(n_audio, sd["tok.weight"].shape[1],
                  len({k.split(".")[2] for k in sd if k.startswith("tr.layers.")})).to("mps")
    am.load_state_dict(sd)
    if n_audio != cfg["n_in"]:  # arrows with the band channels, placement without: load them, placement skips them
        assert n_audio > cfg["n_in"], "the arrow model needs the placement model's features"
        data.BANDS = True
        st = np.load(ROOT / os.environ.get("CHARTNET_ARROW_STATS", "feat_stats_v3_208.npz"))
        stats_ = (st["mean"], st["std"])
    return stats_, om, am


def step_frames(rows) -> np.ndarray:
    return np.array([int(round(t * FPS)) for _, t, row in active_rows(rows)])


def evaluate_chart(song, chart, tm, om, am, profiles):
    difficulty = chart["difficulty"]
    original = [(b, t, row) for b, t, row in chart["rows"]]
    nps = chart_nps(chart)
    probabilities = predict(om, song, difficulty, nps)
    beats = place(probabilities, tm, difficulty, THR, n_target=None if THR > 0 else len(active_rows(original)),
                  snap24=difficulty == "Challenge" and BURSTS in ("learned", "both"),
                  busy=busy_for(profiles, song.key, difficulty, nps))
    predicted = generate(am, song, beats, tm, difficulty, nps,
                         seed=zlib.crc32((song.key + difficulty).encode()))
    return original, predicted


def add_comparisons(totals: dict, difficulty: str, rule: dict | None, hybrid: dict | None) -> None:
    matching = "Easy" if difficulty == "Beginner" else difficulty
    for name, source in (("rule", rule), ("hybrid", hybrid)):
        if not source:
            continue
        chart = next((one for one in source["charts"] if one["difficulty"] == matching), None)
        if chart:
            totals[name].append(stats2(chart["rows"]))


def eval_packs(only=None, keys_file="test_keys.json", out_name="eval2_results.json"):
    stats_, om, am = models()
    profiles = busy_profiles()
    te, _ = load("cache", stats_, only=set(json.loads((ROOT / keys_file).read_text())))
    rd = ROOT / "rulegen"
    rule = json.loads((rd / "out.json").read_text())
    hyb = json.loads((rd / "out_hybrid.json").read_text())
    res: dict = {}
    f1s: dict = {}
    for s in te:
        tm = timing(s.meta)
        for c in s.meta["charts"]:
            d = c["difficulty"]
            if only and d not in only:
                continue
            human, predicted = evaluate_chart(s, c, tm, om, am, profiles)
            r = res.setdefault(d, {"human": [], "v2": [], "hybrid": [], "rule": []})
            r["human"].append(stats2(human))
            r["v2"].append(stats2(predicted))
            matched = f1(step_frames(predicted), step_frames(human))
            counts = f1s.setdefault(d, [0, 0, 0])
            counts[:] = [total + more for total, more in zip(counts, matched)]
            add_comparisons(r, d, rule.get(s.key), hyb.get(s.key))
    out = {}
    for d in DIFFS:
        if d not in res:
            continue
        out[d] = {"stats": {k: mean_stats(v) for k, v in res[d].items() if v}}
        tp, npred, ntrue = f1s[d]
        p, rr = tp / max(npred, 1), tp / max(ntrue, 1)
        out[d]["v2_f1_at_human_density"] = round(2 * p * rr / max(p + rr, 1e-9), 3)
    (ROOT / out_name).write_text(json.dumps(out, indent=1))
    for d, v in out.items():
        print(d, "F1", v["v2_f1_at_human_density"])
        for k, st in v["stats"].items():
            print("   ", k.ljust(7), " ".join(f"{a[:7]}={b}" for a, b in st.items()))


def current_rows(key: str, diff: str):
    """The chart the game has now for this song and difficulty: [(beat, time, row)]."""
    from simfile import parse
    path = Path(__file__).resolve().parents[2] / "games/fusemania/charts" / f"{key}.ssc"
    if not path.exists():
        return []
    sim = parse(path.read_text())
    chart = next((c for c in sim.charts if c.difficulty == diff), None)
    return [] if chart is None else [(b, sim.timing.beat_to_time(b), r) for b, r in chart.rows]


@dataclass
class SongPlan:
    """Density targets and review guidance shared by the four charts for one song."""

    song: Song
    model: OnsetNet
    profiles: tuple | None
    timing: Timing
    raw: np.ndarray
    swing: bool
    target: dict[str, float]
    locked: list[tuple[float, float]]
    scale: list[tuple[float, float, float]]
    guided: int = 0
    burst_count: int | None = None

    def beats(self, g: str, *, bursts: bool = True) -> list[float]:
        """Where the steps of this song's `g` chart go, in beats. Without `bursts` nothing lands on 24ths."""
        s, tm, target, swing = self.song, self.timing, self.target, self.swing
        d = MODEL_DIFF[g]  # the difficulty the models are asked for
        prob = repeats.share(predict(self.model, s, d, target[g]), s.feats, tm)  # bars that sound alike, same rhythm
        n_target = None if THR > 0 else int(target[g] * 0.9 * len(s.feats) / FPS)
        noted, forced = self.review_beats(g, d, prob)
        beats = place(prob, tm, d, THR, n_target=n_target, swing=swing,
                      snap24=bursts and d == "Challenge" and BURSTS in ("learned", "both"), forced=forced,
                      busy=busy_for(self.profiles, s.key, d, target[g], "pool_fuse"), scale=self.scale)
        if noted is not None:
            beats = [b for b in beats if b >= noted - 1e-6]
        if bursts and d == "Challenge":
            return self.add_bursts(g, beats)
        return beats

    def review_beats(self, difficulty: str, model_difficulty: str, probability: np.ndarray):
        s, tm, target = self.song, self.timing, self.target
        g, d = difficulty, model_difficulty
        # review material from the chart lab: a marked band's onsets (8ths on Medium, 16ths above it), and where
        # he tapped, as many steps as he tapped (a share of them on the charts below Hard)
        # a chart starts where a review note says it should; without one, and without a tapped rhythm to
        # follow, on the song's first clear, sharp sound
        noted = noted_opening(s.key, s.onset, tm, SNAP[d])
        start = noted if noted is not None else None if has_taps(s.key) else opening_beat(s.onset, tm, SNAP[d])
        forced: list[float] = [] if start is None else [start]
        if g != "Easy":
            grid = {"Medium": [2], "Challenge": [4]}[d] + ([3] if self.swing and d != "Medium" else [])
            forced = sorted(set(forced) | set(forced_beats(
                s.key, self.raw, tm, grid, probability, share=min(1.0, target[g] / target["Hard"]))))
        self.guided = max(self.guided, len(forced) - (start is not None))
        return noted, forced

    def add_bursts(self, difficulty: str, beats: list[float]) -> list[float]:
        s, tm = self.song, self.timing
        if BURSTS in ("rule", "both"):  # where the music itself moves at 24th speed
            beats, n_burst = with_bursts(beats, burst_beats(s.onset, tm, beats[0], beats[-1]))
            if difficulty == "Challenge":  # the count printed at the end is the top chart's
                self.burst_count = n_burst
        if difficulty == "Challenge" and BURSTS == "learned":
            self.burst_count = len({int(b) for b in beats if only_24th(b)})
        return beats

def prepare_song(song: Song, model: OnsetNet, profiles) -> SongPlan:
    locked, scale = verdicts(song.key)
    raw = np.load(ROOT / "cache_fuse" / f"{song.key}.npz")["feats"]
    return SongPlan(song, model, profiles, timing(song.meta), raw, song_swings(song.meta),
                    ladder(song.key), locked, scale)


def fuse_charts(plan: SongPlan, am: ArrowNet):
    s, tm, target = plan.song, plan.timing, plan.target
    charts = []
    # A Challenge asked for more steps than its sixteenths hold fills up with 24ths. On a slow song those are
    # a stream like any other; on a faster one (24ths closer than FREE_24TH_GAP) they are 12 steps a second and
    # more, which human charts keep to short bursts. There the Challenge gets its 24ths from the Hard chart, which
    # has them only where the music does, and its extra steps go on the ordinary grid.
    fast = 10.0 / float(np.median([bpm for _, bpm in s.meta["bpms"]])) < FREE_24TH_GAP

    # A slow song's grid fills up before a Challenge gets as busy as asked. The Hard below it then steps down,
    # so the two stay a clear step apart (HARD_SHARE of what the Challenge reached), and the easier charts follow.
    top = plan.beats("Challenge", bursts=not fast)
    reached = (len(top) - 1) / max(tm.beat_to_time(top[-1]) - tm.beat_to_time(top[0]), 1.0)
    if target["Hard"] * 0.9 > HARD_SHARE * reached:
        target["Hard"] = HARD_SHARE * reached / 0.9
        cap_lower_difficulties(target)
    hard = plan.beats("Hard")
    if fast:
        top = with_runs(top, runs_24th(hard))
    for g in FUSE_DIFFS:
        d = MODEL_DIFF[g]
        beats = top if g == "Challenge" else hard if g == "Hard" else plan.beats(g)
        rows = generate(am, s, beats, tm, d, target[g], seed=zlib.crc32((s.key + g).encode()),
                        penalty=DENSE_PENALTY if g == "Challenge" else None,
                        jumps=None if g == "Easy" else jump_beats(s.key, plan.raw, tm, beats))
        if plan.locked and LOCK_FROM.get(g):  # spans judged good keep the chart they have now
            rows = keep_locked(rows, current_rows(s.key, LOCK_FROM[g]), plan.locked)
        stepped = [t for _, t, r in rows if any(c in "124" for c in r)]
        charts.append((g, meter_for((len(stepped) - 1) / max(stepped[-1] - stepped[0], 1.0)), rows))
    for i in range(1, len(charts)):  # a harder chart never carries a lower meter
        charts[i] = (charts[i][0], max(charts[i][1], charts[i - 1][1]), charts[i][2])
    return charts


def fuse():
    stats_, om, am = models()
    profiles = busy_profiles()
    only = set(os.environ["CHARTNET_SONGS"].split(",")) if os.environ.get("CHARTNET_SONGS") else None
    songs, _ = load("cache_fuse", stats_, only=only)
    outdir = ROOT / os.environ.get("CHARTNET_OUT", "out_fuse2")
    outdir.mkdir(exist_ok=True)
    agg: dict = {}
    bursts_: dict = {}
    guided: dict = {}
    only = set(sys.argv[2:])  # song ids, or every song
    for s in songs:
        if only and s.key not in only:
            continue
        plan = prepare_song(s, om, profiles)
        charts = fuse_charts(plan, am)
        if plan.burst_count is not None:
            bursts_[s.key] = plan.burst_count
        if plan.guided:
            guided[s.key] = plan.guided
        for difficulty, _, rows in charts:
            agg.setdefault(difficulty, []).append(stats2(rows))
        (outdir / f"{s.key}.ssc").write_text(ssc(s.meta["ssc_head"], charts))
        print(s.key, [(d, len(r)) for d, _, r in charts], flush=True)
    summary = {d: mean_stats(v) for d, v in agg.items()}
    print("24th bursts (beats) per song:", bursts_)
    print("steps placed from review notes:", {k: v for k, v in guided.items() if v})
    (ROOT / "fuse2_results.json").write_text(json.dumps(summary, indent=1))
    for d, st in summary.items():
        print(d.ljust(9), " ".join(f"{a[:7]}={b}" for a, b in st.items()))


if __name__ == "__main__":
    if sys.argv[1] == "eval":
        eval_packs(sys.argv[2].split(",") if len(sys.argv) > 2 else None)
    elif sys.argv[1] == "arrow-eval":  # the arrow model's loss on held-out charts
        from arrows import held_out_loss
        stats_, _, am = models()
        for keys in ("test_keys.json", "test2_keys.json"):
            te, _ = load("cache", stats_, only=set(json.loads((ROOT / keys).read_text())))
            print(WEIGHTS[1], keys, round(held_out_loss(am, te), 3))
    elif sys.argv[1] == "meters":  # after gen.py fixup: the meters of finished .ssc files
        set_meters(sys.argv[2:])
    elif sys.argv[1] == "place-eval":
        place_eval(sys.argv[2] if len(sys.argv) > 2 else "test_keys.json")
    elif sys.argv[1] == "eval2":  # the held-out community songs (stream and stamina packs)
        eval_packs(sys.argv[2].split(",") if len(sys.argv) > 2 else None, "test2_keys.json", "eval2_community.json")
    else:
        fuse()
