"""Compare Fuse maps with the Deluxe executable's map copy and floor fill.

uv run --with unicorn==2.1.4 verify-map-setup.py '/path/to/Bonkheads Deluxe'
Requires Node 22.18+ for running the TypeScript level decoder.
"""

import hashlib
import json
import runpy
import struct
import subprocess
import sys
from pathlib import Path

from unicorn import Uc, UC_ARCH_M68K, UC_MODE_BIG_ENDIAN
from unicorn.m68k_const import UC_CPU_M68K_M68000, UC_M68K_REG_A2, UC_M68K_REG_A5


HERE = Path(__file__).resolve().parent
read = runpy.run_path(str(HERE / "import-levels.py"))["resources"]


def verify(source):
    code = read(source / "Bonkheads Deluxe.rsrc")["CODE"][2][1]
    if hashlib.sha256(code).hexdigest() != "3c601d1f447117f2fe023cdad77eb35473f8985436b1e658b16103927cfff122":
        raise ValueError("Different CODE 2 revision; verify instruction offsets before running")
    # Entry immediately after three SetRect calls; stop before CreateDeadBlockList.
    # The 68000 reads the BKMP through a Classic Mac Handle in A2 and writes
    # the 20 columns of its working map at A5 minus 0x6626, stride 35 words.
    cpu = Uc(UC_ARCH_M68K, UC_MODE_BIG_ENDIAN)
    cpu.ctl_set_cpu_model(UC_CPU_M68K_M68000)
    cpu.mem_map(0, 0x50000)
    cpu.mem_write(0, code)
    cpu.mem_write(0x20000, struct.pack(">I", 0x21000))
    cpu.reg_write(UC_M68K_REG_A2, 0x20000)
    cpu.reg_write(UC_M68K_REG_A5, 0x30000)
    work_map = 0x30000 - 0x6626
    decoder = """
      import { getLevel, levelCount, getFinale } from './index.ts';
      for (const pack of ['original', 'bonus']) {
        for (let round = 1; round <= levelCount(pack); round++) {
          const { mapId, tiles } = getLevel(round, pack);
          console.log(JSON.stringify({ pack, round, mapId, tiles }));
        }
      }
      const { mapId, tiles } = getFinale();
      console.log(JSON.stringify({ pack: 'finale', round: 1, mapId, tiles }));
    """
    all_maps = {
        pack: read(source / filename)["BKMP"]
        for pack, filename in (("original", "Original Levels.rsrc"), ("bonus", "Bonus Levels.rsrc"),
                               ("finale", "BDX_Data.rsrc"))
    }
    result = subprocess.run(
        ["node", "--input-type=module", "-e", decoder],
        cwd=HERE, check=True, capture_output=True, text=True,
    )
    fingerprint = hashlib.sha256()
    counts = {"original": 0, "bonus": 0, "finale": 0}
    for line in result.stdout.splitlines():
        item = json.loads(line)
        raw = all_maps[item["pack"]][item["mapId"]][1]
        cpu.mem_write(0x21000, raw)
        cpu.mem_write(work_map, b"\x55" * 1400)
        cpu.emu_start(0x14E90, 0x14EEE, count=50000)
        grid = bytes(cpu.mem_read(work_map, 1400))
        cells = [struct.unpack_from(">h", grid, 2 * (35 * x + y))[0]
                 for y in range(30) for x in range(20)]
        if cells != item["tiles"]:
            raise ValueError(f"MapSetup mismatch in {item['pack']} round {item['round']}")
        fingerprint.update(struct.pack(">600h", *cells))
        counts[item["pack"]] += 1
    print(counts, "MapSetup SHA-256:", fingerprint.hexdigest())


if __name__ == "__main__":
    verify(Path(sys.argv[1]))
