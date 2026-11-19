"""Tile-scale architecture, including caps for every reference wall junction."""

import random

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

FLOORS = [
    ("#192e37", "#25404b", "#447079"),
    ("#2a2939", "#353648", "#685977"),
    ("#2c3032", "#393e3d", "#5d6157"),
    ("#1c283a", "#27374b", "#4c6178"),
    ("#322d32", "#443a3c", "#795f55"),
    ("#2c333a", "#37424a", "#626f72"),
    ("#252f36", "#344047", "#556169"),
    ("#342d34", "#43383c", "#6c5451"),
    ("#394348", "#48565a", "#71837f"),
    ("#1e2634", "#293647", "#3d5360"),
]
WALLS = [
    ("#34485a", "#576e7c", TEAL),
    ("#57515a", "#827779", "#daa887"),
    ("#604251", "#955967", PINK),
    ("#445163", "#75808a", GOLD),
    ("#505667", "#788190", "#c4c6ac"),
    ("#394456", "#61647a", "#c2a1ec"),
    ("#355454", "#5d7d73", "#b2ee8c"),
]


def floor(p, style, variant, room=False):
    base, slab, seam = FLOORS[style % len(FLOORS)]
    if room:
        base, slab = mix(base, "#263b46", 0.3), mix(slab, "#5b6670", 0.16)
    p.rect(0, 0, 100, 100, base)
    p.poly([(1, 4), (88, 4), (98, 16), (98, 96), (13, 96), (1, 85)], slab)
    # Worn coating: brushed steel has a broad, low-contrast reflection and
    # occasional fine scratches. Keep it quieter than the actors above it.
    p.poly([(3, 6), (69, 6), (27, 90), (16, 91), (3, 81)], mix(slab, seam, 0.045))
    rng = random.Random(511 + 31 * style + variant)
    for _ in range(11):
        x, y = rng.randrange(8, 86), rng.randrange(14, 86)
        length = rng.choice((2, 3, 4, 8))
        p.line(
            [(x, y), (x + length, y - 1)], mix(slab, seam, rng.uniform(0.065, 0.19)), 1
        )
    p.line([(1, 83), (1, 5), (87, 5), (97, 17)], mix(slab, seam, 0.58), 2)
    p.line([(15, 97), (98, 97), (98, 21)], mix(base, INK, 0.65), 2)
    if style % 5 == 0:
        p.line([(4, 72), (21, 72), (30, 81), (60, 81)], mix(slab, seam, 0.45), 2)
        p.line([(38, 13), (68, 13), (78, 25), (94, 25)], base, 2)
        for j in range(3):
            p.line([(71 + j * 6, 82), (74 + j * 6, 76)], seam, 2)
    elif style % 5 == 1:
        for x, y in [(8, 16), (84, 70)]:
            p.rect(x, y, x + 6, y + 5, base)
            p.line([(x + 1, y), (x + 4, y)], seam, 2)
        p.line([(5, 66), (27, 66), (34, 58), (34, 7)], base, 2)
        p.line([(38, 75), (66, 75), (75, 63), (98, 63)], mix(slab, seam, 0.26), 2)
        p.rect(46, 82, 59, 85, base)
        for x in (48, 52, 56):
            p.rect(x, 82, x + 1, 83, seam)
    elif style % 5 == 2:
        rng = random.Random(style * 11 + variant)
        for _ in range(18):
            x, y = rng.randrange(3, 95), rng.randrange(7, 93)
            p.line([(x, y), (x + 3, y - 2)], mix(slab, seam, 0.28), 2)
    elif style % 5 == 3:
        for x in (12, 22, 32):
            p.line([(x, 82), (x + 10, 68)], base, 3)
            p.line([(x + 1, 84), (x + 11, 70)], mix(slab, seam, 0.5), 2)
        p.rect(62, 18, 84, 22, base)
    else:
        for x in (21, 50, 79):
            p.line([(x, 7), (x, 91)], base, 2)
            p.line([(x + 2, 8), (x + 2, 89)], mix(slab, seam, 0.45), 2)
    if variant == 0:
        p.rect(0, 0, 100, 13, mix(base, INK, 0.55))
        p.rect(0, 14, 100, 21, mix(base, INK, 0.27))
    elif variant == 2:
        p.line([(15, 24), (38, 33), (47, 31)], mix(slab, seam, 0.5), 2)
    elif variant == 3:
        for x in (65, 72, 79):
            p.rect(x, 54, x + 3, 61, base)


def wall(p, style, variant):
    base, lit, accent = WALLS[style]
    tall = p.h > 48
    cap = 50 if tall else 100
    p.rect(0, 0, 100, 100, base)
    if tall:
        p.rect(0, cap, 100, 100, mix(base, INK, 0.36))
        p.rect(0, 51, 100, 57, INK)
        p.rect(0, 57, 100, 61, base)
        p.rect(0, 62, 100, 64, mix(lit, base, 0.5))
        p.rect(0, 94, 100, 99, INK)
        if style in (1, 4):
            for row, y in enumerate((68, 82)):
                p.line([(0, y), (99, y)], DARK, 2)
                for x in (24 + row * 22, 72 + row * 16):
                    p.line([(x, y), (x, y + 11)], DARK, 2)
        elif style == 6:
            p.line([(4, 92), (20, 70), (40, 75), (56, 69), (82, 74), (99, 63)], base, 6)
            p.line([(21, 70), (38, 75), (55, 69)], accent, 2)
        else:
            for x in (4, 85):
                p.rect(x, 62, x + 9, 92, base)
                p.line([(x + 2, 62), (x + 2, 91)], lit, 3)
            p.plate(21, 68, 77, 88, mix(base, INK, 0.65), 3)
            for x in range(28, 70, 9):
                p.line([(x, 82), (x + 4, 73)], lit, 3)
            p.rect(25, 90, 48, 91, accent)
    # Extend the cap trim only on exposed tile sides. Shared IDs use canonical topology.
    connections = [0, 2, 8, 4, 1, 6, 12, 3, 9, 7, 13, 14, 11, 5, 10, 15][variant]
    p.rect(0, 0, 100, cap - 2, lit)
    p.rect(0, cap * 0.18, 100, cap * 0.77, base)
    seam = mix(base, lit, 0.52)
    for x in (14, 69):
        p.line(
            [
                (x, cap * 0.24),
                (x + 8, cap * 0.32),
                (x + 8, cap * 0.62),
                (x + 15, cap * 0.72),
            ],
            seam,
            2,
        )
    if not connections & 1:
        p.rect(0, 0, 100, cap * 0.09, mix(lit, ICE, 0.34))
    if not connections & 2:
        p.rect(94, 0, 100, cap - 1, mix(base, INK, 0.55))
    if not connections & 8:
        p.rect(0, 0, 4, cap - 2, mix(lit, ICE, 0.25))
    if not connections & 4:
        p.rect(0, cap * 0.79, 100, cap * 0.90, mix(lit, ICE, 0.31))
        p.rect(0, cap * 0.92, 100, cap - 1, DARK)
    if style in (0, 2, 5):
        p.line(
            [(29, cap * 0.39), (62, cap * 0.39), (68, cap * 0.52)],
            mix(base, INK, 0.5),
            5,
        )
        p.line([(30, cap * 0.39), (52, cap * 0.39)], mix(accent, lit, 0.35), 2)
        for x in (75, 81, 87):
            p.line([(x, cap * 0.51), (x + 3, cap * 0.39)], mix(base, INK, 0.5), 3)
        p.rect(7, cap * 0.25, 12, cap * 0.3, mix(lit, ICE, 0.25))
    else:
        for x in (24, 76):
            p.bolt(x, cap * 0.47)


def exit_tile(p, variant):
    floor(p, 8, 1)
    p.plate(5, 6, 95, 94, DARK, 10)
    p.line([(12, 35), (12, 16), (29, 16)], TEAL, 5)
    p.line([(70, 82), (88, 82), (88, 61)], TEAL, 5)
    for y in (36, 59):
        p.line(
            [(32, y + 10), (50, y - 5), (68, y + 10)],
            MINT if variant % 2 == 0 else GOLD,
            7,
        )


def door(p, kind):
    colors = {"red": PINK, "yellow": GOLD, "green": MINT, "blue": "#83c9ff"}
    accent = next((color for name, color in colors.items() if name in kind), TEAL)
    p.plate(1, 1, 98, 99, DARK, 6)
    if "open" in kind:
        p.plate(4, 5, 21, 93, STEEL, 3)
        p.plate(80, 5, 96, 93, STEEL, 3)
        p.line([(25, 20), (25, 87)], accent, 3)
        return
    p.plate(8, 5, 91, 95, STEEL, 5)
    p.poly([(12, 14), (43, 14), (43, 47), (53, 55), (53, 84), (12, 84)], SLATE, INK)
    p.line([(17, 20), (38, 20)], LIT, 3)
    p.line([(55, 25), (79, 25)], accent, 5)
    for x in (20, 33, 46, 59, 72):
        p.line([(x, 91), (x + 8, 81)], GOLD, 4)


def cargo(p, kind):
    accent = GOLD if "wood" in kind else TEAL
    if "red" in kind:
        accent = PINK
    if "green" in kind:
        accent = MINT
    # Riveted transport cases and a separate rounded pressure-vessel silhouette.
    if "barrel" in kind:
        p.oval(7, 76, 94, 97, DARK)
        p.rect(8, 25, 92, 79, STEEL)
        p.oval(8, 61, 92, 89, STEEL, INK)
        for x in (18, 71, 83):
            p.line([(x, 27), (x, 76)], SLATE, 3)
        for y in (35, 67):
            p.poly(
                [
                    (6, y),
                    (28, y + 6),
                    (72, y + 6),
                    (94, y),
                    (94, y + 8),
                    (72, y + 13),
                    (28, y + 13),
                    (6, y + 8),
                ],
                DARK,
            )
            p.line([(8, y), (31, y + 5), (68, y + 5)], LIT, 2)
        p.oval(6, 10, 94, 35, LIT, INK)
        p.oval(12, 14, 88, 29, STEEL, INK)
        p.oval(26, 17, 39, 22, accent)
        p.plate(33, 49, 63, 62, accent, 2)
        p.line([(40, 56), (46, 51), (53, 57)], INK, 3)
    else:
        p.plate(4, 17, 95, 94, STEEL, 9)
        p.poly([(6, 24), (18, 10), (76, 7), (94, 18), (84, 31), (20, 35)], SLATE, INK)
        p.line([(18, 13), (70, 10), (83, 15)], LIT, 3)
        p.plate(12, 39, 85, 82, mix(STEEL, INK, 0.3), 4)
        p.line([(15, 72), (36, 46), (62, 44)], SLATE, 5)
        for x in (17, 73):
            p.line([(x, 29), (x + 4, 38), (x + 4, 83)], accent, 5)
        p.rect(36, 59, 55, 69, ICE)
        for x in (39, 44, 48, 50):
            p.rect(x, 61, x + 1, 67, DARK)
        p.bolt(13, 86)
        p.bolt(82, 85)


def foliage(p, kind):
    green = "#917558" if "autumn" in kind else "#3c7770"
    p.oval(13, 80, 89, 98, "#121d31a0")
    p.line([(48, 89), (50, 58), (38, 37)], INK, 11)
    p.line([(47, 86), (50, 61), (72, 39)], "#786653", 7)
    if "remains" in kind:
        return
    for i, (x, y, r) in enumerate(
        [
            (35, 56, 22),
            (65, 55, 24),
            (23, 44, 18),
            (72, 34, 17),
            (47, 26, 23),
            (46, 44, 24),
        ]
    ):
        p.poly(
            [
                (x - r, y + 2),
                (x - r * 0.8, y - r * 0.6),
                (x - 2, y - r),
                (x + r * 0.6, y - r * 0.7),
                (x + r, y),
                (x + r * 0.6, y + r * 0.5),
                (x - r * 0.5, y + r * 0.55),
            ],
            mix(green, INK, 0.34 - i * 0.04),
            INK,
        )
        p.line(
            [
                (x - r * 0.65, y - r * 0.38),
                (x - 3, y - r * 0.72),
                (x + r * 0.28, y - r * 0.65),
            ],
            mix(green, GOLD, 0.32),
            3,
        )
    if kind == "plant":
        p.plate(30, 68, 71, 94, STEEL, 6)
        p.line([(33, 74), (66, 74)], TEAL, 3)


def station(p, kind):
    if kind in ("chair", "ogrestatue"):
        p.plate(24, 9, 78, 62, STEEL, 8)
        p.plate(14, 54, 80, 74, SLATE, 6)
        for x in (26, 67):
            p.line([(x, 71), (x - 3, 95)], DARK, 8)
        p.line([(33, 23), (65, 23)], TEAL, 5)
        return
    if "table" in kind:
        for x in (14, 80):
            p.rect(x, 49, x + 6, 92, STEEL)
        p.poly([(1, 25), (21, 10), (92, 13), (98, 44), (77, 57), (2, 52)], SLATE, INK)
        p.line([(3, 27), (22, 14), (87, 17)], LIT, 3)
        if "lab" in kind or "candle" in kind:
            p.plate(43, 1, 58, 32, TEAL, 4)
            p.oval(46, 1, 56, 8, GOLD)
        return
    p.plate(6, 6, 93, 94, STEEL, 8)
    if kind == "terminal":
        p.plate(12, 12, 83, 49, DARK, 5)
        p.poly([(18, 18), (73, 17), (70, 41), (19, 42)], "#20666c", INK)
        p.line([(23, 33), (34, 33), (40, 25), (46, 37), (52, 29), (66, 29)], MINT, 3)
        p.poly([(13, 54), (82, 51), (94, 66), (73, 73), (10, 68)], SLATE, INK)
        for x in range(26, 67, 8):
            p.line([(x, 59), (x + 4, 59)], ICE, 3)
        p.plate(20, 76, 80, 89, DARK, 3)
        p.rect(25, 80, 34, 82, ORANGE)
    elif kind == "bookshelf":
        for j in range(3):
            for i in range(6):
                p.rect(
                    14 + i * 12,
                    15 + j * 25,
                    22 + i * 12,
                    31 + j * 25,
                    (TEAL, RUST, SLATE, GOLD)[(i + j) % 4],
                )
            p.rect(12, 34 + j * 25, 86, 36 + j * 25, INK)
    else:
        for y in (16, 43, 70):
            p.plate(13, y, 84, y + 17, DARK, 3)
            p.line([(45, y + 4), (63, y + 4)], LIT, 3)
        if kind == "safe":
            p.oval(39, 36, 64, 61, SLATE, INK)
            p.line([(47, 49), (59, 46)], GOLD, 4)
