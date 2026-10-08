import { getUser } from '../../auth';
import { readClub,saveClub,check,role,ClubError } from '@/lib/server-club';
import { TEAMS,type Team } from '@/lib/club';
import { deleteObject,getObject,putObject } from '@/lib/r2-budget';
export const dynamic='force-dynamic';
export async function POST(req:Request){let key:string|undefined;try{
  check(req.headers.get('origin')===new URL(req.url).origin,'Invalid origin.',403);
  const user=await getUser();check(user,'Sign in first.',401);
  check((Number(req.headers.get('content-length'))||0)<2300000,'Please choose a photo smaller than 2 MB.');
  const stored=await readClub();check(stored,'Club not found.',404);const form=await req.formData();const file=form.get('photo'),target=form.get('target')==='team'?'team':'player';
  const player=stored.club.players.find(p=>p.userId===user.userId&&p.active!==false),team=form.get('team') as Team;
  if(target==='team'){check(role(stored.club,user.userId).admin,'Only club admins can change team photos.',403);check(TEAMS.includes(team),'Team not found.');}else check(player,'Connect your active player profile first.',403);check(file instanceof File&&file.size>0&&file.size<=2097152,'Choose a JPG, PNG or WebP photo up to 2 MB.');
  const bytes=new Uint8Array(await file.arrayBuffer());let type='';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)type='image/jpeg';
  if([137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b))type='image/png';
  if(new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP')type='image/webp';
  check(type,'Only JPG, PNG and WebP images are supported.');const owner=target==='team'?stored.club.teams[team]:player!,previous=owner.photo,photoKey=(target==='team'?'teams/':'players/')+crypto.randomUUID();
  await putObject(photoKey,bytes,type);key=photoKey;owner.photo=key;await saveClub(stored.club,stored.revision);if(previous)await deleteObject(previous);
  return Response.json({ok:true});
}catch(e){console.error('Photo upload failed',e instanceof Error?e.message:'unknown');if(key)await deleteObject(key);return Response.json({error:e instanceof ClubError?e.message:'The upload did not finish. Please try again.'},{status:e instanceof ClubError?e.status:503});}}
export async function GET(req:Request){try{
  const user=await getUser();check(user,'Sign in first.',401);const stored=await readClub();check(stored?.club.players.some(p=>p.userId===user.userId&&p.active!==false),'Only club members can view photos.',403);const key=new URL(req.url).searchParams.get('key');check(key&&/^(players|teams)\/[a-f0-9-]{36}$/.test(key),'Photo not found.',404);
  const object=await getObject(key);check(object,'Photo not found.',404);return new Response(object.body,{headers:{'Content-Type':object.httpMetadata?.contentType||'image/jpeg','Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'}});
}catch(e){return new Response('Photo unavailable',{status:e instanceof ClubError?e.status:503});}}
export async function DELETE(req:Request){try{
  check(req.headers.get('origin')===new URL(req.url).origin,'Invalid origin.',403);
  const user=await getUser();check(user,'Sign in first.',401);const stored=await readClub();check(stored,'Club not found.',404);
  check(role(stored.club,user.userId).admin,'Only club admins can change team photos.',403);
  const team=new URL(req.url).searchParams.get('team') as Team;check(TEAMS.includes(team),'Team not found.');const previous=stored.club.teams[team].photo;check(previous,'This team has no photo.');
  stored.club.teams[team].photo=null;await saveClub(stored.club,stored.revision);await deleteObject(previous);return Response.json({ok:true});
}catch(e){return Response.json({error:e instanceof ClubError?e.message:'The photo could not be removed. Please try again.'},{status:e instanceof ClubError?e.status:503});}}
