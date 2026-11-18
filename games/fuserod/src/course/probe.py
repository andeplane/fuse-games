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


def oracle(image, route, x, speed, feature="clear"):
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
    if feature in ["bridge", "rough", "guardrail"]:
        array,value = {"bridge":(0x3EEA,0x80),"rough":(0x3EEA,0x60),"guardrail":(0x2F72,0x8000)}[feature]
        machine.mem_write(0x37260+array+2,struct.pack("<H",value))
        if feature=="bridge":
            put(0xA7DA,2000)
            put(0xB8D2,2800)
    elif feature=="rock":
        put(0xBB88,int(abs(x/1000+0.28)<=0.14))
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


def bank(image,lane,previous=None,speed=0):
    machine=Uc(UC_ARCH_X86,UC_MODE_16)
    machine.mem_map(0,0x100000)
    machine.mem_write(0,image)
    ds=0x3E080
    camera=2118+(lane*927+500)//1000
    left,right=camera-110,camera+520
    def put(off,value):
        machine.mem_write(ds+off,struct.pack("<H",value&0xffff))
    def get(off):
        return struct.unpack("<h",machine.mem_read(ds+off,2))[0]
    for off,value in [(0x9AC8,left),(0x9A58,right),(0xA564,camera),(0xF000,0xF100)]:
        put(off,value)
    for reg,value in [(UC_X86_REG_DS,ds//16),(UC_X86_REG_SS,ds//16),(UC_X86_REG_SP,0xF000),(UC_X86_REG_CS,0x0DCB)]:
        machine.reg_write(reg,value)
    if left<=1480 or right>=3320:
        start=0x9d9c if left<=1480 else 0x9e4e
        machine.emu_start(0xdcb0+start,0xdcb0+0xf100,count=200)
        assert machine.reg_read(UC_X86_REG_IP)==0xf100
    if previous is None:
        return -get(0x9e70)
    prev=2118+(previous*927+500)//1000
    def side(p): return -1 if p<2360 else 1 if p>2440 else 0
    for off,value in [(0x96F6,28),(0x96F8,0x7000),(0xA100,speed),
                      (0xA2B6,left),(0xA55A,right),(0xB16E,2360),(0xB872,2440),
                      (0xA7E8,side(prev-110)),(0xAAF2,side(prev+520))]:
        put(off,value)
    machine.reg_write(UC_X86_REG_SP,0xF000)
    machine.emu_start(0xdcb0+0x9f08,0xdcb0+0xf100,count=200)
    assert machine.reg_read(UC_X86_REG_IP)==0xf100
    after=get(0xA564)
    return [lane if after==camera else ((after-2118)*1000+463)//927,get(0xA100),-get(0x9e70)]


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
    for feature in ["bridge","rough","rock","guardrail"]:
        rows=[oracle(image,"canyon",x,speed,feature)
              for x in [-1200,-1001,-420,-369,-368,-280,-140,0,323,324,999,1000,1001,1100]
              for speed in [10,30,31,39,40,60,61]]
        print(feature,len(rows),hashlib.sha256(json.dumps(rows,separators=(",",":")).encode()).hexdigest())
    angles=[bank(image,lane) for lane in range(-1000,1001,5)]
    print("bank",len(angles),hashlib.sha256(json.dumps(angles,separators=(",",":")).encode()).hexdigest())
    samples=[bank(image,lane,lane-delta,speed)
             for lane in range(-1000,1001,25) for delta in [-180,0,180] for speed in [10,11,60]]
    print("channel",len(samples),hashlib.sha256(json.dumps(samples,separators=(",",":")).encode()).hexdigest())
