import { env } from 'cloudflare:workers';
import { getUser } from '../../auth';
import { readClub,saveClub,check,ClubError } from '@/lib/server-club';
export const dynamic='force-dynamic';
export async function POST(req:Request){let key:string|undefined;try{
  check(req.headers.get('origin')===new URL(req.url).origin,'Invalid origin.',403);
  const user=await getUser();check(user,'Sign in first.',401);check(env.BUCKET,'Photo uploads are temporarily unavailable.');
  check((Number(req.headers.get('content-length'))||0)<2300000,'Please choose a photo smaller than 2 MB.');
  const stored=await readClub();const player=stored?.club.players.find(p=>p.userId===user.userId&&p.active!==false);check(stored&&player,'Connect your active player profile first.',403);
  const form=await req.formData();const file=form.get('photo');check(file instanceof File&&file.size>0&&file.size<=2097152,'Choose a JPG, PNG or WebP photo up to 2 MB.');
  const bytes=new Uint8Array(await file.arrayBuffer());let type='';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)type='image/jpeg';
  if([137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b))type='image/png';
  if(new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP')type='image/webp';
  check(type,'Only JPG, PNG and WebP images are supported.');key='players/'+crypto.randomUUID();const previous=player.photo;
  await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:type}});player.photo=key;await saveClub(stored.club,stored.revision);if(previous)await env.BUCKET.delete(previous).catch(()=>{});
  return Response.json({ok:true});
}catch(e){console.error('Photo upload failed',e instanceof Error?e.message:'unknown');if(key&&env.BUCKET)await env.BUCKET.delete(key).catch(()=>{});return Response.json({error:e instanceof ClubError?e.message:'The upload did not finish. Please try again.'},{status:e instanceof ClubError?e.status:503});}}
export async function GET(req:Request){try{
  const user=await getUser();check(user,'Sign in first.',401);const stored=await readClub();check(stored?.club.players.some(p=>p.userId===user.userId&&p.active!==false),'Only club members can view photos.',403);const key=new URL(req.url).searchParams.get('key');check(key&&/^players\/[a-f0-9-]{36}$/.test(key),'Photo not found.',404);
  const object=await env.BUCKET?.get(key);check(object,'Photo not found.',404);return new Response(object.body,{headers:{'Content-Type':object.httpMetadata?.contentType||'image/jpeg','Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'}});
}catch(e){return new Response('Photo unavailable',{status:e instanceof ClubError?e.status:503});}}
