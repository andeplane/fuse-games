"""Measure a free drop and a known contact with a locally supplied TIM DOS EXE.

Reproduce with Python 3 and unicorn==2.1.4. Decompress a *copy* of your
TIM.EXE with mywave82/unlzexe commit 066aac7be3b27813c221d3b03621ad6dfaecd285:
    cc -O2 -o unlzexe unlzexe.c
    ./unlzexe original.exe unpacked.exe
    python probe_tim_motion.py unpacked.exe
The input is never modified. Only numeric measurements are emitted.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct

from unicorn import Uc, UC_ARCH_X86, UC_MODE_16, UC_HOOK_INTR, UC_HOOK_INSN
from unicorn.x86_const import (
    UC_X86_REG_CS, UC_X86_REG_DS, UC_X86_REG_ES, UC_X86_REG_SS, UC_X86_REG_SP,
    UC_X86_REG_IP, UC_X86_INS_IN, UC_X86_INS_OUT,
)

PACKED_SHA256 = "1d8702c45106f4abd5af468c72c38d0588fc9e02a8928df988faaf57d5eb2303"
UNPACKED_SHA256 = "4e6ed40e009e67c491470c510730952ca54de1059bfc449e0fd7fb9ccabdc2cc"
HEADER = 0x2600
DATA_SEGMENT = 0x2D3C
PART = 0xA000
WALL = 0xA200
RETURN_SEGMENT = 0x7000


class Harness:
    def __init__(self, image):
        if hashlib.sha256(image).hexdigest() != UNPACKED_SHA256:
            raise ValueError("Expected the decompressed DOS build identified in this probe")
        self.cpu = Uc(UC_ARCH_X86, UC_MODE_16)
        self.cpu.mem_map(0, 1 << 20)
        # Zero DOS image load base keeps all image-relative segment relocations intact.
        self.cpu.mem_write(0, image[HEADER:])
        for reg in (UC_X86_REG_DS, UC_X86_REG_ES, UC_X86_REG_SS):
            self.cpu.reg_write(reg, DATA_SEGMENT)

    def write(self, offset, fmt, *values):
        self.cpu.mem_write(DATA_SEGMENT * 16 + offset, struct.pack("<" + fmt, *values))

    def read(self, offset, fmt):
        fmt = "<" + fmt
        data = self.cpu.mem_read(DATA_SEGMENT * 16 + offset, struct.calcsize(fmt))
        return struct.unpack(fmt, data)

    def call(self, file_offset, *args, segment=0):
        stack = 0xFF00
        self.write(stack, "HH" + "H" * len(args), 0, RETURN_SEGMENT, *args)
        self.cpu.reg_write(UC_X86_REG_CS, segment)
        self.cpu.reg_write(UC_X86_REG_SP, stack)
        self.cpu.emu_start(file_offset - HEADER, RETURN_SEGMENT * 16, count=1000000)
        if self.cpu.reg_read(UC_X86_REG_CS) != RETURN_SEGMENT:
            raise RuntimeError(f"Instruction budget exhausted at function {file_offset:#x}")

    def init_part(self, offset, kind):
        self.cpu.mem_write(DATA_SEGMENT * 16 + offset, bytes(0x100))
        self.write(offset + 4, "H", kind)
        mass, = self.read(0xEA6 + 58 * kind + 2, "h")
        self.write(offset + 0x3A, "h", mass)


def floor_scene(image):
    """Step the complete DOS part dispatcher and collision-history pass."""
    h = Harness(image)
    h.write(0x50B3, "HH", 67, 272)
    h.call(0x50C0)
    # Construct synthetic static/moving lists and seed the positions normally
    # loaded by the level reader. Original part routines generate the polygons.
    parts = (
        (WALL, 1, 10, 160, 160, 16, 0x6840),
        (PART, 0, 64, 100, 32, 32, 0x1800),
    )
    for ptr, kind, x, y, width, height, flags in parts:
        h.init_part(ptr, kind)
        h.write(ptr + 6, "H", flags)
        h.write(ptr + 0x16, "ii", x * 512, y * 512)
        for field in (0x1E, 0x22, 0x26, 0x2A, 0x2E, 0x32):
            h.write(ptr + field, "hh", x, y)
        for field in (0x40, 0x44, 0x48, 0x4C, 0x50):
            h.write(ptr + field, "hh", width, height)
        definition = 0xEA6 + 58 * kind
        count, = h.read(definition + 0x1E, "H")
        h.write(ptr + 0x80, "HH", count, ptr + 0x100)
        if kind == 0:
            # Supply dimensions in lieu of loading and rendering the DOS bitmap.
            h.write(definition + 0x1A, "H", 0xA400)
            h.write(0xA400, "hh", width, height)
        offset, segment = h.read(definition + 0x2A, "HH")
        h.call(HEADER + segment * 16 + offset, ptr, segment=segment)
    h.write(0x5179, "H", PART)
    h.write(0x521B, "H", WALL)
    h.write(0x4E6B, "H", 0x2000)  # simulation mode
    trace = []
    for tick in range(1, 46):
        h.call(0x3586)  # advance all parts and resolve actual collisions
        h.call(0x3A4E)  # advance animation tick
        h.call(0xA2A2)  # snapshot current positions for the next tick
        x, y = h.read(PART + 0x1E, "hh")
        vx, vy = h.read(PART + 0x36, "hh")
        hit, = h.read(PART + 0x84, "H")
        trace.append({"tick": tick, "x": x, "y": y, "vx": vx, "vy": vy, "contact": hit == WALL})
    return trace


def clock_probe(image):
    """Observe the DOS timer setup, IRQ handler and loop gate with virtual I/O."""
    h = Harness(image)
    writes = []

    def dos_interrupt(cpu, number, user_data):
        if number != 0x21:
            raise RuntimeError(f"Unexpected interrupt {number:#x}")

    def port_out(cpu, port, size, value, user_data):
        if port in (0x40, 0x43):
            writes.append((port, value))

    h.cpu.hook_add(UC_HOOK_INTR, dos_interrupt)
    h.cpu.hook_add(UC_HOOK_INSN, port_out, None, 1, 0, UC_X86_INS_OUT)
    h.cpu.hook_add(UC_HOOK_INSN, lambda *_: 0, None, 1, 0, UC_X86_INS_IN)
    # The program pushes 13 immediately before this call at offset 0x1086b.
    h.call(0x22CC1, 13, segment=0x1C25)
    h.write(0x44EF, "H", 10000)
    for irq_count in range(1, 13):
        h.write(0xFF00, "HHH", 0, RETURN_SEGMENT, 0x200)  # IRET frame
        h.cpu.reg_write(UC_X86_REG_CS, 0x1C25)
        h.cpu.reg_write(UC_X86_REG_SP, 0xFF00)
        h.cpu.emu_start(0x22D67 - HEADER, RETURN_SEGMENT * 16, count=10000)
        if h.cpu.reg_read(UC_X86_REG_CS) != RETURN_SEGMENT:
            raise RuntimeError("IRQ0 did not return")
        h.cpu.reg_write(UC_X86_REG_CS, 0)
        # Give the busy wait a bounded number of instructions per interrupt.
        h.cpu.emu_start(0x3930 - HEADER, 0x394D - HEADER, count=100)
        if h.cpu.reg_read(UC_X86_REG_IP) == 0x394D - HEADER:
            return {"pit_writes": writes, "irqs_per_step": irq_count}
    raise RuntimeError("Simulation gate remained closed")


def measure(image):
    h = Harness(image)
    h.write(0x50B3, "HH", 67, 272)  # controlled air and gravity
    h.call(0x50C0)  # build per-part atmospheric constants
    results = {"drops": [], "contacts": [], "floor_scene": floor_scene(image), "clock": clock_probe(image)}
    for kind in (0, 4, 9, 28, 44):
        h.init_part(PART, kind)
        h.write(PART + 0x16, "ii", 20 * 512, 100 * 512)
        trace = []
        for tick in range(1, 46):
            h.call(0x5239, PART)  # update velocity and force
            h.call(0x5293, PART)  # integrate position
            if tick in (1, 2, 3, 4, 5, 6, 10, 20, 35, 36, 37, 45):
                y, = h.read(PART + 0x20, "h")
                velocity, = h.read(PART + 0x38, "h")
                position, = h.read(PART + 0x1A, "i")
                trace.append({"tick": tick, "y_px": y, "vy": velocity, "y_fixed": position})
        acc, limit = h.read(0xEA6 + 58 * kind + 8, "hh")
        results["drops"].append({"part": kind, "acceleration": acc, "limit": limit, "trace": trace})

    # Supply an already identified brick contact to isolate its response
    # from the game's broad-phase, contact generation and scene initialization.
    for kind in (0, 9):
        for angle in (0, 0x2000, 0xE000):
            for vy in (64, 269, 1024, 4096, 9695):
                h.init_part(PART, kind)
                h.init_part(WALL, 1)
                h.write(PART + 0x1E, "hh", 64, 128)
                h.write(PART + 0x36, "hh", 0, vy)
                h.write(PART + 0x84, "HBBH", WALL, 1, 1, angle)
                h.call(0x5646, PART)
                results["contacts"].append({
                    "part": kind, "angle": angle, "vy_in": vy,
                    "velocity_out": h.read(PART + 0x36, "hh"),
                })
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("decompressed_exe", type=Path)
    args = parser.parse_args()
    print(json.dumps(measure(args.decompressed_exe.read_bytes()), indent=2))
