"""Print reference layout hashes. Run with the directory containing DOS CDOGSSRC.ZIP's extracted MAP.C.
The generated host probe compiles the original geometry functions and substitutes the DOS Watcom rand.
"""
import hashlib
import pathlib
import subprocess
import sys
import tempfile

source = pathlib.Path(sys.argv[1], "MAP.C").read_text(encoding="latin-1")
program = """
#include <stdint.h>
#include <stdlib.h>
#include <stdio.h>
#define YES 1
#define NO 0
#define XMAX 64
#define YMAX 64
#define TILE_WIDTH 16
#define TILE_HEIGHT 12
static uint32_t state;
static int dos_rand(void) {state=1103515245u*state+12345u; return (state>>16)&32767;}
#define rand dos_rand
struct Mission { int mapWidth, mapHeight; };
struct {struct Mission *missionData;} gMission;
"""
program += source[source.index("#define MAP_FLOOR"):source.index("TTile gMap")]
program += source[source.index("static int accessCount"):source.index("static void AddItemToTile")]
program += source[source.index("void GuessCoords"):source.index("static int W(")]
program += source[source.index("void SetupPerimeter"):source.index("void SetupMap")]
program += """
int main(int argc, char **argv) {
  struct Mission m={atoi(argv[2]),atoi(argv[3])};
  int walls=atoi(argv[4]),len=atoi(argv[5]),rooms=atoi(argv[6]),squares=atoi(argv[7]);
  int width=m.mapWidth?m.mapWidth:64,height=m.mapHeight?m.mapHeight:64;
  gMission.missionData=&m; state=strtoul(argv[1],0,10);
  int x=(64-width)/2+rand()%(width-8), y=(64-height)/2+rand()%(height-8);
  SetupPerimeter(m.mapWidth,m.mapHeight);
  for(int i=0;i<1000 && squares>0;i++) if(BuildSquare()) squares--;
  for(int i=0;i<1000 && rooms>0;i++) if(BuildRoom()) rooms--;
  for(int i=0;i<1000 && walls>0;i++) if(BuildWall(len)) walls--;
  fwrite(internalMap, sizeof(internalMap),1,stdout);
  fprintf(stderr,"exit %d,%d..%d,%d; access %d; geometry seed %u\\n", x,y,x+9,y+9,accessCount,state);
}
"""
with tempfile.TemporaryDirectory() as tmp:
    c = pathlib.Path(tmp, "probe.c")
    c.write_text(program)
    exe = c.with_suffix("")
    subprocess.run(["cc", "-O0", str(c), "-o", str(exe)], check=True)
    for args in ([0, 48, 48, 20, 20, 10, 3], [10, 64, 64, 14, 22, 12, 6],
                 [981, 40, 32, 18, 16, 6, 2]):
        result = subprocess.run([str(exe), *map(str, args)], capture_output=True, check=True)
        print(*args, hashlib.sha256(result.stdout).hexdigest(), result.stderr.decode().strip())
