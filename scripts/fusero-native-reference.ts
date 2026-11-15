/** Regenerate the source-extracted differential oracle from the pinned checkout copies. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const source = process.argv[2];
if (!source)
  throw new Error(
    "usage: tsx scripts/fusero-native-reference.ts /path/to/pinned/openlierox",
  );
const read = (file: string) => readFileSync(join(source, file), "utf8");
function body(text: string, start: string): string {
  const at = text.indexOf(start);
  if (at < 0) throw new Error(`missing ${start}`);
  const open = text.indexOf("{", at);
  let depth = 1,
    end = open + 1;
  for (; depth && end < text.length; end++) {
    if (text[end] === "{") depth++;
    if (text[end] === "}") depth--;
  }
  return text.slice(at, end);
}
const physics = read("src/common/PhysicsLX56.cpp"),
  rope = read("src/client/CNinjaRope.cpp"),
  human = read("src/common/CWormHuman.cpp");
const collision = body(physics, "static bool moveAndCheckWormCollision(");
const ropePhysics = body(
  physics,
  "static void simulateNinjarope(float dt, CWorm* owner) {",
);
const ropeForce = body(rope, "CVec CNinjaRope::GetForce() const");
const attachment = body(rope, "void CNinjaRope::checkForWormAttachment()");
const ground = body(
  read("src/common/CWorm.cpp"),
  "bool CWorm::CheckOnGround()",
);
const nativeMotion = physics.slice(
  physics.indexOf(
    "\tif(!(bool)cClient->getGameLobby()[FT_GusanosWormPhysics]) {",
  ),
  physics.indexOf("\n\t// Gusanos worm physics"),
);
const aim = body(human, "\t{\n\t\tfloat aimMaxSpeed =");
const header = String.raw`/*
 * OpenLieroX native differential oracle — altered standalone test harness.
 * Source extracted from 0a20c6d0a10ed63b28a15f05c771913c294efbf6.
 * Code under LGPL, based on Jason Boettcher's work, enhanced by Dark Charlie
 * and Albert Zeyer. PhysicsLX56.cpp created 9/2/2008. Preserve COPYING.LIB.
 * The marked kernels below are verbatim upstream code. Dependencies are tiny
 * test adapters; production TypeScript is never used to produce this oracle.
 * Regenerate: tsx scripts/fusero-native-reference.ts /path/to/pinned/sources
 */
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <vector>
#include <array>
using std::fabs;
const float nativeDT=11*.001f;
#define SQR(v) ((v)*(v))
#define SIGN(v) ((v)>0?1:((v)<0?-1:0))
#define MAX(a,b) std::max((a),(b))
#define MIN(a,b) std::min((a),(b))
#define CLAMP(v,a,b) std::min((b),std::max((a),(v)))
#define CLAMP_DIRECT(v,a,b) clampDirect((v),(a),(b))
#define REDUCE_CONST(v,a) ((v)>0?(v)=std::max(0.0f,(v)-(a)):(v)=std::min(0.0f,(v)+(a)))
#define RESET_SMALL(v,a) if(fabs(v)<(a)) (v)=0
#define FMOD(v,n) ((v)=fmodf(fmodf((v),(n))+(n),(n)))
#define MOD(v,n) ((v)=(((v)%(n))+(n))%(n))
#define SpawnEntity(...)
#define StartSound(...)
#define for_each_iterator(T,n,e) for(auto n=(e).begin();n!=(e).end();++n)
template<class T> bool clampDirect(T& v,T a,T b){T old=v;v=CLAMP(v,a,b);return v!=old;}
template<class T> struct VectorD2 {
 T x,y; VectorD2(T x=0,T y=0):x(x),y(y){}
 template<class U> VectorD2(const VectorD2<U>&v):x(v.x),y(v.y){}
 T GetLength2()const{return x*x+y*y;}
 float GetLength()const{return sqrtf((float)x*x+(float)y*y);}
 VectorD2 Normalize()const{float n=GetLength();return {x/n,y/n};}
};
using CVec=VectorD2<float>;
CVec operator+(CVec a,CVec b){return {a.x+b.x,a.y+b.y};}
CVec operator-(CVec a,CVec b){return {a.x-b.x,a.y-b.y};}
CVec operator-(CVec a){return {-a.x,-a.y};}
CVec operator*(CVec a,float b){return {a.x*b,a.y*b};}
CVec& operator+=(CVec&a,CVec b){a=a+b;return a;}
CVec& operator*=(CVec&a,float b){a=a*b;return a;}
template<class T> struct Attr {
 T value{};const T&get()const{return value;}T&write(){return value;}
 operator const T&()const{return value;}Attr&operator=(T v){value=v;return *this;}
 Attr&operator+=(T v){value+=v;return *this;}
};
enum Feature { FT_InfiniteMap,FT_GusanosWormPhysics,FT_WormGroundSpeed,FT_WormAirSpeed,FT_WormMaxGroundMoveSpeed,FT_WormMaxAirMoveSpeed,FT_WormJumpForce,FT_RelativeAirJump,FT_RelativeAirJumpDelay,FT_JumpToAimDir,FT_WormAirFriction,FT_WormGravity,FT_WormFriction,FT_WormGroundFriction,FT_WormGroundStopSpeed,FT_RopeGravity,FT_RopeFallingGravity,FT_RopeMaxLength,FT_RopeRestLength,FT_RopeStrength,FT_RopeCanAttachWorm,FT_ForceLX56Aim,FT_FullAimAngle,COUNT };
struct Client{std::array<float,COUNT>lobby{};auto&getGameLobby(){return lobby;}int getServerVersion(){return 100;}} client,*cClient=&client;
int OLXRcVersion(int,int,int){return 0;}
float getNinjaropePrecision(){return 1;}
struct Options {float fAimMaxSpeed=232.996f,fAimAcceleration=1299.91f,fAimFriction=0;bool bAimLikeLX56=false;}options,*tLXOptions=&options;
struct Color{};struct Material{bool particle_pass=true,can_hook=true,destroyable=false;};
const int PX_EMPTY=1;
struct CMap {
 unsigned GetWidth(){return 640;}unsigned GetHeight(){return 480;}
 bool solid(int x,int y){return x<0||x>=640||y<0||y>=480||y>=300||y<=20||x>=500;}
 int GetPixelFlag(int x,int y,bool wrap=false){if(wrap){MOD(x,640);MOD(y,480);}return solid(x,y)?0:PX_EMPTY;}
 const Material&getMaterial(unsigned x,unsigned y){static Material air{},rock{false,true,false};return solid(x,y)?rock:air;}
 Color getColorAt(int,int){return {};}
} map;
struct CWorm;
struct CNinjaRope {
 CWorm* parent;Attr<CVec> p,v;bool released=false,shooting=false,attached=false;bool&HookAttached=attached;int player=-1;
 CNinjaRope(CWorm*p):parent(p){} CWorm*owner()const{return parent;}CNinjaRope&write(){return *this;}
 Attr<CVec>&pos(){return p;}const Attr<CVec>&pos()const{return p;}
 Attr<CVec>&velocity(){return v;}Attr<CVec>&hookPos(){return p;}Attr<CVec>&hookVelocity(){return v;}
 bool isReleased(){return released;}bool isAttached(){return attached;}bool isShooting(){return shooting;}
 bool isPlayerAttached(){return player>=0;}void setAttached(bool a){attached=a;}void setShooting(bool a){shooting=a;}
 void Attach(){shooting=false;attached=true;v=CVec();}
 void AttachToPlayer(CWorm*);void UnAttachPlayer(){v=CVec();shooting=false;attached=false;player=-1;}
 CWorm*getAttachedPlayer();CVec GetForce()const;void checkForWormAttachment();
};
using AbsTime=float;float clockTime=0;float GetPhysicsTime(){return clockTime;}
struct State{bool bMove=false,bJump=false;};
struct CWorm {
 int id=0,face=1,moveFace=1;Attr<CVec>vPos,vel;Attr<float>fAngle;float fAngleSpeed=0,lastAirJump=0;bool ground=false,alive=true;Attr<State>tState;CNinjaRope cNinjaRope{this};
 Attr<CVec>&pos(){return vPos;}const Attr<CVec>&pos()const{return vPos;}Attr<CVec>&velocity(){return vel;}
 CVec getPos(){return vPos.get();}float speedFactor(){return 1;}bool isOnGround(){return ground;}void setOnGround(bool b){ground=b;}
 int getMoveDirectionSide(){return moveFace;}void setLastAirJumpTime(float t){lastAirJump=t;}float getLastAirJumpTime(){return lastAirJump;}
 bool canAirJump(){return false;}CVec getFaceDirection(){float angle=(float)fAngle*((float)3.14159265358979323846/180);return {cosf(angle)*face,sinf(angle)};}
 CNinjaRope*getNinjaRope(){return &cNinjaRope;}bool CheckOnGround();bool getAlive(){return alive;}bool isVisible(CWorm*){return true;}int getID(){return id;}bool getLocal(){return true;}
};
struct Game {std::vector<std::shared_ptr<CWorm>>all;CMap*gameMap(){return &map;}auto&aliveWorms(){return all;}CWorm*wormById(int id,bool){for(auto&w:all)if(w->id==id)return w.get();return nullptr;}}game;
void CNinjaRope::AttachToPlayer(CWorm*w){Attach();player=w->id;}
CWorm*CNinjaRope::getAttachedPlayer(){return game.wormById(player,false);}
const int DIR_RIGHT=1;
void applyFriction(CVec&,float,float,float,float,float){}
#define PI 3.14159265358979323846
`;
const tail = String.raw`
void nativeAim(CWorm*m_worm,int bits){
 struct Key{bool down;bool isDown(){return down;}}cUp{bool(bits&4)},cDown{bool(bits&8)};
 bool tUp=false,tDown=false,mouseControl=false;float mouseSensity=0;int mouse_dy=0;
 struct DT{float seconds(){return nativeDT;}}dt;
 // BEGIN verbatim CWormHuman.cpp angle block
@AIM_BLOCK@
}
void nativeMovement(CWorm*worm){float dt=nativeDT;const State*ws=&worm->tState.get();
// BEGIN verbatim PhysicsLX56.cpp movement branch
@MOVE_BLOCK@
}
int main(){
 auto&a=client.lobby;a[FT_WormGroundSpeed]=8;a[FT_WormAirSpeed]=4;a[FT_WormMaxGroundMoveSpeed]=30;a[FT_WormMaxAirMoveSpeed]=30;a[FT_WormJumpForce]=-65;a[FT_WormGravity]=100;a[FT_WormGroundFriction]=.1f;a[FT_WormGroundStopSpeed]=5;a[FT_RopeGravity]=100;a[FT_RopeFallingGravity]=150;a[FT_RopeMaxLength]=300;a[FT_RopeRestLength]=27;a[FT_RopeStrength]=4.5f;a[FT_RopeCanAttachWorm]=1;
 auto w=std::make_shared<CWorm>();game.all.push_back(w);auto other=std::make_shared<CWorm>();other->id=1;other->vPos=CVec(250,150);game.all.push_back(other);
 int ground;std::cin>>w->vPos.write().x>>w->vPos.write().y>>w->vel.write().x>>w->vel.write().y>>w->fAngle.write()>>w->face>>w->moveFace>>ground;w->ground=ground;
 int bits,previous=0;
 while(std::cin>>bits){clockTime+=nativeDT;int pressed=bits&~previous;nativeAim(w.get(),bits);CVec ropeDir=w->getFaceDirection();
  if(!(bits&32768)){if((bits&1)&&!(bits&2)){w->moveFace=-1;if(!(bits&65536))w->face=-1;}if((bits&2)&&!(bits&1)){w->moveFace=1;if(!(bits&65536))w->face=1;}}
  if(pressed&16){w->cNinjaRope.released=false;w->cNinjaRope.shooting=false;w->cNinjaRope.attached=false;w->cNinjaRope.player=-1;}
  if(pressed&64){auto&r=w->cNinjaRope;r.released=true;r.shooting=true;r.attached=false;r.player=-1;r.p=w->getPos();r.v=ropeDir*250;}
  w->tState.write().bMove=(bits&3)&&!(bits&32768);w->tState.write().bJump=pressed&16;
  if(w->cNinjaRope.released){simulateNinjarope(nativeDT,w.get());w->vel+=w->cNinjaRope.GetForce()*nativeDT;}
  nativeMovement(w.get());
  auto&r=w->cNinjaRope;std::printf("[%.9g,%.9g,%.9g,%.9g,%.9g,%.9g,%d,%d,%d,%d,%.9g,%.9g,%.9g,%.9g,%d]\n",w->getPos().x,w->getPos().y,w->vel.get().x,w->vel.get().y,(float)w->fAngle,w->fAngleSpeed,w->ground,r.released,r.shooting,r.attached,r.p.get().x,r.p.get().y,r.v.get().x,r.v.get().y,r.player);
  previous=bits;
 }
}
`;
const out =
  header +
  "\n// BEGIN verbatim CheckOnGround\n" +
  ground +
  "\n// BEGIN verbatim moveAndCheckWormCollision\n" +
  collision +
  "\n// BEGIN verbatim CNinjaRope::GetForce\n" +
  ropeForce +
  "\n// BEGIN verbatim checkForWormAttachment\n" +
  attachment +
  "\n// BEGIN verbatim simulateNinjarope\n" +
  ropePhysics +
  tail.replace("@AIM_BLOCK@", aim).replace("@MOVE_BLOCK@", nativeMotion);
const target = "games/fusero/tests/fixtures/classic-native.cpp";
mkdirSync("games/fusero/tests/fixtures", { recursive: true });
writeFileSync(target, out);
console.log(target);
