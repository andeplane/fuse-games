/** Generate source-extracted native AI tactical decisions behind typed test capabilities. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
const root = process.argv[2];
if (!root)
  throw new Error(
    "usage: tsx scripts/fusero-ai-tactical-reference.ts /path/to/pinned/openlierox",
  );
const blobs: Readonly<Record<string, string>> = {
  "src/common/CWormBot.cpp": "48050363b6899dcf1532c796eb6c9e9b3f75b692",
  "include/MathLib.h": "105d70edfda62292d0cd38d47ce970c8586e5ce7",
  "src/common/MathLib.cpp": "bf934fd280c7bb95e86cb5a28437e5569ee707f1",
  "src/common/CProjectile.cpp": "307deab97c7bae85ca503637aab8bf5e40c24952",
  "include/olx-types.h": "0b69bf26249b2c86a92116f75e715d1f0466c516",
};
const read = (path: string): string => {
  const bytes = readFileSync(join(root, path));
  if (
    createHash("sha1")
      .update(`blob ${bytes.length}\0`)
      .update(bytes)
      .digest("hex") !== blobs[path]
  )
    throw new Error(`Pinned upstream blob mismatch: ${path}`);
  return bytes.toString("utf8");
};
function body(text: string, marker: string): string {
  const at = text.indexOf(marker);
  if (at < 0) throw new Error(`Missing ${marker}`);
  let depth = 1,
    end = text.indexOf("{", at) + 1;
  for (; depth && end < text.length; end++) {
    if (text[end] === "{") depth++;
    if (text[end] === "}") depth--;
  }
  return text.slice(at, end);
}
const ai = read("src/common/CWormBot.cpp"),
  types = read("include/olx-types.h"),
  mathHeader = read("include/MathLib.h"),
  math = read("src/common/MathLib.cpp");
const header = String.raw`/*
 * OpenLieroX Classic AI tactical oracle — source-extracted C++, LGPL.
 * Pinned 0a20c6d0a10ed63b28a15f05c771913c294efbf6.
 * Jason Boettcher, Dark Charlie, Albert Zeyer and contributors.
 * Geometry/vector kernels come from the independent native path oracle.
 * Tiny capabilities supply clock, terrain, weapon data, targets and seeded RNG;
 * the tactical methods below are upstream source, not translated TypeScript.
 * Canonical local/listen host, Classic DM, no full-angle aim, gravity factor1.
 * Regenerate: pnpm exec tsx scripts/fusero-ai-tactical-reference.ts /pinned/source
 */
#define main pathReferenceMain
#include "classic-ai-native.cpp"
#undef main
#include <cassert>
#include <cstdint>
#include <iomanip>
#include <cctype>
using Uint64=uint64_t;
#define PI 3.14159265358979323846
const float D2R(1.745329e-2f),R2D(5.729578e+1f);
#define DEG2RAD(a) ((a)*D2R)
#define RAD2DEG(a) ((a)*R2D)
#define CLAMP(v,a,b) std::min((b),std::max((a),(v)))
#define SIGN(v) ((v)>0?1:((v)<0?-1:0))
#define for_each_iterator(T,n,e) for(auto n=(e).begin();n!=(e).end();++n)
`;
const clocks =
  body(types, "struct TimeDiff {") +
  ";\n" +
  body(types, "struct AbsTime {") +
  ";\n";
const capabilities = String.raw`
template<class T> struct Attr {
 T value{}; const T&get()const{return value;}T&write(){return value;}
 operator const T&()const{return value;}Attr&operator=(T v){value=v;return *this;}
 Attr&operator+=(T v){value+=v;return *this;}Attr&operator-=(T v){value-=v;return *this;}
};
struct Position:CVec {using CVec::CVec;Position():CVec(){}Position(CVec v):CVec(v){}Position&operator=(CVec v){x=v.x;y=v.y;return *this;}CVec&get(){return *this;}const CVec&get()const{return *this;}};
enum {DIR_RIGHT=0,DIR_LEFT=1};using DIR_TYPE=int;
enum {AI_EASY=0,AI_MEDIUM=1,AI_HARD=2,AI_XTREME=3,GAM_RIFLES=0,GAM_100LT=1,GAM_MORTARS=2,GAM_OTHER=3};
enum {WPN_PROJECTILE=0,WPN_SPECIAL=1,WPN_BEAM=2,SPC_JETPACK=0,PRJ_PIXEL=0,PJ_BOUNCE=0,PJ_EXPLODE=1,PJ_DIRT=5,PJ_GREENDIRT=6,PX_WORM=8,PJC_TERRAIN=1,PJC_MAPBORDER=2};
using Proj_ActionType=int;
enum Feature {FT_FullAimAngle,FT_SelfInjure,FT_ProjGravityFactor,FT_GameMode};
enum {GM_DEATHMATCH=0,GM_RACE=1,GM_TEAMRACE=2,GMT_TEAMS=1};
struct CWorm;struct Mode{bool Shoot(CWorm*){return true;}};
struct GameModeInfo {Mode*mode=nullptr;int generalGameType=0;int actualIndex(){return GM_DEATHMATCH;}GameModeInfo*operator->(){return this;}};
struct Value {float number=0;operator float()const{return number;}template<class T>T as()const{return T{};}};
struct Client {std::array<Value,4>lobby;auto&getGameLobby(){return lobby;}bool isTeamGame(){return false;}bool isTagGame(){return false;}} client,*cClient=&client;
struct LX {AbsTime currentTime;TimeDiff fDeltaTime;float debug_float=0;} lx,*tLX=&lx;
uint32_t randomState=1;
float GetRandomPosNum(){randomState=randomState*1664525u+1013904223u;return (float)((double)randomState/4294967296.0);}
float GetRandomNum(){return GetRandomPosNum()*2.0f-1.0f;}
int GetRandomInt(int maximum){float v=GetRandomPosNum()*(float(maximum)+1);return CLAMP((int)v,0,maximum);}
auto&notes=std::cerr;
void stringlwr(std::string& s){for(auto&c:s)c=(char)std::tolower((unsigned char)c);}
bool strincludes(const std::string&s,const std::string&n){return s.find(n)!=std::string::npos;}
struct AiMaterial {bool particle_pass;};
struct TacticalMap:CMap {
 using CMap::CMap;
 AiMaterial materialForIndex(uchar i){return {i==PX_EMPTY};}
 bool IsEmptyForWorm(CVec p){int x=(int)p.x,y=(int)p.y;for(int yy=y-3;yy<y+3;yy++)for(int xx=x-3;xx<x+3;xx++)if(GetPixelFlag(xx,yy)&(PX_ROCK|PX_DIRT))return false;return true;}
};
struct Script {bool gusEngineUsed(){return false;}} script;
struct WormRef {CWorm*pointer;CWorm*get(){return pointer;}};
struct TacticalGame {TacticalMap*map;TacticalMap*gameMap(){return map;}Script*gameScript(){return &script;}CWorm*wormById(int,bool);bool isClient(){return false;}std::vector<WormRef>alive;auto&aliveWorms(){return alive;}} tacticalGame;
#define game tacticalGame
#define CMap TacticalMap
struct proj_t {
 int Type=0;bool UseCustomGravity=false;float Gravity=0,Dampening=1;
 struct Action{int Type=8;float Damage=0;bool Projectiles=false;float Time=0;}Hit,PlyHit,Timer,Tch;
 struct Spawn{proj_t*Proj=nullptr;}GeneralSpawnInfo;
};
struct weapon_t {
 std::string Name;int Type=0,Special=0;float Recoil=0;
 struct Projectile{float Speed=0,SpeedVar=0;proj_t*Proj=nullptr;}Proj;
 struct Beam{float Length=0;}Bm;
};
std::vector<weapon_t>weapons;
std::vector<proj_t>projectiles;
struct wpnslot_t {int WeaponId=0;bool Reloading=false;float LastFire=0;const weapon_t*weapon()const{return WeaponId>=0&&WeaponId<(int)weapons.size()?&weapons[WeaponId]:nullptr;}};
struct State{bool bMove=false,bJump=false,bShoot=false,bCarve=false;};
struct Rope {bool released=false,attached=false;Rope&get(){return *this;}bool isReleased(){return released;}bool isAttached(){return attached;}};
struct CWorm {
 Position vPos,vVelocity;Attr<float>fAngle;int iFaceDirectionSide=DIR_RIGHT,iCurrentWeapon=0,iID=0,iTeam=0;float health=100;bool ground=false;
 std::vector<wpnslot_t>tWeapons=std::vector<wpnslot_t>(5);Attr<State>tState;Rope cNinjaRope;
 const wpnslot_t*getCurWeapon(){return getWeapon(iCurrentWeapon);}const wpnslot_t*getWeapon(int i){return i>=0&&i<(int)tWeapons.size()?&tWeapons[i]:nullptr;}
 int getCurrentWeapon(){return iCurrentWeapon;}CVec getPos(){return vPos;}CVec pos(){return vPos;}const CVec&getVelocity(){return vVelocity;}
 bool CheckOnGround(){return ground;}int getTeam(){return iTeam;}int getID(){return iID;}
};
CWorm*targetWorm=nullptr;
CWorm*TacticalGame::wormById(int id,bool){return targetWorm&&id==targetWorm->iID?targetWorm:nullptr;}
struct CProjectile{static int CheckCollision(proj_t*,float,CVec,CVec);};
class CWormBotInputHandler {
public:
 CWorm*m_worm;int iAiDiffLevel=1,iAiGameType=1,nAITargetWormId=1,iRandomSpread=0;
 AbsTime fLastFace,fLastWeaponChange,fLastRandomChange,fLastShoot;TimeDiff fBadAimTime;float fCanShootTime=0;CVec vLastShootTargetPos,target;
 explicit CWormBotInputHandler(CWorm*w):m_worm(w){}
 CVec AI_GetTargetPos(){return target;}CWorm*findTarget(){return targetWorm;}bool AI_CheckFreeCells(int){return true;}
 bool AI_SetAim(CVec);int AI_GetBestWeapon(int,float,bool,float);int AI_FindClearingWeapon();int traceWeaponLine(CVec,float*,int*);bool weaponCanHit(float,float,CVec);bool AI_Shoot();int AI_GetRockBetween(CVec,CVec);
};
static const float BotAngleSpeed=100;
`;
const parabola =
  body(mathHeader, "class Parabola  {") +
  ";\n" +
  body(math, "Parabola::Parabola(CVec p1, float angleP1, CVec p2)");
const methods = [
  body(
    read("src/common/CProjectile.cpp"),
    "int CProjectile::CheckCollision(proj_t*",
  ),
  body(ai, "bool CWormBotInputHandler::AI_SetAim("),
  body(ai, "int CWormBotInputHandler::AI_FindClearingWeapon("),
  body(ai, "bool CWormBotInputHandler::weaponCanHit("),
  body(ai, "bool AI_GetAimingAngle("),
  body(ai, "static bool canShootRightNowWithCurWeapon("),
  body(ai, "int CWormBotInputHandler::AI_GetBestWeapon("),
  body(ai, "int CWormBotInputHandler::traceWeaponLine("),
  body(ai, "int CWormBotInputHandler::AI_GetRockBetween("),
  body(ai, "bool CWormBotInputHandler::AI_Shoot()"),
];
const runner = String.raw`
#undef game
#undef CMap
int main(){
 std::cout.precision(17);int width,height;std::cin>>width>>height>>randomState;TacticalMap map(width,height);game.map=&map;tacticalGame.map=&map;
 for(int y=0;y<height;y++){std::string row;std::cin>>row;for(int x=0;x<width;x++)map.pixels[y][x]=row[x]=='#'?PX_ROCK:row[x]=='d'?PX_DIRT:PX_EMPTY;}
 int count;std::cin>>count;projectiles.resize(count);std::vector<int>children(count);
 for(int i=0;i<count;i++){auto&p=projectiles[i];std::cin>>p.Type>>p.UseCustomGravity>>p.Gravity>>p.Dampening>>p.Hit.Type>>p.Hit.Damage>>p.Hit.Projectiles>>p.PlyHit.Type>>p.PlyHit.Damage>>p.PlyHit.Projectiles>>p.Timer.Projectiles>>p.Timer.Time>>p.Tch.Projectiles>>children[i];}
 for(int i=0;i<count;i++)if(children[i]>=0)projectiles[i].GeneralSpawnInfo.Proj=&projectiles[children[i]];
 std::cin>>count;weapons.resize(count);for(auto&w:weapons){int p;std::cin>>std::quoted(w.Name)>>w.Type>>w.Recoil>>w.Proj.Speed>>w.Proj.SpeedVar>>p>>w.Bm.Length;if(p>=0)w.Proj.Proj=&projectiles[p];}
 cClient->lobby[FT_SelfInjure].number=1;cClient->lobby[FT_ProjGravityFactor].number=1;
 std::string operation;
 while(std::cin>>operation){
  CWorm worm,enemy;enemy.iID=1;targetWorm=&enemy;CWormBotInputHandler bot(&worm);Uint64 now,lastFace,lastWeapon,lastRandom,lastShoot;int delta,difficulty,gameType,side,rope;
  Uint64 badAim;
  std::cin>>now>>delta>>difficulty>>gameType>>worm.health>>cClient->lobby[FT_SelfInjure].number>>worm.vPos.x>>worm.vPos.y>>worm.vVelocity.x>>worm.vVelocity.y>>worm.fAngle.value>>side>>enemy.vPos.x>>enemy.vPos.y>>enemy.vVelocity.x>>enemy.vVelocity.y>>enemy.ground>>rope>>worm.iCurrentWeapon>>lastFace>>lastWeapon>>lastRandom>>lastShoot>>badAim;
  worm.iFaceDirectionSide=side<0?DIR_LEFT:DIR_RIGHT;worm.cNinjaRope.released=rope>0;worm.cNinjaRope.attached=rope>=3;
  lx.currentTime=AbsTime(now);lx.fDeltaTime=TimeDiff(delta);bot.iAiDiffLevel=difficulty;bot.iAiGameType=gameType;bot.target=enemy.vPos;
  bot.fLastFace=AbsTime(lastFace);bot.fLastWeaponChange=AbsTime(lastWeapon);bot.fLastRandomChange=AbsTime(lastRandom);bot.fLastShoot=AbsTime(lastShoot);
  bot.fBadAimTime=TimeDiff(badAim);
  for(auto&s:worm.tWeapons)std::cin>>s.WeaponId>>s.Reloading>>s.LastFire;
  int result=0;float fraction=0;int type=0;
  if(operation=="aim")result=bot.AI_SetAim(enemy.vPos);
  if(operation=="choose"){float distance,trace;bool direct;std::cin>>distance>>direct>>trace;result=bot.AI_GetBestWeapon(gameType,distance,direct,trace);}
  if(operation=="clear")result=bot.AI_FindClearingWeapon();
  if(operation=="trace")result=bot.traceWeaponLine(enemy.vPos,&fraction,&type);
  if(operation=="shoot")result=bot.AI_Shoot();
  std::cout<<result<<" "<<worm.fAngle.get()<<" "<<(worm.iFaceDirectionSide==DIR_LEFT?-1:1)<<" "<<worm.iCurrentWeapon<<" "<<worm.tState.get().bMove<<" "<<worm.tState.get().bJump<<" "<<worm.tState.get().bShoot<<" "<<bot.fLastFace.milliseconds()<<" "<<bot.fLastWeaponChange.milliseconds()<<" "<<bot.fLastRandomChange.milliseconds()<<" "<<bot.iRandomSpread<<" "<<bot.fBadAimTime.milliseconds()<<" "<<bot.fLastShoot.milliseconds()<<" "<<bot.vLastShootTargetPos.x<<" "<<bot.vLastShootTargetPos.y<<" "<<fraction<<" "<<type<<" "<<randomState<<"\n";
 }
}
`;
writeFileSync(
  "games/fusero/tests/fixtures/classic-ai-tactical-native.cpp",
  [header, clocks, capabilities, parabola, ...methods, runner]
    .join("\n")
    .replace(/^[ \t]+/gm, (indent) => indent.replace(/\t/g, "    "))
    .replace(/[ \t]+$/gm, "")
    .trimEnd() + "\n",
);
