import { getUser } from '../../auth';
import { readClub,saveClub,check,role,ClubError } from '@/lib/server-club';
import { TEAMS,type Club,type Team } from '@/lib/club';
import { deleteObject,getObject,putObject } from '@/lib/r2-budget';
import { readImage } from '@/lib/server-images';
export const dynamic='force-dynamic';
export async function POST(req:Request){let key:string|undefined;try{
  check(req.headers.get('origin')===new URL(req.url).origin,'Invalid origin.',403);
  const user=await getUser();check(user,'Sign in first.',401);
  check((Number(req.headers.get('content-length'))||0)<2300000,'Please choose a photo smaller than 2 MB.');
  const stored=await readClub();check(stored,'Club not found.',404);const form=await req.formData();const file=form.get('photo'),target=form.get('target')==='team'?'team':'player';
  const player=stored.club.players.find(p=>p.userId===user.userId&&p.active!==false),team=form.get('team') as Team;
  if(target==='team'){check(role(stored.club,user.userId).admin,'Only club admins can change team photos.',403);check(TEAMS.includes(team),'Team not found.');}else check(player,'Connect your active player profile first.',403);
  const {bytes,type}=await readImage(file);const owner=target==='team'?stored.club.teams[team]:player!,previous=owner.photo,photoKey=(target==='team'?'teams/':'players/')+crypto.randomUUID();
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
  const params=new URL(req.url).searchParams,playerId=params.get('player');
  const owner=playerId===null?photoTeam(stored.club,user.userId,params.get('team')):photoPlayer(stored.club,user.userId,playerId);const previous=owner.photo;check(previous,playerId===null?'This team has no photo.':'This player has no photo.');
  owner.photo=null;await saveClub(stored.club,stored.revision);await deleteObject(previous);return Response.json({ok:true});
}catch(e){return Response.json({error:e instanceof ClubError?e.message:'The photo could not be removed. Please try again.'},{status:e instanceof ClubError?e.status:503});}}
function photoTeam(club:Club,userId:string,team:string|null){check(role(club,userId).admin,'Only club admins can change team photos.',403);check(TEAMS.includes(team as Team),'Team not found.');return club.teams[team as Team];}
// A player removes their own photo; admins can remove anyone's.
function photoPlayer(club:Club,userId:string,playerId:string){const {me,admin}=role(club,userId);check(admin||me&&me.active!==false&&me.id===playerId,'You can only remove your own photo.',403);const player=club.players.find(p=>p.id===playerId);check(player,'Player not found.',404);return player;}
