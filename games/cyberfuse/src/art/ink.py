"""Four-sample-per-world-pixel drawing tools for the Cyberfuse atlas."""

import math

from PIL import Image, ImageDraw

INK = "#0c1427"
DARK = "#18293d"
STEEL = "#334b63"
SLATE = "#57748c"
LIT = "#95b3bf"
ICE = "#d6ecdc"
TEAL = "#29baa9"
MINT = "#a1ffce"
ORANGE = "#ff985f"
RUST = "#b95849"
GOLD = "#ffd57d"
PINK = "#ff6681"
MAGENTA = "#a24a77"
VIOLET = "#7162ac"


def mix(a, b, t):
    aa = bytes.fromhex(a[1:])
    bb = bytes.fromhex(b[1:])
    return "#" + "".join(f"{round(x + (y - x) * t):02x}" for x, y in zip(aa, bb))


class Ink:
    def __init__(self, width, height):
        self.image = Image.new("RGBA", (width * 4, height * 4))
        self.d = ImageDraw.Draw(self.image)
        self.w, self.h = self.image.size

    def pt(self, p):
        return (round(p[0] * (self.w - 1) / 100), round(p[1] * (self.h - 1) / 100))

    def line(self, points, color, width=3):
        self.d.line(
            [self.pt(p) for p in points],
            fill=color,
            width=max(1, round(min(self.w, self.h) * width / 100)),
            joint="curve",
        )

    def poly(self, points, color, outline=None):
        self.d.polygon([self.pt(p) for p in points], fill=color)
        if outline:
            self.line([*points, points[0]], outline, 3)

    def rect(self, x, y, r, b, color):
        self.d.rectangle([self.pt((x, y)), self.pt((r, b))], fill=color)

    def oval(self, x, y, r, b, color, outline=None):
        self.d.ellipse([self.pt((x, y)), self.pt((r, b))], fill=color, outline=outline)

    def plate(self, x, y, r, b, color, cut=6):
        z = min(cut, (r - x) / 3, (b - y) / 3)
        self.poly(
            [
                (x + z, y),
                (r - z, y),
                (r, y + z),
                (r, b - z),
                (r - z, b),
                (x + z, b),
                (x, b - z),
                (x, y + z),
            ],
            color,
            INK,
        )
        self.line(
            [(x + 1, y + z), (x + z, y + 1), (r - z, y + 1)], mix(color, ICE, 0.38), 2
        )
        self.line(
            [(r - 1, y + z), (r - 1, b - z), (r - z, b - 1), (x + z, b - 1)],
            mix(color, INK, 0.5),
            3,
        )

    def star(self, x, y, rx, ry, n, ratio, rotation, color):
        self.poly(
            [
                (
                    x
                    + rx
                    * math.cos(rotation + i * math.pi / n)
                    * (ratio if i % 2 else 1),
                    y
                    + ry
                    * math.sin(rotation + i * math.pi / n)
                    * (ratio if i % 2 else 1),
                )
                for i in range(2 * n)
            ],
            color,
        )

    def bolt(self, x, y):
        self.oval(x - 2, y - 2, x + 2, y + 2, INK)
        self.line([(x - 1, y - 1), (x + 1, y - 1)], LIT, 2)
