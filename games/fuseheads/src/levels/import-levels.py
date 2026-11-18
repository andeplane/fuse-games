"""Regenerate Fuseheads' level data from visible AppleDouble .rsrc files (unar -forks visible).

Usage: python3 import-levels.py '/path/to/Bonkheads Deluxe'
Only decoded campaign data is emitted. The source application is not required.
"""

import base64
import json
import struct
import sys
from pathlib import Path


def resources(path):
    data = path.read_bytes()
    u16 = lambda offset: struct.unpack_from(">H", data, offset)[0]
    u32 = lambda offset: struct.unpack_from(">I", data, offset)[0]
    if u32(0) != 0x00051607:
        raise ValueError(f"{path} is not an AppleDouble file")
    fork = next(
        u32(i + 4)
        for i in range(26, 26 + u16(24) * 12, 12)
        if u32(i) == 2
    )
    body = fork + u32(fork)
    table = fork + u32(fork + 4)
    names = table + u16(table + 26)
    types = table + u16(table + 24)
    result = {}
    for i in range(types + 2, types + 2 + 8 * (1 + u16(types)), 8):
        kind = data[i : i + 4].decode("macroman")
        refs = types + u16(i + 6)
        records = {}
        for j in range(refs, refs + 12 * (1 + u16(i + 4)), 12):
            offset = u16(j + 2)
            name_at = names + offset
            name = "" if offset == 65535 else data[name_at + 1 : name_at + 1 + data[name_at]].decode("macroman")
            start = body + (u32(j + 4) & 0xFFFFFF)
            records[u16(j)] = (name, data[start + 4 : start + 4 + u32(start)])
        result[kind] = records
    return result


def words(data):
    return struct.unpack(f">{len(data) // 2}h", data)


def build_pack(path, original):
    archive = resources(path)
    campaign = []
    seen = set()
    current = 128
    while current not in (998, 999):
        if current in seen:
            raise ValueError("cyclic MLST chain")
        seen.add(current)
        name, record = archive["MLST"][current]
        world = words(record)
        # BossFinale MLSTs reuse stale ordinary map slots; only their sixth slot is used.
        indices = (5,) if original and current >= 1000 else range(6)
        for slot in indices:
            map_id = world[26] if slot == 5 else world[slot]
            boss = archive["BOSS"][world[11]][1] if slot == 5 else b""
            pests = b"" if slot == 5 else archive["ENDT"][world[6 + slot]][1]
            campaign.append(level(name, world, archive["BKMP"][map_id][1], map_id, slot, pests, boss))
        current = world[25]
    if original:
        name, record = archive["MLST"][15000]
        world = words(record)
        campaign.append(level(name, world, archive["BKMP"][world[0]][1], world[0], 0, archive["ENDT"][world[6]][1], b""))
    return campaign


def level(name, world, bitmap, map_id, slot, pests, boss):
    cells = words(bitmap)
    if len(cells) != 600 or (pests and len(pests) != 2 + 26 * words(pests)[0]):
        raise ValueError(f"Invalid map or pest table for {name}/{map_id}")
    # Store row-major cells as printable ASCII. Original words range from -1 to 51.
    tiles = "".join(chr(65 + cells[x * 30 + y]) for y in range(30) for x in range(20))
    return {
        "name": name,
        "mapId": map_id,
        "stage": slot + 1,
        "backgroundId": world[5],
        "platformId": world[13],
        "starts": world[19:23],
        "environment": [world[i] for i in (23, 24, 27, 28, 29, 16)],
        "tiles": tiles,
        "pests": base64.b64encode(pests[2:]).decode("ascii"),
        "boss": words(boss),
    }


if __name__ == "__main__":
    root = Path(sys.argv[1])
    campaign = {
        "original": build_pack(root / "Original Levels.rsrc", True),
        "bonus": build_pack(root / "Bonus Levels.rsrc", False),
    }
    out = Path(__file__).with_name("campaign.json")
    out.write_text(json.dumps(campaign, indent=2, ensure_ascii=False) + "\n")
