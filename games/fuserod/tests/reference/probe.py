"""Trace the user's own unpacked MZ image with Unicorn. See README.md."""
import hashlib
import json
from pathlib import Path
import struct
import sys
from unicorn import Uc, UC_ARCH_X86, UC_MODE_16
from unicorn.x86_const import UC_X86_REG_AX, UC_X86_REG_BP, UC_X86_REG_CS, UC_X86_REG_DS, UC_X86_REG_SS, UC_X86_REG_SP


def trace(image, power, gearbox, tires, scenario):
    vm = Uc(UC_ARCH_X86, UC_MODE_16)
    vm.mem_map(0, 0x100000)
    vm.mem_write(0, image)
    ds = 0x3E080
    car, player = 0xC000, 0xA100

    def put(offset, value, size=2):
        vm.mem_write(ds + offset, (value % (1 << size*8)).to_bytes(size, "little"))

    def word(offset):
        return int.from_bytes(vm.mem_read(ds + offset, 2), "little", signed=True)

    vm.reg_write(UC_X86_REG_DS, ds // 16)
    vm.reg_write(UC_X86_REG_SS, ds // 16)
    # Runtime-only catalogue and car records. Original tables and code remain in place.
    put(0xAA02, car)
    put(0xA810, 2, 1)
    for offset in [2, 6, 8]:
        put(0xBAAC + offset, 1)
    auto = scenario == "automatic"
    for slot, (offset, grade) in enumerate([(6, 0 if auto else gearbox + 1), (8, power), (10, 0), (12, 0),
                                             (18, tires), (28, 0), (30, 0), (32, 1)]):
        part = 0xC100 + slot*16
        put(car + offset, part)
        put(part + 4, slot)
        put(0x4504 + slot*10, grade, 1)
    vm.reg_write(UC_X86_REG_CS, 1)
    vm.reg_write(UC_X86_REG_SP, 0xF000)
    put(0xF000, 0xF100)
    put(0xF002, car)
    put(0xF004, player)
    vm.emu_start(0xC2A4, 0xF110, count=50000)
    assert word(player + 0x1C) in (3, 4), "car_setup did not run"
    put(player + 0x0E, 1500)
    put(player + 0x14, word(player + 0x48))
    put(player + 0x16, word(player + 0x4A))
    put(0xB7AE, 1, 1)
    put(0xA2AA, 960)
    put(0x4A84, 37, 4)
    # Ignore external input devices. Stop just before the separate road collision routine.
    for offset in [0x1F60, 0x3B25, 0x3B48, 0x9730, 0x1F82]:
        put(offset, 0)
    rows = []
    if scenario == "speeds":
        put(0xB7B4, 4)
        for speed in range(-1, 142):
            vm.reg_write(UC_X86_REG_SP, 0xF000)
            vm.reg_write(UC_X86_REG_CS, 1)
            put(0xF000, 0xF100)
            put(0xF002, 1)
            put(0xF004, speed)
            vm.emu_start(0xCEAC, 0xF110, count=100)
            rows.append(vm.reg_read(UC_X86_REG_AX))
        return rows
    for i in range(2000 if scenario == "quarter" else 170):
        rpm, gear = word(player + 14), word(player + 24)
        running = scenario == "quarter" or i < 135
        brake = scenario != "quarter" and 95 <= i < 108
        gas = running and not brake
        shift = (gear == 0 or (scenario != "limiter" and rpm >= 4350 and gear < word(player + 28))) and gas
        if auto:
            shift = gear == 0 and gas
        steer = 1 if 38 <= i < 49 else -1 if 52 <= i < 64 else 0
        put(0x1F6E, (i+1)*3, 4)
        put(0x3B36, steer, 1)
        put(0x3B37, -1 if gas else 1 if brake else 0, 1)
        put(0x3BD4, int(shift), 1)
        put(0x7BA2, int(scenario != "quarter" and 75 <= i < 79))
        vm.reg_write(UC_X86_REG_BP, 0xF000)
        vm.reg_write(UC_X86_REG_SP, 0xEE00)
        vm.reg_write(UC_X86_REG_CS, 1)
        vm.emu_start(0x2960, 0x2F50, count=3000)
        rows.append([word(player+14), word(player), word(player+24), word(player+4),
                     word(player+0x42), word(0x2006), word(0xC112), word(0xC102),
                     word(player+0xBC)])
        if rows[-1][-1]:
            break
    return rows


def quarter(rows, speeds):
    # Compare every reconstructed 20 Hz frame, including the first that crosses the stripe.
    # Interrupt number n falls in the first log tick t for which n*16384*20 <= t*1193182.
    frames = []
    position, interrupt, i, speed, rpm, gear = 0, 0, 0, 0, 1500, 0
    for t in range(1, 2401):
        while (interrupt + 1)*16384*20 <= t*1193182:
            interrupt += 1
            if interrupt % 12 == 0:
                rpm, speed, gear = rows[i][:3]
                i += 1
            if interrupt % 8 == 0:
                position += speeds[speed+1]
        frames.append([rpm, speed, gear, position])
        if position >= 5120:
            return frames
    raise ValueError("quarter-mile run did not finish")


if __name__ == "__main__":
    mz = Path(sys.argv[1]).read_bytes()
    image = mz[struct.unpack_from("<H", mz, 8)[0]*16:]
    print("unpacked image", hashlib.sha256(image).hexdigest(), file=sys.stderr)
    assert hashlib.sha256(image).hexdigest() == "217a709d90715e4299814255a8370d01b9b2e902b8558dd3624e947940c273a5"
    speeds = trace(image, 0, 0, 0, "speeds")
    print("road steps", hashlib.sha256(json.dumps(speeds, separators=(",", ":")).encode()).hexdigest())
    for tune in [(0, 0, 0), (1, 1, 1), (2, 2, 2)]:
        for scenario in ["shifts", "limiter", "quarter", "automatic"]:
            rows = trace(image, *tune, scenario)
            if scenario == "quarter":
                rows = quarter(rows, speeds)
            digest = hashlib.sha256(json.dumps(rows, separators=(",", ":")).encode()).hexdigest()
            print(tune, scenario, len(rows), digest, rows[-1])
