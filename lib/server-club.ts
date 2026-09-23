import { env } from 'cloudflare:workers';
import type { Club } from './club';
export function db(){if(!env.DB)throw new Error('Club storage is temporarily unavailable. Please try again.');return env.DB;}
export async function readClub(){const row=await db().prepare('SELECT revision,data FROM club WHERE id=1').first<{revision:number;data:string}>();return row?{revision:row.revision,club:JSON.parse(row.data) as Club}:null;}
export async function saveClub(club:Club,revision:number){const r=await db().prepare('UPDATE club SET data=?,revision=revision+1 WHERE id=1 AND revision=?').bind(JSON.stringify(club),revision).run();if(r.meta.changes!==1)throw new ClubError('Someone just updated the club. Refresh and try again.',409);}
export class ClubError extends Error{constructor(message:string,public status=400){super(message);}}
export function check(ok:unknown,message:string,status=400):asserts ok {if(!ok)throw new ClubError(message,status);}
export async function digest(token:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(n=>n.toString(16).padStart(2,'0')).join('');}
export function token(){return crypto.randomUUID()+crypto.randomUUID();}
