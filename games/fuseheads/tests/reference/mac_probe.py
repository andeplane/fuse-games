"""Run isolated gameplay scenarios on the shipped 68000 instructions (see the design note)."""

import argparse
from hashlib import sha256
import json
from pathlib import Path
import struct

from unicorn import Uc, UC_ARCH_M68K, UC_HOOK_CODE, UC_MODE_BIG_ENDIAN
from unicorn.m68k_const import (
    UC_CPU_M68K_M68020,
    UC_M68K_REG_A2,
    UC_M68K_REG_A3,
    UC_M68K_REG_A5,
    UC_M68K_REG_A6,
    UC_M68K_REG_A7,
    UC_M68K_REG_D0,
    UC_M68K_REG_D3,
    UC_M68K_REG_D4,
    UC_M68K_REG_D5,
    UC_M68K_REG_PC,
)


def resource(path, kind, resource_id, expected_hash):
    """Read an unar -forks visible AppleDouble sidecar and validate the selected payload."""
    blob = path.read_bytes()
    u16 = lambda at: int.from_bytes(blob[at : at + 2], "big")
    u32 = lambda at: int.from_bytes(blob[at : at + 4], "big")
    fork = next(u32(i + 4) for i in range(26, 26 + 12 * u16(24), 12) if u32(i) == 2)
    data = fork + u32(fork)
    resource_map = fork + u32(fork + 4)
    types = resource_map + u16(resource_map + 24)
    for entry in range(types + 2, types + 2 + 8 * (1 + u16(types)), 8):
        if blob[entry : entry + 4] != kind:
            continue
        refs = types + u16(entry + 6)
        for ref in range(refs, refs + 12 * (1 + u16(entry + 4)), 12):
            if u16(ref) == resource_id:
                start = data + (u32(ref + 4) & 0xFFFFFF)
                payload = blob[start + 4 : start + 4 + u32(start)]
                if sha256(payload).hexdigest() != expected_hash:
                    raise ValueError(f"Unexpected {kind!r} {resource_id} revision")
                return payload
    raise ValueError(f"Missing {kind!r} {resource_id} in {path}")


class Reference:
    code1 = 0x40000
    globals = 0x90000
    handle = 0x110000
    actor = 0x111000
    enemy_handle = 0x114000
    enemy = 0x114200
    enemy_list = 0x115000
    frame = 0x120800
    stack = 0x12F000
    stop = 0x1F000

    def __init__(self, directory):
        app = directory / "Bonkheads Deluxe.rsrc"
        levels = directory / "Original Levels.rsrc"
        self.cpu = Uc(UC_ARCH_M68K, UC_MODE_BIG_ENDIAN)
        self.cpu.ctl_set_cpu_model(UC_CPU_M68K_M68020)
        self.cpu.mem_map(0, 0x180000)
        self.cpu.mem_write(
            self.code1,
            resource(
                app,
                b"CODE",
                1,
                "7d619dbe6c5824e0c123c73f214cf5f2fe8bff8b919c056a6ea9fd6b5cf80ff3",
            ),
        )
        self.cpu.mem_write(
            0,
            resource(
                app,
                b"CODE",
                2,
                "3c601d1f447117f2fe023cdad77eb35473f8985436b1e658b16103927cfff122",
            ),
        )
        self.cpu.mem_write(
            0x80000,
            resource(
                app,
                b"DATA",
                0,
                "712bfb4a453601f5d319b0b1009b93e1c5d0989dda1f9de10c7f436ab37df64f",
            ),
        )
        self.cpu.mem_write(
            0x112000,
            resource(
                levels,
                b"MLST",
                128,
                "53867d44d7d779bdb4ba5dfeb0e6c354c052e073c70d3861d53abb39add1c9bf",
            ),
        )
        self.cpu.reg_write(UC_M68K_REG_A5, self.globals)
        # Execute the actual DATA initializer to recover the tick delay and jump table.
        self.call(self.code1 + 0x10E, 0x80004, self.globals)
        self.write(self.globals - 0x6B76, self.handle + 4)
        self.write(self.handle + 4, 0x112000)
        self.write(self.handle, self.actor)
        self.write(self.enemy_handle, self.enemy)
        self.write(self.enemy_list, self.enemy_list + 0x100)
        self.write(self.enemy_list + 0x100 + 0xA2, self.enemy_handle)
        self.write(self.globals - 0x663A, self.handle)
        self.write(self.globals - 0x6642, self.handle + 12)
        self.write(self.handle + 12, 0x116400)
        self.write(0x116400 + 0xF, 1, 1)
        # Substitute frame bounds for sprite bitmaps. The tested routines read just the rect.
        for bank in range(80):
            bounds = 0x113000 if bank < 6 else 0x113100
            size = 48 if bank < 6 else 32
            cell = 0x116000 + 4 * bank
            self.write(cell, bounds)
            self.cpu.mem_write(bounds, struct.pack(">4h", 0, 0, size, size))
            for phase in range(40):
                self.write(self.globals + 0x28 + bank * 160 + phase * 4, cell)
        for addr, bank, size in ((self.actor, 2, 48), (self.enemy, 7, 32)):
            self.write(addr + 0x20, size, 2)
            self.write(addr + 0x22, size, 2)
            self.write(addr + 0x5A, size, 2)
            self.write(addr + 0x44, bank, 2)
            self.write(addr + 0x46, bank, 2)
            self.write(addr + 0xC, 1, 1)
        self.write(self.actor + 0x92, 120 * 16)
        self.write(self.actor + 0x96, 192 * 16)
        for col in range(20):
            self.write(self.globals - 0x6626 + col * 70 + 15 * 2, 2, 2)
        self.keys = set()
        for disp, key in ((0x7F80, 123), (0x7F82, 124), (0x7F84, 126)):
            self.write(self.globals - disp, key, 2)
        self.hook(0x696E, self.key_read)
        self.hook(0x9314, self.set_rect)
        self.hook(0x4DA, lambda: self.cpu.reg_write(UC_M68K_REG_PC, self.code1 + 0x4DA))
        self.score_updates = []
        self.hook(0x6A1E, self.score_delta)
        self.hook(0x6A3E, self.return_to_caller)
        for pc in (0x62F0, 0x6366, 0x6486):
            self.hook(pc, self.sect_rect)

    def hook(self, pc, f):
        self.cpu.hook_add(UC_HOOK_CODE, lambda *_: f(), begin=pc, end=pc)

    def write(self, address, value, size=4):
        self.cpu.mem_write(address, (value % (1 << (8 * size))).to_bytes(size, "big"))

    def read(self, address, size=4):
        return int.from_bytes(self.cpu.mem_read(address, size), "big", signed=True)

    def run(self, start, end):
        self.cpu.emu_start(start, end, count=100000)
        if self.cpu.reg_read(UC_M68K_REG_PC) != end:
            raise RuntimeError(
                f"Reference instruction limit at {self.cpu.reg_read(UC_M68K_REG_PC):x}"
            )

    def call(self, addr, *args):
        sp = self.stack - 4 * (len(args) + 1)
        for i, value in enumerate((self.stop, *args)):
            self.write(sp + 4 * i, value)
        self.cpu.reg_write(UC_M68K_REG_A7, sp)
        self.run(addr, self.stop)

    def return_to_caller(self):
        sp = self.cpu.reg_read(UC_M68K_REG_A7)
        self.cpu.reg_write(UC_M68K_REG_PC, self.read(sp))
        self.cpu.reg_write(UC_M68K_REG_A7, sp + 4)

    def key_read(self):
        key = self.read(self.cpu.reg_read(UC_M68K_REG_A7) + 4, 2)
        self.cpu.reg_write(UC_M68K_REG_D0, int(key in self.keys))
        self.return_to_caller()

    def score_delta(self):
        self.score_updates.append(self.read(self.cpu.reg_read(UC_M68K_REG_A7) + 8))
        self.return_to_caller()

    def set_rect(self):
        sp = self.cpu.reg_read(UC_M68K_REG_A7)
        bottom, right, top, left = struct.unpack(">4h", self.cpu.mem_read(sp, 8))
        self.cpu.mem_write(
            self.read(sp + 8), struct.pack(">4h", top, left, bottom, right)
        )
        self.cpu.reg_write(UC_M68K_REG_A7, sp + 12)
        self.cpu.reg_write(UC_M68K_REG_PC, self.cpu.reg_read(UC_M68K_REG_PC) + 2)

    def sect_rect(self):
        sp = self.cpu.reg_read(UC_M68K_REG_A7)
        dest, a, b = struct.unpack(">3I", self.cpu.mem_read(sp, 12))
        r1, r2 = (struct.unpack(">4h", self.cpu.mem_read(rect, 8)) for rect in (a, b))
        result = [
            max(r1[0], r2[0]),
            max(r1[1], r2[1]),
            min(r1[2], r2[2]),
            min(r1[3], r2[3]),
        ]
        overlaps = result[0] < result[2] and result[1] < result[3]
        self.cpu.mem_write(dest, struct.pack(">4h", *(result if overlaps else [0] * 4)))
        self.write(sp + 12, int(overlaps), 1)
        self.cpu.reg_write(UC_M68K_REG_A7, sp + 12)
        self.cpu.reg_write(UC_M68K_REG_PC, self.cpu.reg_read(UC_M68K_REG_PC) + 2)

    def motion(self):
        output = []
        for step in range(36):
            self.keys = {124} if 1 <= step <= 5 else set()
            if 2 <= step <= 4:
                self.keys.add(126)
            self.call(0xED0A, self.handle)  # ProcessSprite
            self.call(0x6F78, self.handle)  # Player1Processor
            output.append([self.read(self.actor + o) for o in (0x92, 0x96, 0x8A, 0x8E)])
        return output

    def enemy_frame(self):
        # Stack/register ABI at entry to the selected internal EnemyProcessor blocks.
        for reg, value in (
            (UC_M68K_REG_A2, self.enemy),
            (UC_M68K_REG_A3, self.enemy_list),
            (UC_M68K_REG_A6, self.frame),
            (UC_M68K_REG_A7, self.stack),
        ):
            self.cpu.reg_write(reg, value)
        self.cpu.mem_write(self.frame - 0x38, bytes(0x38))

    def pests(self):
        self.enemy_frame()
        for offset, value in (
            (0x5C, 16),
            (0x62, 7),
            (0x66, 44),
            (0x68, 150),
            (0x6C, -16),
            (0x6E, 624),
            (0x70, 48),
            (0x72, 48),
            (0x50, 500),
        ):
            self.write(self.enemy + offset, value, 2)
        self.write(self.enemy + 0x92, 4 * 32 * 16)
        self.write(self.enemy + 0x96, 208 * 16)
        self.write(self.enemy + 0x8A, 16)
        # Both feet probe column 4, row 15. An upward block animation installs marker 999.
        for reg, value in (
            (UC_M68K_REG_D3, 4),
            (UC_M68K_REG_D4, 4),
            (UC_M68K_REG_D5, 15),
        ):
            self.cpu.reg_write(reg, value)
        self.write(self.globals + 0x5DB2 + 4 * 70 + 15 * 2, 999, 2)
        self.run(0x59DC, 0x5C32)
        fields = lambda: {
            key: self.read(self.enemy + offset, size)
            for key, offset, size in (
                ("stunned", 8, 1),
                ("removed", 10, 1),
                ("vx16", 0x8A, 4),
                ("vy16", 0x8E, 4),
                ("pose", 0x44, 2),
                ("value", 0x68, 2),
                ("stunAge", 0x4E, 2),
            )
        }
        bonk = fields()
        # Feed the exact threshold values into the wake-up block on consecutive steps.
        self.write(self.enemy + 0x4E, 249, 2)
        self.run(0x5630, 0x56F6)
        first = self.read(self.enemy + 0x4A, 2)
        self.run(0x5630, 0x56F6)
        second = self.read(self.enemy + 0x4A, 2)
        self.write(self.enemy + 0x4E, 499, 2)
        self.run(0x5630, 0x56F6)
        before_wake = fields()
        self.run(0x5630, 0x56F6)
        awake = fields()
        # Eligible ordinary pest at the lower left entrance. Verify position reset and value.
        self.write(self.enemy + 0x92, -25 * 16)
        self.write(self.enemy + 0x96, 303 * 16)
        self.run(0x5FE8, 0x62D4)
        escaped = [self.read(self.enemy + o) for o in (0x92, 0x96, 0x8A)]
        # The original scores by calling the UI counter with the pest's value.
        self.write(self.enemy + 8, 1, 1)
        self.write(self.actor + 0x8A, 72)

        def kick(left):
            self.cpu.mem_write(self.enemy + 0x2C, struct.pack(">4h", 40, 100, 72, 132))
            self.cpu.mem_write(
                self.actor + 0x2C, struct.pack(">4h", 30, left, 78, left + 48)
            )
            self.run(0x62D4, 0x65CC)
            return self.read(self.enemy + 10, 1)

        edge = kick(126)  # Left+3 meets the pest's right−3 exactly.
        overlap = kick(125)
        return {
            "bonk": bonk,
            "shakeRates": [first, second],
            "beforeWake": before_wake,
            "awake": awake,
            "escaped": escaped,
            "kickEdge": edge,
            "kickOverlap": overlap,
            "kicked": fields(),
            "scoreDelta": self.score_updates,
        }

    def special_enemy(self, kind):
        # Exercise each species' actual SpecialEnemy routine with the same isolated inputs.
        # Sustained ground contact, living player to the left with feet above the pest.
        self.cpu.mem_write(self.enemy, bytes(0xB0))
        for offset, value in (
            (0x44, kind),
            (0x46, kind),
            (0x5C, 16),
            (0x5E, 0),
            (0x60, 44),
            (0x62, 7),
            (0x66, 44),
            (0x30, 240),
            (0x4A, 8),
        ):
            self.write(self.enemy + offset, value, 2)
        self.write(self.enemy + 0xF, 1, 1)
        self.write(self.enemy + 0xC, 1, 1)
        self.write(self.enemy + 0x92, 128 * 16)
        self.write(self.enemy + 0x96, 208 * 16)
        self.write(self.enemy + 0x8A, 16)
        self.write(self.actor + 0x92, 48 * 16)
        self.write(self.actor + 0x30, 200, 2)
        for i in range(41):
            self.write(self.globals - 0x702A + 2 * i, 10, 2)
        states = []
        for step in range(12):
            self.call(0xAEE8, self.enemy_handle)
            if step in (0, 1, 8, 9, 10, 11):
                states.append(
                    [
                        self.read(self.enemy + o, size)
                        for o, size in ((0x8A, 4), (0x8E, 4), (0x44, 2), (0x4A, 2))
                    ]
                )
        return states


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "directory", type=Path, help="directory containing the extracted .rsrc files"
    )
    args = parser.parse_args()
    mac = Reference(args.directory)
    print(
        json.dumps(
            {
                "macTicksPerStep": mac.read(mac.globals - 0xA38),
                "motion": mac.motion(),
                "pests": mac.pests(),
                "specialEnemy": {
                    k: mac.special_enemy(k) for k in (7, 15, 19, 23, 27, 52, 56)
                },
            },
            separators=(",", ":"),
        )
    )
