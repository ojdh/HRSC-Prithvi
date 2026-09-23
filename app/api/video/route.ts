import {env} from 'cloudflare:workers';
import {getUser} from '../../auth';
import {ClubError,check,readClub,saveClub} from '@/lib/server-club';
import type {Highlight} from '@/lib/club';
export const dynamic='force-dynamic';
function failure(e:unknown){console.error('Video request failed',e instanceof Error?e.message:'unknown');return Response.json({error:e instanceof ClubError?e.message:'The video could not be saved. Please try again.'},{status:e instanceof ClubError?e.status:503});}
function mime(bytes:Uint8Array){
  if(new TextDecoder().decode(bytes.slice(4,8))==='ftyp')return 'video/mp4';
  if(bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3)return 'video/webm';
  return null;
}
export async function POST(req:Request){let key:string|undefined;try{
  check(req.headers.get('origin')===new URL(req.url).origin,'Invalid origin.',403);
  const user=await getUser();check(user,'Sign in first.',401);check(env.BUCKET,'Video storage is unavailable.');
  check((Number(req.headers.get('content-length'))||0)<25000000,'Choose a clip smaller than 20 MB.');
  const form=await req.formData(),file=form.get('video'),target=form.get('target');
  check(file instanceof File&&file.size>0&&file.size<=20*1024*1024,'Choose an MP4 or WebM clip under 20 MB.');
  const bytes=new Uint8Array(await file.arrayBuffer()),type=mime(bytes);check(type,'Choose a playable MP4 or WebM clip.');
  const stored=await readClub();check(stored,'Club not found.',404);
  const player=stored.club.players.find(p=>p.userId===user.userId&&p.active!==false),admin=stored.club.adminId===user.userId;
  check(player||admin,'Connect your player profile first.',403);
  const kind=String(form.get('kind')||'Other') as Highlight['kind'];
  check(['Goal','Assist','Save','Skill','Foul','Other'].includes(kind),'Choose a highlight type.');
  const note=String(form.get('note')||'').trim();check(note.length<=100,'Keep the clip caption under 100 characters.');
  const day=target==='matchday'?stored.club.days.find(d=>d.id===form.get('dayId')):null;
  check(target==='profile'||target==='matchday','Choose a profile or matchday clip.');
  if(target==='matchday')check(admin&&day,'Only the organiser can add matchday footage.',403);
  const profile=target==='profile'?stored.club.players.find(p=>p.id===form.get('playerId')&&p.active!==false):null;
  if(target==='profile')check(admin&&profile,'Only the organiser can add clips to active player profiles.',403);
  if(target==='profile')check((profile?.highlights?.length||0)<12,'A player profile can hold up to twelve clips.');
  key='videos/'+crypto.randomUUID();const previous=day?.videoKey;
  await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:type}});
  if(day)day.videoKey=key;
  else profile!.highlights=[...(profile!.highlights||[]),{id:crypto.randomUUID(),key,kind,note}];
  await saveClub(stored.club,stored.revision);
  if(previous)await env.BUCKET.delete(previous).catch(()=>{});
  return Response.json({ok:true});
}catch(e){if(key&&env.BUCKET)await env.BUCKET.delete(key).catch(()=>{});return failure(e);}}

export async function GET(req:Request){try{
  const user=await getUser();check(user,'Sign in first.',401);
  const stored=await readClub();check(stored?.club.players.some(p=>p.userId===user.userId&&p.active!==false)||stored?.club.adminId===user.userId,'Club membership required.',403);
  const key=new URL(req.url).searchParams.get('key');check(key&&/^videos\/[a-f0-9-]{36}$/.test(key),'Video not found.',404);
  check(stored,'Club unavailable.',404);
  check(stored.club.days.some(d=>d.videoKey===key)||stored.club.players.some(p=>p.highlights?.some(h=>h.key===key)),'Video not found.',404);
  check(env.BUCKET,'Video storage is unavailable.');
  const range=req.headers.get('range');let options:{range:{offset:number;length:number}}|undefined;
  if(range){const m=/^bytes=(\d+)-(\d*)$/.exec(range);check(m,'Unsupported video range.',416);
    const start=Number(m[1]),end=m[2]?Number(m[2]):start+1024*1024-1;
    check(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&end>=start,'Invalid video range.',416);
    options={range:{offset:start,length:Math.min(end-start+1,1024*1024)}};
  }
  const object=await env.BUCKET.get(key,options);check(object,'Video not found.',404);
  const common={'Content-Type':object.httpMetadata?.contentType||'video/mp4','Accept-Ranges':'bytes','Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'};
  if(options){const start=options.range.offset;check(start<object.size,'Range is past the end of this video.',416);const end=Math.min(start+options.range.length,object.size)-1;
    return new Response(object.body,{status:206,headers:{...common,'Content-Range':`bytes ${start}-${end}/${object.size}`,'Content-Length':String(end-start+1)}});}
  return new Response(object.body,{headers:{...common,'Content-Length':String(object.size)}});
}catch(e){return new Response('Video unavailable',{status:e instanceof ClubError?e.status:503});}}

export async function DELETE(req:Request){try{
  check(req.headers.get('origin')===new URL(req.url).origin,'Invalid origin.',403);
  const user=await getUser();check(user,'Sign in first.',401);
  const stored=await readClub();check(stored,'Club not found.',404);
  const key=new URL(req.url).searchParams.get('key');check(key&&/^videos\/[a-f0-9-]{36}$/.test(key),'Video not found.',404);
  const admin=stored.club.adminId===user.userId;
  const day=stored.club.days.find(d=>d.videoKey===key);
  const owner=stored.club.players.find(p=>p.highlights?.some(h=>h.key===key));
  check(admin&&(day||owner),'Only the organiser can remove videos.',403);
  if(day)day.videoKey=null;
  if(owner)owner.highlights=owner.highlights!.filter(h=>h.key!==key);
  await saveClub(stored.club,stored.revision);await env.BUCKET?.delete(key).catch(()=>{});
  return Response.json({ok:true});
}catch(e){return failure(e);}}
