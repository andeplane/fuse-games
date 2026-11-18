"""Check the supplied DOS course builder without copying any road or art files."""

import hashlib
import struct
import sys
from pathlib import Path

from unicorn import UC_ARCH_X86, UC_MODE_16, Uc
from unicorn.x86_const import (
    UC_X86_REG_CS,
    UC_X86_REG_DS,
    UC_X86_REG_IP,
    UC_X86_REG_SP,
    UC_X86_REG_SS,
)


def build(image, layout):
    u = Uc(UC_ARCH_X86, UC_MODE_16)
    u.mem_map(0, 1 << 20)
    u.mem_write(0, image)
    data, track, code = 0x3E080, 0x37260, 0xDCB0
    u.mem_write(track + 0x27B6, bytes(0x6E16 - 0x27B6))
    # Seed only the right-drop guardrail bit from track_build_all. The rest of
    # that pass draws randomized furniture, irrelevant to course geometry.
    for seg in [*range(380, 419), *range(700, 990)]:
        u.mem_write(track + 0x2F72 + 2 * seg, struct.pack("<H", 0x8000))
    for off, value in [
        (0x7DFE, layout),
        (0xADD8, 0),
        (0xF000, 0xF100),
        (0xF002, code // 16),
        (0xF004, 0),
    ]:
        u.mem_write(data + off, struct.pack("<H", value))
    for reg, value in [
        (UC_X86_REG_CS, code // 16),
        (UC_X86_REG_DS, data // 16),
        (UC_X86_REG_SS, data // 16),
        (UC_X86_REG_SP, 0xF000),
    ]:
        u.reg_write(reg, value)
    u.emu_start(code + 0x24D8, code + 0xF100, count=1000000)
    assert u.reg_read(UC_X86_REG_IP) == 0xF100

    def word(table, seg):
        return struct.unpack("<h", u.mem_read(track + table + 2 * seg, 2))[0]

    def digest(rows):
        return hashlib.sha256(
            b"".join(struct.pack("<" + "h" * len(r), *r) for r in rows)
        ).hexdigest()

    canyon = []
    for seg in range(370, 961):
        yaw = word(0x372E, seg)
        height = word(0x46A6, seg)
        canyon.append(
            (
                yaw,
                height,
                yaw - word(0x372E, seg + 1),
                word(0x46A6, seg + 1) - height,
                word(0x3EEA, seg) & 0xE0,
            )
        )
    aqueduct = [(0, 0, 0, 0, word(0x4E62, seg)) for seg in range(8, 343)]
    banks = [
        (word(0x5146, s), word(0x5902, s), int(bool(word(0x2F72, s) & 0x8000)))
        for s in range(370, 961)
    ]
    return digest(canyon), digest(aqueduct), digest(banks)


if __name__ == "__main__":
    exe = Path(sys.argv[1]).read_bytes()
    image = exe[struct.unpack_from("<H", exe, 8)[0] * 16 :]
    assert (
        hashlib.sha256(image).hexdigest()
        == "217a709d90715e4299814255a8370d01b9b2e902b8558dd3624e947940c273a5"
    )
    for layout in range(10):
        print(layout, *build(image, layout))
