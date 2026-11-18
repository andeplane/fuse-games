"""Prepare local reference art: python3 scripts/fuse-drivers-reference.py OFFROAD palette.png OUTPUT.json"""
import argparse
import base64
import hashlib
import json
import struct
from pathlib import Path


def encoded(data):
    return base64.b64encode(data).decode("ascii")


def plane(data, pos):
    result = bytearray(8000)
    for x in range(40):
        y = 0
        while y < 200:
            value = data[pos]
            pos += 1
            run = 1
            if y < 199 and value in (0, 255):
                run += data[pos]
                pos += 1
            if y + run > 200:
                raise ValueError("Invalid course column")
            for row in range(y, y + run):
                result[row * 40 + x] = value ^ 255
            y += run
    return result, pos


def indices(planes):
    return bytes(sum(((p[i] >> shift) & 1) << bit for bit, p in enumerate(planes))
                 for i in range(len(planes[0])) for shift in range(7, -1, -1))


def course(data):
    mask_start = int.from_bytes(data[:4], "big")
    pos = 4
    planes = []
    for _ in range(4):
        p, pos = plane(data, pos)
        planes.append(p)
    if not 0 <= mask_start - pos <= 1:
        raise ValueError("Invalid course mask offset")
    mask, pos = plane(data, mask_start + 4)
    if not 0 <= len(data) - pos <= 1:
        raise ValueError("Invalid course mask length")
    pixels = indices(planes)
    # First row of the four colored counters in the stadium's baked scoreboard.
    stripe = bytes([14]).join(bytes([color])*11 for color in (10, 7, 2, 5))
    counter = pixels.index(stripe)
    return {"pixels": encoded(pixels), "mask": encoded(mask), "counter": counter}


def sprites(ega, source, start, count, planes):
    result = []
    cursor = 0
    for frame in range(count):
        offset, segment, h, y, w, x = struct.unpack_from("<HHBBBB", ega, start + 8*frame)
        if offset + 16*segment != cursor or not w or w % 8:
            raise ValueError("Invalid EGA frame index")
        stride = w // 8
        pixels = bytearray()
        for _ in range(h):
            row = [source[cursor+k*stride:cursor+(k+1)*stride] for k in range(planes)]
            pixels.extend(indices(row))
            cursor += planes*stride
        result.append({"x": x, "y": y, "width": w, "pixels": encoded(pixels)})
    if cursor != len(source):
        raise ValueError("Unconsumed EGA sprite data")
    return result


def palette(png):
    if png[:8] != bytes.fromhex("89504e470d0a1a0a"):
        raise ValueError("Expected an indexed DOS capture in PNG format")
    pos = 8
    while pos + 12 <= len(png):
        length = int.from_bytes(png[pos:pos+4], "big")
        if png[pos+4:pos+8] == b"PLTE" and length >= 48:
            return list(png[pos+8:pos+56])
        pos += length + 12
    raise ValueError("The reference capture needs a 16-color palette")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ["folder", "palette_png", "output"]:
        parser.add_argument(arg, type=Path)
    args = parser.parse_args()
    if args.output.resolve().is_relative_to(Path(__file__).resolve().parents[1]):
        parser.error("Choose a private output location outside the repository")
    game = (args.folder / "game.exe").read_bytes()
    ega = (args.folder / "ega.exe").read_bytes()
    if (hashlib.sha256(game).hexdigest() != "a67ba31b021ed53d2d033cbe67ecb32a4537bf20593392bcf4ba85d3fd67836c"
            or hashlib.sha256(ega).hexdigest() != "0000c0595ea4550e7fd56f1f8b4760c89fe0b66f708675c7e3da6d93c2fa1260"):
        parser.error("The frame directory and pose table require the 1990 DOS EGA release")
    ds = game[0x5b40:]
    poses = []
    for pose in range(25):
        base, table = struct.unpack_from("<HH", ds, 0x5126 + 4*pose)
        poses.append([base + ds[table + heading] for heading in range(32)])
    bank = ega[0x290:]
    pack = {
        "version": 1, "palette": palette(args.palette_png.read_bytes()), "poses": poses,
        "clipHeights": [v*256 for v in ds[0x524a:0x5252]],
        "tracks": [course((args.folder / f"track{i}.xx").read_bytes()) for i in range(8)],
        "trucks": sprites(bank, (args.folder / "etruck.pcg").read_bytes(), 0xa46, 412, 3),
        "shadows": sprites(bank, (args.folder / "eshadow.pcg").read_bytes(), 0xa46+412*8, 32, 1),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(pack, separators=(",", ":")))
    print(f"Prepared {args.output} with 8 courses, 412 truck frames and 32 shadows")


if __name__ == "__main__":
    main()
