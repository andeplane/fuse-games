/* Reference extraction from OpenLieroX 0a20c6d0a10ed63b28a15f05c771913c294efbf6.
 * Code under LGPL; Jason Boettcher, Dark Charlie, Albert Zeyer.
 * Altered only to remove SDL/world dependencies and emit observable numeric fixtures.
 * Sources: PhysicsLX56_Projectiles.cpp checkCollAndMove_Frame, CProjectile::Spawn,
 * CalculateCheckSteps and Bounce, PhysicsLX56.cpp simulateWormWeapon,
 * Proj_LX56Timer::checkEvent; Game.cpp fixed-frame loop; CClient_Game.cpp
 * Simulation/PlayerShoot/ProcessShot_Beam; CServer_Game.cpp WormShoot.
 * Build: c++ -std=c++17 -O0 -ffp-contract=off classic-combat-native.cpp -o /tmp/fusero-combat-native
 */
#include <cmath>
#include <iomanip>
#include <iostream>
#include "classic-random-native.h"
// Exact cursor/count behavior from src/util/VecTimeRecorder.h (float data is sufficient here).
struct Recorder {
  float data[100]{};size_t cursor=0,count=0;
  void push(float d){data[cursor]=d;cursor=(cursor+1)%100;if(count<100)count++;}
  void clear(float d){count=0;push(d);}
  float get(size_t n)const{return data[(cursor+100-(n%100))%100];}
  float best(size_t ms)const{size_t n=ms/11;if(n<count)return get(n);if(count>0)return get(count-1);return data[(cursor+99)%100];}
};
struct Vec {float x,y;};
// CProjectile::Spawn's fixed-random operations, in original source order.
// Colour selection consumes the separate global rand stream, so cannot change these indices.
struct Spawned {
  int random,minimum=4,maximum=6,average=4,speed;
  float timeVar,wall;
  float getRandomFloat(){float r=RandomNumbers[random++];random%=255;return r;}
  Spawned(Vec velocity,int seed,bool bouncing=false):random(seed),timeVar(RandomNumbers[seed]) {
    // CProjectile::CalculateCheckSteps, copied operation-for-operation.
    speed=int(velocity.x*velocity.x+velocity.y*velocity.y);
    if(speed<14000){minimum=0;maximum=3;average=2;}
    else if(speed<75000){minimum=0;maximum=4;average=2;}
    else if(speed<250000){minimum=1;maximum=5;average=2;}
    else {
      int rnd=random%3;float value=getRandomFloat();rnd*=((value>0)-(value<0));minimum=6;
      if(bouncing){maximum=2;average=2;}else{maximum=9+rnd;average=6+rnd;}
    }
    wall=.011f+getRandomFloat()/1000;
  }
};
// Isolated original shared CWorm slot in a local/listen session. No transport delay,
// one outer frame per rendered frame: SendPackets at frame end, ReadPackets next start.
// Game.cpp uses10ms Game::FixedFrameTime; CClient::Simulation advances11ms separately.
struct LaserSession {
  float lastFire=0,charge=1;
  int physicsMs=0,pending=0;
  bool reloading=false;
  bool frame(int now) {
    // CClient_Parse -> ProcessServerShotList -> ProcessShot_Beam.
    while(pending>0){lastFire=.3f;pending--;}
    bool shot=false;
    while(physicsMs+11<=now){
      // PhysicsLX56.cpp simulateWormWeapon.
      const float dt=11*.001f;
      if(lastFire>0)lastFire-=dt;
      if(reloading){charge+=dt*((1.7999999523162842f/10.f)*(1.f/(100*.01f)));if(charge>=1){charge=1;reloading=false;}}
      // CServer_Game.cpp WormShoot (held trigger, alive, weapon selected).
      if(!reloading&&lastFire<=0){lastFire=.009f;pending++;shot=true;charge-=1.25f/100;if(charge<=0){charge=0;reloading=true;}}
      // CClient_Game.cpp PlayerShoot beam branch, after WormShoot, before delivery.
      if(!reloading&&lastFire>0)lastFire-=10*.001f;
      physicsMs+=11;
    }
    return shot;
  }
};
void flight(Vec& pos,Vec& velocity,float gravity,float dampening) {
  // Unchanged operation boundaries from CVec's float component operators.
  const float dt=11 * .001f;
  if(dampening!=1.0f){velocity.x*=dampening;velocity.y*=dampening;}
  velocity.y+=gravity*dt;
  pos.x+=velocity.x*dt;pos.y+=velocity.y*dt;
}
void bounce(Vec& velocity,int side,float coefficient) {
  float x=1,y=1;
  if(side&1){x=coefficient;y=-coefficient;}
  if(side&4){x=coefficient;y=-coefficient;}
  if(side&8){x=-coefficient;y=coefficient;}
  if(side&2){x=-coefficient;y=coefficient;}
  velocity.x*=x;velocity.y*=y;
}
int main(){
  std::cout<<std::setprecision(17);
  std::cout<<"{\"source\":\"0a20c6d0a10ed63b28a15f05c771913c294efbf6\",\"flight\":[";
  const float gravities[]={0,130,1};
  const float dampening[]={1.0010000467300415f,1,1};
  const Vec initialVelocity[]={{140,0},{80,-110},{700,0}};
  for(int kind=0;kind<3;kind++){
    Vec pos{100,100},velocity=initialVelocity[kind];
    for(int step=1;step<=100;step++){
      flight(pos,velocity,gravities[kind],dampening[kind]);
      if(step==1||step==10||step==100){
        if(kind||step!=1)std::cout<<",";
        std::cout<<"{\"kind\":"<<kind<<",\"step\":"<<step<<",\"x\":"<<pos.x<<",\"y\":"<<pos.y<<",\"vx\":"<<velocity.x<<",\"vy\":"<<velocity.y<<"}";
      }
    }
  }
  Vec corner{100,150};bounce(corner,1|2,.4f);
  float charge=0;for(int i=0;i<500;i++)charge+=(11*.001f)*((1.7100000381469727f/10.0f)*(1.0f/(100*.01f)));
  float life=0;int timerSteps=0;while(!(1.6430000066757202f+.14300000667572021f*(-.620216f)<life)){life+=11*.001f;timerSteps++;}
  std::cout<<"],\"cornerBounce\":{\"vx\":"<<corner.x<<",\"vy\":"<<corner.y<<"},\"bazookaChargeAfter500\":"<<charge<<",\"grenadeTimerPreSteps\":"<<timerSteps<<",\"grenadeTimerLife\":"<<life;
  Recorder record;record.push(10);record.push(20);record.push(30);
  std::cout<<",\"historyPartial\":["<<record.best(0)<<","<<record.best(11)<<","<<record.best(22)<<","<<record.best(33)<<"]";
  Recorder full;for(int i=0;i<100;i++)full.push(float(i));
  std::cout<<",\"historyFull\":["<<full.best(0)<<","<<full.best(11)<<","<<full.best(1089)<<","<<full.best(1100)<<"]";
  full.clear(500);std::cout<<",\"historyCleared\":["<<full.best(0)<<","<<full.best(11)<<"]";
  // GeneralSpawnInfo::apply on a Bazooka's collision, parent random index1 after its wallshoot draw.
  int random=1;std::cout<<",\"bazookaChildren\":[";
  for(int i=0;i<4;i++){
    float angle=RandomNumbers[random++]*360.0f;random%=255;
    float radians=angle*float(3.14159265358979323846/180);
    float x=cosf(radians),y=sinf(radians),variation=RandomNumbers[random++];random%=255;
    float vx=x*105.0f+(x*14.0f)*variation,vy=y*105.0f+(y*14.0f)*variation;
    int childRandom=(random+1)%255;
    if(i)std::cout<<",";
    std::cout<<"{\"vx\":"<<vx<<",\"vy\":"<<vy<<",\"timeVarRandom\":"<<RandomNumbers[childRandom]<<",\"randomIndex\":"<<(childRandom+1)%255<<"}";
  }
  std::cout<<"],\"rifleSpawns\":[";
  for(int seed=7;seed<=8;seed++){
  Vec pos{100,100},velocity{700,0};Spawned spawned(velocity,seed);
  if(seed!=7)std::cout<<",";
  std::cout<<"{\"seed\":"<<seed<<",\"randomIndex\":"<<spawned.random<<",\"maxCheck\":"<<spawned.maximum<<",\"avgCheck\":"<<spawned.average<<",\"wallShootTime\":"<<spawned.wall<<",\"flight\":[";
  for(int step=1;step<=10;step++){
    float speed=velocity.x*velocity.x+velocity.y*velocity.y;
    int checkMs=11;
    if(int(speed*.011f*.011f)>spawned.maximum*spawned.maximum) {
      float check=float(spawned.average)/sqrtf(speed);
      if(check<.001f)check=.001f;
      checkMs=int(check*1000.0f);
    }
    for(int time=0;time<11;time+=checkMs){
      int ms=(time+checkMs>11)?11-time:checkMs;float dt=ms*.001f;
      velocity.y+=1.0f*dt;pos.x+=velocity.x*dt;pos.y+=velocity.y*dt;
    }
    if(step==1||step==10){if(step!=1)std::cout<<",";std::cout<<"{\"step\":"<<step<<",\"x\":"<<pos.x<<",\"y\":"<<pos.y<<",\"vx\":"<<velocity.x<<",\"vy\":"<<velocity.y<<"}";}
  }
  std::cout<<"]}";
  }
  std::cout<<"],\"localLaserFrames\":[";
  LaserSession laser;
  for(int frame=0;frame<200;frame++){
    bool shot=laser.frame(frame*10);if(frame)std::cout<<",";
    std::cout<<"{\"frame\":"<<frame<<",\"physicsMs\":"<<laser.physicsMs<<",\"shot\":"<<(shot?"true":"false")<<",\"pending\":"<<laser.pending<<",\"lastFire\":"<<laser.lastFire<<",\"charge\":"<<laser.charge<<"}";
  }
  std::cout<<"]}\n";
}
