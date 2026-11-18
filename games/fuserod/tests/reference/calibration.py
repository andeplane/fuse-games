"""Run DOS car_perf and car_setup against the owned game's actual catalogue."""
import hashlib
import json
from pathlib import Path
import struct
import sys
from unicorn import Uc, UC_ARCH_X86, UC_MODE_16
from unicorn.x86_const import UC_X86_REG_AX, UC_X86_REG_CS, UC_X86_REG_DS, UC_X86_REG_SS, UC_X86_REG_SP


def measure(image, data, model, modified):
    vm = Uc(UC_ARCH_X86, UC_MODE_16)
    ds, car, player = 0x3E080, 0xC000, 0xA100
    vm.mem_map(0, 0x100000)
    vm.mem_write(0, image)
    vm.mem_write(ds + 0xA80C, data[396:836])
    vm.mem_write(ds + 0xBAAC, data[836:1056])

    def put(offset, value, size=2):
        vm.mem_write(ds + offset, (value % (1 << (8*size))).to_bytes(size, 'little'))

    def word(offset):
        return int.from_bytes(vm.mem_read(ds + offset, 2), 'little')

    def invoke(address):
        for reg in [UC_X86_REG_DS, UC_X86_REG_SS]:
            vm.reg_write(reg, ds // 16)
        vm.reg_write(UC_X86_REG_CS, 1)
        vm.reg_write(UC_X86_REG_SP, 0xF000)
        put(0xF000, 0xF100)
        put(0xF002, car)
        put(0xF004, player)
        vm.emu_start(0x10 + address, 0xF110, count=50000)

    put(car + 2, model)
    a, b = struct.unpack_from('<HH', data, 396+20*model+8)
    make = (a & 14) >> 1
    parts = [(a>>8 & 3)*3+make, ((a>>6 & 3)+3)*3+make, 50+(a>>4 & 3),
             ((a>>10 & 15)+8)*3+make, (a>>14)+21, (b & 31)*3+53+make,
             59+(b>>5 & 31), 61+(b>>10)]
    if modified:
        # New motor, close-ratio gearbox, slicks, three carburettors or blower,
        # headers, no muffler, differential, altered spark/condition and body.
        parts = [6, 18, 52, 48 if model % 2 else 30, 23, 56, None, 61+model%3]
        put(car+0x23, -5+model%9, 1)
        removed = model % 8
        put(car+0x26, (removed&1)*0x2000 + (removed&2)*0x4000 + (removed&4)*0x1000)
    for i, (offset, part_type) in enumerate(zip([8, 6, 18, 10, 12, 28, 30, 32], parts)):
        if part_type is None:
            continue
        pointer = 0xC100+16*i
        put(car+offset, pointer)
        put(pointer+4, part_type)
        if modified and i == 0:
            put(pointer+2, model*399)
    invoke(0xC02C)
    perf = vm.reg_read(UC_X86_REG_AX)
    invoke(0xC294)
    ratio = word(player+0x36)
    rpm = 1500 + word(player+0x44+24+4)
    return [word(player+0x1C), perf, rpm, rpm//ratio]


if __name__ == '__main__':
    mz = Path(sys.argv[1]).read_bytes()
    image = mz[16*struct.unpack_from('<H', mz, 8)[0]:]
    data = Path(sys.argv[2]).read_bytes()
    assert hashlib.sha256(image).hexdigest() == '217a709d90715e4299814255a8370d01b9b2e902b8558dd3624e947940c273a5'
    assert hashlib.sha256(data).hexdigest() == '8e3393ae7e2b54eb14431b12ef4b86197029abbf00b6046eecce6957e17d3644'
    for modified in [False, True]:
        rows = [measure(image, data, m, modified) for m in range(22)]
        print(modified, hashlib.sha256(json.dumps(rows,separators=(',',':')).encode()).hexdigest(), rows)
