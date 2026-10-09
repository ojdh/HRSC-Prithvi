// Team formations: up to ten markers on a vertical pitch, saved per team. x and y are fractions of the
// pitch (0 is the left touchline and the top goal line, 1 the right and bottom), so a layout looks the same
// at every screen size. A slot is a squad player (playerId) or a placeholder name (label), never both.
// This module has no imports, so the server, the browser and the model tests share it as it is.
export const FORMATION_LIMITS={slots:10,formations:10,name:40,label:30} as const;
// A point on the pitch as fractions, like a marker's x and y.
export type PitchPoint={x:number;y:number};
// A movement arrow runs from its player to where they should go: an attacking run or a defensive one.
export type RunKind='attack'|'defend';
export const RUN_KINDS:readonly RunKind[]=['attack','defend'];
// former marks, on read only, a squad slot whose player has since left the team or been archived. attack and
// defend are the arrowheads of the player's runs; formations saved before arrows have neither.
export type FormationSlot={id:string;playerId:string|null;label:string|null;x:number;y:number;attack?:PitchPoint|null;defend?:PitchPoint|null;former?:boolean};
export type Formation={id:string;name:string;slots:FormationSlot[];updatedBy:string;updatedAt:number};
// Where new markers go, in order: the goalkeeper at the bottom, then defence, midfield and attack.
export const SPOTS:readonly (readonly [number,number])[]=[[0.5,0.9],[0.2,0.72],[0.4,0.75],[0.6,0.75],[0.8,0.72],[0.3,0.5],[0.5,0.52],[0.7,0.5],[0.35,0.27],[0.65,0.27]];
// How far one arrow-key press moves a focused marker.
export const KEY_STEP=0.02;
// A touch or pen held this long without moving opens a marker's menu; moving further than slop pixels first is a drag.
export const LONG_PRESS={ms:800,slop:8} as const;
// How far up (attack) or down (defence) the pitch a new arrow starts while it is aimed.
const AIM_STEP=0.15;
// Arrowhead length and half-width, in metres.
const HEAD={length:2.2,halfWidth:1.21};
const MOVES:Record<string,[number,number]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};

export function roundFraction(value:number){return Math.round(value*1000)/1000}
// A position kept on the pitch and rounded to 3 decimals.
export function pitchFraction(value:number){return roundFraction(Math.min(1,Math.max(0,value)))}
// Where a dragged marker lands: the pointer's position within the pitch's on-screen rectangle.
export function pointerSpot(clientX:number,clientY:number,rect:{left:number;top:number;width:number;height:number}){
  return {x:pitchFraction((clientX-rect.left)/rect.width),y:pitchFraction((clientY-rect.top)/rect.height)};
}
// The position an arrow key moves a marker to, or null for any other key.
export function nudge({x,y}:{x:number;y:number},key:string){
  const move=MOVES[key];
  return move?{x:pitchFraction(x+move[0]*KEY_STEP),y:pitchFraction(y+move[1]*KEY_STEP)}:null;
}
// What a press on a marker has become after heldMs with the pointer dx,dy pixels from where it went down. A mouse
// opens the menu with right-click instead, so it only ever drags.
export function pressIntent(pointerType:string,heldMs:number,dx:number,dy:number):'pending'|'drag'|'menu'{
  if(Math.hypot(dx,dy)>LONG_PRESS.slop)return 'drag';
  return pointerType!=='mouse'&&heldMs>=LONG_PRESS.ms?'menu':'pending';
}
export function validLabel(label:string){return label.length>=1&&label.length<=FORMATION_LIMITS.label}
export function canAdd(slots:FormationSlot[]){return slots.length<FORMATION_LIMITS.slots}
// Adds a squad player or a trimmed placeholder name at the first default spot nobody stands on. Returns the
// slots unchanged when the formation is full, the player is already on it, or the name is empty or too long.
export function addSlot(slots:FormationSlot[],who:{playerId:string}|{label:string},id:string):FormationSlot[]{
  const playerId='playerId' in who?who.playerId:null,label='label' in who?who.label.trim():null;
  if(!canAdd(slots)||(playerId!==null&&slots.some(s=>s.playerId===playerId))||(label!==null&&!validLabel(label)))return slots;
  const [x,y]=SPOTS.find(([sx,sy])=>!slots.some(s=>s.x===sx&&s.y===sy))??SPOTS[slots.length%SPOTS.length];
  return [...slots,{id,playerId,label,x,y}];
}
export function removeSlot(slots:FormationSlot[],id:string){return slots.filter(s=>s.id!==id)}
// Gives one player's run of this kind an arrowhead, kept on the pitch, replacing any it had.
export function setRun(slots:FormationSlot[],id:string,kind:RunKind,to:PitchPoint):FormationSlot[]{
  const head={x:pitchFraction(to.x),y:pitchFraction(to.y)};
  return slots.map(s=>s.id===id?{...s,[kind]:head}:s);
}
export function clearRuns(slots:FormationSlot[],id:string){return slots.map(s=>s.id===id?{...s,attack:null,defend:null}:s)}
export function hasRuns(slot:FormationSlot){return !!(slot.attack||slot.defend)}
// Where an arrowhead starts while it is aimed: where it already is, else a step towards the opponents' goal (the
// top) for an attacking run or towards our own for a defensive one.
export function aimStart(slot:FormationSlot,kind:RunKind):PitchPoint{
  return slot[kind]??{x:slot.x,y:pitchFraction(slot.y+(kind==='attack'?-AIM_STEP:AIM_STEP))};
}
// An arrow from a player to its head, in pitch metres (as PITCH_MARKINGS), for the SVG and the shared image alike:
// the line stops where the head begins so a dashed line never shows through it. null when the head is on the player.
export function runArrow(from:PitchPoint,to:PitchPoint){
  const x1=from.x*PITCH.width,y1=from.y*PITCH.length,x2=to.x*PITCH.width,y2=to.y*PITCH.length,length=Math.hypot(x2-x1,y2-y1);
  if(length===0)return null;
  const ux=(x2-x1)/length,uy=(y2-y1)/length,head=Math.min(HEAD.length,length),width=HEAD.halfWidth*head/HEAD.length;
  const bx=x2-ux*head,by=y2-uy*head,m=(v:number)=>Math.round(v*100)/100;
  return {line:[m(x1),m(y1),m(bx),m(by)] as const,head:[[m(x2),m(y2)],[m(bx+uy*width),m(by-ux*width)],[m(bx-uy*width),m(by+ux*width)]] as const};
}
// The squad players not yet on the pitch, for the add-a-player picker.
export function unplaced<P extends {id:string}>(players:P[],slots:FormationSlot[]){return players.filter(p=>!slots.some(s=>s.playerId===p.id))}
// Up to two initials, for a marker without a photo.
export function initials(name:string){return name.trim().split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase()||'?'}
export function shareFileName(team:string,name:string){const slug=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');return `formation-${team}${slug?'-'+slug:''}.png`}
// The pitch in metres, drawn the same way on screen (SVG) and in the shared image (canvas). The margin leaves
// room for the goals behind each goal line; markers are placed on the field inside it.
export const PITCH={width:68,length:105,margin:4} as const;
export const PITCH_MARKINGS={
  rects:[[0,0,68,105],[13.84,0,40.32,16.5],[24.84,0,18.32,5.5],[13.84,88.5,40.32,16.5],[24.84,99.5,18.32,5.5],[30.34,-2,7.32,2],[30.34,105,7.32,2]],
  lines:[[0,52.5,68,52.5]],
  circles:[[34,52.5,9.15]],
  spots:[[34,52.5],[34,11],[34,94]],
} as const;
