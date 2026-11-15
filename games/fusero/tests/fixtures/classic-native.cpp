/*
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

// BEGIN verbatim CheckOnGround
bool CWorm::CheckOnGround()
{
	int px = (int)vPos.get().x;
	int py = (int)vPos.get().y;
	bool wrapAround = cClient->getGameLobby()[FT_InfiniteMap];

	for(short y = 6; y > 0; y--) {

		// Optimize: pixelflag + Width
		if(!(game.gameMap()->GetPixelFlag(px - 2, py + y, wrapAround) & PX_EMPTY))
			return true;
		if(!(game.gameMap()->GetPixelFlag(px + 2, py + y, wrapAround) & PX_EMPTY))
			return true;
	}

	return false;
}
// BEGIN verbatim moveAndCheckWormCollision
static bool moveAndCheckWormCollision(AbsTime currentTime, float dt, CWorm* worm, CVec pos, CVec *vel, CVec vOldPos, bool jump ) {
	static const int maxspeed2 = 10; // this should not be too high as we could run out of the game.gameMap() without checking else

	// Can happen when starting a game
	if (!game.gameMap())
		return false;
	CMap* map = game.gameMap();

	// check if the vel is really too high (or infinity), in this case just ignore
	if( (*vel*dt*worm->speedFactor()).GetLength2() > (float)map->GetWidth() * (float)map->GetHeight() )
		return true;

	// If the worm is going too fast, divide the speed by 2 and perform 2 collision checks
	// TODO: is this still needed? we call this function with a fixed dt
	// though perhaps it is as with higher speed the way we have to check is longer
	if( (*vel * dt * worm->speedFactor()).GetLength2() > maxspeed2 && dt > 0.001f ) {
		dt /= 2;
		if(moveAndCheckWormCollision(currentTime, dt,worm,pos,vel,vOldPos,jump)) return true;
		return moveAndCheckWormCollision(currentTime, dt,worm,worm->getPos(),vel,vOldPos,jump);
	}

	bool wrapAround = cClient->getGameLobby()[FT_InfiniteMap];
	pos += *vel * dt * worm->speedFactor();
	if(wrapAround) {
		FMOD(pos.x, (float)map->GetWidth());
		FMOD(pos.y, (float)map->GetHeight());
	}
	worm->pos() = pos;


	int x = (int)pos.x;
	int y = (int)pos.y;
	short clip = 0; // 0x1=left, 0x2=right, 0x4=top, 0x8=bottom
	bool coll = false;

	if(y >= 0 && (uint)y < map->GetHeight()) {
		for(x=-3;x<4;x++) {
			// Optimize: pixelflag++

			// Left side clipping
			if(!wrapAround && (pos.x+x <= 2)) {
				clip |= 0x01;
				worm->pos().write().x = 5;
				coll = true;
				if(fabs(vel->x) > 40)
					vel->x *=  -0.4f;
				else
					vel->x=(0);
				continue; // Note: This was break in LX56, but continue is really better here
			}

			// Right side clipping
			if(!wrapAround && (pos.x+x >= map->GetWidth())) {
				worm->pos().write().x = (float)map->GetWidth() - 5;
				coll = true;
				clip |= 0x02;
				if(fabs(vel->x) > 40)
					vel->x *= -0.4f;
				else
					vel->x=(0);
				continue; // Note: This was break in LX56, but continue is really better here
			}

			int posx = (int)pos.x + x; if(wrapAround) { posx %= (int)map->GetWidth(); if(posx < 0) posx += map->GetWidth(); }
			if(!(map->GetPixelFlag(posx,y) & PX_EMPTY)) {
				coll = true;

				// NOTE: Be carefull that you don't do any float->int->float conversions here.
				// This has some *huge* effect. People reported it as high ceil friction.
				if(x<0) {
					clip |= 0x01;
					worm->pos().write().x = pos.x + x + 4;
				}
				else {
					clip |= 0x02;
					worm->pos().write().x = pos.x + x - 4;
				}

				// Bounce
				if(fabs(vel->x) > 40)
					vel->x *= -0.4f;
				else
					vel->x=(0);
			}
		}
	}

	// In case of this, it could be that we need to do a FMOD. Just do it to be sure.
	if(wrapAround) {
		FMOD(pos.x, (float)map->GetWidth());
	}

	worm->setOnGround( false );

	bool hit = false;
	x = (int)pos.x;

	if(x >= 0 && (uint)x < map->GetWidth()) {
		for(y=5;y>-5;y--) {
			// Optimize: pixelflag + Width

			// Top side clipping
			if(!wrapAround && (pos.y+y <= 1)) {
				worm->pos().write().y = 6;
				coll = true;
				clip |= 0x04;
				if(fabs(vel->y) > 40)
					vel->y *= -0.4f;
				else
					vel->y = (0);

				// it was also break in LX56. this makes a huge difference when bouncing against the bottom.
				break;
			}

			// Bottom side clipping
			if(!wrapAround && (pos.y+y >= map->GetHeight())) {
				worm->pos().write().y = (float)map->GetHeight() - 5;
				clip |= 0x08;
				coll = true;
				worm->setOnGround( true );
				if(fabs(vel->y) > 40)
					vel->y *= -0.4f;
				else
					vel->y=(0);
				continue; // Note: This was break in LX56, but continue is really better here
			}

			int posy = (int)pos.y + y; if(wrapAround) { posy %= (int)map->GetHeight(); if(posy < 0) posy += map->GetHeight(); }
			if(!(map->GetPixelFlag(x,posy) & PX_EMPTY)) {
				coll = true;

				if(!hit && !jump) {
					if(fabs(vel->y) > 40 && ((vel->y > 0 && y>0) || (vel->y < 0 && y<0)))
						vel->y *= -0.4f;
					else
						vel->y=(0);
				}

				hit = true;
				worm->setOnGround( true );

				// NOTE: Be carefull that you don't do any float->int->float conversions here.
				// This has some *huge* effect. People reported it as high ceil friction.
				if(y<0) {
					clip |= 0x04;
					worm->pos().write().y = pos.y + y + 5;
				}
				else {
					clip |= 0x08;
					worm->pos().write().y = pos.y + y - 5;
				}
			}
		}
	}

	// In case of this, it could be that we need to do a FMOD. Just do it to be sure.
	if(wrapAround) {
		FMOD(pos.y, (float)map->GetHeight());
	}

	// If we are stuck in left & right or top & bottom, just don't move in that direction
	if ((clip & 0x01) && (clip & 0x02))
		worm->pos().write().x = vOldPos.x;

	// HINT: when stucked horizontal we move slower - it's more like original LX
	if ((clip & 0x04) && (clip & 0x08))  {
		worm->pos().write().y = vOldPos.y;
		if (!worm->tState.get().bJump)  // HINT: this is almost exact as old LX
			worm->pos().write().x = vOldPos.x;
	}

	// If we collided with the ground and we were going pretty fast, make a bump sound
	if(coll) {
		if( fabs(vel->x) > 30 && (clip & 0x01 || clip & 0x02) )
			StartSound( sfxGame.smpBump, worm->pos(), worm->getLocal(), -1 );
		else if( fabs(vel->y) > 30 && (clip & 0x04 || clip & 0x08) )
			StartSound( sfxGame.smpBump, worm->pos(), worm->getLocal(), -1 );
	}

	return coll;
}
// BEGIN verbatim CNinjaRope::GetForce
CVec CNinjaRope::GetForce() const
{
	if(!HookAttached)
		return CVec(0,0);

	CVec dir = owner()->pos() - pos();
	dir = dir.Normalize();
	
	const float RestLength = (float)(int)cClient->getGameLobby()[FT_RopeRestLength];
	if((owner()->pos() - pos()).GetLength2() < RestLength*RestLength)
		return CVec(0,0);
	
	dir *= (float)cClient->getGameLobby()[FT_RopeStrength] * -100;
	
	return dir;
}
// BEGIN verbatim checkForWormAttachment
void CNinjaRope::checkForWormAttachment() {
	if(owner() == NULL) return;

	// Check if the hook has hit another worm
	if(cClient->getGameLobby()[FT_RopeCanAttachWorm] && !isAttached() && !isPlayerAttached()) {

		for_each_iterator(CWorm*, w, game.aliveWorms()) {
			if(w->get()->getID() == owner()->getID())
				continue;
			if(!w->get()->isVisible(owner()))
				continue;

			if( ( w->get()->getPos() - hookPos() ).GetLength2() < 25 ) {
				AttachToPlayer(w->get());
				break;
			}
		}
	}

	// Put the hook where the worm is
	else if(isAttached() && isPlayerAttached()) {

		// If the worm has been killed, or dropped, or became invisible in H&S - drop the hook
		if(	!getAttachedPlayer() ||
			!getAttachedPlayer()->getAlive() ||
			!getAttachedPlayer()->isVisible(owner()) )
		{
			UnAttachPlayer();
		} else {
			hookPos() = getAttachedPlayer()->getPos();
		}
	}
}
// BEGIN verbatim simulateNinjarope
static void simulateNinjarope(float dt, CWorm* owner) {
	CNinjaRope* rope = &owner->cNinjaRope.write();
	CVec playerpos = owner->getPos();

	const bool wrapAround = cClient->getGameLobby()[FT_InfiniteMap];

	if(!rope->isReleased())
		return;

	const bool firsthit = !rope->isAttached();
	CVec force = rope->isShooting() ?
		CVec(0.0f, (float)cClient->getGameLobby()[FT_RopeGravity]) :
		CVec(0.0f, (float)cClient->getGameLobby()[FT_RopeFallingGravity]);

	// dt is fixed, but for very high speed, this could be inaccurate.
	// We use the limit 5 here to have it very unpropable to shoot through a wall.
	// In most cases, dt his halfed once, so this simulateNinjarope is
	// like in LX56 with 200FPS.
	if((rope->hookVelocity() + force*dt).GetLength2() * dt * dt * getNinjaropePrecision() > 5) {
		simulateNinjarope( dt/2, owner );
		simulateNinjarope( dt/2, owner );
		return;
	}

	// Still flying in the air
	if(rope->isShooting()) {

		// Gravity
		rope->hookVelocity() += force*dt;
		rope->hookPos() += rope->hookVelocity() * dt;

		const float length2 = (playerpos - rope->hookPos()) . GetLength2();

		// Check if it's too long
		const float ropeMaxLength = (float)(int)cClient->getGameLobby()[FT_RopeMaxLength];
		if(length2 > ropeMaxLength * ropeMaxLength) {
			rope->hookVelocity() = CVec(0,0);
			rope->setShooting( false );
		}
	}
	// Falling
	else if(!rope->isShooting() && !rope->isAttached()) {

		// Going towards the player
		const float length2 = (playerpos - rope->hookPos()) . GetLength2();
		const float ropeRestLength = (float)(int)cClient->getGameLobby()[FT_RopeRestLength];
		if(length2 > ropeRestLength * ropeRestLength) {

			// Pull the hook back towards the player
			CVec d = playerpos - rope->hookPos();
			if(length2) d *= (float)(1.0f/sqrt(length2)); // normalize

			force += (d*10000)*dt;
		}

		rope->hookVelocity() += force * dt;
		rope->hookPos() += rope->hookVelocity() * dt;
	}


	bool outsideMap = false;

	// Hack to see if the hook went out of the game.gameMap()
	if(!rope->isPlayerAttached() && !wrapAround)
		if(
			rope->hookPos().get().x <= 0 || rope->hookPos().get().y <= 0 ||
			rope->hookPos().get().x >= game.gameMap()->GetWidth()-1 ||
			rope->hookPos().get().y >= game.gameMap()->GetHeight()-1) {
		rope->Attach();

		// Make the hook stay at an edge
		rope->hookPos().write().x = ( MAX((float)0, rope->hookPos().get().x) );
		rope->hookPos().write().y = ( MAX((float)0, rope->hookPos().get().y) );

		rope->hookPos().write().x = ( MIN(game.gameMap()->GetWidth()-(float)1, rope->hookPos().get().x) );
		rope->hookPos().write().y = ( MIN(game.gameMap()->GetHeight()-(float)1, rope->hookPos().get().y) );

		outsideMap = true;
	}


	// Check if the hook has hit anything on the game.gameMap()
	if(!rope->isPlayerAttached()) {
		rope->setAttached( false );

		VectorD2<long> wrappedHookPos = rope->hookPos().get();
		MOD(wrappedHookPos.x, (long)game.gameMap()->GetWidth());
		MOD(wrappedHookPos.y, (long)game.gameMap()->GetHeight());

		const Material& px = game.gameMap()->getMaterial((uint)wrappedHookPos.x, (uint)wrappedHookPos.y);
		if(!px.particle_pass || outsideMap) {
			if(!outsideMap && !px.can_hook) {
				rope->hookVelocity() = CVec(0,0);
				rope->setShooting( false );
			}
			else {
				rope->Attach();

				if(px.destroyable && firsthit) {
					Color col = game.gameMap()->getColorAt(wrappedHookPos.x, wrappedHookPos.y);
					for( short i=0; i<5; i++ )
						SpawnEntity(ENT_PARTICLE,0, rope->hookPos() + CVec(0,2), GetRandomVec()*40,col,NULL);
				}
			}
		}
	}

	rope->checkForWormAttachment();
}
void nativeAim(CWorm*m_worm,int bits){
 struct Key{bool down;bool isDown(){return down;}}cUp{bool(bits&4)},cDown{bool(bits&8)};
 bool tUp=false,tDown=false,mouseControl=false;float mouseSensity=0;int mouse_dy=0;
 struct DT{float seconds(){return nativeDT;}}dt;
 // BEGIN verbatim CWormHuman.cpp angle block
	{
		float aimMaxSpeed = MAX((float)fabs(tLXOptions->fAimMaxSpeed), 20.0f); // Note: 100 was LX56 max aimspeed
		float aimAccel = MAX((float)fabs(tLXOptions->fAimAcceleration), 100.0f); // HINT: 500 is the LX56 value here (rev 1)
		float aimFriction = CLAMP(tLXOptions->fAimFriction, 0.0f, 1.0f); // we didn't had that in LX56; it behaves more natural
		bool aimLikeLX56 = tLXOptions->bAimLikeLX56;
		if(cClient->getGameLobby()[FT_ForceLX56Aim] || cClient->getServerVersion() < OLXRcVersion(0,58,3)) {
			aimMaxSpeed = 100;
			aimAccel = 500;
			aimLikeLX56 = true;
		}

		if(cUp.isDown() || tUp) { // Up
			m_worm->fAngleSpeed -= aimAccel * dt.seconds();
			if(!aimLikeLX56) CLAMP_DIRECT(m_worm->fAngleSpeed, -aimMaxSpeed, aimMaxSpeed);
		} else if(cDown.isDown() || tDown) { // Down
			m_worm->fAngleSpeed += aimAccel * dt.seconds();
			if(!aimLikeLX56) CLAMP_DIRECT(m_worm->fAngleSpeed, -aimMaxSpeed, aimMaxSpeed);
		} else {
			if(!mouseControl) {
				// HINT: this is the original order and code (before mouse patch - rev 1007)
				CLAMP_DIRECT(m_worm->fAngleSpeed, -aimMaxSpeed, aimMaxSpeed);
				if(aimLikeLX56) REDUCE_CONST(m_worm->fAngleSpeed, 200*dt.seconds());
				else m_worm->fAngleSpeed *= powf(aimFriction, dt.seconds() * 100.0f);
				RESET_SMALL(m_worm->fAngleSpeed, 5.0f);

			} else { // mouseControl for angle
				// HINT: to behave more like keyboard, we use CLAMP(..aimAccel) here
				float diff = mouse_dy * mouseSensity;
				CLAMP_DIRECT(diff, -aimAccel, aimAccel); // same limit as keyboard
				m_worm->fAngleSpeed += diff * dt.seconds();

				// this tries to be like keyboard where this code is only applied if up/down is not pressed
				if(abs(mouse_dy) < 5) {
					CLAMP_DIRECT(m_worm->fAngleSpeed, -aimMaxSpeed, aimMaxSpeed);
					if(aimLikeLX56) REDUCE_CONST(m_worm->fAngleSpeed, 200*dt.seconds());
					else m_worm->fAngleSpeed *= powf(aimFriction, dt.seconds() * 100.0f);
					RESET_SMALL(m_worm->fAngleSpeed, 5.0f);
				}
			}
		}

		m_worm->fAngle += m_worm->fAngleSpeed * dt.seconds();
		if(CLAMP_DIRECT(m_worm->fAngle.write(), -90.0f, cClient->getGameLobby()[FT_FullAimAngle] ? 90.0f : 60.0f) != 0)
			m_worm->fAngleSpeed = 0;
	}
}
void nativeMovement(CWorm*worm){float dt=nativeDT;const State*ws=&worm->tState.get();
// BEGIN verbatim PhysicsLX56.cpp movement branch
	if(!(bool)cClient->getGameLobby()[FT_GusanosWormPhysics]) {
		// Process the moving
		if(ws->bMove) {
			const bool onGround = worm->isOnGround();
			const float speed = onGround ? (float)cClient->getGameLobby()[FT_WormGroundSpeed] : (float)cClient->getGameLobby()[FT_WormAirSpeed];
			const float maxspeed = onGround ? (float)cClient->getGameLobby()[FT_WormMaxGroundMoveSpeed] : (float)cClient->getGameLobby()[FT_WormMaxAirMoveSpeed];

			if(worm->getMoveDirectionSide() == DIR_RIGHT) {
				// Right
				if(worm->velocity().get().x < maxspeed)
					worm->velocity().write().x += speed * dt * 90.0f;
			} else {
				// Left
				if(worm->velocity().get().x > -maxspeed)
					worm->velocity().write().x -= speed * dt * 90.0f;
			}
		}


		// Process the jump
		bool jumped = false;
		{
			const bool onGround = worm->CheckOnGround();
			const float jumpForce = cClient->getGameLobby()[FT_WormJumpForce];

			if( onGround )
				worm->setLastAirJumpTime(AbsTime());
			if(ws->bJump && ( onGround || worm->canAirJump() ||
				( bool(cClient->getGameLobby()[FT_RelativeAirJump]) && GetPhysicsTime() >
					worm->getLastAirJumpTime() + float( cClient->getGameLobby()[FT_RelativeAirJumpDelay] ) ) ))
			{
				if( onGround )
					worm->velocity().write().y = jumpForce;
				else {
					// GFX effect, as in TeeWorlds (we'll change velocity after that)
					SpawnEntity(ENT_SPARKLE, 10, worm->getPos() + CVec( 0, 4 ), worm->velocity() + CVec( 0, 40 ), Color(), NULL );
					SpawnEntity(ENT_SPARKLE, 10, worm->getPos() + CVec( 2, 4 ), worm->velocity() + CVec( 20, 40 ), Color(), NULL );
					SpawnEntity(ENT_SPARKLE, 10, worm->getPos() + CVec( -2, 4 ), worm->velocity() + CVec( -20, 40 ), Color(), NULL );

					if( !(bool)cClient->getGameLobby()[FT_JumpToAimDir] && worm->canAirJump() && worm->velocity().get().y > jumpForce ) // Negative Y coord = moving up
						worm->velocity().write().y = jumpForce; // Absolute velocity - instant air jump
					else {
						CVec dir = (bool)cClient->getGameLobby()[FT_JumpToAimDir] ? -worm->getFaceDirection() : CVec(0.0f,1.0f);
						worm->velocity() += dir * jumpForce; // Relative velocity - relative air jump
					}
				}
				worm->setLastAirJumpTime(GetPhysicsTime());
				worm->setOnGround( false );
				jumped = true;
			}
		}

		{
			// Air drag (Mainly to dampen the ninja rope)
			const float Drag = cClient->getGameLobby()[FT_WormAirFriction];

			if(!worm->isOnGround())	{
				worm->velocity().write().x -= SQR(worm->velocity().get().x) * SIGN(worm->velocity().get().x) * Drag * dt;
				worm->velocity().write().y += -SQR(worm->velocity().get().y) * SIGN(worm->velocity().get().y) * Drag * dt;
			}
		}

		// Gravity
		worm->velocity().write().y += (float)cClient->getGameLobby()[FT_WormGravity] * dt;

		{
			const float friction = cClient->getGameLobby()[FT_WormFriction];
			if(friction > 0) {
				static const float wormSize = 5.0f;
				static const float wormMass = (wormSize/2) * (wormSize/2) * (float)PI;
				static const float wormDragCoeff = 0.1f; // Note: Never ever change this! (Or we have to make this configureable)
				applyFriction(worm->velocity().write(), dt, wormSize, wormMass, wormDragCoeff, friction);
			}
		}


		// Check collisions and move
		moveAndCheckWormCollision( GetPhysicsTime(), dt, worm, worm->getPos(), &worm->velocity().write(), worm->getPos(), jumped );


		// Ultimate in friction
		if(worm->isOnGround()) {
			worm->velocity().write().x *= 1.0f - float(cClient->getGameLobby()[FT_WormGroundFriction]);

			// Too slow, just stop
			if(fabs(worm->velocity().get().x) < (float)cClient->getGameLobby()[FT_WormGroundStopSpeed] && !ws->bMove)
				worm->velocity().write().x = 0;
		}
	}

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
