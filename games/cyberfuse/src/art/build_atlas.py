"""Build original four-resolution atlas and frame layout. Usage in README.md."""

import argparse
import json
from collections import defaultdict
from pathlib import Path

from PIL import Image

from equipment import effect, emblem, glyph, prop
from facility import exit_tile, floor, wall
from ink import DARK, INK, SLATE, Ink
from operative import body, death, head, weapon
from reference_layout import extract

HERE = Path(__file__).resolve().parent
WIDTH = 1024
SCALE = 4


def classify(data):
    slots = {}
    # A source cell can be shared by angles/states. Draw its most representative cardinal pose.
    for name in ("body", "head", "gun"):
        uses = defaultdict(list)
        for bank, dirs in enumerate(data[name]):
            for direction, states in enumerate(dirs):
                for state, cell in enumerate(states):
                    idx = cell[-1] if name == "gun" else cell
                    uses[idx].append((bank, direction, state))
        for idx, candidates in uses.items():
            slots[idx] = (
                name,
                *min(candidates, key=lambda q: (q[1] % 2, q[2], q[1], q[0])),
            )
    for name in ("wall", "floor", "room"):
        for style, row in enumerate(data[name]):
            for variant, idx in enumerate(row):
                if idx not in slots:
                    slots[idx] = (name, style, variant)
    for name, (_, _, idx) in data["props"].items():
        slots.setdefault(idx, ("prop", name))
    for name, frames in data["effects"].items():
        for n, (_, _, idx) in enumerate(frames):
            slots[idx] = ("effect", name, n)
    for n, (_, _, idx) in enumerate(data["death"]):
        slots[idx] = ("death", n)
    slots[89] = (
        "gun",
        0,
        3,
        0,
    )  # Stored ready pose; reference table aliases 90 instead.
    for idx in (0, 5):
        slots[idx] = ("dark",)
    for idx in (109, 342, 546, 561):
        slots[idx] = ("prop", "hdoor_open")
    for idx in (161, 162):
        slots[idx] = ("prop", "blood")
    slots[164] = ("drain",)
    for idx in (375, 376, 380, 381):
        slots[idx] = ("exit", idx % 2)
    for idx in (378, 379, 382, 385, 387):
        slots[idx] = ("floor", idx % 10, 1)
    slots[520] = ("logo",)
    return slots


def paint(p, idx, definition):
    name, *args = definition
    if name == "body":
        bank, direction, state = args
        body(p, direction, state, bank == 1)
    elif name == "head":
        face, direction, state = args
        head(p, face, direction, state >= 7)
    elif name == "gun":
        bank, direction, state = args
        weapon(p, direction, state, bank == 1)
    elif name == "wall":
        wall(p, *args)
    elif name in ("room", "floor"):
        floor(p, *args, room=name == "room")
    elif name == "prop":
        prop(p, args[0], idx)
    elif name == "effect":
        effect(p, *args)
    elif name == "death":
        death(p, *args)
    elif name == "dark":
        p.rect(0, 0, 100, 100, INK)
    elif name == "exit":
        exit_tile(p, *args)
    elif name == "logo":
        emblem(p)
    elif name == "glyph":
        glyph(p, *args)
    elif name == "drain":
        floor(p, 0, 1)
        p.plate(10, 12, 90, 88, DARK, 5)
        for x in range(21, 83, 11):
            p.line([(x, 26), (x - 4, 73)], SLATE, 5)
    else:
        raise ValueError(definition)


def run(data):
    out = []
    coords = []
    glyph_coords = []
    types = classify(data)
    # Slot 374 is the sole empty world slot. Failing here catches any newly
    # introduced unclassified graphics, avoiding silent placeholder fallbacks.
    for font, dims, dest in [
        (False, data["dims"], coords),
        (True, data["glyphs"], glyph_coords),
    ]:
        for idx, size in enumerate(dims):
            if size is None:
                dest.append(None)
                continue
            p = Ink(*size)
            definition = ("glyph", idx) if font else types[idx]
            paint(p, idx, definition)
            if not p.image.getbbox() and not (font and idx == 32):
                raise ValueError(f"Unhandled graphic {idx} {definition}")
            dest.append(len(out))
            out.append(p.image)
    positions = []
    x = y = line_height = 0
    for image in out:
        w, h = image.size
        if x + w > WIDTH:
            x = 0
            y += line_height + 2
            line_height = 0
        positions.append((x, y, w // SCALE, h // SCALE))
        x += w + 2
        line_height = max(line_height, h)
    sheet = Image.new("RGBA", (WIDTH, y + line_height))
    for image, (x, y, _, _) in zip(out, positions):
        sheet.paste(image, (x, y))
    sheet.save(HERE / "cyberfuse-atlas.png", optimize=True)

    # Store nine animation states for the bodies but only rest/fire frame IDs
    # for the heads. Idle head turning is a runtime direction change.
    data["head"] = [[[row[0], row[7]] for row in dirs] for dirs in data["head"]]
    data["frames"] = [None if i is None else positions[i] for i in coords]
    data["glyphFrames"] = [None if i is None else positions[i] for i in glyph_coords]
    del data["dims"], data["glyphs"]
    lines = [
        "// Generated by build_atlas.py from DOS v1.06 layout and original Cyberfuse artwork.",
        "// Pixel rectangles contain atlas x/y and logical DOS width/height.",
    ]
    for name, value in data.items():
        lines.extend(
            [
                "// prettier-ignore",
                "export const "
                + name
                + " = "
                + json.dumps(value, separators=(",", ":"))
                + ";",
            ]
        )
    (HERE / "layout.ts").write_text("\n".join(lines) + "\n")
    print(
        f"{len(coords)} game slots, {len(glyph_coords)} glyph slots, {len(out)} images, {sheet.size}"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dos", type=Path)
    parser.add_argument("source", type=Path)
    args = parser.parse_args()
    run(extract(args.dos, args.source))
