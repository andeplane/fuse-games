"""Decode Ronny Wester's mission data from the pinned C-Dogs DOS v1.06 package."""

import hashlib
import json
import struct
import sys
from pathlib import Path


FILES = {
    "CDOGS.EXE": "1a9420f29c7bd9c99b8c5083f583636c7b236c3f52e5ee1fba968a8d30647f1e",
    "DISTRESS.CPN": "3e174aae981fc24b06e14baeaa97138b7b9e67bfe680b2ea664479cbb3937782",
    "TERROR.CPN": "d81d6cd1e1f02f06233eac14d3ca3ac06e80edd428ba43322195cfd8bc7cbd7e",
    "ZOMBIE.CPN": "bf5f3405050ef6500af44a423e36ec7c878487185756563ab8ef54cb831793a4",
}
KINDS = ["kill", "collect", "destroy", "rescue", "investigate"]
CHARACTER = "armedBody unarmedBody face speed move track shoot delay gun skin arms body legs hair hp flags"


class Reader:
    def __init__(self, data, offset=0):
        self.data = data
        self.offset = offset

    def ints(self, count):
        values = struct.unpack_from(f"<{count}i", self.data, self.offset)
        self.offset += 4 * count
        return list(values)

    def number(self):
        return self.ints(1)[0]

    def string(self, size):
        start = self.offset
        self.offset += size
        return self.data[start:self.offset].split(b"\0", 1)[0].decode("cp437")

    def fields(self, names):
        keys = names.split()
        return dict(zip(keys, self.ints(len(keys)), strict=True))

    def indexed(self, size):
        count = self.number()
        assert 0 <= count <= size
        return self.ints(size)[:count]


def read_mission(r):
    start = r.offset
    m = dict(title=r.string(60), description=r.string(400))
    m.update(r.fields("wallStyle floorStyle roomStyle exitStyle keyStyle doorStyle width height walls wallLength rooms squares"))
    exit_rect = r.fields("left top right bottom")
    m["exit"] = exit_rect if exit_rect["left"] > 0 else None
    count = r.number()
    objectives = []
    for _ in range(5):
        description = r.string(60)
        kind = KINDS[r.number()]
        objectives.append(dict(description=description, kind=kind, **r.fields("index count required flags")))
    assert 0 <= count <= 5
    m["objectives"] = objectives[:count]
    m["enemies"] = r.indexed(12)
    m["specials"] = r.indexed(6)
    indices = r.indexed(16)
    densities = r.ints(16)
    m["items"] = [dict(index=i, density=d) for i, d in zip(indices, densities)]
    m["enemyDensity"] = r.number()
    mask = r.number() or -1
    m["allowedWeapons"] = [i for i in range(16) if mask & (1 << i)][:11]
    m["song"] = r.string(80)
    m["map"] = r.string(80)
    m.update(r.fields("wallRange floorRange roomRange altRange"))
    assert r.offset - start == 1324
    return m


def read_header(r):
    return dict(title=r.string(40), author=r.string(40), description=r.string(200))


def read_builtin(exe, title, campaign_id):
    r = Reader(exe, exe.index(title.encode("ascii") + b"\0"))
    campaign = dict(id=campaign_id, **read_header(r))
    mission_count, mission_ptr, character_count, character_ptr = r.ints(4)
    # For this Watcom LE executable, these initialized data pointers are relative
    # to the beginning of object three, at 238080 in the distributed EXE.
    missions = Reader(exe, 238080 + mission_ptr)
    characters = Reader(exe, 238080 + character_ptr)
    campaign["missions"] = [read_mission(missions) for _ in range(mission_count)]
    campaign["characters"] = [characters.fields(CHARACTER) for _ in range(character_count)]
    return campaign


def read_file(data, campaign_id):
    r = Reader(data)
    assert r.ints(2) == [690304, 6]  # FILES.C: magic and format version
    campaign = dict(id=campaign_id, **read_header(r))
    campaign["missions"] = [read_mission(r) for _ in range(r.number())]
    campaign["characters"] = [r.fields(CHARACTER) for _ in range(r.number())]
    assert r.offset == len(data)
    return campaign


def read_art_tables(exe):
    r = Reader(exe, 71408)  # cGeneralPics[141]
    offsets = [r.fields("dx dy id") for _ in range(141)]
    r = Reader(exe, 251284)  # mapItems, pickupItems, four key styles
    props = []
    for _ in range(40):
        prop = r.fields("offsetSprite wreckOffsetSprite halfWidth halfHeight hp flags")
        prop["sprite"] = offsets[prop["offsetSprite"]]
        prop["wreck"] = offsets[prop["wreckOffsetSprite"]] if prop["wreckOffsetSprite"] else None
        props.append(prop)
    pickups = [offsets[i] for i in r.ints(12)]
    keys = [[offsets[i] for i in r.ints(4)] for _ in range(4)]
    return props, pickups, keys


def main(folder):
    files = {name: (folder / name).read_bytes() for name in FILES}
    for name, data in files.items():
        if hashlib.sha256(data).hexdigest() != FILES[name]:
            raise ValueError(f"Unexpected DOS file: {name}")
    exe = files["CDOGS.EXE"]
    campaigns = [read_builtin(exe, "Bug-Eyed Monsters", "bem"),
                 read_builtin(exe, "Ogre Rampage", "ogre")]
    campaigns.extend(read_file(files[f"{name}.CPN"], name.lower()) for name in ["DISTRESS", "TERROR", "ZOMBIE"])
    assert all(c["author"] == "Ronny Wester" for c in campaigns)
    arenas = []
    for title in ["Dogfight in the dungeon", "Cubicle wars"]:
        m = read_builtin(exe, title, "")["missions"][0]
        m["title"] = title
        arenas.append(m)
    props, pickups, keys = read_art_tables(exe)
    output = ['// Generated by import_campaigns.py. C-Dogs campaign data © Ronny Wester, CC BY.',
              'import type { Campaign, Mission, Prop, OffsetSprite } from "./types.js";', ""]
    # Keep each source record on its own line; field names are explicit even in the generated tables.
    def record(value):
        return json.dumps(value, ensure_ascii=False, separators=(", ", ": "))
    output.extend(["// prettier-ignore", "export const CAMPAIGNS: Campaign[] = ["])
    for c in campaigns:
        output.append("  {")
        for k in ["id", "title", "author", "description"]:
            output.append(f"    {k}: {record(c[k])},")
        for k in ["missions", "characters"]:
            output.append(f"    {k}: [")
            output.extend(f"      {record(v)}," for v in c[k])
            output.append("    ],")
        output.append("  },")
    output.append("];")
    for name, kind, data in [("DOGFIGHTS", "Mission", arenas), ("PROP_DEFS", "Prop", props),
                             ("PICKUP_SPRITES", "OffsetSprite", pickups), ("KEY_SPRITES", "OffsetSprite[]", keys)]:
        output.extend(["", "// prettier-ignore", f"export const {name}: {kind}[] = ["])
        output.extend(f"  {record(v)}," for v in data)
        output.append("];")
    Path(__file__).with_name("data.ts").write_text("\n".join(output) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
