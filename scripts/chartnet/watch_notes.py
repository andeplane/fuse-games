"""Regenerate a song's charts whenever its chart-lab notes or taps change, so labelling is a loop:
judge a span in the lab (`good ...`, `bad: too many`, a marked band, a tapped rhythm), reload, judge again.

  python watch_notes.py          – watch $CHARTNET_NOTES (the lab's notes.json) and taps/, regenerate what changed
  python watch_notes.py <song>   – regenerate that song once and exit

Each regeneration runs `gen2.py fuse` for the song, puts the charts into the game (`bundle.ts`, `gen.py fixup`,
`gen2.py meters`, `fusemania-charts.ts bundle`) and appends a line to $CHARTNET_WORK/watch.log. The lab served from this checkout
(`pnpm exec vite`) shows the new chart on reload.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

from guidance import NOTES, SNAPSHOT

ROOT = Path(os.environ.get("CHARTNET_WORK", Path.home() / "projects/personal/fusemania-songs/chartnet"))
REPO = Path(__file__).resolve().parents[2]
OUT = ROOT / "out_live"


def fingerprints() -> dict[str, str]:
    """Per song: a hash of its notes and taps."""
    per: dict[str, list] = {}
    if NOTES.exists():
        for note in json.loads(NOTES.read_text()).get("notes", []):
            per.setdefault(note.get("song", ""), []).append(note)
    for path in sorted((NOTES.parent / "taps").glob("*.json")):
        per.setdefault(path.stem, []).append(path.read_text())
    return {song: hashlib.sha1(json.dumps(items, sort_keys=True).encode()).hexdigest() for song, items in per.items()}


def regenerate(song: str) -> bool:
    env = {**os.environ, "CHARTNET_SONGS": song, "CHARTNET_OUT": OUT.name}
    here = Path(__file__).parent
    steps = [
        ([sys.executable, str(here / "gen2.py"), "fuse"], here),
        (["pnpm", "exec", "tsx", "scripts/chartnet/bundle.ts", str(OUT), song], REPO),
        ([sys.executable, str(here / "gen.py"), "fixup", str(REPO / "games/fusemania/charts" / f"{song}.ssc")], here),
        ([sys.executable, str(here / "gen2.py"), "meters", str(REPO / "games/fusemania/charts" / f"{song}.ssc")], here),
        (["pnpm", "exec", "tsx", "scripts/fusemania-charts.ts", "bundle"], REPO),
    ]
    for cmd, cwd in steps:
        done = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True)
        if done.returncode != 0:
            log(f"{song}: FAILED at {Path(cmd[-2]).name if len(cmd) > 2 else cmd[0]}: {done.stderr.strip().splitlines()[-1:]}")
            return False
    snapshot(song)
    return True


def snapshot(song: str) -> None:
    """Copy the labels the charts were just made from into the repository (`labels/`)."""
    if NOTES == SNAPSHOT or not NOTES.exists():
        return
    (SNAPSHOT.parent / "taps").mkdir(parents=True, exist_ok=True)
    SNAPSHOT.write_text(NOTES.read_text())
    taps = NOTES.parent / "taps" / f"{song}.json"
    if taps.exists():
        (SNAPSHOT.parent / "taps" / f"{song}.json").write_text(taps.read_text())


def log(line: str) -> None:
    stamp = time.strftime("%H:%M:%S")
    print(stamp, line, flush=True)
    with open(ROOT / "watch.log", "a") as f:
        f.write(f"{stamp} {line}\n")


def main() -> None:
    if len(sys.argv) > 1:
        ok = regenerate(sys.argv[1])
        log(f"{sys.argv[1]}: {'regenerated' if ok else 'failed'}")
        return
    seen = fingerprints()
    log(f"watching {NOTES} ({len(seen)} songs with labels)")
    while True:
        time.sleep(2)
        try:
            now = fingerprints()
        except (json.JSONDecodeError, OSError):
            continue  # the lab is in the middle of writing the file
        changed = [song for song, h in now.items() if song and seen.get(song) != h]
        if not changed:
            continue
        time.sleep(3)  # let a burst of edits settle
        try:
            now = fingerprints()
        except (json.JSONDecodeError, OSError):
            continue
        for song in [s for s, h in now.items() if s and seen.get(s) != h]:
            t0 = time.time()
            ok = regenerate(song)
            log(f"{song}: {'regenerated' if ok else 'failed'} in {time.time() - t0:.0f} s")
        seen = now


if __name__ == "__main__":
    main()
