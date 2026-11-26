"""Check an independently supplied unpacked SR.EXE's canyon obstacle positions against Fuserod.
Run with Unicorn 2.1.4. No original data is exported; stdout contains seed, count and digest.
"""
import hashlib
from pathlib import Path
import json
import struct
import sys

from unicorn import Uc, UC_ARCH_X86, UC_MODE_16
from unicorn.x86_const import UC_X86_REG_AX, UC_X86_REG_CS, UC_X86_REG_DS, UC_X86_REG_IP, UC_X86_REG_SS, UC_X86_REG_SP

DATA = 0x3e080
TRACK = 0x37260

def sample(image, seed):
    cpu = Uc(UC_ARCH_X86, UC_MODE_16)
    cpu.mem_map(0, 0x100000)
    cpu.mem_write(0, image)
    def word(offset, value):
        cpu.mem_write(DATA + offset, struct.pack("<H", value & 0xffff))
    for offset in range(0x86f8, 0x8726, 2):
        word(offset, TRACK // 16)
    word(0xadd8, 0)
    cpu.mem_write(DATA + 0xa9f8, struct.pack("<I", seed))
    for offset, value in [(0xf000, 0xffff), (0xf002, 0xdcb), (0xf004, 0)]:
        word(offset, value)
    for reg, value in [(UC_X86_REG_CS, 0x0dcb), (UC_X86_REG_DS, DATA//16),
                       (UC_X86_REG_SS, DATA//16), (UC_X86_REG_SP,0xf000)]:
        cpu.reg_write(reg, value)
    # track_build_all(full=0) restores the saved road seed. Stop before rnd(-1)
    # replaces that seed with the current time.
    cpu.emu_start(0xdcb0+0x2866, 0xdcb0+0x3395, count=3_000_000)
    assert cpu.reg_read(UC_X86_REG_IP) == 0x3395
    def track(offset, segment):
        return struct.unpack("<H",cpu.mem_read(TRACK + offset + segment*2, 2))[0]
    rows = []
    for segment in range(370,960):
        flags = track(0x3eea, segment)
        if flags & 0x1004:
            rows.append([segment-370,"rock" if flags & 4 else "debris",track(0x665a,segment)])
        for offset,lane in [(0x27b6,0),(0x2f72,16)]:
            side=track(offset,segment)
            if side&0x10: rows.append([segment-370,"bush",lane])
            if side&0x1000: rows.append([segment-370,"warning",lane])
    rows.sort()
    final_seed = struct.unpack("<I",cpu.mem_read(DATA+0x4a84,4))[0]
    packed = json.dumps(rows,separators=(",",":")).encode()
    return [seed, final_seed, len(rows), hashlib.sha256(packed).hexdigest()]

def dodge(image, x, offset, kind, speed, player):
    cpu=Uc(UC_ARCH_X86,UC_MODE_16)
    cpu.mem_map(0,0x100000)
    cpu.mem_write(0,image)
    def put(address,value): cpu.mem_write(address,struct.pack("<H",value & 0xffff))
    for off in [0x86ee,0x871a,0x8720,0x8722]:
        put(DATA+off,TRACK//16)
    for off in [0x3eea,0x27b6,0x2f72,0x665a]:
        cpu.mem_write(TRACK+off+198, bytes(26))
    lane=6
    at=100+offset
    if kind=="rock":
        put(TRACK+0x3eea+2*at,4)
        put(TRACK+0x665a+2*at,lane)
    else:
        put(TRACK+(0x27b6 if kind=="left" else 0x2f72)+2*at,0x10)
    native=2380+(x*850+500)//1000
    target=2380+(320*850+500)//1000
    for off,val in [(0xa1e4,speed),(0x985c,1500),(0xa558,3300),(0xa55e,player),(0xa564,2380),(0xa9cc,native),(0xf000,0xf100),(0xf002,native),(0xf004,target-native),(0xf006,100)]:
        put(DATA+off,val)
    for reg,value in [(UC_X86_REG_CS,1),(UC_X86_REG_DS,DATA//16),(UC_X86_REG_SS,DATA//16),(UC_X86_REG_SP,0xf000)]:
        cpu.reg_write(reg,value)
    cpu.emu_start(16+0xcf9a,16+0xf100,count=1200)
    assert cpu.reg_read(UC_X86_REG_IP)==0xf100
    ax=cpu.reg_read(UC_X86_REG_AX)
    return ax-65536 if ax>=32768 else ax

if __name__ == "__main__":
    data = Path(sys.argv[1]).read_bytes()
    image = data[struct.unpack_from("<H",data,8)[0]*16:]
    assert hashlib.sha256(image).hexdigest() == "217a709d90715e4299814255a8370d01b9b2e902b8558dd3624e947940c273a5"
    for seed in [0,1,37,0xdeadbeef]:
        print(json.dumps(sample(image, seed)))
    rows=[dodge(image,x,offset,kind,speed,player) for x in [-900,-250,0,500,950]
          for offset in [0,2,6,7] for kind in ["rock","left","right"] for speed in [50,51] for player in [50,104]]
    print(len(rows),hashlib.sha256(json.dumps(rows,separators=(",",":")).encode()).hexdigest())
