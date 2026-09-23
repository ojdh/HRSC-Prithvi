import {digest} from './server-club';
import type {Club} from './club';
export const INVITE_COOKIE='hrsc_pending_invite';
export function pendingInvite(req:Request){const part=req.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(INVITE_COOKIE+'='));try{return part?decodeURIComponent(part.slice(INVITE_COOKIE.length+1)):''}catch{return ''}}
export function inviteCookie(value:string,secure=true){return `${INVITE_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${value?604800:0}${secure?'; Secure':''}`;}
export async function findInvitation(club:Club,value:string){if(value.length<20||value.length>150)return undefined;const hash=await digest(value);return club.players.find(p=>p.active!==false&&(p.inviteHash===hash||p.legacyInviteHash===hash));}
