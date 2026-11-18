"""Compile the DOS map/object routines against recording sinks and print original BEM object placements.
Run python3 objects-probe.py /path/to/extracted/cdogssrc 0 (the zero-based mission).
No game source or graphics are embedded in the fixture.
"""
import pathlib
import subprocess
import sys
import tempfile

source = pathlib.Path(sys.argv[1])
def read(name):
    return (source / name).read_text(encoding="latin-1")

program = """
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
static uint32_t seed;
static int dosrand(void){seed=seed*1103515245u+12345u;return (seed>>16)&32767;}
#define rand dosrand
"""
# The DOS header declares ItemsCollide externally, but its definition in MAP.C is static.
program += read("MAP.C").replace("static int ItemsCollide", "int ItemsCollide")
program += '\n#include "bem.inc"\n'
mission = read("MISSION.C")
program += mission[mission.index("static TMapObject mapItems"):mission.index("static int exitPics")]
pics = read("PICS.C")
for start in ["const int cWallPics", "const int cFloorPics", "const int cRoomPics", "const TOffsetPic cGeneralPics"]:
    begin = pics.index(start)
    program += pics[begin:pics.index("};", begin)+2]+"\n"
program += """
struct MissionOptions gMission;
static void record(int x,int y,int sprite,int flags,char category){
  TTileItem *t=calloc(1,sizeof(TTileItem));x>>=8;y>>=8;MoveTileItem(t,x,y);
  printf("%c %d %d %d %d\\n",category,x,y,sprite,flags);
}
void AddObject(int x,int y,int w,int h,TOffsetPic *pic,int index,int flags){
  record(x,y,pic->picIndex,flags,'I');
}
void AddDestructibleObject(int x,int y,int w,int h,TOffsetPic *pic,TOffsetPic *wreck,int hp,int flags,int tileflags){
  record(x,y,pic->picIndex,tileflags,'P');
}
TWatch *AddWatch(int c,int a) {
  TWatch *w=calloc(1,sizeof(TWatch));w->conditions=calloc(c,sizeof(TCondition));w->actions=calloc(a,sizeof(TAction));return w;
}
TTrigger *AddTrigger(int x,int y,int a) {
  TTrigger *t=calloc(1,sizeof(TTrigger)); t->x=x;t->y=y;t->actions=calloc(a,sizeof(TAction));return t;
}
int main(int argc,char **argv){
  int mission=atoi(argv[1]);if(mission<0||mission>=9)return 1;
  struct Mission *m=&BEM_missions[mission];gMission.missionData=m;
  seed=10*mission;
  if(m->exitLeft<=0){rand();rand();}
  gMission.keyPics=keyStyles[m->keyStyle];gMission.doorPics=doorStyles[m->doorStyle];
  gMission.objectCount=m->itemCount;
  for(int i=0;i<m->itemCount;i++) gMission.mapObjects[i]=&mapItems[m->items[i]];
  for(int i=0;i<m->objectiveCount;i++){
    struct Objective *o=&gMission.objectives[i];struct MissionObjective *s=&m->objectives[i];
    o->count=s->count;o->required=s->required;
    o->pickupItem=pickupItems[s->index%PICKUPS_COUNT];o->blowupObject=&mapItems[s->index%ITEMS_COUNT];
  }
  SetupMap();
}
"""
with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp)
    # Normalize DOS filenames so GCC/clang can resolve includes on case-sensitive hosts.
    for h in [*source.glob("*.H"), source / "BEM.INC"]:
        (root / h.name.lower()).write_text(read(h.name))
    c = root / "probe.c"
    c.write_text(program)
    exe = root / "probe"
    subprocess.run(["cc","-std=c99","-Wno-unknown-pragmas","-Wno-incompatible-pointer-types-discards-qualifiers","-Wno-ignored-qualifiers","-O0",str(c),"-o",str(exe)],check=True)
    subprocess.run([str(exe),sys.argv[2]],check=True)
