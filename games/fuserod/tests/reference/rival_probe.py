"""Run isolated opponent decision branches in the original unpacked image."""
import hashlib
import json
from pathlib import Path
import struct
import sys
from unicorn import Uc, UC_ARCH_X86, UC_MODE_16, UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_AX, UC_X86_REG_BP, UC_X86_REG_CS, UC_X86_REG_DS, UC_X86_REG_IP, UC_X86_REG_SS, UC_X86_REG_SP

def digest(values):
    return hashlib.sha256(json.dumps(values, separators=(",", ":")).encode()).hexdigest()

mz = Path(sys.argv[1]).read_bytes()
image = mz[struct.unpack_from("<H", mz, 8)[0]*16:]
assert hashlib.sha256(image).hexdigest() == "217a709d90715e4299814255a8370d01b9b2e902b8558dd3624e947940c273a5"
vm = Uc(UC_ARCH_X86, UC_MODE_16)
vm.mem_map(0, 0x100000)
vm.mem_write(0, image)
ds = 0x3E080
def put(offset, value):
    vm.mem_write(ds+offset, struct.pack("<H", value & 65535))
def read(offset):
    return struct.unpack("<h", vm.mem_read(ds+offset, 2))[0]

def run(start, ends):
    # Intercept state transitions before wholly unrelated sound, drawing, and gear recomputation.
    def stop(machine, addr, size, unused):
        if addr-16 in ends:
            machine.emu_stop()
    hook = vm.hook_add(UC_HOOK_CODE, stop)
    for reg, value in [(UC_X86_REG_CS,1),(UC_X86_REG_DS,ds//16),(UC_X86_REG_SS,ds//16),
                       (UC_X86_REG_BP,0xF000),(UC_X86_REG_SP,0xEE00)]:
        vm.reg_write(reg,value)
    vm.emu_start(start+16, 0xFFFF, count=1500)
    vm.hook_del(hook)
    ip = vm.reg_read(UC_X86_REG_IP)
    assert ip in ends, hex(ip)
    return ip

police = []
for state in range(4):
    for player in [49,50,51]:
        for gap in [-16,-15,-8,-7,-6,-3,-2,2,3,15,16]:
            put(0xAB2C,state)
            put(0x9ACA,50)
            put(0xA55E,player)
            put(0xA9C6,player+gap)
            put(0xA1BC,0)
            end = run(0xD9B4, {0xD9EC,0xD9E0,0xDA62,0xDA7F})
            police.append(4 if read(0xA1BC) & 0x41 else read(0xAB2C))
print("patrol",len(police),digest(police))

finish = []
for a in range(60,75):
    for b in range(56,82):
        for seg,sub,val in [(0xA55E,0xA560,a),(0xA9C6,0xA9C8,b)]:
            put(seg,val//64)
            put(sub,val%64)
        run(0xB1E8,{0xB219})
        finish.append(bool(read(0xB168)))
print("finish",len(finish),digest(finish))

caps = []
for mode in [1,4,8,16]:
    start = {1:200,4:8,8:8,16:370}[mode]
    for i in range(96):
        player = start + 12 + i%30
        opp = player + [-14,-3,3,5,14,20][i%6]
        ps = [40,57,96,97][i%4]
        speed = [49,59,60,79,100,115][i%6]
        police_on, king = i%5==0, i%11==0
        vmax = 110
        for offset,val in [(0xADD6,mode),(0xA9C6,opp),(0xA55E,player),(0xA1E4,speed),(0xA100,ps),
              (0xA56E,int(king)),(0xAB2C,2 if police_on else 0),(0xA5F8,16),(0xA2AA,1000),
              (0xB8E4,vmax),(0xA33C,vmax*(60 if police_on else 70)//100),(0xA2B0,vmax*80//100),
              (0x523C,0),(0xA1BE,1),(0x8014,0),(0x871A,0x8000),(0x871C,0x8000)]:
            put(offset,val)
        base=0x80000+opp*2
        vm.mem_write(base+0x3EEA,struct.pack("<H",0x20 if i%7==0 else 0))
        vm.mem_write(base+0x372E, struct.pack("<HH",0,int(i%3==0)))
        end = run(0xCB98,{0xCB00,0xCD51,0xCC85})
        cap = read(vm.reg_read(UC_X86_REG_SP)+4) if end==0xCB00 else None
        caps.append(cap)
print("caps",len(caps),digest(caps))

dodges=[]
for x in range(1500,3301,100):
    for left,right in [(1500,1800),(1880,2050),(2100,2750),(2800,3200)]:
        for offset,val in [(0xF004,x),(0xEFF6,left),(0xEFF2,right),(0x985C,1500),(0xA558,3300)]:
            put(offset,val)
        run(0xD21A,{0xD2A3})
        dodges.append(struct.unpack("<h",struct.pack("<H",vm.reg_read(UC_X86_REG_AX)))[0])
print("dodges",len(dodges),digest(dodges),dodges[:12])

brackets=[]
for ahead in [False,True]:
    for dial in [140,170,205,250]:
        for actual in [140,170,205,250]:
            for off,val in [(0x9B3E,int(ahead)),(0xF004,4),(0xADA8,dial),(0xB8C2,actual)]:
                put(off,val)
            ip=run(0xB366,{0xB45F,0xB3C2,0xB41E,0xB40B})
            if ip==0xB40B:
                # The next instructions display a message; resume after that call.
                run(0xB413,{0xB419})
            brackets.append(bool(read(0x9B3E)))
print("brackets",len(brackets),digest(brackets))

delays=[]
for dial in [140,170,205,250]:
    for other in [140,170,205,250]:
        for off,val in [(0x911A,110),(0x911C,0),(0x9120,110),(0x9122,0),(0xADA8,dial),(0x9ADC,other)]:
            put(off,val)
        run(0x90A6,{0x8F59,0x8F69})
        delays.append(read(0x911A)-110)
print("delays",len(delays),digest(delays))
