"""Original articulated exosuits and faces. Facing zero looks toward the back wall."""

from dataclasses import dataclass

from ink import (
    DARK,
    GOLD,
    ICE,
    INK,
    LIT,
    ORANGE,
    PINK,
    RUST,
    SLATE,
    STEEL,
    TEAL,
    VIOLET,
    mix,
)

# Shell, trim and construction of each operative's helmet.
HELMETS = [
    ("#365175", TEAL, "crest"),
    ("#9daac2", "#78c9ff", "ear"),
    ("#416d57", "#c6ee79", "horn"),
    ("#804d46", ORANGE, "band"),
    ("#866046", GOLD, "crest"),
    ("#635580", "#f29bb7", "lens"),
    ("#756382", GOLD, "ear"),
    ("#3b645c", ORANGE, "horn"),
    ("#535f76", PINK, "band"),
    ("#686681", "#a4e8e3", "lens"),
    ("#665456", ORANGE, "ear"),
    ("#504d65", PINK, "band"),
    ("#5c685b", GOLD, "crest"),
    ("#4a6274", PINK, "lens"),
    ("#647786", "#ff826e", "cyborg"),
    ("#446575", "#a2f7ed", "robot"),
    ("#684e72", "#f7b8b0", "ear"),
]
FACING = [
    (0, -1),
    (0.72, -0.72),
    (1, 0),
    (0.72, 0.72),
    (0, 1),
    (-0.72, 0.72),
    (-1, 0),
    (-0.72, -0.72),
]



@dataclass(frozen=True)
class Face:
    skin: str
    hair: str | None = None
    feature: str = "bare"
    ponytail: bool = False
    band: str | None = None


# The exposed heads keep their palette and distinguishing features together.
FACES = {
    1: Face("#885d52", "#523646", "pilot"),
    2: Face("#829966", feature="alien"),
    3: Face("#b68065", "#433c3c", "pilot"),
    4: Face("#ba7866"),
    6: Face("#c08973", "#c39c62", "pilot", ponytail=True),
    7: Face("#678871", feature="alien"),
    9: Face("#b1967d", "#b4b5aa", "goggles"),
    10: Face("#a17158", "#543d42", band=RUST),
    11: Face("#a68168", "#96785d", band=TEAL),
    12: Face("#886254", "#48374a", band=VIOLET, ponytail=True),
    16: Face("#a16852", "#523941", "pilot", ponytail=True),
}
REAR_FACING_Y = -0.3


def exposed_face(p, face, dx, dy):
    profile = FACES.get(face)
    if profile is None:
        return
    hair = profile.hair or profile.skin
    if dy < REAR_FACING_Y:
        rear_face(p, profile, hair)
    else:
        front_face(p, profile, hair, dx)


def rear_face(p, profile, hair):
    p.poly(
        [
            (22, 36),
            (32, 19),
            (58, 11),
            (76, 24),
            (82, 53),
            (69, 72),
            (45, 79),
            (27, 62),
        ],
        hair,
        INK,
    )
    p.line([(28, 36), (37, 24), (53, 20)], mix(hair, ICE, 0.32), 4)
    if profile.ponytail:
        p.poly([(36, 52), (48, 53), (44, 74), (29, 92), (24, 80)], hair, INK)
    if profile.band is not None:
        p.line([(23, 52), (49, 57), (78, 48)], RUST, 8)


def front_face(p, profile, hair, dx):
    x = 50 + dx * 10
    skin = profile.skin
    p.poly(
        [
            (x - 25, 32),
            (x + 21, 29),
            (x + 28, 44),
            (x + 21, 74),
            (x + 7, 88),
            (x - 11, 87),
            (x - 25, 69),
            (x - 29, 49),
        ],
        skin,
        INK,
    )
    p.poly(
        [
            (x - 23, 49),
            (x - 12, 44),
            (x + 18, 41),
            (x + 18, 48),
            (x + 2, 51),
            (x - 5, 71),
            (x - 14, 71),
        ],
        mix(skin, GOLD, 0.22),
    )
    p.poly(
        [
            (x - 19, 75),
            (x - 5, 80),
            (x + 10, 78),
            (x + 18, 68),
            (x + 8, 85),
            (x - 8, 87),
        ],
        mix(skin, INK, 0.38),
    )
    if abs(dx) > 0.9:
        p.poly(
            [
                (x + dx * 14, 47),
                (x + dx * 30, 59),
                (x + dx * 29, 65),
                (x + dx * 13, 66),
            ],
            skin,
            INK,
        )
    if profile.feature == "alien":
        for side in (-1, 1):
            p.poly(
                [
                    (x + side * 24, 38),
                    (x + side * 40, 21),
                    (x + side * 33, 42),
                    (x + side * 22, 49),
                ],
                GOLD,
                INK,
            )
            p.poly([(x + side * 16, 78), (x + side * 16, 67), (x + side * 9, 77)], ICE)
        p.line([(x - 22, 44), (x - 6, 52)], DARK, 6)
        p.line([(x + 7, 51), (x + 23, 42)], DARK, 6)
    elif profile.feature == "pilot":
        p.poly(
            [
                (x - 29, 52),
                (x - 31, 32),
                (x - 18, 15),
                (x + 7, 10),
                (x + 25, 22),
                (x + 24, 34),
                (x + 6, 29),
                (x - 7, 39),
                (x - 17, 35),
                (x - 20, 52),
            ],
            hair,
            INK,
        )
        p.line([(x - 23, 30), (x - 12, 20), (x + 3, 17)], mix(hair, GOLD, 0.55), 5)
        if profile.ponytail:
            near = x - 24 if dx >= 0 else x + 25
            p.line([(near, 43), (near - 2, 65), (near - 8, 78)], hair, 7)
    elif profile.band is not None:
        accent = profile.band
        p.poly(
            [
                (x - 29, 46),
                (x - 29, 29),
                (x - 17, 15),
                (x + 4, 11),
                (x + 26, 25),
                (x + 29, 36),
            ],
            accent,
            INK,
        )
        p.line([(x - 28, 47), (x + 22, 38)], mix(accent, ICE, 0.45), 5)
        p.line([(x - 26, 44), (x + 16, 60)], DARK, 4)
        p.plate(x - 1, 47, x + 16, 61, DARK, 2)
    else:
        p.line([(x - 21, 36), (x - 10, 27), (x + 3, 24)], mix(skin, ICE, 0.55), 5)
    face_eyes(p, profile, dx, x)
    p.line([(x - 4, 71), (x + 9, 69)], mix(skin, INK, 0.55), 3)


def face_eyes(p, profile, dx, x):
    if profile.feature == "goggles":
        p.line([(x - 24, 49), (x + 24, 47)], DARK, 5)
        for side in (-1, 1):
            ex = x + side * 13
            p.oval(ex - 9, 43, ex + 8, 61, INK)
            p.oval(ex - 6, 45, ex + 5, 55, "#93c8cb")
    else:
        for side in (-1, 1):
            if (abs(dx) > 0.9 and side * dx < 0) or (profile.band is not None and side > 0):
                continue
            ex = x + side * 12 + dx * 4
            p.line([(ex - 3, 52), (ex + 4, 51)], DARK, 4)
            p.line([(ex, 54), (ex + 2, 54)], GOLD if profile.feature == "alien" else ICE, 2)


def head(p, face, direction, fire):
    shell, accent, feature = HELMETS[face]
    dx, dy = FACING[direction]
    c = 50 + dx * 6
    p.poly(
        [
            (20, 20),
            (30, 7),
            (59, 3),
            (76, 10),
            (88, 27),
            (91, 64),
            (76, 77),
            (68, 92),
            (43, 99),
            (25, 87),
            (16, 66),
            (10, 45),
        ],
        INK,
    )
    p.poly(
        [
            (18, 35),
            (30, 13),
            (58, 7),
            (75, 14),
            (85, 31),
            (85, 59),
            (72, 79),
            (51, 87),
            (25, 72),
        ],
        shell,
    )
    p.poly(
        [(24, 34), (36, 16), (60, 12), (71, 18), (55, 22), (47, 35)],
        mix(shell, ICE, 0.46),
    )
    p.line([(24, 42), (37, 30), (48, 28)], mix(shell, ICE, 0.55), 3)
    # A raised brow in profile; the back has a vertical power coupler.
    if dy < REAR_FACING_Y:
        p.plate(26, 43, 76, 80, mix(shell, DARK, 0.4), 6)
        p.rect(35, 53, 68, 57, INK)
        p.line([(38, 53), (49, 53)], accent, 3)
        for x in (38, 46, 54, 62):
            p.line([(x, 63), (x - 3, 73)], DARK, 4)
    else:
        left = 16 + max(0, dx) * 23
        right = 84 + min(0, dx) * 23
        p.poly(
            [
                (left, 42),
                (c, 37),
                (right, 40),
                (right - 4, 60),
                (c, 71),
                (left + 4, 58),
            ],
            INK,
        )
        p.poly(
            [
                (left + 3, 46),
                (c, 42),
                (right - 4, 44),
                (right - 8, 52),
                (c, 60),
                (left + 7, 54),
            ],
            mix(accent, STEEL, 0.3),
        )
        p.line([(left + 7, 47), (c, 44), (right - 7, 45)], mix(accent, ICE, 0.6), 4)
        p.line([(c, 55), (c + dx * 12, 51)], ICE, 4)
        p.poly(
            [
                (left + 7, 62),
                (c, 70),
                (right - 7, 59),
                (right - 12, 77),
                (c, 90),
                (left + 14, 78),
            ],
            mix(shell, INK, 0.18),
            INK,
        )
        for y in (72, 77):
            p.line([(c - 7, y), (c + 7, y - 2)], INK, 3)
    # Ear modules, fins and other kit distinguish roles at gameplay zoom.
    near = 19 if dx >= 0 else 80
    p.plate(near - 8, 43, near + 8, 71, STEEL, 4)
    p.line([(near - 4, 51), (near + 3, 50)], accent, 3)
    if feature == "crest":
        p.poly([(39, 20), (41, 5), (53, 0), (59, 4), (57, 19), (49, 30)], accent, INK)
    elif feature == "ear":
        p.line([(near, 43), (near - 5, 16), (near - 2, 6)], INK, 5)
        p.line([(near - 2, 13), (near - 2, 6)], accent, 4)
    elif feature == "horn":
        for x, s in [(22, -1), (75, 1)]:
            p.poly(
                [
                    (x - 5, 33),
                    (x + s * 13, 14),
                    (x + s * 13, 1),
                    (x + s * 5, 10),
                    (x + 7, 27),
                ],
                GOLD,
                INK,
            )
    elif feature == "band":
        p.line([(22, 29), (46, 21), (77, 24)], accent, 7)
    elif feature == "lens":
        for x in (c - 12, c + 12):
            p.oval(x - 9, 38, x + 9, 62, DARK, INK)
            p.oval(x - 5, 41, x + 4, 53, accent)
            p.oval(x - 4, 41, x - 1, 45, ICE)
    elif feature == "cyborg":
        p.plate(near + 1, 24, near + 15, 52, LIT, 3)
        p.oval(near + 4, 32, near + 11, 42, PINK)
    else:
        p.line([(33, 19), (65, 16)], accent, 5)
    exposed_face(p, face, dx, dy)
    if fire and dy >= 0:
        p.line([(c + dx * 4, 83), (c + dx * 9, 80)], ORANGE, 4)


def body(p, direction, state, armed):
    dx, dy = FACING[direction]
    stride = [0, 0, 0, -1, 0, 1, 0, 0, 0][state]
    # Boots with separate sole, kneecap and reinforced straps.
    p.oval(12, 84, 90, 99, "#0e182faa")
    p.plate(39, 0, 61, 23, DARK, 3)
    p.line([(41, 6), (57, 5)], SLATE, 4)
    for side in (-1, 1):
        x = 50 + side * (16 if abs(dx) < 0.8 else 11) + side * stride * 7
        y = 88 + side * stride * 6
        p.line([(50 + side * 13, 57), (x - 1, 73), (x + dx * 5, y)], INK, 19)
        p.line([(50 + side * 13, 57), (x - 2, 73), (x + dx * 4, y - 1)], STEEL, 13)
        p.plate(x - 7, 65 + side * stride * 4, x + 6, 79 + side * stride * 4, SLATE, 3)
        p.plate(x - 10 + dx * 3, y - 5, x + 10 + dx * 4, y + 6, DARK, 4)
        p.line([(x - 6 + dx * 3, y + 1), (x + 3 + dx * 4, y + 1)], LIT, 3)
    p.poly(
        [(23, 17), (37, 8), (65, 8), (79, 21), (72, 55), (63, 68), (37, 68), (27, 52)],
        STEEL,
        INK,
    )
    p.poly(
        [(27, 20), (38, 12), (62, 12), (73, 22), (67, 37), (52, 45), (33, 37)],
        SLATE,
        INK,
    )
    p.poly([(34, 20), (43, 16), (61, 16), (68, 23), (50, 29)], LIT)
    if dy < REAR_FACING_Y:
        p.plate(35, 21, 66, 52, DARK, 5)
        for x in (39, 48, 57):
            p.line([(x, 29), (x, 42)], SLATE, 4)
        p.line([(42, 22), (58, 22)], TEAL, 3)
    else:
        p.line([(33, 34), (50, 42), (70, 33)], TEAL, 5)
        p.rect(49, 44, 56, 50, GOLD)
    for side in (-1, 1):
        x = 50 + side * 28
        arm_shift = side * stride * 5
        p.line(
            [
                (x, 27),
                (x + side * 7, 40),
                (x + side * (4 if armed else 8) + dx * 3, 52 + arm_shift),
            ],
            INK,
            16,
        )
        p.line(
            [(x, 27), (x + side * 6, 40), (x + side * 4 + dx * 3, 50 + arm_shift)],
            STEEL,
            10,
        )
        p.plate(x - 11, 18, x + 11, 36, SLATE, 5)
        p.line([(x - 7, 25), (x + 6, 22)], TEAL, 4)
        p.plate(
            x - 3 + side * 4, 45 + arm_shift, x + 7 + side * 4, 55 + arm_shift, DARK, 3
        )
    p.rect(34, 53, 66, 59, INK)
    p.rect(46, 53, 55, 59, LIT)


def weapon(p, direction, state, blade):
    dx, dy = FACING[direction]
    # Longitudinal geometry in a local axis makes the eight foreshortenings consistent.
    if state == 0 and not blade and abs(dx) > 0.4:
        dy -= 0.6
    length = (dx * dx + dy * dy) ** 0.5
    dx, dy = dx / length, dy / length

    def point(t, v):
        return (50 + dx * t - dy * v, 50 + dy * t + dx * v)

    def strip(a, b, r, color):
        p.poly([point(a, -r), point(b, -r), point(b, r), point(a, r)], color, INK)

    if blade:
        p.poly(
            [
                point(-19, -10),
                point(9, -12),
                point(43, -2),
                point(16, 10),
                point(-18, 11),
            ],
            ICE,
            INK,
        )
        p.line([point(-15, 5), point(34, -1)], TEAL, 6)
        strip(-39, -18, 7, RUST)
        strip(-20, -15, 14, GOLD)
    else:
        strip(-43, -21, 8, DARK)
        p.poly(
            [
                point(-27, -13),
                point(-12, -23),
                point(14, -17),
                point(24, -9),
                point(22, 10),
                point(-24, 14),
            ],
            STEEL,
            INK,
        )
        p.line([point(-19, -13), point(-6, -17), point(13, -13)], LIT, 5)
        p.line([point(-15, 0), point(8, 0)], TEAL, 6)
        strip(20, 39, 6, SLATE)
        strip(34, 42, 10, DARK)
        if state == 1:
            p.line([point(40, -4), point(42, 4)], GOLD, 5)


def death(p, frame):
    angle = frame / 8
    y = 30 + angle * 47
    for x, s in [(38, -1), (62, 1)]:
        p.line([(x, y), (x + s * (8 + angle * 9), y + 18 - angle * 9)], INK, 14)
        p.line([(x, y), (x + s * (8 + angle * 9), y + 18 - angle * 9)], SLATE, 8)
    p.plate(30, y - 13, 70, y + 8, STEEL, 7)
    p.line([(35, y - 6), (62, y - 9)], TEAL, 4)
    p.oval(38 + angle * 20, y - 27, 61 + angle * 20, y - 5, SLATE, INK)
    p.line([(43 + angle * 20, y - 16), (56 + angle * 20, y - 17)], TEAL, 4)
    for i in range(3):
        p.line([(16 + i * 26, y - 23 - i * 3), (18 + i * 26, y - 26 - i * 3)], GOLD, 3)
