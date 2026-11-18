"""Normalize DOS CPU decision programs into native waypoint/control graphs."""
import hashlib
import json
import struct
import sys
from pathlib import Path

image = Path(sys.argv[1]).read_bytes()
if hashlib.sha256(image).hexdigest() != "a67ba31b021ed53d2d033cbe67ecb32a4537bf20593392bcf4ba85d3fd67836c":
    raise SystemExit("Expected the 1990 DOS GAME.EXE")
data = image[0x5b40:]
lengths = [5, 4, 5, 3, 3, 1, 2, 2, 3, 3]
names = ["region", "chance", "level", "eligible", "jump", "pace", "radius", "pedal", "nitro", "boosting"]

def graph(start):
    offsets = []
    offset = start
    while data[offset] != 0x8a:
        offsets.append(offset)
        op = data[offset]
        offset += 2 if op < 128 else lengths[op - 128]
    index = {offset: i for i, offset in enumerate(offsets)}
    lines = []
    for offset in offsets:
        op = data[offset]
        if op < 128:
            parts = ["point", data[offset] * 256, data[offset + 1] * 256]
        else:
            code = op - 128
            end = offset + lengths[code]
            parts = [names[code], *data[offset + 1:end]]
            if code in (0, 1, 2, 4, 9):
                displacement = struct.unpack_from("<h", data, end-2)[0]
                parts[-2:] = [index[end-2+displacement]]
            elif code == 6:
                parts[1] = (parts[1] // 2) ** 2
            elif code == 7:
                parts[1] = ((parts[1] + 1) % 256) * 2
        lines.append(" ".join(map(str, parts)))
    return "|".join(lines)

output = Path(__file__).resolve().parents[1] / "games/fuse-drivers/src/game/offroad/cpu-routes.json"
output.write_text(json.dumps([graph(p) for p in struct.unpack_from("<16H", data, 0x755a)], indent=2) + "\n")
