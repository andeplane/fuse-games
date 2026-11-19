"""Summarize part, atmosphere and wiring metadata from a local TIM v1.02 copy."""
import argparse
from collections import Counter
import json
from pathlib import Path
from struct import unpack_from
from inspect_graphics import filename, uint


def volumes(directory):
    index = (directory / "RESOURCE.MAP").read_bytes()
    entries = unpack_from("<H", index, 4)[0]
    cursor = 6
    for _ in range(entries):
        volume = filename(index[cursor:cursor + 13])
        count = unpack_from("<H", index, cursor + 13)[0]
        cursor += 15
        data = (directory / volume).read_bytes()
        for _ in range(count):
            offset = unpack_from("<I", index, cursor + 4)[0]
            cursor += 8
            name = filename(data[offset:offset + 13])
            size = uint(data, offset + 13, 4)
            if size > len(data) - offset - 17:
                raise ValueError("truncated volume entry")
            if name.endswith(".LEV"):
                yield name, data[offset + 17:offset + 17 + size], False
    for path in sorted(directory.glob("*.TIM")):
        yield path.name, path.read_bytes(), True


def read_level(data, freeform=False):
    offset = 0

    def words(count):
        nonlocal offset
        result = unpack_from(f"<{count}H", data, offset)
        offset += count * 2
        return result

    if words(2) != (0xACED, 0x0102):
        raise ValueError("expected a v1.02 TIM level")
    if not freeform:
        for _ in range(2):
            offset = data.index(0, offset) + 1
        words(2)
    air, gravity = words(2)
    if not freeform:
        words(2)
    music, static, moving, inventory = words(4)
    groups = []
    edges = []
    kinds = []
    for count in (static, moving, 0 if freeform else inventory):
        group = []
        for _ in range(count):
            kind, *_ = words(13)
            group.append(kind)
            owner = len(kinds)
            kinds.append(kind)
            belt, _, _ = words(3)
            if belt:
                endpoints = words(2)
                if all(i != 0xFFFF for i in endpoints):
                    edges.append(("belt", *endpoints))
            for _ in range(2):
                rope, _ = words(2)
                if rope:
                    end1, end2, _ = words(3)
                    if 0xFFFF not in (end1, end2):
                        edges.append(("rope", end1, end2))
            _, _, plug1, plug2 = words(4)
            edges.extend(("plug", owner, plug) for plug in (plug1, plug2) if plug != 0xFFFF)
            if kind == 7:
                words(1)
        groups.append(group)
    if offset != len(data):
        raise ValueError("unexpected level trailer")
    if any(index >= len(kinds) for _, a, b in edges for index in (a,b)):
        raise ValueError("connection to missing part")
    return {
        "air": air, "gravity": gravity, "music": music,
        "static": groups[0], "moving": groups[1], "bin": groups[2],
        "connections": dict(Counter(kind for kind, _, _ in edges)),
        "edge_types": [(kind,kinds[a],kinds[b]) for kind,a,b in edges],
    }


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("directory", type=Path)
    args = cli.parse_args()
    levels = {name: read_level(data, freeform) for name, data, freeform in volumes(args.directory)}
    overview = {}
    for category, records in (("puzzles", [v for k,v in levels.items() if k.endswith(".LEV")]),
                              ("examples", [v for k,v in levels.items() if k.endswith(".TIM")])):
        overview[category] = {
            "count": len(records),
            "parts": {g: dict(sorted(Counter(i for v in records for i in v[g]).items()))
                      for g in ("static", "moving", "bin")},
            "atmospheres": dict(Counter(f"{v['air']}/{v['gravity']}" for v in records)),
            "connections": dict(sum((Counter(v["connections"]) for v in records), Counter())),
            "edge_types": dict(Counter(f"{kind}:{a},{b}" for v in records for kind,a,b in v["edge_types"])),
        }
    print(json.dumps(overview, indent=2))
