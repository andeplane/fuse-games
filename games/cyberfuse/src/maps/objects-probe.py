"""Compile the DOS map/object routines against recording sinks.
Print one BEM mission with: python3 objects-probe.py /path/to/extracted/cdogssrc 0
Hash all shipped missions with: python3 objects-probe.py /path/to/extracted/cdogssrc /path/to/dos106
The latter reads each 1324-byte mission record directly from the original CDOGS.EXE or CPN file.
"""
import hashlib
import pathlib
import struct
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
  int mission=atoi(argv[1]);struct Mission fromDisk,*m=NULL;
  if(argc>2){
    if(sizeof(fromDisk)!=1324||fread(&fromDisk,sizeof(fromDisk),1,stdin)!=1)return 2;
    m=&fromDisk;
  }else{
    if(mission<0||mission>=9)return 1;
    m=&BEM_missions[mission];
  }
  gMission.missionData=m;
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
    origin = pathlib.Path(sys.argv[2])
    if not origin.is_dir():
        subprocess.run([str(exe),sys.argv[2]],check=True)
        sys.exit(0)
    shipped = (origin / "CDOGS.EXE").read_bytes()
    groups = []
    def builtin(title):
        start = shipped.index(title.encode("ascii")+b"\0")
        count, pointer = struct.unpack_from("<ii", shipped, start+280)
        groups.append((title, shipped, count, 238080+pointer))
    builtin("Bug-Eyed Monsters")
    builtin("Ogre Rampage")
    for campaign in ["DISTRESS", "TERROR", "ZOMBIE"]:
        data = (origin / (campaign+".CPN")).read_bytes()
        count, = struct.unpack_from("<i",data,288)
        groups.append((campaign,data,count,292))
    builtin("Dogfight in the dungeon")
    builtin("Cubicle wars")
    for name,data,count,offset in groups:
        digest = hashlib.sha256()
        for i in range(count):
            start=offset+1324*i
            trace=subprocess.run([str(exe),str(i),"stdin"],input=data[start:start+1324],capture_output=True,timeout=4,check=True).stdout
            digest.update(trace+b"\0")
        print(name,count,digest.hexdigest())
