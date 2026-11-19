"""Props, pickups, the Cyberfuse wordmark and kinetic effects."""

import math
import random

from PIL import Image, ImageDraw, ImageFont

from facility import cargo, door, exit_tile, foliage, station
from ink import (
    DARK,
    GOLD,
    ICE,
    INK,
    LIT,
    MINT,
    ORANGE,
    PINK,
    RUST,
    SLATE,
    STEEL,
    TEAL,
    mix,
)


def emblem(p):
    # Broken hex around a bolt-shaped C/F monogram, drawn on a transparent field.
    p.poly(
        [
            (7, 24),
            (24, 5),
            (75, 5),
            (94, 24),
            (83, 36),
            (72, 21),
            (30, 21),
            (17, 34),
            (17, 66),
            (30, 79),
            (71, 79),
            (82, 66),
            (95, 76),
            (76, 96),
            (23, 96),
            (4, 75),
        ],
        TEAL,
        INK,
    )
    p.poly(
        [
            (30, 30),
            (73, 30),
            (64, 43),
            (44, 43),
            (40, 50),
            (60, 50),
            (52, 62),
            (35, 62),
            (29, 75),
            (18, 66),
        ],
        MINT,
        INK,
    )
    p.poly(
        [(73, 37), (79, 37), (65, 57), (76, 57), (51, 82), (58, 64), (49, 64)],
        ORANGE,
        INK,
    )


def glyph(p, code):
    if code in (16, 17, 30, 31):
        angle = {16: 0, 17: math.pi, 30: -math.pi / 2, 31: math.pi / 2}[code]
        p.poly(
            [
                (50 + r * math.cos(angle + a), 50 + r * math.sin(angle + a))
                for r, a in [(44, 0), (48, 2.3), (48, -2.3)]
            ],
            ICE,
        )
        return
    if code == 32:
        return
    char = bytes([code]).decode("cp437")
    font = ImageFont.load_default(size=64)
    box = font.getbbox(char)
    mask = Image.new("L", (max(1, box[2] - box[0]), max(1, box[3] - box[1])))
    ImageDraw.Draw(mask).text((-box[0], -box[1]), char, font=font, fill=255)
    mask = mask.resize(
        (max(1, p.w - 2), max(1, p.h - 2)), Image.Resampling.LANCZOS
    ).point(lambda a: 255 if a > 100 else 0)
    p.image.paste(TEAL, (2, 2, p.w, p.h), mask)
    p.image.paste(ICE, (0, 0, p.w - 2, p.h - 2), mask)


def key(p, kind):
    accent = next(
        (
            v
            for k, v in {
                "red": PINK,
                "green": MINT,
                "blue": "#80c9ff",
                "yellow": GOLD,
            }.items()
            if k in kind
        ),
        TEAL,
    )
    # Access fobs have a colour and a tally so access is legible without hue.
    p.poly(
        [(3, 32), (25, 8), (89, 12), (98, 32), (81, 79), (17, 93), (2, 70)], DARK, INK
    )
    p.poly([(8, 34), (27, 17), (84, 19), (89, 32), (74, 65), (17, 74)], accent, INK)
    p.line([(20, 34), (32, 25), (65, 25)], ICE, 4)
    p.plate(18, 43, 39, 60, GOLD, 2)
    for n in range(
        1
        + ["red", "green", "blue", "yellow"].index(
            next((k for k in ["red", "green", "blue", "yellow"] if k in kind), "red")
        )
    ):
        p.rect(52 + n * 6, 42, 54 + n * 6, 55, INK)


def orb(p, kind):
    color = GOLD if kind == "egg" else TEAL
    if kind == "holo":
        p.oval(10, 76, 90, 97, DARK, INK)
        p.oval(17, 77, 85, 91, TEAL)
        p.poly([(49, 7), (75, 40), (60, 67), (39, 69), (24, 42)], "#66d9d6", INK)
        p.poly([(49, 8), (50, 62), (26, 41)], "#aaf6de")
        for y in (29, 42, 54):
            p.line([(32, y), (64, y)], "#378791", 2)
    else:
        p.oval(13, 12, 88, 94, mix(color, STEEL, 0.75), INK)
        p.line([(25, 63), (23, 47), (36, 25), (50, 19)], mix(color, ICE, 0.6), 5)
        p.line([(62, 27), (53, 40), (61, 48), (44, 70)], color, 3)
        p.oval(61, 61, 69, 69, DARK)


def supplies(p, kind):
    if "key" in kind:
        key(p, kind)
        return
    if kind in ("egg", "holo"):
        orb(p, kind)
        return
    if kind in ("blueprint", "folder", "paper", "circuit"):
        color = {
            "folder": GOLD,
            "paper": ICE,
            "blueprint": "#58a6ca",
            "circuit": "#40ad92",
        }[kind]
        p.poly(
            [(3, 35), (26, 15), (92, 12), (98, 65), (72, 84), (7, 91)],
            mix(color, STEEL, 0.3),
            INK,
        )
        p.poly([(8, 34), (22, 24), (84, 18), (90, 60), (71, 75), (12, 82)], color, INK)
        if kind == "folder":
            p.poly(
                [(7, 34), (12, 13), (36, 8), (50, 21), (88, 16), (87, 33)], GOLD, INK
            )
        for j in range(3):
            p.line(
                [
                    (23, 42 + j * 10),
                    (38 + j * 3, 38 + j * 10),
                    (45 + j * 3, 44 + j * 10),
                    (69, 38 + j * 10),
                ],
                mix(color, DARK, 0.64),
                3,
            )
        if kind == "circuit":
            p.plate(36, 35, 60, 64, DARK, 3)
            for x in range(38, 61, 8):
                p.line([(x, 29), (x, 35)], GOLD, 3)
        return
    if kind == "cd" or kind.startswith("disk"):
        if kind == "cd":
            p.oval(4, 14, 96, 89, ICE, INK)
            p.oval(41, 43, 57, 58, DARK, INK)
            p.line([(61, 39), (83, 25)], TEAL, 8)
            p.line([(29, 62), (15, 72)], PINK, 6)
        else:
            p.plate(6, 9, 94, 90, TEAL, 8)
            p.plate(20, 13, 76, 41, STEEL, 3)
            p.rect(56, 20, 66, 36, ICE)
            p.plate(19, 55, 82, 84, ICE, 3)
            for i in range(int(kind[-1])):
                p.rect(24 + i * 10, 67, 29 + i * 10, 75, RUST)
        return
    if kind in ("rod", "rocket", "bottle", "molotov"):
        if kind == "rocket":
            p.poly(
                [
                    (53, 2),
                    (64, 18),
                    (68, 64),
                    (82, 82),
                    (80, 94),
                    (52, 84),
                    (27, 94),
                    (25, 82),
                    (39, 63),
                    (41, 20),
                ],
                SLATE,
                INK,
            )
            p.poly([(53, 4), (63, 21), (41, 24)], PINK, INK)
            p.line([(45, 28), (43, 63)], ICE, 4)
            p.rect(42, 61, 63, 70, GOLD)
        else:
            p.plate(39, 6, 62, 31, LIT, 3)
            p.poly(
                [
                    (41, 26),
                    (60, 26),
                    (64, 44),
                    (77, 52),
                    (74, 91),
                    (26, 94),
                    (21, 55),
                    (36, 44),
                ],
                TEAL if kind != "molotov" else RUST,
                INK,
            )
            p.line([(32, 57), (32, 78)], MINT, 5)
            p.plate(34, 55, 67, 72, DARK, 2)
            if kind == "molotov":
                p.line([(48, 11), (38, 6), (43, 1)], GOLD, 4)
        return
    if kind in ("mine", "dynamite"):
        p.oval(4, 31, 96, 89, INK)
        p.oval(8, 25, 92, 75, SLATE, INK)
        p.oval(27, 24, 75, 60, DARK, INK)
        p.oval(38, 26, 62, 47, PINK, INK)
        for x, y in [(17, 52), (78, 48), (53, 65)]:
            p.bolt(x, y)
        if kind == "dynamite":
            p.line([(51, 35), (40, 7), (60, 4), (66, 20)], ORANGE, 5)
        return
    if kind == "bag":
        p.line([(32, 37), (31, 16), (44, 9), (60, 12), (64, 31)], SLATE, 8)
        p.plate(8, 28, 92, 92, "#6b6c50", 10)
        p.plate(21, 54, 69, 80, "#858269", 4)
        p.rect(46, 47, 57, 62, GOLD)
        return
    if kind == "radio":
        p.line([(73, 34), (77, 3)], LIT, 5)
        p.plate(12, 28, 90, 94, STEEL, 7)
        p.plate(19, 40, 60, 63, TEAL, 3)
        for y in (73, 79, 85):
            p.line([(23, y), (64, y)], DARK, 3)
        p.oval(72, 54, 83, 66, GOLD)


def debris(p, kind, idx):
    rng = random.Random(1288 + idx)
    color = (
        "#46675e"
        if "goo" in kind or "plant" in kind or "stuff" in kind
        else "#8e546f"
        if "blood" in kind or "yeuch" in kind
        else "#6e7079"
    )
    for j in range(13):
        x, y = rng.randrange(8, 81), rng.randrange(26, 83)
        w, h = rng.randrange(6, 20), rng.randrange(5, 15)
        p.poly(
            [
                (x, y),
                (x + w, y - h * 0.2),
                (x + w * 0.8, y + h * 0.7),
                (x + w * 0.2, y + h),
            ],
            mix(color, INK, (j % 4) * 0.12),
            INK,
        )
        p.line([(x, y), (x + w * 0.5, y - h * 0.1)], mix(color, ICE, 0.23), 2)
    if "skull" in kind:
        p.oval(25, 12, 74, 67, LIT, INK)
        p.rect(37, 49, 65, 75, LIT)
        p.oval(32, 36, 44, 49, DARK)
        p.oval(54, 35, 67, 49, DARK)


def effect(p, kind, frame):
    if kind == "grenade":
        p.oval(13, 22, 86, 93, STEEL, INK)
        p.plate(30, 29, 71, 70, TEAL, 6)
        p.line([(30, 53), (69, 46)], DARK, 6)
        p.line([(49, 28), (51, 68)], DARK, 5)
        a = frame * math.pi / 2
        p.line([(50, 33), (50 + 23 * math.cos(a), 28 + 12 * math.sin(a))], GOLD, 7)
    elif kind in ("beam", "brightBeam", "bullet", "sniperbullet"):
        color = MINT if kind == "brightBeam" else GOLD
        dx, dy = [(0, 1), (0.7, -0.7), (1, 0), (0.7, 0.7)][frame % 4]
        for width, c in [
            (26, ORANGE if kind != "brightBeam" else TEAL),
            (11, color),
            (4, ICE),
        ]:
            p.line(
                [(50 - 40 * dx, 50 - 40 * dy), (50 + 40 * dx, 50 + 40 * dy)], c, width
            )
    elif kind == "flame":
        s = frame % 4 * 4
        p.poly(
            [
                (2, 78),
                (14, 54),
                (18, 59),
                (25, 25 + s),
                (38, 46),
                (56 + s, 3),
                (60, 35),
                (80, 23 + s),
                (77, 49),
                (94, 43),
                (86, 81),
                (68, 94),
                (34, 98),
            ],
            RUST,
            INK,
        )
        p.poly(
            [
                (17, 73),
                (36, 44),
                (38, 62),
                (58 + s, 24),
                (58, 58),
                (80, 46),
                (73, 77),
                (49, 93),
            ],
            ORANGE,
        )
        p.poly([(30, 81), (44, 64), (49, 72), (63, 51), (60, 80), (45, 90)], GOLD)
    elif kind == "fireball":
        r = 14 + min(frame, 7) * 4
        rng = random.Random(44)
        for i in range(8):
            a = i * math.pi / 4 + 0.2
            x, y = 50 + math.cos(a) * r * 0.55, 50 + math.sin(a) * r * 0.52
            radius = max(2, r * (0.67 + rng.random() * 0.2) - max(0, frame - 8) * 2.2)
            p.oval(
                x - radius,
                y - radius,
                x + radius,
                y + radius,
                ("#8a5260", "#a95b55", "#74475b")[i % 3],
                INK,
            )
            if frame < 12:
                p.oval(
                    x - radius * 0.83,
                    y - radius * 0.83,
                    x + radius * 0.47,
                    y + radius * 0.42,
                    ORANGE if i % 2 else GOLD,
                )
        if frame < 9:
            p.star(50, 49, r * 0.82, r * 0.78, 6, 0.5, frame * 0.13, ICE)
    else:
        p.star(50, 50, 46, 47, 5, 0.19, 0.3, ORANGE)
        p.star(48, 47, 37, 35, 4, 0.18, 0, ICE)


def prop(p, name, idx):
    if name in ("bullet", "sniperbullet", "spark", "grenade"):
        effect(p, name, 0)
    elif (
        "wrecked" in name
        or "remains" in name
        or name
        in {
            "blood",
            "bloodstain",
            "bone_n_blood",
            "burn",
            "skull",
            "wall_skull",
            "scratch",
            "bullet_marks",
            "wall_stuff",
            "wall_goo",
            "goo",
        }
    ):
        debris(p, name, idx)
    elif "door" in name:
        door(p, name)
    elif "barrel" in name or "box" in name:
        cargo(p, name)
    elif "tree" in name or name == "plant":
        foliage(p, name)
    elif (
        name in ("cabinet", "safe", "chair", "ogrestatue", "terminal", "bookshelf")
        or "table" in name
    ):
        station(p, name)
    elif name == "exit":
        exit_tile(p, 0)
    else:
        supplies(p, name)
