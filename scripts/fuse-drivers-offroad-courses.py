"""Bake native route geometry from the 1990 DOS release. Usage: python3 scripts/fuse-drivers-offroad-courses.py /path/to/game.exe"""

import hashlib
import json
import math
import struct
import subprocess
import sys
from pathlib import Path

source = Path(sys.argv[1]).read_bytes()
if hashlib.sha256(source).hexdigest() != "a67ba31b021ed53d2d033cbe67ecb32a4537bf20593392bcf4ba85d3fd67836c":
    raise SystemExit("Unrecognised game.exe. This decoder targets the October 1990 DOS build.")
data = source[0x5B40:]


def word(offset, signed=False):
    return struct.unpack_from("<h" if signed else "<H", data, offset)[0]


def in_range(value, lo, hi):
    return lo <= value <= hi if lo < hi else value >= lo or value <= hi


def extract(index):
    def entry(offset):
        return word(offset + 2 * index)

    # File 17b0–182f initialises four trucks from these route-specific tables.
    x, y = entry(0x5262), entry(0x5282)
    heading, z = entry(0x52C2), entry(0x52A2)
    base = 0x52E2 + (16 if heading & 0x8000 else 0)
    grid = [[x + word(base + i, True), y + word(base + i + 2, True)] for i in range(0, 16, 4)]
    # A fifth Fuse seat starts half a row behind the rear pair, in its middle.
    rear = (min if heading == 0 else max)(p[0] for p in grid)
    grid.append([rear + (-384 if heading == 0 else 384), y + 384])
    regions = []
    pos = entry(0x6B24)
    while len(regions) < 64:
        left, right, bottom, top, _, _, flags = data[pos:pos + 7]
        regions.append([left, right, top, bottom])
        pos += 7
        if flags & 128:
            break
    else:
        raise ValueError("unterminated region stream")

    # The CPU chooses the nearest eligible waypoint, then follows an AI program.
    # Record a single line, using a fixed middle difficulty and no random shortcuts.
    program = entry(0x755A)
    pos = program
    candidates = []
    enabled = True
    lengths = [5, 4, 5, 3, 3, 1, 2, 2, 3, 3]
    while data[pos] != 0x8A:
        op = data[pos]
        if op < 128:
            px, py = data[pos:pos + 2]
            if enabled:
                candidates.append(((px - x / 256)**2 + (py - y / 256)**2, pos))
            pos += 2
        else:
            if op == 0x83:
                enabled = in_range(0, *data[pos + 1:pos + 3])
            pos += lengths[op - 128]
    _, pos = min(candidates)
    points = []
    goal = laps = 0
    last = (x / 256, y / 256)
    for _ in range(5000):
        op = data[pos]
        if op < 128:
            point = tuple(data[pos:pos + 2])
            # Traverse the segment, using the original unsigned high-byte rectangle tests.
            steps = max(1, math.ceil(8 * math.dist(point, last)))
            for j in range(1, steps + 1):
                ax, ay = [math.floor(a + (b - a) * j / steps) for a, b in zip(last, point)]
                left, right, top, bottom = regions[goal]
                if left <= ax < right and top <= ay <= bottom:
                    goal += 1
                    if goal == len(regions):
                        goal = 0
                        laps += 1
            if laps == 2:
                break
            if laps == 1 and (not points or list(point) != points[-1][:2]):
                points.append([*point, goal])
            last = point
            pos += 2
            continue
        if op == 0x8A:
            raise ValueError("unexpected terminal opcode")
        offset = pos + lengths[op - 128] - 2
        lo, hi = data[pos + 1:pos + 3]
        jump = (op == 0x84 or (op == 0x80 and in_range(goal, lo, hi))
                or (op == 0x82 and in_range(6, lo, hi)))
        pos = offset + word(offset, True) if jump else pos + lengths[op - 128]
    else:
        raise ValueError(f"route {index}: could not trace a lap (laps={laps}, target={goal})")
    return dict(grid=grid, heading=heading, height=z, regions=regions, line=points,
                offset=[word(0x53EC + 2 * (index % 8), True), word(0x53FC + 2 * (index % 8), True)])


routes = [extract(i) for i in range(16)]
output = Path(__file__).resolve().parents[1] / "games/fuse-drivers/src/game/offroad/courses-data.json"
output.write_text(json.dumps(routes, separators=(",", ":")) + "\n")
subprocess.run(["pnpm", "exec", "prettier", "--write", str(output)], check=True, cwd=output.parents[5])
