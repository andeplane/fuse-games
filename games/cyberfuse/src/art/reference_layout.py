"""Inspect the v1.06 slot geometry and C lookup tables. No DOS pixel data is exported."""

import hashlib
import json
import re
import struct

PACKS = {
    "CDOGS.PX": "74a91767e70858ee82b4958694291f5f0d6a8f257cff9a8f6664ff3154f38d9a",
    "CDOGS2.PX": "a5f97193c537bd835f30ba756251ed5071161e8167b987098b20183ba1c779c9",
    "FONT.PX": "d68dcb9efc9fc49cdc1bead2f34e7df2e51848912b036bc5e6e6ef43854050d5",
}


def dimensions(path):
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != PACKS[path.name]:
        raise ValueError(f"Unexpected DOS pack revision: {path.name}")
    offset = 256 * 3
    slots = []
    while offset < len(data):
        (size,) = struct.unpack_from("<H", data, offset)
        offset += 2
        if not size:
            slots.append(None)
            continue
        w, h = struct.unpack_from("<HH", data, offset)
        if w * h + 4 != size or offset + size > len(data):
            raise ValueError(f"Malformed slot {len(slots)} in {path.name}")
        slots.append((w, h))
        offset += size
    return slots


def extract(dos, source):
    c = re.sub(r"//[^\n]*", "", (source / "PICS.C").read_text("latin-1"))

    def table(name):
        match = re.search(r"\b" + name + r"\s*\[[^;]+?=\s*(\{.*?\});", c, re.DOTALL)
        value = re.sub(r"P2\s*\+\s*(\d+)", lambda m: str(398 + int(m[1])), match[1])
        return json.loads(
            value.replace("PIC_UZIBULLET", "42").replace("{", "[").replace("}", "]")
        )

    names = re.findall(
        r"#define OFSPIC_(\w+)\s+(\d+)", (source / "PICS.H").read_text("latin-1")
    )
    props = table("cGeneralPics")
    data = {
        key: table("c" + name)
        for key, name in [
            ("body", "BodyPic"),
            ("head", "HeadPic"),
            ("gun", "GunPics"),
            ("bodyOffset", "BodyOffset"),
            ("headOffset", "HeadOffset"),
            ("neck", "NeckOffset"),
            ("hand", "GunHandOffset"),
            ("death", "DeathPics"),
            ("wall", "WallPics"),
            ("floor", "FloorPics"),
            ("room", "RoomPics"),
        ]
    }
    data["props"] = {
        name.lower(): props[int(i)] for name, i in names if int(i) < len(props)
    }
    data["offsets"] = props
    data["effects"] = {
        key: table("c" + label + "Pics")
        for key, label in [
            ("flame", "Flame"),
            ("fireball", "FireBall"),
            ("grenade", "Grenade"),
            ("beam", "Beam"),
            ("brightBeam", "BrightBeam"),
        ]
    }
    data["props"].update(grenade=table("cGrenadePics")[0], exit=[-8, -6, 375])
    data["dims"] = dimensions(dos / "CDOGS.PX") + dimensions(dos / "CDOGS2.PX")
    data["glyphs"] = dimensions(dos / "FONT.PX")
    return data
