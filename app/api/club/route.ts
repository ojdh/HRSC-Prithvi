import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { getUser } from '../../auth';
import { TEAMS,nextMatch,result,type Club,type Day } from '@/lib/club';
import { db,readClub,saveClub,check,digest,token,ClubError } from '@/lib/server-club';
import {pendingInvite,findInvitation,inviteCookie} from '@/lib/server-invitations';
export const dynamic='force-dynamic';
const team=z.enum(TEAMS),id=z.string().min(1).max(100);
const details=z.object({name:z.string().trim().min(1).max(60),age:z.number().int().min(5).max(100).nullable(),height:z.number().int().min(70).max(250).nullable(),district:z.string().trim().max(60).nullable(),position:z.enum(['Goalkeeper','Defender','Midfielder','Forward','All-rounder'])});
function response(value:unknown,status=200){return Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}});}
function fail(e:unknown){if(e instanceof ClubError)return response({error:e.message},e.status);if(e instanceof z.ZodError)return response({error:e.issues[0].message},400);console.error('Club request failed',e instanceof Error?e.message:'unknown');return response({error:'We could not save or load that. Please retry; your form is still here.'},503);}
export async function GET(req:Request){try{
  const user=await getUser();const stored=await readClub();
  if(!stored)return response({players:[],days:[],revision:0,initialized:false,isAdmin:false,me:null,polls:{}});
  const invited=await findInvitation(stored.club,pendingInvite(req));const invitation=invited&&!invited.userId?{name:invited.name,team:invited.team}:undefined;
  if(!user)return response({players:[],days:[],revision:0,initialized:true,isAdmin:false,me:null,polls:{},invitation});
  const {club,revision}=stored;const me=club.players.find(p=>p.userId===user.userId);
  if(!me&&club.adminId!==user.userId)return response({players:[],days:[],revision,initialized:true,isAdmin:false,me:null,polls:{},invitation});
  const polls:Record<string,unknown>={};
  const counts=(await db().prepare('SELECT day,COUNT(*) AS n FROM vote_receipts GROUP BY day').all<{day:string;n:number}>()).results;
  const mine=me?(await db().prepare('SELECT day FROM vote_receipts WHERE player=?').bind(me.id).all<{day:string}>()).results:[];
  const tallies=(await db().prepare('SELECT day,candidate,COUNT(*) AS votes FROM ballots GROUP BY day,candidate ORDER BY votes DESC,candidate').all<{day:string;candidate:string;votes:number}>()).results;
  for(const day of club.days.filter(d=>d.poll!=='ready')){
    const tally=day.poll==='closed'?tallies.filter(t=>t.day===day.id).map(({candidate,votes})=>({candidate,votes})):[];
    polls[day.id]={count:counts.find(x=>x.day===day.id)?.n??0,voted:mine.some(x=>x.day===day.id),tally};
  }
  return response({initialized:true,revision,isAdmin:club.adminId===user.userId,me:me?.id??null,players:club.players.map(({userId,inviteHash,legacyInviteHash,inviteToken,...p})=>({...p,linked:!!userId})),days:club.days,polls});
}catch(e){return fail(e);}}
export async function POST(req:Request){try{
  const origin=req.headers.get('origin');check(!origin||origin===new URL(req.url).origin,'This request must come from the club website.',403);
  check((Number(req.headers.get('content-length'))||0)<100000,'Request too large.');
  const user=await getUser();check(user,'Please sign in first.',401);
  const body=z.record(z.unknown()).parse(await req.json());const action=z.string().parse(body.action);const stored=await readClub();
  if(action==='initialize'){
    check(!stored,'The club has already been set up.',409);
    const setup=z.object({key:z.string(),name:z.string().trim().min(1).max(60),team}).parse(body);
    const secret=(env as unknown as Record<string,string>).CLUB_SETUP_KEY;
    check(secret&&await digest(setup.key)===await digest(secret),'Enter the organiser setup code supplied with your site.',403);
    const c:Club={adminId:user.userId,players:[{id:crypto.randomUUID(),name:setup.name,team:setup.team,userId:user.userId,age:null,height:null,district:null,position:'All-rounder',number:null,photo:null}],days:[]};
    const r=await db().prepare('INSERT OR IGNORE INTO club (id,revision,data) VALUES (1,0,?)').bind(JSON.stringify(c)).run();
    check(r.meta.changes===1,'The club has already been set up.',409);return response({ok:true});
  }
  check(stored,'The organiser needs to set up the club first.');const {club,revision}=stored;
  const me=club.players.find(p=>p.userId===user.userId),admin=club.adminId===user.userId;
  if(action==='vote'){
    const input=z.object({dayId:id,candidate:id}).parse(body);const day=club.days.find(d=>d.id===input.dayId);check(day&&day.poll==='open','Voting is not open for this match day.');
    const voter=day.roster.find(p=>p.id===me?.id),candidate=day.roster.find(p=>p.id===input.candidate);
    check(voter&&me?.active!==false,'Only active players marked as attending can vote.',403);check(candidate&&club.players.find(p=>p.id===candidate.id)?.active!==false&&candidate.team!==voter.team,'Choose an active player from one of the other two teams.');
    try{
      const r=await db().batch([
        db().prepare('INSERT INTO vote_receipts (day,player) SELECT ?,? WHERE EXISTS (SELECT 1 FROM club WHERE id=1 AND revision=?)').bind(day.id,me!.id,revision),
        db().prepare('INSERT INTO ballots (id,day,candidate) SELECT ?,?,? WHERE changes()=1').bind(crypto.randomUUID(),day.id,candidate.id),
      ]);
      check(r[0].meta.changes===1&&r[1].meta.changes===1,'The match day changed. Refresh and vote again.',409);
    }catch(e){if(e instanceof ClubError)throw e;if(String(e).includes('UNIQUE'))throw new ClubError('Your vote has already been recorded.',409);throw e;}
    return response({ok:true});
  }
  check(body.revision===revision,'The club was updated. Refresh before saving this change.',409);
  let extra:Record<string,unknown>={};
  if(action==='claim'){
    check(!me,'This account already has a player profile. Sign out and sign in with the invited player’s email.');
    const p=await findInvitation(club,z.string().min(20).max(150).parse(body.token||pendingInvite(req)));check(p&&!p.userId,'This invitation has already been used or is unavailable. Ask your organiser for the current link.');p.userId=user.userId;delete p.inviteHash;delete p.legacyInviteHash;delete p.inviteToken;
  }else if(action==='profile'){
    check(me&&me.active!==false,'Only an active linked player can update their profile.',403);
    const allowed=new Set(['action','revision','name','age','height','district','position']);
    check(Object.keys(body).every(key=>allowed.has(key)),'You can only update your own personal information.',403);
    Object.assign(me,details.parse(body));
  }else{
    check(admin,'Only the organiser can change match records and teams.',403);
    if(action==='addPlayer'){
      const input=details.extend({team}).parse(body);check(club.players.length<150,'The club supports up to 150 players.');
      club.players.push({...input,id:crypto.randomUUID(),active:true,photo:null});
    }else if(action==='editPlayer'){
      const input=details.extend({team,id}).parse(body);const p=club.players.find(p=>p.id===input.id&&p.active!==false);check(p,'Active player not found.');Object.assign(p,input);
    }else if(action==='archivePlayer'||action==='restorePlayer'){
      const playerId=id.parse(body.playerId);const p=club.players.find(p=>p.id===playerId);check(p,'Player not found.');check(p.userId!==club.adminId,'The organiser cannot remove their own profile.');
      if(action==='archivePlayer'){
        check(p.active!==false,'This player has already been removed.');
        check(!club.days.some(d=>d.poll==='open'&&d.roster.some(r=>r.id===p.id)),'Close voting for this player’s match day before removing them.');
        p.active=false;
      }else{check(p.active===false,'This player is already on the active roster.');p.active=true;}
    }else if(action==='invite'){
      const p=club.players.find(p=>p.id===body.playerId&&p.active!==false);check(p,'Active player not found.');check(!p.userId,'This player already has an account.');
      if(!p.inviteToken){if(p.inviteHash)p.legacyInviteHash=p.inviteHash;p.inviteToken=token();p.inviteHash=await digest(p.inviteToken);}extra={invite:p.inviteToken};
    }else if(action==='createDay'){
      const input=z.object({date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),roster:z.array(id).min(3),a:team,b:team,firstExit:team}).parse(body);
      const dt=new Date(input.date+'T12:00:00Z');check(!isNaN(dt.valueOf())&&dt.toISOString().slice(0,10)===input.date&&dt.getUTCDay()===0&&input.date>='2026-09-01','Choose a match date on or after September 1, 2026 that falls on a Sunday.');
      check(!club.days.some(d=>d.date===input.date),'There is already a match day on that date.');check(input.a!==input.b,'Choose two different opening teams.');check([input.a,input.b].includes(input.firstExit),'The first draw exit must be an opening team.');
      const roster=[...new Set(input.roster)].map(pid=>{const p=club.players.find(x=>x.id===pid&&x.active!==false);check(p,'An active attending player is missing.');return {id:p.id,team:p.team};});
      check(TEAMS.every(t=>roster.some(p=>p.team===t)),'Mark at least one attending player from each team.');
      const day:Day={id:crypto.randomUUID(),date:input.date,roster,opening:[input.a,input.b],firstExit:input.firstExit,rounds:[],poll:'ready'};club.days.push(day);extra={dayId:day.id};
    }else if(action==='attendance'){
      const day=club.days.find(d=>d.id===body.dayId);check(day,'Match day not found.');check(day.poll==='ready'&&!day.rounds.length,'Attendance is locked after voting opens or results are entered.');
      const ids=z.array(id).min(3).parse(body.roster);day.roster=[...new Set(ids)].map(pid=>{const p=club.players.find(p=>p.id===pid&&p.active!==false);check(p,'Active player not found.');return {id:pid,team:p.team};});check(TEAMS.every(t=>day.roster.some(p=>p.team===t)),'Include all three teams.');
    }else if(action==='addRound'){
      const input=z.object({dayId:id,scoreA:z.number().int().min(0).max(2),scoreB:z.number().int().min(0).max(2),lineup:z.array(id).min(2),goals:z.array(z.object({team,scorer:id.nullable(),assist:id.nullable(),ownGoal:z.boolean()})).max(3)}).parse(body);
      const day=club.days.find(d=>d.id===input.dayId);check(day,'Match day not found.');const n=nextMatch(day);
      check(!(input.scoreA===2&&input.scoreB===2),'A round ends as soon as a team scores two goals.');
      const lineup=[...new Set(input.lineup)];check(lineup.every(pid=>day.roster.some(p=>p.id===pid&&[n.a,n.b].includes(p.team))),'Only attending players on the two playing teams can appear.');
      check([n.a,n.b].every(t=>day.roster.some(p=>p.team===t&&lineup.includes(p.id))),'Include at least one player from each playing team.');
      check(input.goals.filter(g=>g.team===n.a).length===input.scoreA&&input.goals.filter(g=>g.team===n.b).length===input.scoreB&&input.goals.length===input.scoreA+input.scoreB,'Goal entries must match the score.');
      for(const g of input.goals){check([n.a,n.b].includes(g.team),'Invalid scoring team.');check(!g.ownGoal||!g.assist,'Own goals cannot have assists.');
        if(g.scorer){const p=day.roster.find(p=>p.id===g.scorer);check(p&&lineup.includes(p.id)&&(g.ownGoal?p.team!==g.team:p.team===g.team),'Choose a scorer who played for the correct team.');}
        if(g.assist){check(g.assist!==g.scorer,'A scorer cannot assist their own goal.');check(day.roster.some(p=>p.id===g.assist&&p.team===g.team)&&lineup.includes(g.assist),'Choose an assist from the scoring team’s lineup.');}}
      day.rounds.push({id:crypto.randomUUID(),a:n.a,b:n.b,scoreA:input.scoreA,scoreB:input.scoreB,lineup,goals:input.goals,...result(n.a,n.b,input.scoreA,input.scoreB,n.incumbent)});
    }else if(action==='undoRound'){
      const day=club.days.find(d=>d.id===body.dayId);check(day&&day.rounds.length,'There is no round to undo.');check(day.rounds.at(-1)?.id===body.roundId,'The latest round has changed. Refresh first.',409);day.rounds.pop();
    }else if(action==='openPoll'||action==='closePoll'){
      const day=club.days.find(d=>d.id===body.dayId);check(day,'Match day not found.');check(day.poll===(action==='openPoll'?'ready':'open'),'Voting has already changed.');day.poll=action==='openPoll'?'open':'closed';
    }else if(action==='setMatchVideo'){
      const day=club.days.find(d=>d.id===body.dayId);check(day,'Match day not found.');
      const raw=z.string().trim().max(500).parse(body.videoUrl);
      if(raw){let u:URL;try{u=new URL(raw);}catch{throw new ClubError('Enter a valid video link.');}
        check(u.protocol==='https:'&&['youtube.com','www.youtube.com','youtu.be','vimeo.com','www.vimeo.com','drive.google.com'].includes(u.hostname),'Use an HTTPS YouTube, Vimeo, or Google Drive video link.');}
      day.videoUrl=raw||null;
    }else throw new ClubError('Unknown action.');
  }
  await saveClub(club,revision);const reply=response({ok:true,...extra});if(action==='claim')reply.headers.set('Set-Cookie',inviteCookie('',new URL(req.url).protocol==='https:'));return reply;
}catch(e){return fail(e);}}
