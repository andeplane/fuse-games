"""Measure a switch, motor, belt, conveyor and ball in the original DOS dispatch routines.

Place alongside probe_tim_motion.py and run with the same decompressed executable.
The fixture supplies the switch state and an existing top-surface contact.
Callbacks are invoked in the listed order; the DOS scheduler is outside this probe.
"""
import json
import struct
import sys
from pathlib import Path
from probe_tim_motion import Harness, RETURN_SEGMENT
from unicorn.x86_const import UC_X86_REG_CS, UC_X86_REG_SP


def run_case(image, power, reversed_motor, connected):
    vm = Harness(image)
    switch, motor, conveyor, ball, belt = 0xa000, 0xa200, 0xa400, 0xa600, 0xa800
    for addr, kind in ((switch, 21), (motor, 50), (conveyor, 5), (ball, 9)):
        vm.init_part(addr, kind)
    vm.write(switch + 0x62, "H", motor)
    vm.write(switch + 0x12, "h", int(power))
    vm.write(motor + 0x08, "H", 0x10 if reversed_motor else 0)
    if connected:
        vm.write(motor + 0x54, "H", belt)
        vm.write(conveyor + 0x54, "H", belt)
        vm.write(belt + 4, "HH", motor, conveyor)
    vm.write(ball + 0x84, "H", conveyor)
    # Move the previous animation frame aside to avoid the unrelated sound path.
    vm.write(motor + 0x0e, "h", -1)
    vm.write(conveyor + 0x0c, "h", 28)

    def callback(kind, slot, argument):
        pointer = 0x0ea6 + 58 * kind + 34 + slot * 4
        offset, segment = vm.read(pointer, "HH")
        stack = 0xff00
        vm.write(stack, "HHH", 0, RETURN_SEGMENT, argument)
        vm.cpu.reg_write(UC_X86_REG_CS, segment)
        vm.cpu.reg_write(UC_X86_REG_SP, stack)
        vm.cpu.emu_start(segment * 16 + offset, RETURN_SEGMENT * 16, count=20000)
        if vm.cpu.reg_read(UC_X86_REG_CS) != RETURN_SEGMENT:
            raise ValueError("part callback did not return")

    callback(21, 1, switch)
    callback(50, 1, motor)
    callback(5, 1, conveyor)
    callback(5, 0, ball)
    return {
        "power": power, "motor_flipped": reversed_motor, "has_belt": connected,
        "motor_state": vm.read(motor + 0x12, "h")[0],
        "conveyor_direction": vm.read(conveyor + 0x12, "h")[0],
        "conveyor_frame": vm.read(conveyor + 0x0c, "h")[0],
        "ball_vx": vm.read(ball + 0x36, "h")[0],
    }


if __name__ == "__main__":
    image = Path(sys.argv[1]).read_bytes()
    print(json.dumps([run_case(image, power, flip, belt)
                      for power in (False, True)
                      for flip in (False, True)
                      for belt in (False, True)], indent=2))
