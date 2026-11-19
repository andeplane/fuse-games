"""Compile the unmodified v1.06 weapon routines and emit JSON trace digests.

Usage: python3 probe.py /path/to/unpacked/cdogssrc
The C harness replaces the map/actor/sound/graphics boundaries and fixes rand()
at 4. No source archive or executable is distributed with Cyberfuse.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
import hashlib
import json
import os
import shutil
import subprocess
import sys

SOURCE = Path(sys.argv[1])
EXPECTED = {
    "ACTORS.C": "1f392527ea15958ab4b7abf9c47191d4a5a06367da9ec2fe95b0e278f113ad4f",
    "OBJS.C": "1db68d8af31b560a2e1b3eb0ed00a29252edb2802478afd3770bffac8e4c4eb7",
    "DEFS.C": "20a69ccbc7d80662fdf41cd6179e98bb84041b4d1da2db460efdda3402d151c1",
    "PICS.C": "81ef362d97a2b7ce694262afe3a53fe58c79cef2bcd0a48348f5273496022fcc",
}
for name, digest in EXPECTED.items():
    if hashlib.sha256((SOURCE / name).read_bytes()).hexdigest() != digest:
        raise ValueError(f"Unexpected source version for {name}")


def section(name, first, last):
    source = (SOURCE / name).read_text(encoding="latin1")
    return source[source.index(first):source.index(last, source.index(first) + len(first))]


includes = """
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include "actors.h"
#include "objs.h"
#include "sounds.h"
#define rand() 4
#define DrawTPic(a,b,c,d) ((void)0)
TTile gMap[YMAX][XMAX];
struct CharacterDescription characterDesc[CHARACTER_COUNT];
static TMobileObject *mobObjList;
TMobileObject *AddMobileObject(void);
TMobileObject *AddFireBall(int flags);
int HitItem(TMobileObject *obj,int x,int y,int special);
static int cost, obstacle;
void Score(int flags,int points) { cost-=points; }
void PlaySoundAt(int x,int y,int sound) {}
void MoveTileItem(TTileItem *tile,int x,int y) {tile->x=x;tile->y=y;}
void RemoveTileItem(TTileItem *tile) {}
int HitItem(TMobileObject *obj,int x,int y,int special) {
    return obstacle && x>>8==537 && (y>>8)>=374 && (y>>8)<=397;
}
"""
# Rendering function identities have no bearing on the simulated particle state.
draw = ["BogusDraw", "DrawBullet", "DrawFlame", "DrawGrenade", "DrawMolotov",
        "DrawGasCloud", "DrawBrownBullet", "DrawPetrifierBullet", "DrawSeeker",
        "DrawLaserBolt", "DrawBrightBolt", "DrawMine", "DrawDynamite", "DrawFireball", "DrawSpark"]
source = includes + "".join("#define " + name + " NULL\n" for name in draw)
source += (SOURCE / "DEFS.C").read_text(encoding="latin1")
source += section("ACTORS.C", "struct GunDescription gunDesc[]", "static TActor *actorList")
source += section("PICS.C", "const TOffsetPic cGunPics", "const OffsetTable cBodyOffset")
source += section("PICS.C", "const OffsetTable cGunHandOffset", "const OffsetTable cHeadOffset")
source += section("OBJS.C", "int UpdateMobileObject(", "int HitItem( TMobileObject *obj, int x, int y, int special )\n{")
source += section("OBJS.C", "int InternalUpdateBullet(", "void KillAllMobileObjects(")
source += section("ACTORS.C", "void LaunchGrenade(", "void CommandActor(")

source += """
static uint32_t h;
static void mix(int value) {h=(h^(uint32_t)value)*16777619u;}
static void sample(void) {
    int count=0;
    for(TMobileObject *p=mobObjList;p;p=p->next){
        mix(p->x);mix(p->y);mix(p->dx);mix(p->dy);mix(p->z);mix(p->dz);
        mix(p->count);mix(p->range);mix(p->power);mix(p->tileItem.w);mix(p->tileItem.h);
        count++;
    }
    mix(count);
}
int main(void) {
    TTileItem actorTile={0};actorTile.kind=KIND_CHARACTER;
    gMap[32][32].things=&actorTile;
    for(int weapon=0;weapon<16;weapon++) {
        h=2166136261u;
        for(obstacle=0;obstacle<=1;obstacle++) {
            for(int y=0;y<64;y++)for(int x=0;x<64;x++)
                gMap[y][x].flags=obstacle&&(x<28||x>35||y<28||y>35)?NO_WALK:0;
            for(int d=0;d<8;d++) {
                TActor actor={0};
                actor.flags=FLAGS_PLAYER1; actor.gun=weapon; actor.direction=d;
                actor.x=512<<8;actor.y=384<<8;cost=0;
                Shoot(&actor);mix(actor.gunLock);mix(cost);sample();
                for(int tick=1;tick<=285;tick++){UpdateMobileObjects();sample();}
                while(mobObjList){TMobileObject *p=mobObjList;mobObjList=p->next;free(p);}
            }
        }
        printf("%08x\\n",h);
    }
    return 0;
}
"""
with TemporaryDirectory() as tmp:
    root = Path(tmp)
    for header in SOURCE.glob("*.H"):
        shutil.copyfile(header, root / header.name.lower())
    (root / "probe.c").write_text(source)
    subprocess.run([os.environ.get("CC", "cc"), "-std=gnu99", "-Wno-int-conversion",
                    "-Wno-incompatible-pointer-types", "probe.c", "-o", "probe"], cwd=root, check=True)
    run = subprocess.check_output([str(root / "probe")], text=True)
    print(json.dumps(run.splitlines(), indent=2))
