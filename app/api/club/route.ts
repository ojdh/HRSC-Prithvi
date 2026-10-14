import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { getUser } from '../../auth';
import { TEAMS,DEFAULT_TEAMS,TIERS,SCORING_POSITIONS,voteCandidates,dayScores,MAX_SERIES_DAYS,DELETION_APPROVALS,LOG_LIMIT,nextMatch,incumbentAt,result,snapshot,isPlayed,emptyClub,isReady,isVideoUrl,validDate,weeklyDates,clubToday,type Club,type Day,type Tier,type Team,type DayLogEntry,type Player } from '@/lib/club';
import { db,readClub,saveClub,check,digest,token,role,ClubError } from '@/lib/server-club';
import {pendingInvite,findInvitation,inviteCookie} from '@/lib/server-invitations';
import {deleteObject} from '@/lib/r2-budget';
import {saveClubWithAccess,type AccessChange,type AccessResult} from '@/lib/access-sync';
export const dynamic='force-dynamic';
const team=z.enum(TEAMS),id=z.string().min(1).max(100);
const date=z.string().refine(validDate,'Choose a real date.'),time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/,'Choose a valid time.');
const slot=z.object({start:time,end:time}),endsAfterStart=[(v:{start:string;end:string})=>v.end>v.start,'The end time must be after the start time.'] as const;
const videoUrl=z.string().trim().max(500).refine(v=>!v||isVideoUrl(v),'Use an HTTPS YouTube, Vimeo, or Google Drive video link.');
const MAX_DAYS=300;
const score=z.number().int().min(0).max(20);
const roundInput=z.object({dayId:id,scoreA:score,scoreB:score,lineup:z.array(id).min(2),goals:z.array(z.object({team,scorer:id.nullable(),assist:id.nullable(),ownGoal:z.boolean()})).max(40),keepers:z.record(team,id).default({})});
const birthPair=[(v:{birthYear:number|null;birthMonth:number|null})=>(v.birthYear===null)===(v.birthMonth===null),'Choose both a birth year and month, or leave both empty.'] as const;
// The latest allowed birth year follows the club calendar, so it is checked per request rather than fixed when the Worker starts.
const birthYear=z.number().int().min(1940,'Choose a birth year from 1940 onwards.').refine(y=>y<=Number(clubToday().slice(0,4))-5,'Players must be at least five years old.');
const details=z.object({name:z.string().trim().min(1).max(60),birthYear:birthYear.nullable(),birthMonth:z.number().int().min(1,'Choose a birth month.').max(12,'Choose a birth month.').nullable(),height:z.number().int().min(70).max(250).nullable(),district:z.string().trim().max(60).nullable(),position:z.enum(['Goalkeeper','Defender','Midfielder','Forward','All-rounder'])});
const email=z.string().trim().max(254).transform(s=>s.toLowerCase()).refine(s=>!s||z.string().email().safeParse(s).success,'Enter a valid email address.').nullable().transform(s=>s||null);
function response(value:unknown,status=200){return Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}});}
function fail(e:unknown){if(e instanceof ClubError)return response({error:e.message},e.status);if(e instanceof z.ZodError)return response({error:e.issues[0].message},400);console.error('Club request failed',e instanceof Error?e.message:'unknown');return response({error:'We could not save or load that. Please retry; your form is still here.'},503);}
export async function GET(req:Request){try{
  const user=await getUser();const stored=await readClub();
  if(!stored)return response(emptyClub);
  const invited=await findInvitation(stored.club,pendingInvite(req));const invitation=invited&&!invited.userId?{name:invited.name,team:invited.team}:undefined;
  if(!user)return response({...emptyClub,initialized:true,invitation});
  const {club,revision}=stored;const {me,owner,admin}=role(club,user.userId);
  if(!me&&!owner)return response({...emptyClub,revision,initialized:true,invitation});
  const days=club.days.filter(d=>d.poll!=='ready'),[playerOfTheDay,fairPlay]=await Promise.all([pollResults('vote_receipts','ballots',days,me?.id),pollResults('fair_play_receipts','fair_play_ballots',days,me?.id)]);
  // Players see only each closed day's combined scores; the tally behind them, like tiers and scoring positions, is for admins.
  const polls=Object.fromEntries(days.map(d=>{const votes=playerOfTheDay[d.id];
    return [d.id,{...votes,tally:admin?votes.tally:[],fairPlay:fairPlay[d.id],...(d.poll==='closed'?{scores:dayScores(d,club.players,votes.tally).map(s=>({candidate:s.id,score:Math.round(s.score*10)/10}))}:{})}];}));
  const fairPlayVoters=club.fairPlayVoters??[];
  return response({initialized:true,revision,isAdmin:admin,isOwner:owner,owner:club.players.find(p=>p.userId===club.adminId)?.id??null,admins:club.admins,fairPlayVoters:admin?fairPlayVoters:fairPlayVoters.filter(v=>v===me?.id),teams:club.teams,me:me?.id??null,players:club.players.map(({userId,inviteHash,legacyInviteHash,inviteToken,email,accessEmail,tier,scoringPosition,...p})=>({...p,linked:!!userId,...(admin?{email,accessEmail,tier,scoringPosition}:{})})),days:admin?club.days:club.days.map(({deletion,...d})=>d),polls,...(admin?{log:club.log??[]}:{})});
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
    const c:Club={adminId:user.userId,admins:[],teams:DEFAULT_TEAMS,players:[{id:crypto.randomUUID(),name:setup.name,team:setup.team,userId:user.userId,birthYear:null,birthMonth:null,height:null,district:null,position:'All-rounder',number:null,photo:null}],days:[]};
    const r=await db().prepare('INSERT OR IGNORE INTO club (id,revision,data) VALUES (1,0,?)').bind(JSON.stringify(c)).run();
    check(r.meta.changes===1,'The club has already been set up.',409);return response({ok:true});
  }
  check(stored,'The organiser needs to set up the club first.');const {club,revision}=stored;
  const {me,owner,admin}=role(club,user.userId);
  if(action==='vote'){
    const input=z.object({dayId:id,candidates:z.array(id).min(1).max(TEAMS.length)}).parse(body);const day=club.days.find(d=>d.id===input.dayId);check(day&&day.poll==='open','Voting is not open for this match day.');
    check(me&&me.active!==false&&day.roster.some(p=>p.id===me.id),'Only active players marked as attending can vote.',403);
    // A ballot names one active attending player from each team that has one, the voter's own team included; never the voter.
    const eligible=voteCandidates(club.players,day).filter(p=>p.id!==me.id);
    const picks=input.candidates.map(c=>eligible.find(p=>p.id===c)),teams=new Set(eligible.map(p=>p.team));
    check(picks.every(p=>p)&&new Set(picks.map(p=>p!.team)).size===picks.length&&picks.length===teams.size,'Choose one active player from each team. You cannot vote for yourself.');
    await castBallots('vote_receipts','ballots',day.id,me.id,picks.map(p=>p!.id),revision);
    return response({ok:true});
  }
  if(action==='fairPlayVote'){
    const input=z.object({dayId:id,candidate:id}).parse(body);
    check(me&&me.active!==false&&(club.fairPlayVoters??[]).includes(me.id),'Only fair-play voters chosen by the admins can vote for fair play.',403);
    const day=club.days.find(d=>d.id===input.dayId);check(day&&day.poll==='open','Voting is not open for this match day.');
    check(input.candidate!==me.id&&voteCandidates(club.players,day).some(p=>p.id===input.candidate),'Choose one active attending player other than yourself.');
    await castBallots('fair_play_receipts','fair_play_ballots',day.id,me.id,[input.candidate],revision);
    return response({ok:true});
  }
  check(body.revision===revision,'The club was updated. Refresh before saving this change.',409);
  let extra:Record<string,unknown>={},deleted:Day|undefined;let access:{change:AccessChange;apply:(r:AccessResult)=>void}|undefined;
  if(action==='claim'){
    check(!me,'This account already has a player profile. Sign out and sign in with the invited player’s email.');
    const p=await findInvitation(club,z.string().min(20).max(150).parse(body.token||pendingInvite(req)));check(p&&!p.userId,'This invitation has already been used or is unavailable. Ask your organiser for the current link.');p.userId=user.userId;delete p.inviteHash;delete p.legacyInviteHash;delete p.inviteToken;
  }else if(action==='profile'){
    check(me&&me.active!==false,'Only an active linked player can update their profile.',403);
    const allowed=new Set(['action','revision','name','birthYear','birthMonth','height','district','position']);
    check(Object.keys(body).every(key=>allowed.has(key)),'You can only update your own personal information.',403);
    Object.assign(me,details.refine(...birthPair).parse(body));
  }else if(action==='setAdmin'){
    check(owner,'Only the club owner can change admins.',403);
    const input=z.object({playerId:id,admin:z.boolean()}).parse(body);const p=club.players.find(p=>p.id===input.playerId&&p.active!==false);check(p,'Active player not found.');
    check(p.userId!==club.adminId,'The owner is always an admin.');check(p.userId,'This player needs to accept their invitation before becoming an admin.');
    check(club.admins.includes(p.id)!==input.admin,input.admin?'This player is already an admin.':'This player is not an admin.');
    if(input.admin){check(club.admins.length<10,'The club supports up to 10 admins.');club.admins.push(p.id);}else club.admins=club.admins.filter(a=>a!==p.id);
  }else{
    check(admin,'Only club admins can change match records and teams.',403);
    if(action==='addPlayer'){
      const {email:newEmail,...input}=details.extend({team,email:email.optional()}).refine(...birthPair).parse(body);check(club.players.length<150,'The club supports up to 150 players.');
      if(newEmail)check(!emailTaken(club,newEmail),'Another player already uses that email.');
      club.players.push({...input,...(newEmail?{email:newEmail}:{}),id:crypto.randomUUID(),active:true,photo:null});
    }else if(action==='editPlayer'){
      const {email:newEmail,...input}=details.extend({team,id,email:email.optional()}).refine(...birthPair).parse(body);const p=club.players.find(p=>p.id===input.id&&p.active!==false);check(p,'Active player not found.');Object.assign(p,input);dropCaptaincy(club,p);
      if(newEmail!==undefined&&newEmail!==(p.email??null)){
        check(!p.userId,'A player’s email can only be changed before they accept their invitation.');
        if(newEmail)check(!emailTaken(club,newEmail,p.id),'Another player already uses that email.');
        p.email=newEmail;
        // An invited player's Access entry follows their email.
        if(p.accessEmail)access={change:{add:newEmail,remove:p.accessEmail},apply:r=>{p.accessEmail=r.added?newEmail:null;}};
      }
    }else if(action==='archivePlayer'||action==='restorePlayer'){
      const playerId=id.parse(body.playerId);const p=club.players.find(p=>p.id===playerId);check(p,'Player not found.');check(p.userId!==club.adminId,'The organiser cannot remove their own profile.');
      if(action==='archivePlayer'){
        check(p.active!==false,'This player has already been removed.');check(owner||!club.admins.includes(p.id),'Only the club owner can remove an admin.',403);
        check(!club.days.some(d=>d.poll==='open'&&d.roster.some(r=>r.id===p.id)),'Close voting for this player’s match day before removing them.');
        p.active=false;club.admins=club.admins.filter(a=>a!==p.id);dropCaptaincy(club,p);
        if(p.accessEmail)access={change:{remove:p.accessEmail},apply:()=>{p.accessEmail=null;}};
      }else{check(p.active===false,'This player is already on the active roster.');p.active=true;}
    }else if(action==='editTeam'){
      const input=z.object({team,name:z.string().trim().min(1).max(30),letter:z.string().trim().min(1).max(2).transform(s=>s.toUpperCase()),color:z.string().regex(/^#[0-9a-fA-F]{6}$/,'Choose a colour like #1f7a4d.').transform(s=>s.toLowerCase()),motto:z.string().trim().max(60)}).parse(body);
      check(TEAMS.every(t=>t===input.team||club.teams[t].name.toLowerCase()!==input.name.toLowerCase()),'Each team needs its own name.');
      club.teams[input.team]={...club.teams[input.team],name:input.name,color:input.color,letter:input.letter,motto:input.motto};
    }else if(action==='setFairPlayVoter'){
      // A removed player can still be taken off the list, but only active players are added.
      const input=z.object({playerId:id,voter:z.boolean()}).parse(body);const p=club.players.find(p=>p.id===input.playerId&&(!input.voter||p.active!==false));check(p,'Active player not found.');
      const voters=club.fairPlayVoters??[];check(voters.includes(p.id)!==input.voter,input.voter?'This player already votes for fair play.':'This player does not vote for fair play.');
      club.fairPlayVoters=input.voter?[...voters,p.id]:voters.filter(v=>v!==p.id);
    }else if(action==='setScoring'){
      const input=z.object({playerId:id,tier:z.number().int().refine((t):t is Tier=>TIERS.includes(t as Tier),'Choose a tier from 1 to 5.'),scoringPosition:z.enum(SCORING_POSITIONS)}).parse(body);
      const p=club.players.find(p=>p.id===input.playerId&&p.active!==false);check(p,'Active player not found.');
      Object.assign(p,{tier:input.tier,scoringPosition:input.scoringPosition});
    }else if(action==='setCaptain'){
      const input=z.object({team,playerId:id.nullable()}).parse(body);
      if(input.playerId){const p=club.players.find(p=>p.id===input.playerId&&p.active!==false);check(p&&p.team===input.team,'Choose an active player from this team as captain.');club.teams[input.team].captain=p.id;}
      else delete club.teams[input.team].captain;
    }else if(action==='invite'){
      const p=club.players.find(p=>p.id===body.playerId&&p.active!==false);check(p,'Active player not found.');check(!p.userId,'This player already has an account.');
      if(!p.inviteToken){if(p.inviteHash)p.legacyInviteHash=p.inviteHash;p.inviteToken=token();p.inviteHash=await digest(p.inviteToken);}extra={invite:p.inviteToken};
      // Only invited emails are registered in Access. An email already there that the app did not add stays unmanaged.
      if(p.email){const invited=p.email,stale=p.accessEmail&&p.accessEmail!==invited?p.accessEmail:null;
        access={change:{add:invited,remove:stale},apply:r=>{const ours=r.added||p.accessEmail===invited;p.accessEmail=ours?invited:null;extra.access=r.added?'added':'already';}};}
    }else if(action==='addDays'){
      const input=slot.extend({from:date,to:date.optional()}).refine(...endsAfterStart).refine(v=>!v.to||v.to>=v.from,'The series must end on or after its first date.').parse(body);
      const dates=input.to?weeklyDates(input.from,input.to):[input.from];check(dates.length<=MAX_SERIES_DAYS,`A series can hold up to ${MAX_SERIES_DAYS} match days.`);
      const fresh=dates.filter(d=>!club.days.some(x=>x.date===d));check(fresh.length,'There is already a match day on '+(dates.length>1?'every one of those dates.':'that date.'));
      check(club.days.length+fresh.length<=MAX_DAYS,`The club supports up to ${MAX_DAYS} match days.`);
      const created:Day[]=fresh.map(d=>({id:crypto.randomUUID(),date:d,start:input.start,end:input.end,roster:[],opening:null,firstExit:null,rounds:[],poll:'ready'}));
      club.days.push(...created);extra={dayIds:created.map(d=>d.id),skipped:dates.filter(d=>!fresh.includes(d))};
    }else if(action==='setupDay'){
      const input=z.object({dayId:id,a:team,b:team,firstExit:team}).parse(body);const day=editableDay(club,input.dayId,'Opening teams are locked after voting opens or results are entered.');
      check(input.a!==input.b,'Choose two different opening teams.');check([input.a,input.b].includes(input.firstExit),'The first draw exit must be an opening team.');
      // Everyone active attends by default; admins then remove whoever did not come. Updating the teams keeps that attendance.
      const roster=isReady(day)?day.roster:club.players.filter(p=>p.active!==false).map(p=>attendee(club,p.id));
      check(TEAMS.every(t=>roster.some(p=>p.team===t)),'Every team needs at least one active player. Add players on the team pages first.');
      Object.assign(day,{roster,opening:[input.a,input.b],firstExit:input.firstExit});
    }else if(action==='addAttendee'){
      const input=z.object({dayId:id,playerId:id}).parse(body);const day=club.days.find(d=>d.id===input.dayId);check(day,'Match day not found.');
      // Like removal, this works at any time, so a player missed from a played day can be added and then put into its games with Edit.
      check(isReady(day),'Set up the matchday before adding late arrivals.');
      check(!day.roster.some(r=>r.id===input.playerId),'This player is already marked as attending.');day.roster.push(attendee(club,input.playerId));
      record(club,actor(me),'addAttendee',day,{player:input.playerId});
    }else if(action==='removeAttendee'){
      const input=z.object({dayId:id,playerId:id}).parse(body);const day=club.days.find(d=>d.id===input.dayId);check(day,'Match day not found.');
      check(isReady(day),'Set up the matchday before changing attendance.');
      const player=day.roster.find(r=>r.id===input.playerId);check(player,'This player is not marked as attending.');
      // Their stats that day would otherwise point at someone who was not there, so those games are corrected first.
      check(!day.rounds.some(r=>r.goals.some(g=>g.scorer===player.id||g.assist===player.id)||Object.values(r.keepers??{}).includes(player.id)),'This player has a goal, an assist or a game in goal on this day. Edit those games first.');
      const sole=day.rounds.findIndex(r=>r.lineup.includes(player.id)&&!r.lineup.some(pid=>pid!==player.id&&day.roster.some(p=>p.id===pid&&p.team===player.team)));
      check(sole<0,`This player is their team’s only player in game ${sole+1}. Edit that game first.`);
      day.roster=day.roster.filter(r=>r.id!==player.id);for(const r of day.rounds)r.lineup=r.lineup.filter(pid=>pid!==player.id);
      record(club,actor(me),'removeAttendee',day,{player:player.id});
    }else if(action==='editDay'){
      const input=slot.extend({dayId:id,date}).refine(...endsAfterStart).parse(body);const day=editableDay(club,input.dayId,'Match days cannot be moved after voting opens or results are entered.');
      check(!club.days.some(d=>d.id!==day.id&&d.date===input.date),'There is already a match day on that date.');Object.assign(day,{date:input.date,start:input.start,end:input.end});
    }else if(action==='deleteDay'){
      const day=editableDay(club,id.parse(body.dayId),'Match days cannot be cancelled after voting opens or results are entered.');check(!day.videoKey,'Remove the matchday clip before cancelling this match day.');
      club.days=club.days.filter(d=>d.id!==day.id);
    }else if(action==='addRound'){
      const input=roundInput.parse(body);
      const day=club.days.find(d=>d.id===input.dayId);check(day,'Match day not found.');check(isReady(day),'Set attendance and opening teams first.');check(!day.ended,'This matchday has ended. Resume it under Manage to add games.');const n=nextMatch(day);
      const lineup=playedLineup(day,n.a,n.b,input);
      day.rounds.push({id:crypto.randomUUID(),a:n.a,b:n.b,scoreA:input.scoreA,scoreB:input.scoreB,lineup,goals:input.goals,keepers:input.keepers,...result(n.a,n.b,input.scoreA,input.scoreB,n.incumbent)});
    }else if(action==='editRound'){
      const input=roundInput.extend({roundId:id}).parse(body);
      const day=club.days.find(d=>d.id===input.dayId);check(day&&isReady(day),'Match day not found.');
      const index=day.rounds.findIndex(r=>r.id===input.roundId);check(index>=0,'Round not found.');const round=day.rounds[index],before=snapshot(round);
      const lineup=playedLineup(day,round.a,round.b,input);
      Object.assign(round,{scoreA:input.scoreA,scoreB:input.scoreB,lineup,goals:input.goals,keepers:input.keepers,...result(round.a,round.b,input.scoreA,input.scoreB,incumbentAt(day,index))});
      record(club,actor(me),'editRound',day,{roundId:round.id,before,after:snapshot(round)});
    }else if(action==='undoRound'){
      const day=club.days.find(d=>d.id===body.dayId);check(day&&day.rounds.length,'There is no round to undo.');check(day.rounds.at(-1)?.id===body.roundId,'The latest round has changed. Refresh first.',409);
      const round=day.rounds.pop()!;record(club,actor(me),'undoRound',day,{roundId:round.id,before:snapshot(round)});
    }else if(action==='requestDayDeletion'){
      const day=club.days.find(d=>d.id===body.dayId);check(day,'Match day not found.');
      check(isPlayed(day),'This match day has not been played. Cancel it instead.');check(!day.deletion,'Deleting this match day has already been requested.');
      const by=actor(me);day.deletion={requestedBy:by,approvals:[by]};record(club,by,'requestDayDeletion',day);deleted=settleDeletion(club,day,by);
    }else if(action==='approveDayDeletion'){
      const day=club.days.find(d=>d.id===body.dayId);check(day?.deletion,'There is no deletion request for this match day.');
      const by=actor(me);check(!day.deletion.approvals.includes(by),'You have already approved deleting this match day.');
      day.deletion.approvals.push(by);record(club,by,'approveDayDeletion',day);deleted=settleDeletion(club,day,by);
    }else if(action==='cancelDayDeletion'){
      const day=club.days.find(d=>d.id===body.dayId);check(day?.deletion,'There is no deletion request for this match day.');
      delete day.deletion;record(club,actor(me),'cancelDayDeletion',day);
    }else if(action==='endDay'){
      const day=club.days.find(d=>d.id===body.dayId);check(day,'Match day not found.');check(isReady(day),'Set attendance and opening teams first.');check(day.date<=clubToday(),'A matchday can only end on or after its date.');check(!day.ended,'This matchday has already ended.');
      day.ended=true;if(day.poll==='ready')day.poll='open';
    }else if(action==='resumeDay'){
      const day=club.days.find(d=>d.id===body.dayId);check(day?.ended,'This matchday has not ended.');delete day.ended;
    }else if(action==='openPoll'||action==='closePoll'){
      const day=club.days.find(d=>d.id===body.dayId);check(day,'Match day not found.');check(action==='closePoll'||isReady(day),'Set attendance and opening teams first.');check(action==='closePoll'||day.date<=clubToday(),'Voting opens on or after the match day.');check(day.poll===(action==='openPoll'?'ready':'open'),'Voting has already changed.');day.poll=action==='openPoll'?'open':'closed';
    }else if(action==='setMatchVideo'){
      const day=club.days.find(d=>d.id===body.dayId);check(day,'Match day not found.');day.videoUrl=videoUrl.parse(body.videoUrl)||null;
    }else if(action==='setRoundVideo'){
      const input=z.object({dayId:id,roundId:id,videoUrl}).parse(body);const round=club.days.find(d=>d.id===input.dayId)?.rounds.find(r=>r.id===input.roundId);check(round,'Round not found.');round.videoUrl=input.videoUrl||null;
    }else throw new ClubError('Unknown action.');
  }
  if(access)await saveClubWithAccess(club,revision,access.change,access.apply);else await saveClub(club,revision);
  if(deleted){
    await db().batch(['ballots','vote_receipts','fair_play_ballots','fair_play_receipts'].map(table=>db().prepare(`DELETE FROM ${table} WHERE day=?`).bind(deleted.id)));
    if(deleted.videoKey)await deleteObject(deleted.videoKey);
  }
  const reply=response({ok:true,...extra,...(deleted?{deleted:true}:{})});if(action==='claim')reply.headers.set('Set-Cookie',inviteCookie('',new URL(req.url).protocol==='https:'));return reply;
}catch(e){return fail(e);}}
// Stores one voter's receipt and their anonymous ballots together, only if the club has not changed since it was read.
async function castBallots(receipts:'vote_receipts'|'fair_play_receipts',ballots:'ballots'|'fair_play_ballots',dayId:string,voter:string,picks:string[],revision:number){
  try{
    // Each ballot is stored only if the statement before it stored a row, so the receipt and every ballot land together.
    const r=await db().batch([
      db().prepare(`INSERT INTO ${receipts} (day,player) SELECT ?,? WHERE EXISTS (SELECT 1 FROM club WHERE id=1 AND revision=?)`).bind(dayId,voter,revision),
      ...picks.map(pick=>db().prepare(`INSERT INTO ${ballots} (id,day,candidate) SELECT ?,?,? WHERE changes()=1`).bind(crypto.randomUUID(),dayId,pick)),
    ]);
    check(r.every(x=>x.meta.changes===1),'The match day changed. Refresh and vote again.',409);
  }catch(e){if(e instanceof ClubError)throw e;if(String(e).includes('UNIQUE'))throw new ClubError('Your vote has already been recorded.',409);throw e;}
}
// Each day's participation count, whether `player` has voted, and the tally once that day's voting has closed.
async function pollResults(receipts:'vote_receipts'|'fair_play_receipts',ballots:'ballots'|'fair_play_ballots',days:Day[],player:string|undefined){
  const counts=(await db().prepare(`SELECT day,COUNT(*) AS n FROM ${receipts} GROUP BY day`).all<{day:string;n:number}>()).results;
  const mine=player?(await db().prepare(`SELECT day FROM ${receipts} WHERE player=?`).bind(player).all<{day:string}>()).results:[];
  const tallies=(await db().prepare(`SELECT day,candidate,COUNT(*) AS votes FROM ${ballots} GROUP BY day,candidate ORDER BY votes DESC,candidate`).all<{day:string;candidate:string;votes:number}>()).results;
  return Object.fromEntries(days.map(day=>[day.id,{count:counts.find(x=>x.day===day.id)?.n??0,voted:mine.some(x=>x.day===day.id),tally:day.poll==='closed'?tallies.filter(t=>t.day===day.id).map(({candidate,votes})=>({candidate,votes})):[]}]));
}
function attendee(club:Club,playerId:string){const p=club.players.find(x=>x.id===playerId&&x.active!==false);check(p,'An active attending player is missing.');return {id:p.id,team:p.team};}
function editableDay(club:Club,dayId:string,locked:string){const day=club.days.find(d=>d.id===dayId);check(day,'Match day not found.');check(day.poll==='ready'&&!day.rounds.length,locked);return day;}
// Validates a game's lineup, keepers, goals and score for the two teams that played it, and returns the de-duplicated lineup.
function playedLineup(day:Day,a:Team,b:Team,input:z.infer<typeof roundInput>){
  const lineup=[...new Set(input.lineup)];check(lineup.every(pid=>day.roster.some(p=>p.id===pid&&[a,b].includes(p.team))),'Only attending players on the two playing teams can appear.');
  check([a,b].every(t=>day.roster.some(p=>p.team===t&&lineup.includes(p.id))),'Include at least one player from each playing team.');
  for(const [t,keeper] of Object.entries(input.keepers) as [Team,string][])check([a,b].includes(t)&&lineup.includes(keeper)&&day.roster.some(p=>p.id===keeper&&p.team===t),'Choose each goalkeeper from their own team’s players in this game.');
  check(input.goals.filter(g=>g.team===a).length===input.scoreA&&input.goals.filter(g=>g.team===b).length===input.scoreB&&input.goals.length===input.scoreA+input.scoreB,'Goal entries must match the score.');
  for(const g of input.goals){check([a,b].includes(g.team),'Invalid scoring team.');check(!g.ownGoal||!g.assist,'Own goals cannot have assists.');
    if(g.scorer){const p=day.roster.find(p=>p.id===g.scorer);check(p&&lineup.includes(p.id)&&(g.ownGoal?p.team!==g.team:p.team===g.team),'Choose a scorer who played for the correct team.');}
    if(g.assist){check(g.assist!==g.scorer,'A scorer cannot assist their own goal.');check(day.roster.some(p=>p.id===g.assist&&p.team===g.team)&&lineup.includes(g.assist),'Choose an assist from the scoring team’s lineup.');}}
  return lineup;
}
// The edit log names people by player id, so these actions need the admin's player profile.
function actor(me:{id:string}|undefined){check(me,'Link your player profile before changing match records.',403);return me.id;}
function record(club:Club,by:string,action:DayLogEntry['action'],day:Day,details:Pick<DayLogEntry,'roundId'|'player'|'before'|'after'>={}){
  club.log=[{id:crypto.randomUUID(),at:new Date().toISOString(),by,action,dayId:day.id,date:day.date,...details},...(club.log??[])].slice(0,LOG_LIMIT);
}
// Deletes the day once the owner has approved or enough current admins have. Approvals from people who are no
// longer admins do not count. Returns the removed day so its ballots and clip can be cleaned up after saving.
// A captain who leaves their team or the active roster stops being its captain.
function dropCaptaincy(club:Club,p:Player){for(const t of TEAMS)if(club.teams[t].captain===p.id&&(p.active===false||p.team!==t))delete club.teams[t].captain;}
function settleDeletion(club:Club,day:Day,by:string){
  const ownerId=club.players.find(p=>p.userId===club.adminId)?.id;
  const current=day.deletion!.approvals.filter(pid=>pid===ownerId||club.admins.includes(pid)&&club.players.some(p=>p.id===pid&&p.active!==false));
  if(!(ownerId&&current.includes(ownerId))&&current.length<DELETION_APPROVALS)return undefined;
  club.days=club.days.filter(d=>d.id!==day.id);record(club,by,'deleteDay',day);return day;
}
function emailTaken(club:Club,email:string,exceptId?:string){return club.players.some(p=>p.id!==exceptId&&(p.email===email||p.accessEmail===email));}
