"""Playable freeze cleanup and StepMania chart serialization."""
from __future__ import annotations

from fractions import Fraction
import math
from pathlib import Path


# ---------------------------------------------------------------- playability fix-ups
LEAD_IN = 1.0  # seconds before the first step


def tail_after(beats, grid, column, head):
    return next((beat for beat in beats if beat > head and grid[beat][column] == "3"), None)


def held_elsewhere(beats, grid, column, at):
    held = 0
    for other in range(4):
        if other == column:
            continue
        head = max((beat for beat in beats if beat < at and grid[beat][other] == "2"), default=None)
        if head is not None:
            tail = tail_after(beats, grid, other, head)
            held += tail is not None and tail >= at
    return held


def first_hold_conflict(beats, grid, column, head, tail):
    for beat in beats:
        if not head < beat <= tail:
            continue
        row = grid[beat]
        if row[column] in "124" or sum(symbol in "124" for symbol in row) + held_elsewhere(beats, grid, column, beat) >= 2:
            return beat
    return None


def playable(rows, tm, lead_in: float = LEAD_IN):
    """Drop steps in the first second, and end a freeze before any row that would need a third arrow or its panel.
    A freeze left shorter than half a beat becomes a tap. `rows` are (beat, time, "0123"), tails included."""
    rows = [(b, t, r) for b, t, r in rows if t >= lead_in or not any(c in "124" for c in r)]
    grid = {b: list(r) for b, _, r in rows}
    beats = sorted(grid)
    for b in beats:
        for c in range(4):
            if grid[b][c] != "2":
                continue
            tail = tail_after(beats, grid, c, b)
            if tail is None:
                grid[b][c] = "1"
                continue
            stop = first_hold_conflict(beats, grid, c, b, tail)
            if stop is None:
                continue
            grid[tail][c] = "0"
            new_tail = math.floor((stop - 0.25) * 4 + 1e-6) / 4
            if new_tail - b < 0.5:
                grid[b][c] = "1"
            else:
                grid.setdefault(new_tail, ["0"] * 4)[c] = "3"
                if new_tail not in beats:
                    beats = sorted(grid)
    # orphan tails (a head dropped with the lead-in) go too
    open_cols: set[int] = set()
    for b in sorted(grid):
        for c in range(4):
            if grid[b][c] == "2":
                open_cols.add(c)
            elif grid[b][c] == "3":
                if c in open_cols:
                    open_cols.discard(c)
                else:
                    grid[b][c] = "0"
    return [(b, tm.beat_to_time(b), "".join(r)) for b, r in sorted(grid.items()) if "".join(r) != "0000"]


def fixup(paths):
    """Apply `playable` to the charts of finished .ssc files in place."""
    from simfile import parse
    for p in paths:
        text = Path(p).read_text()
        sim = parse(text)
        blocks = text.split("#NOTES:\n")
        out = [blocks[0]]
        for chart, block in zip(sim.charts, blocks[1:]):
            rest = block[block.index("\n;"):]
            rows = playable([(b, sim.timing.beat_to_time(b), r) for b, r in chart.rows], sim.timing)
            out.append(notes_text(rows) + rest)
        Path(p).write_text("#NOTES:\n".join(out))


# ---------------------------------------------------------------- ssc output
def measure_text(rows_in_measure: dict[Fraction, str]) -> str:
    for n in (4, 8, 12, 16, 24, 32, 48, 64, 192):
        if all((pos * n).denominator == 1 for pos in rows_in_measure):
            break
    lines = ["0000"] * n
    for pos, r in rows_in_measure.items():
        lines[int(pos * n)] = r
    return "\n".join(lines)


def notes_text(rows) -> str:
    measures: dict[int, dict[Fraction, str]] = {}
    for b, _, r in rows:
        fb = Fraction(b).limit_denominator(48)
        m = int(fb // 4)
        measures.setdefault(m, {})[(fb - 4 * m) / 4] = r
    last = max(measures) if measures else 0
    return "\n,\n".join(measure_text(measures.get(m, {})) for m in range(last + 1))


def ssc(head: str, charts) -> str:
    out = [head.rstrip() + "\n"]
    for diff, meter, rows in charts:
        out.append(f"\n#NOTEDATA:;\n#STEPSTYPE:dance-single;\n#DESCRIPTION:ChartNet;\n#DIFFICULTY:{diff};\n"
                   f"#METER:{meter};\n#CREDIT:ChartNet;\n#NOTES:\n{notes_text(rows)}\n;\n")
    return "".join(out)
