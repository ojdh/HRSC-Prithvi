// Team formations: up to ten markers on a vertical pitch, saved per team. x and y are fractions of the
// pitch (0 is the left touchline and the top goal line, 1 the right and bottom), so a layout looks the same
// at every screen size. A slot is a squad player (playerId) or a placeholder name (label), never both.
// This module has no imports, so the server, the browser and the model tests share it as it is.
export const FORMATION_LIMITS={slots:10,formations:10,name:40,label:30} as const;
// former marks, on read only, a squad slot whose player has since left the team or been archived.
export type FormationSlot={id:string;playerId:string|null;label:string|null;x:number;y:number;former?:boolean};
export type Formation={id:string;name:string;slots:FormationSlot[];updatedBy:string;updatedAt:number};
// Where new markers go, in order: the goalkeeper at the bottom, then defence, midfield and attack.
export const SPOTS:readonly (readonly [number,number])[]=[[0.5,0.9],[0.2,0.72],[0.4,0.75],[0.6,0.75],[0.8,0.72],[0.3,0.5],[0.5,0.52],[0.7,0.5],[0.35,0.27],[0.65,0.27]];
// How far one arrow-key press moves a focused marker.
export const KEY_STEP=0.02;
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
