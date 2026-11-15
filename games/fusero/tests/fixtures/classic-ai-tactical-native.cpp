/*
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

struct TimeDiff {
    Uint64 timeDiff;
    // Explicit constructors needed 'cause TimeDiff(float) != TimeDiff(int), and we will have hard-to-find errors in expressions
    explicit TimeDiff(Uint64 td = 0) : timeDiff(td) {}
    explicit TimeDiff(float seconds) : timeDiff((Uint64)(seconds * 1000.0f)) { assert(seconds >= 0.0f); }
    explicit TimeDiff(int td) : timeDiff(td) { assert(td >= 0); }
    explicit TimeDiff(Uint64 start, Uint64 end) : timeDiff(end - start) { assert(end >= start); }

    const TimeDiff & operator=(float seconds) { *this = TimeDiff(seconds); return *this; };
    // No operator=(int) here, 'cause it will be in milliseconds - inconsistent, and hard-to-find errors occur

    float seconds() const { return timeDiff * 0.001f; }
    Uint64 milliseconds() const { return timeDiff; }

    TimeDiff operator+(const TimeDiff& td) const { return TimeDiff(timeDiff + td.timeDiff); }
    TimeDiff operator-(const TimeDiff& td) const { assert(timeDiff >= td.timeDiff); return TimeDiff(timeDiff - td.timeDiff); }
    float operator/(const TimeDiff& td) const { return (float)timeDiff / (float)td.timeDiff; }
    TimeDiff operator*(float f) const { return TimeDiff((Uint64)(timeDiff * f)); }

    TimeDiff& operator+=(const TimeDiff& td) { timeDiff += td.timeDiff; return *this; }
    TimeDiff& operator-=(const TimeDiff& td) { assert(timeDiff >= td.timeDiff); timeDiff -= td.timeDiff; return *this; }
    TimeDiff& operator*=(float f) { *this = (*this) * f; return *this; }

    bool operator<(const TimeDiff& td) const { return timeDiff < td.timeDiff; }
    bool operator>(const TimeDiff& td) const { return timeDiff > td.timeDiff; }
    bool operator<=(const TimeDiff& td) const { return timeDiff <= td.timeDiff; }
    bool operator>=(const TimeDiff& td) const { return timeDiff >= td.timeDiff; }
    bool operator==(const TimeDiff& td) const { return timeDiff == td.timeDiff; }
    bool operator!=(const TimeDiff& td) const { return timeDiff != td.timeDiff; }

    bool operator<(float td) const { return *this < TimeDiff(td); }
    bool operator>(float td) const { return *this > TimeDiff(td); }
    bool operator<=(float td) const { return *this <= TimeDiff(td); }
    bool operator>=(float td) const { return *this >= TimeDiff(td); }

};
struct AbsTime {
    Uint64 time;
    explicit AbsTime(Uint64 t = 0) : time(t) {}
    explicit AbsTime(int t) : time(t) {}
    explicit AbsTime(float seconds) : time( (Uint64)(seconds * 1000.0f) ) {}
    static AbsTime Max() { return AbsTime((Uint64)-1); }

    const AbsTime & operator=(float seconds) { *this = AbsTime(seconds); return *this; };
    // No operator=(int) here, 'cause it will be in milliseconds - inconsistent, and hard-to-find errors occur

    float seconds() const { return time * 0.001f; }
    Uint64 milliseconds() const { return time; }

    TimeDiff operator-(const AbsTime& t) const { return TimeDiff(t.time, time); }
    AbsTime operator+(const TimeDiff& td) const { return AbsTime(time + td.timeDiff); }
    AbsTime operator-(const TimeDiff& td) const { return AbsTime(time - td.timeDiff); }
    AbsTime operator+(float td) const { return AbsTime(time + (Uint64)(td * 1000.0f)); }
    // Remake all your expressions so they will not include AbsTime minus something - it wraps around easily
    //AbsTime operator-(float td) const { return AbsTime(time - (Uint64)(td * 1000.0f)); }

    AbsTime& operator+=(const TimeDiff& td) { time += td.timeDiff; return *this; }

    bool operator<(const AbsTime& t) const { return time < t.time; }
    bool operator>(const AbsTime& t) const { return time > t.time; }
    bool operator<=(const AbsTime& t) const { return time <= t.time; }
    bool operator>=(const AbsTime& t) const { return time >= t.time; }
    bool operator==(const AbsTime& t) const { return time == t.time; }
    bool operator!=(const AbsTime& t) const { return time != t.time; }
};


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

class Parabola  {
public:
    float a, b, c; // a*x^2 + b*x + c
public:
    Parabola() : a(0), b(0), c(0) {}
    Parabola(float pa, float pb, float pc) : a(pa), b(pb), c(pc) {}
    Parabola(const Parabola& p) { a = p.a; b = p.b; c = p.c; }
    Parabola(CVec p1, CVec p2, CVec p3);
    Parabola(CVec p1, float angleP1, CVec p2);

    INLINE bool operator==(const Parabola& p) const {
        return (a == p.a && b == p.b && c == p.c);
    }

    float getLength(CVec p1, CVec p2);
    float getLength(float pa, float pb);
    bool isPointAtParabola(CVec p1)  {
        return (p1.y == (a * p1.x * p1.x ) + (b * p1.x) + c);
    }
};
Parabola::Parabola(CVec p1, float angleP1, CVec p2)
{
    const float p = p1.x;
    const float r = p1.y;
    const float s = p2.x;
    const float t = p2.y;
    const float cos_f = cosf(angleP1);
    const float sin_f = sinf(angleP1);

    const float denom = (p-s) * (p-s) * cos_f;
    if (denom == 0)  {
        a = b = c = 0;
        return;
    }

    a = -((r-t)*cos_f+(s-p)*sin_f)/denom;
    b = (2*p*(r-t)*cos_f+(p+s)*(s-p)*sin_f)/denom;
    c = ((p*p*t-2*p*r*s+r*s*s)*cos_f+p*s*(p-s)*sin_f)/denom;
}
int CProjectile::CheckCollision(proj_t* tProjInfo, float dt, CVec pos, CVec vel)
{
    // Check if it hit the terrain
    CMap* map = game.gameMap();
    int mw = map->GetWidth();
    int mh = map->GetHeight();
    int w,h;

    if(tProjInfo->Type == PRJ_PIXEL)
        w=h=1;
    else
        w=h=2;

    float maxspeed2 = (float)(4*w*w+4*w+1); // (2w+1)^2
    if( (vel*dt).GetLength2() > maxspeed2) {
        dt *= 0.5f;

        int col = CheckCollision(tProjInfo,dt,pos,vel);
        if(col) return col;

        pos += vel*dt;

        return CheckCollision(tProjInfo,dt,pos,vel);
    }

    pos += vel*dt;

    int px = (int)pos.x;
    int py = (int)pos.y;

    // Hit edges
    if(px-w<0 || py-h<0 || px+w>=mw || py+h>=mh)
        return PJC_TERRAIN|PJC_MAPBORDER;

    for(int y=py-h;y<=py+h;y++) {

        uchar *pf = &map->material->line[y][px-w];

        for(int x=px-w;x<=px+w;x++) {

            if(!map->materialForIndex(*pf).particle_pass)
                return PJC_TERRAIN;

            pf++;
        }
    }


    // No collision
    return 0;
}
bool CWormBotInputHandler::AI_SetAim(CVec cPos)
{
    TimeDiff   dt = tLX->fDeltaTime;
    CVec	tgPos = cPos;
    CVec	tgDir = tgPos - m_worm->vPos;
    bool    goodAim = false;

    float angleSpeed = BotAngleSpeed * dt.seconds();

    NormalizeVector(&tgDir);

    DIR_TYPE wantedDir = (tgDir.x < 0) ? DIR_LEFT : DIR_RIGHT;
    if (tLX->currentTime - fLastFace > 0.3f)  {  // prevent turning
        // Make me face the target
        m_worm->iFaceDirectionSide = wantedDir;

        fLastFace = tLX->currentTime;
    }

    // Aim at the target
    float ang = (float)atan2(tgDir.x, tgDir.y);
    ang = RAD2DEG(ang);

    if(wantedDir == DIR_LEFT)
        ang+=90;
    else
        ang = -ang + 90;

    // Clamp the angle
    ang = MAX((float)-90, ang);

    if(iAiDiffLevel < AI_XTREME) {
        static float angleDiff[AI_HARD + 1] = {0,0,0};
        static AbsTime lastAngleDiffUpdateTime;
        if(tLX->currentTime - lastAngleDiffUpdateTime > TimeDiff(0.5f)) {
            for(int aiLevel = AI_EASY; aiLevel < AI_XTREME; aiLevel++) {
                float maxdiff = float(AI_XTREME - aiLevel) / float(AI_XTREME);
                angleDiff[aiLevel] = GetRandomNum() * maxdiff * 50.0f;
            }
            lastAngleDiffUpdateTime = tLX->currentTime;
        }
        ang += angleDiff[iAiDiffLevel];
        ang = MAX(ang, -90.0f);
    }

    // Move the angle at the same speed humans are allowed to move the angle
    if(ang > m_worm->fAngle)
        m_worm->fAngle += angleSpeed;
    else if(ang < m_worm->fAngle)
        m_worm->fAngle -= angleSpeed;

    // If the angle is within +/- 3 degrees, just snap it
    if( fabs(m_worm->fAngle - ang) < 3 )
        m_worm->fAngle = ang;

    if(fabs(m_worm->fAngle - ang) < 3 + 20 * float(AI_XTREME - iAiDiffLevel) / float(AI_XTREME))
        goodAim = true;

    // Clamp the angle
    m_worm->fAngle = CLAMP(m_worm->fAngle.get(), -90.0f, cClient->getGameLobby()[FT_FullAimAngle] ? 90.0f : 60.0f);

    return goodAim;
}
int CWormBotInputHandler::AI_FindClearingWeapon()
{
    const bool canIgnoreSelfHit = !(bool)cClient->getGameLobby()[FT_SelfInjure];

    if(!canIgnoreSelfHit && iAiGameType == GAM_MORTARS)
        return -1;

    // search a good projectile weapon
    for (size_t i=0; i<m_worm->tWeapons.size(); i++) {
        if(m_worm->tWeapons[i].weapon() && m_worm->tWeapons[i].weapon()->Type == WPN_PROJECTILE) {
            // TODO: not really all cases...
            Proj_ActionType type = m_worm->tWeapons[i].weapon()->Proj.Proj->Hit.Type;

            // Nothing that could fall back onto us
            if (!canIgnoreSelfHit && m_worm->tWeapons[i].weapon()->Proj.Speed < 100.0f) {
                if (!m_worm->tWeapons[i].weapon()->Proj.Proj->UseCustomGravity || m_worm->tWeapons[i].weapon()->Proj.Proj->Gravity > 30)
                    continue;
            }

            // Suspicious
            std::string name;
            name = m_worm->tWeapons[i].weapon()->Name;
            stringlwr(name);
            if(strincludes(name,"dirt") || strincludes(name,"napalm") || strincludes(name,"grenade") || strincludes(name,"nuke") || strincludes(name,"mine"))
                continue;

            // Nothing explosive or dirty
            if (type != PJ_DIRT && type != PJ_GREENDIRT && type != PJ_BOUNCE)
                if(!m_worm->tWeapons[i].Reloading)
                    return (int)i;
        }
    }

    // accept also beam-weapons as a second choice
    for (size_t i=0; i<m_worm->tWeapons.size(); i++)
        if(m_worm->tWeapons[i].weapon() && m_worm->tWeapons[i].weapon()->Type == WPN_BEAM)
            return (int)i;

    // No suitable weapons
    return -1;
}
bool CWormBotInputHandler::weaponCanHit(float gravity, float speed, CVec cTrgPos)
{
    // Get the target position
    if(nAITargetWormId < 0)
        return false;

    // Get the projectile
    const wpnslot_t* wpnslot = m_worm->getWeapon(m_worm->getCurrentWeapon());
    const weapon_t* wpn = wpnslot ? wpnslot->weapon() : NULL;
    proj_t* wpnproj = wpn ? wpn->Proj.Proj : NULL;
    if(!wpnproj) // no valid weapon
        return false;

    if(iAiDiffLevel < AI_XTREME) {
        static float randomNums[4] = {0,0,0,0};
        static AbsTime lastRandomNumRefresh;
        if(tLX->currentTime - lastRandomNumRefresh > TimeDiff(0.5f)) {
            for(uint i = 0; i < sizeof(randomNums)/sizeof(randomNums[0]); ++i)
                randomNums[i] = GetRandomNum();
            lastRandomNumRefresh = tLX->currentTime;
        }

        float f = float(AI_XTREME - iAiDiffLevel) / float(AI_XTREME);
        gravity += randomNums[0] * f * 5;
        speed += randomNums[1] * f * 20.0f;
        cTrgPos.x += randomNums[2] * f * 50.0f;
        cTrgPos.y += randomNums[3] * f * 50.0f;
    }

    // Exchange endpoints and velocity if needed
    float x_vel = 1;
    CVec from = m_worm->vPos;
    CVec to = cTrgPos;
    if (from.x > to.x)  {
        from = cTrgPos;
        to = m_worm->vPos;
        x_vel = -1;
    } else if (from.x == to.x)
        return true;

    // Get the parabolic trajectory
    // TODO: this calculation is wrong in some cases, someone who knows how to work with fAngle please fix it
    float alpha = DEG2RAD(m_worm->fAngle);
    if (cTrgPos.y > m_worm->vPos.get().y)
        alpha = -alpha;
    Parabola p(m_worm->vPos, alpha, cTrgPos);
    if (p.a > 0.1f)
        return false;

#ifdef DEBUG
    //game.gameMap()->ClearDebugImage();
#endif

    // Check
    float last_y = (p.a * (from.x + 5) * (from.x + 5) + p.b * (from.x + 5) + p.c);
    for (float x = from.x + 5; x < to.x; x++)  {
        float y = (p.a * x * x + p.b *x + p.c);

        // Rock or dirt, trajectory not free
        if (CProjectile::CheckCollision(wpnproj, 1, CVec(x, y), CVec(x_vel, y - last_y)))
            return false;

        last_y = y;

#ifdef DEBUG
        //PutPixel(game.gameMap()->GetDebugImage(), CLAMP((int)x, 0, (int)game.gameMap()->GetWidth()-1)*2, CLAMP((int)y, 0, (int)game.gameMap()->GetHeight()-1)*2, Color(0, 255, 0));
#endif
    }

    return true;
}
bool AI_GetAimingAngle(float v, float g, float x, float y, float *angle)
{
    // TODO: returns wron angles (too big) for mortars
    // Is it a fault of wrong parameters or wrong calculations?

    float v2 = v*v;
    float x2 = x*x;
    float g2 = g*g;
    float y2 = y*y;

    // Small hack - for small y-distance we want positive numbers
    if (fabs(y) < 3)  {
        if (y <= 0)
            y = -y;
    }

    float tmp1 = (float)fabs(-2*v2*y*g-g2*x2+v2*v2);

    // Validity check
    if (tmp1 < 0)  {
        *angle = 0;
        return false;
    }

    float tmp2 = -x2*(float)sqrt(tmp1)+x2*y*g+v2*(x2+2*y2);

    // Validity check
    if (tmp2 < 0)  {
        *angle = 0;
        return false;
    }

    float tmp3 = (float)sqrt(tmp1)-y*g+v2;

    // Validity check
    if (tmp3 <= 0 || x == 0)  {
        *angle = 60;
        return false;
    }

    // Get the angle
    *angle = (float)atan((float)sqrt(tmp2)/(x*(float)sqrt(tmp3)));
    if (x < 0)
        *angle = -(*angle);
    if (y > 0)
        *angle = -(*angle);

    // Convert to degrees
    *angle *= R2D;

    // Clamp the angle
    const float upperAngle = cClient->getGameLobby()[FT_FullAimAngle] ? 90.0f : 60.0f;
    if (*angle > upperAngle)  {
        *angle = upperAngle;
        return false;
    }
    if (*angle < -90)  {
        *angle = -90;
        return false;
    }

    // Ok!
    return true;

}
static bool canShootRightNowWithCurWeapon(CWorm* w) {
    if(game.gameScript()->gusEngineUsed())
        // TODO: reloading check and so on
        return true;

    // code from GameServer::WormShoot, CClient::PlayerShoot
    // and look also at CClient::ShootSpecial for special weapons like jetpack

    const wpnslot_t *Slot = w->getCurWeapon();
    if(!Slot) return false;

    if(Slot->Reloading)
        return false;

    if(Slot->LastFire>0)
        return false;

    if(!Slot->weapon())
        return false;

    if(Slot->weapon()->Type == WPN_SPECIAL) {
        switch(Slot->weapon()->Special) {
            case SPC_JETPACK: return true;
            default: return false;
        }
    }

    // Must be a projectile
    if(Slot->weapon()->Type != WPN_PROJECTILE && Slot->weapon()->Type != WPN_BEAM)
        return false;

    return true;
}
int CWormBotInputHandler::AI_GetBestWeapon(int iGameMode, float fDistance, bool bDirect, float fTraceDist) {
    if(game.gameScript()->gusEngineUsed()) {
        // TODO: right weapon
        return 0;
    }

    // if we are to close to the target, don't selct any weapon (=> move away)
    /*if(fDistance < 5)
        return -1; */

    float diff[4] = {0.50f,0.30f,0.20f,0.12f};

    // We need to wait a certain time before we change weapon
    if( tLX->currentTime - fLastWeaponChange > diff[iAiDiffLevel] )
        fLastWeaponChange = tLX->currentTime;
    else
        return m_worm->iCurrentWeapon;

    // For rifles and mortars just get the first unreloaded weapon
    if (iAiGameType == GAM_RIFLES || iAiGameType == GAM_MORTARS)  {
        for (int i=0; i<5; i++)
            if (!m_worm->tWeapons[i].Reloading)
                return i;
        //printf("GAM_RIFLES|GAM_MORTARS: all weapons still are reloading...\n");
        return -1;
    }

    CVec    cTrgPos = AI_GetTargetPos();


    if (iAiGameType == GAM_100LT)  {
        // We're above the worm

        // If we are close enough, shoot the napalm
        if (m_worm->vPos.get().y <= cTrgPos.y && (m_worm->vPos-cTrgPos).GetLength2() < 10000.0f)  {
            if (traceWormLine(cTrgPos,m_worm->vPos) && !m_worm->tWeapons[1].Reloading) {
                CWorm* w = game.wormById(nAITargetWormId, false);
                if (w && w->CheckOnGround())
                    return 1;
            }
        }



        float d = (m_worm->vPos-cTrgPos).GetLength();
        // We're close to the target
        if (d < 50.0f)  {
            // We see the target
            if(bDirect)  {
                // Super shotgun
                if (!m_worm->tWeapons[0].Reloading)
                    return 0;

                // Chaingun
                if (!m_worm->tWeapons[4].Reloading)
                    return 4;


                // Doomsday
                if (!m_worm->tWeapons[3].Reloading)
                    return 3;

                // Let's try cannon
                if (!m_worm->tWeapons[2].Reloading)
                // Don't use cannon when we're on ninja rope, we will avoid suicides
                    if (!m_worm->cNinjaRope.get().isAttached())  {
                        m_worm->tState.write().bMove = false;  // Don't move, avoid suicides
                        return 2;
                    }
            }
            // We don't see the target
            else  {
                //notes << "bot: GAM_100LT: i think we should not shoot here" << endl;
                m_worm->tState.write().bJump = true; // Jump, we might get better position
                return -1;
            }
        }

        // Not close, not far
        if (d > 50.0f && d<=300.0f)  {
            if (bDirect)  {

                // Chaingun is the best weapon for this situation
                if (!m_worm->tWeapons[4].Reloading)  {
                    return 4;
                }

                // Let's try cannon
                if (!m_worm->tWeapons[2].Reloading)
                    // Don't use cannon when we're on ninja rope, we will avoid suicides
                    if (!m_worm->cNinjaRope.get().isReleased())  {
                        m_worm->tState.write().bMove = false;  // Don't move, avoid suicides
                        return 2;
                    }

                // Super Shotgun makes it sure
                if (!m_worm->tWeapons[0].Reloading)
                    return 0;

                // As for almost last, try doomsday
                if (!m_worm->tWeapons[3].Reloading)
                    // Don't use doomsday when we're on ninja rope, we will avoid suicides
                    if (!m_worm->cNinjaRope.get().isAttached())  {
                        m_worm->tState.write().bMove = false;  // Don't move, avoid suicides
                        return 3;
                    }
            } // End of direct shooting weaps

            //return -1;
        }

        // Quite far
        if (d > 300.0f && bDirect)  {

            // First try doomsday
            if (!m_worm->tWeapons[3].Reloading)  {
                // Don't use doomsday when we're on ninja rope, we will avoid suicides
                if (!m_worm->cNinjaRope.get().isAttached())  {
                    m_worm->tState.write().bMove = false;  // Don't move, avoid suicides
                    return 3;
                }
            }

            // Super Shotgun
            if (!m_worm->tWeapons[0].Reloading)
                return 0;

            // Chaingun
            if (!m_worm->tWeapons[4].Reloading)
                return 4;

            // Cannon, the worst possible for this
            if (!m_worm->tWeapons[2].Reloading)
                // Don't use cannon when we're on ninja rope, we will avoid suicides
                if (!m_worm->cNinjaRope.get().isReleased())  {
                    // Aim a bit up
                    // AI_SetAim(CVec(cTrgPos.x,cTrgPos.y+5.0f)); // don't do aiming here
                    m_worm->tState.write().bMove = false;  // Don't move, avoid suicides
                    return 2;
                }
        }

        //return -1;

    }

    /*
    0: "minigun"
    1: "shotgun"
    2: "chiquita bomb"
    3: "blaster"
    4: "big nuke"
    */


    /*

      Special firing cases

    */

    //
    // Case 1: The target is on the bottom of the level, a perfect spot to lob an indirect weapon
    //
    if(cTrgPos.y > game.gameMap()->GetHeight()-50 && fDistance < 200) {
        for (size_t i=0; i<m_worm->tWeapons.size(); i++)
            if (!m_worm->tWeapons[i].Reloading)
                if (m_worm->tWeapons[i].weapon() && m_worm->tWeapons[i].weapon()->Type == WPN_PROJECTILE)
                    if (m_worm->tWeapons[i].weapon()->Proj.Proj->Hit.Type == PJ_EXPLODE)
                        return (int)i;
    }



    /*

      Direct firing weapons

    */

    //
    // If we're close, use some beam or projectile weapon
    //
    if(fDistance < 100 && bDirect) {
        // First try beam
        for (size_t i=0; i<m_worm->tWeapons.size(); i++)
            if (!m_worm->tWeapons[i].Reloading)
                if (m_worm->tWeapons[i].weapon() && m_worm->tWeapons[i].weapon()->Type == WPN_BEAM)
                    return (int)i;

        // If beam not available, try projectile
        for (size_t i=0; i<m_worm->tWeapons.size(); i++)
            if (!m_worm->tWeapons[i].Reloading)
                if (m_worm->tWeapons[i].weapon() && m_worm->tWeapons[i].weapon()->Type == WPN_PROJECTILE)
                    if( m_worm->tWeapons[i].weapon()->Proj.Proj->Hit.Type != PJ_DIRT
                    && m_worm->tWeapons[i].weapon()->Proj.Proj->Hit.Type != PJ_GREENDIRT)
                    //if (tWeapons[i].Weapon->Proj.Proj->Type == PRJ_PIXEL)
                    return (int)i;

         // don't return here, try selection by other, not optimal fitting cases
   }


    //
    // If we're at a medium distance, use any weapon, but prefer the exact ones
    //
    if(fDistance < 150 && bDirect) {

        // First try beam
        for (size_t i=0; i<m_worm->tWeapons.size(); i++)
            if (!m_worm->tWeapons[i].Reloading)
                if (m_worm->tWeapons[i].weapon() && m_worm->tWeapons[i].weapon()->Type == WPN_BEAM)
                    return (int)i;

        // If beam not available, try projectile
        for (size_t i=0; i<m_worm->tWeapons.size(); i++)
            if (!m_worm->tWeapons[i].Reloading)
                if (m_worm->tWeapons[i].weapon() && m_worm->tWeapons[i].weapon()->Type == WPN_PROJECTILE)
                    if( m_worm->tWeapons[i].weapon()->Proj.Proj->Hit.Type != PJ_DIRT
                    && m_worm->tWeapons[i].weapon()->Proj.Proj->Hit.Type != PJ_GREENDIRT)
                    /*if (tWeapons[i].Weapon->Proj.Proj->Type == PRJ_PIXEL || tWeapons[i].Weapon->Proj.Proj->Hit.Type == PJ_BOUNCE)*/
                        return (int)i;

        // don't return here, try selection by other, not optimal fitting cases
    }


    //
    // Any greater distance for direct firing uses a projectile weapon first
    //
    if(bDirect) {
        // First try projectile
        for (size_t i=0; i<m_worm->tWeapons.size(); i++)
            if (!m_worm->tWeapons[i].Reloading)
                if (m_worm->tWeapons[i].weapon() && m_worm->tWeapons[i].weapon()->Type == WPN_PROJECTILE)
                    if( m_worm->tWeapons[i].weapon()->Proj.Proj->Hit.Type != PJ_DIRT
                    && m_worm->tWeapons[i].weapon()->Proj.Proj->Hit.Type != PJ_GREENDIRT)
                        return (int)i;

        // If projectile not available, try beam
        for (size_t i=0; i<m_worm->tWeapons.size(); i++)
            if (!m_worm->tWeapons[i].Reloading)
                if (m_worm->tWeapons[i].weapon() && m_worm->tWeapons[i].weapon()->Type == WPN_BEAM)
                    return (int)i;

        // If everything fails, try some random weapons
        for (size_t i=0; i<m_worm->tWeapons.size(); i++) {
            int num = GetRandomInt((int)m_worm->tWeapons.size()-1);
            if (!m_worm->tWeapons[num].Reloading && m_worm->tWeapons[num].weapon())
                return num;
        }

        //return -1;
    }


    //
    // Indirect firing weapons
    //


    // If we're above the target, try any special weapon, for Liero mod try napalm
    // BUT only if our health is looking good
    // AND if there is no rock/dirt nearby
    if(fDistance > 190 && m_worm->health > 25 && fTraceDist > 0.5f && (cTrgPos.y-20) > m_worm->vPos.get().y ) {
        if (!AI_CheckFreeCells(5)) {
            //notes << "bot: we should not shoot because of the hints everywhere" << endl;
            return -1;
        }

        // try projectile weapons
        for (size_t i=0; i<m_worm->tWeapons.size(); i++)
            if (!m_worm->tWeapons[i].Reloading && m_worm->tWeapons[i].weapon() && m_worm->tWeapons[i].weapon()->Type == WPN_PROJECTILE)
                if (m_worm->tWeapons[i].weapon()->Proj.Proj->Hit.Type == PJ_EXPLODE || m_worm->tWeapons[i].weapon()->Proj.Proj->Hit.Type == PJ_BOUNCE)
                    return (int)i;

    }


    //
    // Last resort
    //

    // Shoot a beam (we cant suicide with that)
    for (size_t i=0; i<m_worm->tWeapons.size(); i++)
        if (!m_worm->tWeapons[i].Reloading && m_worm->tWeapons[i].weapon() && m_worm->tWeapons[i].weapon()->Type == WPN_BEAM)
            return (int)i;

    // If everything fails, try some random weapons
    for (size_t i=0; i<m_worm->tWeapons.size(); i++) {
        int num = GetRandomInt((int)m_worm->tWeapons.size()-1);
        if (!m_worm->tWeapons[num].Reloading && m_worm->tWeapons[num].weapon())
            return num;
    }

    // If everything fails, try all weapons
    for (size_t i=0; i<m_worm->tWeapons.size(); i++)
        if (!m_worm->tWeapons[i].Reloading && m_worm->tWeapons[i].weapon())
            return (int)i;

    return -1;
}
int CWormBotInputHandler::traceWeaponLine(CVec target, float *fDist, int *nType)
{
    if( game.gameMap() == NULL) {
        errors << "AI:traceWeaponLine: map == NULL" << endl;
        return 0;
    }

    // Trace a line from the worm to length or until it hits something
    CVec    pos = m_worm->vPos;
    CVec    dir = target-pos;
    int     nTotalLength = (int)NormalizeVector(&dir);

    int first_division = 7;	// How many pixels we go through first check (we can shoot through walls)
    int divisions = 5;		// How many pixels we go through each check (more = slower)

    if(!game.gameScript()->gusEngineUsed()) {

        if(!m_worm->getCurWeapon() || !m_worm->getCurWeapon()->weapon())
            return 0;


        //
        // Predefined divisions
        //

        // Beam
        if (m_worm->tWeapons[m_worm->iCurrentWeapon].weapon()->Type == WPN_BEAM)  {
            first_division = 1;
            divisions = 1;
        }

        // Rifles
        else if (iAiGameType == GAM_RIFLES)  {
            first_division = 10;
            divisions = 6;
        }

        // Mortars
        else if (iAiGameType == GAM_MORTARS)  {
            first_division = 7;
            divisions = 2;
        }

        // 100lt
        else if (iAiGameType == GAM_100LT)  {
            first_division = 6;
            divisions = 3;
        }

    }

    // Add the worm thickness
    first_division += 5;

    // Check
    if( nTotalLength < divisions)
        divisions = nTotalLength;

    *nType = PX_EMPTY;

    // Make sure we have at least 1 division
    divisions = MAX(divisions,1);
    first_division = MAX(first_division,1);

    // Check that we don't hit any teammate
    std::vector<CVec> WormsPos;
    if (cClient && cClient->getGameLobby()[FT_GameMode].as<GameModeInfo>()->generalGameType == GMT_TEAMS)  {
        for_each_iterator(CWorm*, w, game.aliveWorms()) {
            if (w->get()->getTeam() == m_worm->iTeam && w->get()->getID() != m_worm->iID)
                WormsPos.push_back(w->get()->getPos());
        }
    }


    // Trace the line
    int divs = first_division;
    int i;
    for(i=0; i<nTotalLength; i+=divs) {
        uchar px = game.gameMap()->GetPixelFlag( (int)pos.x, (int)pos.y );

        if (i>first_division)  // we aren't close to a wall, so we can shoot through only thin wall
            divs = divisions;

        // Dirt or rock
        if((px & PX_DIRT) || (px & PX_ROCK)) {
            if(nTotalLength != 0)
                *fDist = (float)i / (float)nTotalLength;
            else
                *fDist = 0;
            *nType = px;
            return i;
        }

        // Friendly worm
        for (size_t j=0;j<WormsPos.size();j++) {
            if ((pos-WormsPos[j]).GetLength2() < 400.0f)  {
                if(nTotalLength != 0)
                    *fDist = (float)i / (float)nTotalLength;
                else
                    *fDist = 0;
                *nType = *nType | PX_WORM;
                return i;
            }
        }

        pos += dir * (float)divs;
    }

    // Full length
    if(nTotalLength != 0)
        *fDist = (float)i / (float)nTotalLength;
    else
        *fDist = 0;
    return nTotalLength;
}
int CWormBotInputHandler::AI_GetRockBetween(CVec pos, CVec trg)
{
    assert( game.gameMap() != NULL );

    int result = 0;

    // Trace a line from the worm to the target
    CVec    dir = trg-pos;
    int     nTotalLength = (int)NormalizeVector(&dir);

    const int divisions = 4;			// How many pixels we go through each check (less = slower)

    int i;
    uchar px = PX_EMPTY;
    for(i=0; i<nTotalLength; i+=divisions) {
        px = game.gameMap()->GetPixelFlag( (int)pos.x, (int)pos.y );
        //game.gameMap()->PutImagePixel((int)pos.x, (int)pos.y, Color(255,0,0));

        if (px & PX_ROCK)
            result++;

        pos = pos + dir * (float)divisions;
    }

    return result;
}
bool CWormBotInputHandler::AI_Shoot()
{
    if(cClient->getGameLobby()[FT_GameMode].as<GameModeInfo>()->mode && !cClient->getGameLobby()[FT_GameMode].as<GameModeInfo>()->mode->Shoot(m_worm)) {
        // there is no shooting in this gamemode
        return false;
    }

    if(cClient->getGameLobby()[FT_GameMode].as<GameModeInfo>()->actualIndex() == GM_RACE || cClient->getGameLobby()[FT_GameMode].as<GameModeInfo>()->actualIndex() == GM_TEAMRACE)
        // dont care about shooting in this mod, just try to be fast
        return false;

    if(!canShootRightNowWithCurWeapon(m_worm)) return false;

    // search for best target
     CWorm* w = findTarget();
    if(!w) return false;

    CVec    cTrgPos = w->getPos();
    bool    bDirect = true;


    /*
      Here we check if we have a line of sight with the target.
      If we do, and our 'direct' firing weapons are loaded, we shoot.

      If the line of sight is blocked, we use 'indirect' shooting methods.
      We have to be careful with indirect, because if we're in a confined space, or the target is above us
      we shouldn't shoot at the target

      The aim of the game is killing worms, so we put a higher priority on shooting rather than
      thinking tactically to prevent injury to self

      If we play a mortar game, make sure there's enough free space to shoot - avoid suicides
    */


    // If the target is too far away we can't shoot at all (but not when a rifle game)
    CVec diff = cTrgPos - m_worm->vPos;
    float d = diff.GetLength();
 /*   if(d > 300.0f && iAiGameType != GAM_RIFLES)
        return false; */

/*	// If we're on the target, simply shoot // this doesn't work in every case
    if(d < 10.0f)
        return true;
*/

    // TODO: first choose the weapon, and then use weaponCanHit instead of traceWeaponLine
    // hm, i would say, the other way around is better


    float fDist;
    int nType = -1;

    traceWeaponLine(cTrgPos, &fDist, &nType);

    // If target is blocked by rock we can't use direct firing
    if(nType & PX_ROCK)  {
        bDirect = false;
    }

    // Don't shoot teammates
    // TODO: why do we catch only teammates here and not the enemy worm?
    if(cClient->getGameLobby()[FT_GameMode].as<GameModeInfo>()->generalGameType == GMT_TEAMS && (nType & PX_WORM)) {
        //notes << "bot: we don't want shoot teammates" << endl;
        return false;
    }


    if(game.gameScript()->gusEngineUsed()) {
        // TODO: merge this with rest (we have to merge wpns for this)

        if(!bDirect) return false;
        if(!AI_SetAim(cTrgPos)) return false;

        m_worm->tState.write().bShoot = true;
        fLastShoot = tLX->currentTime;
        return true;
    }


    // If target is blocked by large amount of dirt, we can't shoot it
    // But we can use a clearing weapon :)
    if (nType & PX_DIRT)  {
        bDirect = false;
        if(diff.y < 0 && fabs(diff.y) > fabs(diff.x) && d-fDist > 40.0f)  {
            int w = AI_FindClearingWeapon();
            if (w >= 0 && AI_GetRockBetween(m_worm->vPos, cTrgPos) <= 3) {
                m_worm->iCurrentWeapon = w;
                if(AI_SetAim(cTrgPos)) {
                    m_worm->tState.write().bShoot = true;
                    return true;
                }
                else
                    return false;
            }
        }
    }

    // In mortar game there must be enough of free cells around us
    if (iAiGameType == GAM_MORTARS)
        if (!(nType & PX_EMPTY) && fDist <= 25)
            return false;

    // Set the best weapon for the situation
    // If there is no good weapon, we can't shoot
    tLX->debug_float = d;
    int wpn = AI_GetBestWeapon(iAiGameType, d, bDirect, fDist);
    if(wpn < 0) {
        //notes << "bot: I could not find any useable weapon" << endl;
        return false;
    }

    m_worm->iCurrentWeapon = wpn;

    bool bAim = false;

    float alpha = 0;

    bool bShoot = false;

    // Aim in the right direction to account of weapon speed, gravity and worm velocity
    const weapon_t *weap = m_worm->getCurWeapon() ? m_worm->getCurWeapon()->weapon() : NULL;
    if(!weap) return false;
    if(weap->Proj.Proj)  {
        switch (weap->Proj.Proj->Hit.Type)  {
            //case PJ_NOTHING:
            //case PJ_CARVE:
            case PJ_DIRT:
            case PJ_GREENDIRT:
                //printf("hit_type is %i\n", weap->Proj.Proj->PlyHit.Type);
                // don't shoot this shit
                break;
            default:
                CVec direction = (w->getPos() - m_worm->vPos).Normalize();
                // speed of target in the direction (moving away from us)
                float targ_speed = direction.Scalar(w->getVelocity());
                float my_speed = direction.Scalar(m_worm->vVelocity);

                // Projectile speed (see CClient::ProcessShot for reference) - targ_speed
                float v = (float)weap->Proj.Speed/* *weap->Proj.Proj->Dampening */ + weap->Proj.SpeedVar*100.0f + my_speed;
                if(v < 0) {
                    // we have high velocities, danger to shot...
                    // if v<0, we would shoot in the wrong direction
                    //printf("velocities(%f) too high...\n", v);
                /*	printf("  ProjSpeed = %f\n", (float)weap->Proj.Speed);
                    printf("  Dampening = %f\n", (float)weap->Proj.Proj->Dampening);
                    printf("  ProjSpeedVar = %f\n", weap->Proj.SpeedVar);
                    printf("  my_speed = %f\n", my_speed);
                    printf("  targ_speed = %f\n", targ_speed); */
                    bAim = false;
                    break;
                }

                // Distance
                float x = (cTrgPos.x-m_worm->vPos.get().x);
                float y = (m_worm->vPos.get().y-cTrgPos.y); // no PC-koord but real-world-koords



                // how long it takes for hitting the target
                float apriori_time = v ? sqrt(x*x + y*y) / v : 0;
                apriori_time *= 0.7f; // it's no direct line but a polynom, so this could give better results :)
                if(apriori_time < 0) {
                    // target is faster than the projectile
                    // shoot somewhere in the other direction
                    notes << "bot: target is too fast! my speed: " << my_speed << ", trg speed: " << targ_speed << ", my abs speed: " << m_worm->vVelocity.get().GetLength() << ", trg abs speed: " << w->getVelocity().GetLength() << ", proj speed: " << (float)weap->Proj.Speed*weap->Proj.Proj->Dampening << "+" << (weap->Proj.SpeedVar*100.0f) << endl;

                } else { // apriori_time >= 0
                    // where the target would be
                    x += apriori_time*w->getVelocity().x;
                    y -= apriori_time*w->getVelocity().y; // HINT: real-world-koords
                }

                // Gravity
                float g = 100;
                if(weap->Proj.Proj->UseCustomGravity)
                    g = (float)weap->Proj.Proj->Gravity;

                proj_t *tmp = weap->Proj.Proj;
                while(tmp)  {
                    if (tmp->UseCustomGravity)  {
                        if (tmp->Gravity > g)
                            g = (float)tmp->Gravity;
                    } else
                        if (g < 100.0f)
                            g = 100.0f;

                    // If there are any other projectiles, that are spawned with the main one, try their gravity
                    if (tmp->Timer.Projectiles)  {
                        if (tmp->Timer.Time >= 0.5f)
                            break;
                    }
                    else if (tmp->Hit.Projectiles || tmp->PlyHit.Projectiles || tmp->Tch.Projectiles)
                        break;

                    // TODO: this is not correct anymore for newer gamescripts
                    tmp = tmp->GeneralSpawnInfo.Proj;
                }
                g *= (float)cClient->getGameLobby()[FT_ProjGravityFactor];

                // Get the alpha
                bAim = AI_GetAimingAngle(v,g,x,y,&alpha);
                if (!bAim) {
                    //printf("cannot calc the alpha, v=%f, g=%i, x=%f, y=%f\n", v,g,x,y);
                    break;
                }

                // AI diff level
                // Don't shoot so exactly on easier skill levels
                static const int diff[4] = {13,8,3,0};

                if (tLX->currentTime-fLastRandomChange >= 0.5f)  {
                    iRandomSpread = GetRandomInt(diff[iAiDiffLevel]) * SIGN(GetRandomNum());
                    fLastRandomChange = tLX->currentTime;
                }

                alpha += iRandomSpread;

                // Can we hit the target?
                //printf("proj-speed: %f\n", v);
                if (g <= 10 || v >= 200)  {
                    // we already have bDirect==false, if we have no direct free way
                    bAim = bDirect;
                }

                if (!bAim)
                    break;

                bShoot = true;

                float trg_dist2 = (cTrgPos - m_worm->vPos).GetLength2();
                if (trg_dist2 >= 2500)  {
                    bAim = AI_SetAim(cTrgPos);
                } else if (trg_dist2 >= 100) {
                    bAim = AI_SetAim(cTrgPos);
                    if (iAiGameType != GAM_MORTARS) // Not in mortars - close shoot = suicide
                        bShoot = true; // We are so close, that we almost cannot miss, just shoot
                    break;
                } else { // Too close, get away!
                    bAim = false;
                    bShoot = false;
                }

                // Check if we can aim with this angle
                // HINT: we have to do it here because weaponCanHit requires already finished aiming
                if (bAim && g >= 10.0f && v <= 200)  {
                    bShoot = bAim = weaponCanHit(g,v,m_worm->vPos+CVec(x,-y));
                }

                break;
            }

    // Not a projectile weapon
    } else {
        // Beam
        if (weap->Type == WPN_BEAM)  {
            int dist = (int)(cTrgPos - m_worm->vPos).GetLength();
            if (bDirect && weap->Bm.Length >= dist) // Check that the beam can reach the target
                bShoot = bAim = AI_SetAim(cTrgPos) || dist <= 25;
            else  {
                if (bDirect)
                    AI_SetAim(cTrgPos); // Aim - when we come closer, we won't have to aim anymore
                bShoot = bAim = false;
            }
        }

    }

    //
    // If there's some lag or low FPS, don't shoot in the direction of our flight (avoid suicides)
    //

    // HINT: we don't need this, because we ensure above in the speed-calculation, that we have no problem
    // TODO: avoiding projectiles should not be done by not shooting but by changing MoveToTarget
    if(bAim) if (game.isClient())  {
        // Get the angle
        float ang = (float)atan2(m_worm->vVelocity.get().x, m_worm->vVelocity.get().y);
        ang = RAD2DEG(ang);
        if(m_worm->iFaceDirectionSide == DIR_LEFT)
            ang+=90;
        else
            ang = -ang + 90;

        // Cannot shoot
        if (fabs(m_worm->fAngle-ang) <= 30 && m_worm->vVelocity.get().GetLength2() >= 3600.0f && weap->Type != WPN_BEAM)  {
            if (weap->Type == WPN_PROJECTILE)  {
                if (weap->Proj.Proj->PlyHit.Damage > 0)
                    return false;
            }
        }
    }

    if(!bAim)  {

          // we cannot shoot here

        // TODO: do we need this?
        fBadAimTime += tLX->fDeltaTime;
        if((fBadAimTime) > 4) {
            if(game.gameMap()->IsEmptyForWorm(m_worm->pos() + CVec(0,-5)))
                m_worm->tState.write().bJump = true;
            fBadAimTime = 0;
        }

        fCanShootTime = 0;

        return bShoot;
    }

    // Reflexes :)
    // TODO: this doesn't work atm
    /*float diff[4] = {0.45f,0.35f,0.25f,0.0f};
    fCanShootTime += tLX->fDeltaTime;
    if (fCanShootTime <= diff[iAiDiffLevel])  {
        return false;
    }*/

    fBadAimTime = 0;
    vLastShootTargetPos = cTrgPos;

    // Shoot
    m_worm->tState.write().bShoot = true;
    fLastShoot = tLX->currentTime;
    return true;
}

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
