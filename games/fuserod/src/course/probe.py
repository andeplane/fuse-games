"""Run the DOS wall-contact routine on authored clear-track fixtures (Unicorn 2.1.4)."""
import hashlib
import json
from pathlib import Path
import struct
import sys
from unicorn import Uc, UC_ARCH_X86, UC_MODE_16
from unicorn.x86_const import (
    UC_X86_REG_AX, UC_X86_REG_CS, UC_X86_REG_DS, UC_X86_REG_IP,
    UC_X86_REG_SS, UC_X86_REG_SP,
)


def oracle(image, route, x, speed):
    machine = Uc(UC_ARCH_X86, UC_MODE_16)
    machine.mem_map(0, 0x100000)
    machine.mem_write(0, image)
    data = 0x3E080
    # A synthetic, clear segment: no resource data copied from a course.
    machine.mem_write(0x37260 + 0x27B6, bytes(0x6800 - 0x27B6))
    def put(offset, value):
        machine.mem_write(data + offset, struct.pack("<H", value & 0xffff))
    def word(offset):
        return struct.unpack("<h", machine.mem_read(data + offset, 2))[0]
    aqueduct = route == "aqueduct"
    scale, centre = (927, 2118) if aqueduct else (850, 2380)
    # JavaScript Math.round(v) = floor(v + 0.5), also for negative ties.
    cam = centre + (x*scale+500)//1000
    for off, value in {
        0xADD6: {"strip": 4, "aqueduct": 8, "canyon": 16}[route],
        0xA55E: 0, 0xA564: cam, 0xA7DA: 1500, 0xB8D2: 3300,
        0xA100: speed, 0x9E92: speed, 0x9AC8: cam-110, 0x9A58: cam+520,
        0x8720: 0x3726, 0x8722: 0x3726, 0xA7D2: 0,
        0xF000: 0xF100, 0xF002: 0x0DCB,
    }.items():
        put(off, value)
    # The audio adapter consumes no arguments and has no driving side effects.
    machine.mem_write(0x78000, bytes([0xcb]))
    put(0xBB8C+16*4, 0)
    put(0xBB8C+16*4+2, 0x7800)
    for reg, value in [(UC_X86_REG_DS,data//16),(UC_X86_REG_SS,data//16),
                       (UC_X86_REG_SP,0xF000),(UC_X86_REG_CS,0x0DCB)]:
        machine.reg_write(reg,value)
    machine.emu_start(0xDCB0+0x148A, 0xDCB0+0xF100, count=1500)
    assert machine.reg_read(UC_X86_REG_IP)==0xF100, "routine failed to return"
    cam_after=word(0xA564)
    x_after = x if cam_after==cam else ((cam_after-centre)*1000+scale//2)//scale
    return [x_after,word(0xA100),word(0x7BA2),machine.reg_read(UC_X86_REG_AX)]


if __name__=="__main__":
    packed=Path(sys.argv[1]).read_bytes()
    image=packed[struct.unpack_from("<H",packed,8)[0]*16:]
    assert hashlib.sha256(image).hexdigest()=="217a709d90715e4299814255a8370d01b9b2e902b8558dd3624e947940c273a5"
    for route in ["strip","aqueduct","canyon"]:
        rows=[oracle(image,route,x,speed)
              for x in [-1450,-1306,-1177,-1176,-1001,-1000,-999,0,787,788,789,998,999,1000,1001,1176,1177,1306,1450]
              for speed in [0,9,10,39,40,41,75]]
        digest=hashlib.sha256(json.dumps(rows,separators=(",",":")).encode()).hexdigest()
        print(route,len(rows),digest)
