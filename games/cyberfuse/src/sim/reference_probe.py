"""Compile a compact reference scenario from an external, unmodified DOS source tree.
Usage: python3 reference_probe.py /path/to/unpacked/cdogssrc [--trace]
Only generated files inside a temporary directory are written.
"""
import hashlib
import re
import subprocess
import sys
import tempfile
from pathlib import Path

source = Path(sys.argv[1])
def original(file, name):
    code = (source / file).read_text(encoding="cp437")
    return re.search(r"^(?:int|void) " + name + r"\([^;\n]+\)\s*\n\{.*?^\}", code, re.M | re.S)[0]

# The runner supplies only external services and the synthetic mission geometry.
# Movement and slide logic, footprint tests and completion predicates come from the reference.
setup = r"""
#include <stdio.h>
#include <stdlib.h>
#include "DEFS.H"
typedef struct Tile {int x,y,w,h,flags,kind;void* data;} TTileItem;
typedef struct {int flags;} TObject;
typedef struct {int x,y,dx,dy,health,lastCmd,confused,petrified,state,character,direction,flags,gun; TTileItem tileItem;} TActor;
struct PlayerData {int weaponCount,weapons[3];} kit={3,{1,4,5}};
struct {int speed;} characterDesc[]={{256}};
enum {FLAGS_PLAYERS=3,FLAGS_SPECIAL_USED=16,FLAGS_PRISONER=262144,KIND_CHARACTER=1,KIND_OBJECT=2,OBJFLAG_DANGEROUS=31,GUN_KNIFE=0,TILEITEM_IMPASSABLE=1,TILEITEM_CAN_BE_TAKEN=2,SND_SWITCH=0};
struct {int dogFight;} gCampaign={0};
struct mission {int objectiveCount;} scenario={1};
struct {struct mission *missionData;struct {int done,required;} objectives[1];int exitLeft,exitRight,exitTop,exitBottom;} gMission={&scenario,{{0,1}},176,191,96,143};
TActor player={.x=120*256,.y=120*256,.health=200,.flags=1,.direction=4,.gun=1,.tileItem={120,120,7,5}};
TActor *gPlayer1=&player,*gPlayer2=NULL,*gPrisoner=NULL;
int HitWall(int x,int y){return x<16 || x>=192 || y<12 || y>=180;}
TObject jewel={0}; TTileItem item={136,120,5,4,0,KIND_OBJECT,&jewel};
TTileItem* CheckTileItemCollision(TTileItem* current,int x,int y,int mask){
  return mask==TILEITEM_CAN_BE_TAKEN && gMission.objectives[0].done==0 && abs(x-item.x)<12 && abs(y-item.y)<9?&item:NULL;
}
void CheckTrigger(TActor*a,int x,int y){}
void CheckMissionObjective(int flags){}
void DamageSomething(int x,int y,int p,int f,TTileItem*t,int s){}
void PickupObject(TActor*a,TObject*o){gMission.objectives[0].done++;}
void MoveTileItem(TTileItem*t,int x,int y){t->x=x;t->y=y;}
void PlaySoundAt(int x,int y,int s){}
void Shoot(TActor*a){}
void SetStateForActor(TActor*a,int s){a->state=s;}
"""
loop = r"""
int main(void){
 int extraction=0;
 for(int t=1;t<=600;t++){
   if(MissionCompleted())extraction++; else extraction=0;
   int cmd=t<=4?2:t==5?18:t==6?34:t==7?2:t==8?20:t>=55&&t<62?6:t==62?32:t>=90&&t<96?2:0;
   if(extraction<350 && !PlayerSpecialCommands(&player,cmd,&kit))CommandActor(&player,cmd);
   printf("%d,%d,%d,%d,%d,%d,%d,%d,%d\n",t,player.x,player.y,player.dx,player.dy,player.direction,player.gun,gMission.objectives[0].done,extraction);
   if(extraction>=350)return 0;
 }
 return 2;
}
"""
directions = re.search(r"int cmd2dir\[ 16\] =.*?};", (source/"DEFS.C").read_text(), re.S)[0]
parts=[setup,directions]
for f,n in [("MAP.C","CheckWall"),("ACTORS.C","MoveActor"),("ACTORS.C","SlideActor"),("ACTORS.C","CommandActor"),("GAME.C","PlayerSpecialCommands"),("MISSION.C","MissionCompleted")]:
    parts.append(original(f,n))
with tempfile.TemporaryDirectory() as tmp:
    path=Path(tmp)
    (path/"probe.c").write_text("\n".join([*parts,loop]))
    subprocess.run(["cc","-std=c99","-I",str(source.resolve()),str(path/"probe.c"),"-o",str(path/"probe")],check=True)
    trace=subprocess.check_output([str(path/"probe")])
if "--trace" in sys.argv:
    sys.stdout.buffer.write(trace)
else:
    print(f"{len(trace.splitlines())} ticks; sha256={hashlib.sha256(trace).hexdigest()}")
