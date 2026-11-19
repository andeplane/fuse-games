/* Oracle for the DOS AI decision, built with the unmodified v1.06 AI.C and
 * DEFS.C. See reference.md. No game executable or game data is required. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define max(a,b) ((a)>(b)?(a):(b))
#define min(a,b) ((a)<(b)?(a):(b))
static int calls, rolls[2];
static int oracle_rand(void) { return rolls[calls++ % 2]; }
#define rand oracle_rand
#include "ai.c"
#include "defs.c"

struct CharacterDescription characterDesc[CHARACTER_COUNT];
struct MissionOptions gMission;
struct GameOptions gOptions;
TActor *gPlayer1, *gPlayer2, *gPrisoner;
static TActor actor;
static int blocked, issued;
TActor *ActorList(void) { return &actor; }
void CommandActor(TActor *a, int cmd) { a->lastCmd=issued=cmd; }
int CheckWall(int x, int y, int w, int h) { return blocked; }
TTileItem *CheckTileItemCollision(TTileItem *i,int x,int y,int mask) { return NULL; }
TActor *AddActor(int character) { abort(); }
int MoveActor(TActor *a,int x,int y) { abort(); }
int IsHighAccess(int x,int y) { abort(); }
int HasHighAccess(void) { abort(); }

int main(void) {
  struct Mission mission = {0};
  TActor player = {0};
  gMission.missionData = &mission;
  gPlayer1=&player;
  player.x=64<<8; player.y=32<<8;
  gOptions.difficulty=DIFFICULTY_NORMAL;
  /* Each row: roll, extra roll, flags, facing, last input, delay, detour count,
   * obstacle, track, move, shoot, player firing, output gun lock. */
  int rows[][13] = {
    {10,0,FLAGS_VISIBLE,2,0,0,0,0,80,90,40,0,0},
    {65,0,FLAGS_VISIBLE,2,0,0,0,0,80,90,40,0,0},
    {85,5,FLAGS_VISIBLE,2,0,0,0,0,80,90,40,0,0},
    {99,0,0,2,0,0,0,0,80,90,40,0,0},
    {65,0,FLAGS_VISIBLE,4,CMD_LEFT,0,0,1,80,90,40,0,0},
    {80,0,FLAGS_VISIBLE|FLAGS_DETOURING,6,CMD_LEFT,0,2,1,0,90,0,0,0},
    {80,0,FLAGS_VISIBLE|FLAGS_DETOURING|FLAGS_TRYRIGHT,1,0,0,1,0,0,90,0,0,0},
    {10,0,FLAGS_VISIBLE|FLAGS_SNEAKY,6,0,3,0,0,0,0,0,1,0},
    {10,0,FLAGS_VISIBLE|FLAGS_RUNS_AWAY,0,0,0,0,0,80,90,0,0,0},
    {10,0,FLAGS_VISIBLE,6,CMD_DOWN|CMD_BUTTON1,3,0,0,80,90,40,0,0},
    {10,0,FLAGS_SLEEPING,2,0,0,0,0,80,90,40,0,30},
    {10,0,FLAGS_VISIBLE|FLAGS_FOLLOWER,2,0,0,0,0,80,90,0,0,0}
  };
  for (unsigned i=0; i<sizeof(rows)/sizeof(*rows); i++) {
    int *r=rows[i];
    memset(&actor,0,sizeof(actor));
    calls=0; rolls[0]=r[0]; rolls[1]=r[1]; blocked=r[7];
    actor.x=32<<8; actor.y=32<<8; actor.flags=r[2]; actor.direction=r[3];
    actor.lastCmd=r[4]; actor.delay=r[5]; actor.turns=r[6]; actor.gunLock=r[12];
    characterDesc[0].probabilityToTrack=r[8]; characterDesc[0].probabilityToMove=r[9];
    characterDesc[0].probabilityToShoot=r[10]; characterDesc[0].actionDelay=7;
    player.lastCmd=r[11]?CMD_BUTTON1:0;
    CommandBadGuys();
    printf("%d %d %d %d %d %d\n", issued,actor.direction,actor.delay,actor.turns,actor.gunLock,calls);
  }
  return 0;
}
