import type { Player, World } from "./simulation.js";
import type { FuseLevel } from "../levels/index.js";

interface FlyingObject {
  x: number;
  y: number;
  vx: number;
  vy: number;
}
interface Tire extends FlyingObject {
  lastRow: number;
}
interface Bat extends FlyingObject {
  targetX: number;
  targetY: number;
  turnAt: number;
  elapsed: number;
}
export interface Hazards {
  bat: Bat | null;
  tire: Tire | null;
  batClock: number;
  tireClock: number;
}
export function createHazards(): Hazards {
  return {bat:null, tire:null, batClock:0, tireClock:0};
}
export function blastBat(hazards: Hazards) {
  hazards.bat = null;
  hazards.batClock = 0;
}
type Solid = (column:number,row:number)=>boolean;
type Random = () => number;
export const hazardDelay = (frequency:number) => frequency === 0 ? 0 : (101-frequency)*13+250;
const roll = (random:Random, range:number) => (random() & 0x7fff) % range;

function target(bat:Bat, solid:Solid, random:Random) {
  bat.targetX = bat.targetX === 630 ? 10 : 630;
  bat.targetY = Math.floor(roll(random,400)/16)*16;
  const col = Math.floor(bat.targetX/32);
  for (let tries=0; tries<25 && solid(col, bat.targetY/16); tries++) {
    bat.targetY = (bat.targetY+16)%400;
  }
  bat.turnAt = 800 + roll(random,400);
  bat.elapsed = 0;
  bat.vx = bat.targetX === 630 ? 2 : -2;
}

function fly(bat:Bat, solid:Solid, random:Random) {
  const direction = bat.y < bat.targetY ? 1 : -1;
  const nearRow = Math.floor((bat.y + (direction > 0 ? 12 : 0))/16) + direction;
  const blocked = [bat.x+10,bat.x+38].some(x => solid(Math.floor(x/32),nearRow));
  const acceleration = direction * (blocked ? -0.75 : 0.5);
  bat.vy = Math.max(-3, Math.min(3, bat.vy + acceleration));
  bat.x += bat.vx;
  bat.y = Math.max(0, Math.min(402, bat.y + bat.vy));
  bat.elapsed++;
  if ((Math.abs(bat.x-bat.targetX) < 50 && Math.abs(bat.y-bat.targetY)<50) || bat.elapsed >= bat.turnAt) target(bat,solid,random);
  if (bat.x < -48 || bat.x > 640) {
    bat.x = Math.max(-48,Math.min(640,bat.x));
    bat.vx = bat.x < 0 ? 2 : -2;
  }
}

function bounce(tire:Tire, gravity:number, solid:Solid, random:Random) {
  tire.x += tire.vx;
  tire.y += tire.vy;
  const row = Math.floor((tire.y+48)/16);
  const onTile = row >= 0 && row <= 26 &&
    (solid(Math.floor((tire.x+9)/32),row) || solid(Math.floor((tire.x+39)/32),row));
  if (onTile && row > tire.lastRow + 1 && tire.vy >= 0) {
    tire.y = row*16 - 50;
    tire.vy = -(tire.vy - Math.floor(tire.vy*4)/16);
    tire.lastRow = row;
    if (Math.abs(tire.vx)<=1) tire.vx = roll(random,320) < 160 ? -2 : 2;
  } else if (tire.vy < 15) {
    tire.vy += (Math.floor(gravity/2)+4)/16;
  }
  if (tire.x < -24) tire.x = 616;
  else if (tire.x > 639) tire.x = -20;
}

export function stepHazards(world:World,level:FuseLevel,damage:(player:Player)=>void,solid:Solid,random:Random) {
  const h=world.hazards;
  const batPeriod=hazardDelay(level.batFrequency);
  const tirePeriod=hazardDelay(level.tireFrequency);
  if (!h.bat && batPeriod && ++h.batClock>batPeriod) {
    const fromLeft=roll(random,50)<25;
    h.bat={x:fromLeft?-33:640,y:roll(random,320)+1,vx:fromLeft?2:-2,vy:0,
      targetX:fromLeft?10:630,targetY:16,turnAt:500,elapsed:0};
    target(h.bat,solid,random);
    h.batClock=0;
  }
  if (!h.tire && tirePeriod && ++h.tireClock>tirePeriod) {
    h.tire={x:50+roll(random,540),y:roll(random,50)-99,vx:(roll(random,64)-31)/16,vy:0,lastRow:-3};
    h.tireClock=0;
  }
  if (h.bat) fly(h.bat,solid,random);
  if (h.tire) {
    bounce(h.tire,level.physics.gravity,solid,random);
    if(h.tire.y+48>550) h.tire=null;
  }
  for(const p of world.players) {
    if (!p.lives || p.respawn!=="active") continue;
    const touches=(obj:FlyingObject,height:number) => p.x+10>obj.x+8 && p.x-10<obj.x+40 && p.y-5>obj.y+2 && p.y-34<obj.y+height-2;
    if((h.bat && touches(h.bat,12)) || (h.tire && touches(h.tire,48))) damage(p);
  }
}

const record = (value:unknown):value is Record<string,unknown> => !!value && typeof value==="object" && !Array.isArray(value);
const integer=(n:unknown,min:number,max:number) => typeof n==="number" && Number.isInteger(n) && n>=min && n<=max;
const fixed=(n:unknown,min:number,max:number) => typeof n==="number" && integer(n*16,min*16,max*16);
function body(obj:unknown):obj is Record<string,unknown> {
  return record(obj) && fixed(obj.x,-50,650) && fixed(obj.y,-110,550) && fixed(obj.vx,-8,8) && fixed(obj.vy,-20,20);
}
export function validHazards(value:unknown):value is Hazards {
  if(!record(value) || Object.keys(value).length!==4 || !integer(value.batClock,0,2000) || !integer(value.tireClock,0,2000)) return false;
  const {bat,tire}=value;
  return (tire===null || (body(tire) && Object.keys(tire).length===5 && integer(tire.lastRow,-3,26))) &&
    (bat===null || (body(bat) && Object.keys(bat).length===8 && (bat.targetX===10 || bat.targetX===630) &&
      integer(bat.targetY,0,384) && integer(bat.turnAt,500,1199) && integer(bat.elapsed,0,1199)));
}
