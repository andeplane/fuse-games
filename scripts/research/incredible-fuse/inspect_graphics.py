"""Inventory a locally supplied DOS Incredible Machine build, without writing any images."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
from struct import unpack_from


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def uint(data, at, length):
    require(0 <= at <= len(data) - length, "truncated integer")
    return int.from_bytes(data[at:at + length], "little")


def filename(field):
    name = field.split(b"\0", 1)[0].decode("ascii")
    require(name and all(c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_." for c in name)
            and name not in (".", ".."), "invalid archive entry name")
    return name


def tags(data):
    at = 0
    result = {}
    while at < len(data):
        tag = data[at:at + 4].decode("ascii")
        length = uint(data, at + 4, 4) & 0x7fffffff
        at += 8
        require(tag not in result and at + length <= len(data), "invalid chunk")
        result[tag] = data[at:at + length]
        at += length
    return result


def validate_scn(frame, width, height):
    # Count painted samples only. Skipped horizontal spans stay transparent.
    at = 1  # First byte selects a palette base.
    x = y = 0
    while at < len(frame):
        mode, count = divmod(frame[at], 64)
        at += 1
        if mode == 0:
            y += 1
            x -= count
            if at < len(frame) and 0 < frame[at] < 64:
                x -= 64 * frame[at]
                at += 1
        elif mode == 1:
            if count == 0:
                return
            x += count
        else:
            require(0 <= x <= x + count <= width and 0 <= y < height, "paint outside frame")
            at += 1 if mode == 2 else (count + 1) // 2
            x += count
    raise ValueError("unterminated SCN frame")


def expanded_bin_size(data):
    # Measure the decompressed stream with dictionary lengths alone, so the
    # tool never reconstructs the pixel buffer. Type 2 uses LSB-first LZW.
    require(data[0] == 2, "unknown BIN codec")
    expected = uint(data, 1, 4)
    size = 0
    bit = 0
    lengths = []
    width = 9
    body = data[5:]
    while size < expected:
        require(bit + width <= 8 * len(body), "truncated LZW token")
        start, shift = divmod(bit, 8)
        word = int.from_bytes(body[start:start + 3], "little")
        token = (word >> shift) & ((1 << width) - 1)
        bit += width
        if token == 256:
            bit += -bit % 160  # This DOS codec aligns resets on 20-byte boundaries.
            lengths.clear()
            width = 9
            continue
        if token < 256:
            length = 1
        else:
            require(token - 257 < len(lengths), "unknown LZW entry")
            length = lengths[token - 257] + 1
        size += length
        next_code = 257 + len(lengths)
        if next_code == 1 << width and width < 12:
            width += 1
        if next_code < 4096:
            lengths.append(length)
    require(size == expected, "BIN expanded size mismatch")
    return size


def inspect_bitmap(body):
    sections = tags(tags(body)["BMP:"])
    info = sections["INF:"]
    count = uint(info, 0, 2)
    require(len(info) == 2 + 4 * count and count > 0, "invalid frame table")
    sizes = unpack_from(f"<{2 * count}H", info, 2)
    dimensions = list(zip(sizes[:count], sizes[count:]))
    require(all(w and h for w, h in dimensions), "zero-sized frame")
    if "SCN:" in sections:
        stream = sections["SCN:"]
        offset_table = sections["OFF:"]
        require(len(offset_table) == 4 * count, "invalid offset table")
        offsets = list(unpack_from(f"<{count}I", offset_table)) + [len(stream)]
        require(offsets[0] == 0, "missing first frame")
        for (w, h), start, end in zip(dimensions, offsets, offsets[1:]):
            require(start < end <= len(stream), "invalid frame range")
            validate_scn(stream[start:end], w, h)
        codec = "SCN"
    else:
        size = expanded_bin_size(sections["BIN:"])
        require(all(w % 2 == 0 for w, h in dimensions), "unsupported packed row")
        require(size == sum(w * h // 2 for w, h in dimensions), "packed frame size mismatch")
        codec = "BIN"
    return {"codec": codec, "frames": count, "dimensions": dimensions}


def inventory(folder):
    index = (folder / "RESOURCE.MAP").read_bytes()
    volume_count = uint(index, 4, 2)
    at = 6
    types = Counter()
    banks = {}
    palettes = {}
    for _ in range(volume_count):
        volume_name = filename(index[at:at + 13])
        entries = uint(index, at + 13, 2)
        volume = (folder / volume_name).read_bytes()
        at += 15
        for _ in range(entries):
            offset = uint(index, at + 4, 4)
            at += 8
            name = filename(volume[offset:offset + 13])
            length = uint(volume, offset + 13, 4)
            start = offset + 17
            require(start + length <= len(volume), "truncated resource")
            body = volume[start:start + length]
            extension = name.rsplit(".", 1)[-1]
            types[extension] += 1
            if extension == "BMP":
                banks[name] = inspect_bitmap(body)
            elif extension == "PAL":
                colors = tags(tags(body)["PAL:"])["VGA:"]
                require(len(colors) == 768 and max(colors) <= 63, "invalid VGA palette")
                palettes[name] = len(colors) // 3
    require(at == len(index), "trailing volume index data")
    return {
        "index_sha256": hashlib.sha256(index).hexdigest(),
        "resource_counts": types,
        "palette_sizes": palettes,
        "total_frames": sum(bank["frames"] for bank in banks.values()),
        "bitmaps": banks,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    print(json.dumps(inventory(parser.parse_args().folder), indent=2, sort_keys=True))
