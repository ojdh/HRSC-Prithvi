// Runs against an isolated Worker/D1/R2 emulator. Never touches the hosted club.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url);
const workerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare}=workerRequire('miniflare');
const modulePaths=(await readdir('dist/server',{recursive:true})).filter(p=>/\.m?js$/.test(p)&&p!=='index.js');
// A stand-in Cloudflare Access team: its own signing key, served from the certs endpoint.
const teamUrl='https://hrsc-test.cloudflareaccess.com',audience='test-access-aud';
const signing={name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'};
const accessKey=await crypto.subtle.generateKey(signing,true,['sign','verify']);
const foreignKey=await crypto.subtle.generateKey(signing,true,['sign','verify']);
const jwks={keys:[{...await crypto.subtle.exportKey('jwk',accessKey.publicKey),kid:'access-key',alg:'RS256',use:'sig'}]};
const accessService=req=>new URL(req.url).href===teamUrl+'/cdn-cgi/access/certs'?Response.json(jwks):new Response('not found',{status:404});
const b64url=value=>Buffer.from(value).toString('base64url');
async function accessToken(user,claims={},key=accessKey.privateKey,kid='access-key'){const now=Math.floor(Date.now()/1000);const unsigned=b64url(JSON.stringify({alg:'RS256',kid,typ:'JWT'}))+'.'+b64url(JSON.stringify({aud:[audience],iss:teamUrl,sub:user,email:user+'@test.invalid',iat:now,nbf:now,exp:now+3600,...claims}));return unsigned+'.'+b64url(await crypto.subtle.sign(signing,key,new TextEncoder().encode(unsigned)))}
const workerOptions={modules:[{type:'ESModule',path:resolve('dist/server/index.js')},...modulePaths.map(p=>({type:'ESModule',path:resolve('dist/server',p)}))],modulesRoot:resolve('dist/server'),compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'hrsc-integration-only'},r2Buckets:{BUCKET:'hrsc-integration-only'},outboundService:accessService,cf:false};
const accessBindings={CLUB_SETUP_KEY:'test-setup-secret',CF_ACCESS_TEAM_URL:teamUrl,CF_ACCESS_AUD:audience};
const budget=({storage,classA,classB})=>({R2_STORAGE_QUOTA_BYTES:String(storage),R2_CLASS_A_MONTHLY_LIMIT:String(classA),R2_CLASS_B_MONTHLY_LIMIT:String(classB)});
const mf=new Miniflare({...workerOptions,bindings:{...accessBindings,...budget({storage:1e9,classA:1e6,classB:1e7})}});
const origin='https://club.test';
let checks=0;
const ok=(value,message)=>{assert.ok(value,message);checks++};
async function headers(user){return {'Content-Type':'application/json',Origin:origin,...(user?{'Cf-Access-Jwt-Assertion':await accessToken(user)}:{})}}
async function get(user='owner'){const r=await mf.dispatchFetch(origin+'/api/club',{headers:await headers(user)});return {status:r.status,data:await r.json()}}
async function post(action,body={},user='owner',revision){const v=revision??(await get(user)).data.revision;const r=await mf.dispatchFetch(origin+'/api/club',{method:'POST',headers:await headers(user),body:JSON.stringify({action,revision:v,...body})});return {status:r.status,data:await r.json()}}
async function success(action,body={},user='owner'){const r=await post(action,body,user);assert.equal(r.status,200,JSON.stringify(r));checks++;return r.data}
try{
  const migrations=await Promise.all((await readdir('drizzle')).filter(f=>f.endsWith('.sql')).sort().map(async f=>({file:f,sql:await readFile('drizzle/'+f,'utf8')})));
  async function migrate(instance,include=()=>true){const db=await instance.getD1Database('DB');for(const {file,sql} of migrations.filter(m=>include(m.file)))for(const statement of sql.split('--> statement-breakpoint').filter(x=>x.trim()))await db.prepare(statement).run();}
  await migrate(mf);
  ok((await get(null)).data.initialized===false,'clean club');
  // Identity comes only from a valid Access token; anything else is anonymous.
  async function initializeWith(extraHeaders){return (await mf.dispatchFetch(origin+'/api/club',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...extraHeaders},body:JSON.stringify({action:'initialize',key:'test-setup-secret',name:'Intruder',team:'red'})})).status}
  ok(await initializeWith({'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@test.invalid'})===401,'forged ChatGPT identity headers ignored');
  ok(await initializeWith({'Cf-Access-Jwt-Assertion':await accessToken('owner',{},foreignKey.privateKey)})===401,'token signed by another key rejected');
  ok(await initializeWith({'Cf-Access-Jwt-Assertion':await accessToken('owner',{aud:['another-app']})})===401,'token for another Access application rejected');
  ok(await initializeWith({'Cf-Access-Jwt-Assertion':await accessToken('owner',{iss:'https://evil.cloudflareaccess.com'})})===401,'token from another Access team rejected');
  ok(await initializeWith({'Cf-Access-Jwt-Assertion':await accessToken('owner',{exp:Math.floor(Date.now()/1000)-60})})===401,'expired token rejected');
  ok(await initializeWith({'Cf-Access-Jwt-Assertion':'not.a.jwt'})===401,'malformed token rejected');
  const [unsignedHead,unsignedBody]=(await accessToken('owner')).split('.');
  ok(await initializeWith({'Cf-Access-Jwt-Assertion':unsignedHead+'.'+unsignedBody+'.'})===401,'unsigned token rejected');
  const unconfigured=new Miniflare({...workerOptions,bindings:{CLUB_SETUP_KEY:'test-setup-secret'}});
  try{await migrate(unconfigured);ok((await unconfigured.dispatchFetch(origin+'/api/club',{headers:await headers('owner')})).status===503,'missing Access configuration fails closed')}finally{await unconfigured.dispose()}
  ok((await post('initialize',{key:'bad',name:'Organiser',team:'red'})).status===403,'setup code required');
  await success('initialize',{key:'test-setup-secret',name:'Organiser',team:'red'});
  ok((await get(null)).data.players.length===0,'anonymous visitors see no roster');
  ok((await get('intruder')).data.players.length===0,'unlinked accounts see no roster');
  const fields={age:25,height:170,district:'Kathmandu',position:'Midfielder'};
  await success('addPlayer',{...fields,name:'Red teammate',team:'red'});
  await success('addPlayer',{...fields,name:'Black player',team:'black'});
  await success('addPlayer',{...fields,name:'White player',team:'white'});
  await success('addPlayer',{...fields,name:'Absent white',team:'white'});
  let state=(await get()).data;
  const [owner,red,black,white,absent]=state.players;
  const invites={};
  for(const [p,u] of [[red,'red-user'],[black,'black-user'],[white,'white-user'],[absent,'absent-user']]){
    invites[u]=(await success('invite',{playerId:p.id})).invite;
    const again=(await success('invite',{playerId:p.id})).invite;
    ok(again===invites[u],'copying invite keeps previous link valid');
    if(u==='black-user'){
      const landing=await mf.dispatchFetch(origin+'/join?invite='+encodeURIComponent(invites[u]),{redirect:'manual'});
      ok(landing.status===303&&landing.headers.get('location')==='/winterleague?view=profile','invite redirects to clean profile page');
      const setCookie=landing.headers.get('set-cookie');ok(setCookie.includes('HttpOnly')&&setCookie.includes('SameSite=Lax')&&setCookie.includes('Secure'),'invite cookie protected');
      const cookie=setCookie.split(';')[0];
      const guest=await mf.dispatchFetch(origin+'/api/club',{headers:{Cookie:cookie}});const guestData=await guest.json();
      ok(guestData.invitation.name===p.name&&guestData.players.length===0,'guest invitation survives redirect without exposing roster');
      const html=await (await mf.dispatchFetch(origin+'/winterleague?view=profile',{headers:{Cookie:cookie}})).text();
      ok(html.includes('href="/winterleague?view=profile"'),'sign-in return path rendered server-side');
      const rev=(await get(u)).data.revision;
      const claimed=await mf.dispatchFetch(origin+'/api/club',{method:'POST',headers:{...await headers(u),Cookie:cookie},body:JSON.stringify({action:'claim',revision:rev})});
      ok(claimed.status===200&&claimed.headers.get('set-cookie').includes('Max-Age=0'),'claim works after sign-in without token in URL');
      ok(!(await get()).data.players.some(p=>p.inviteToken||p.legacyInviteHash),'invite secrets never exposed');
    }else await success('claim',{token:invites[u]},u);
  }
  ok((await post('claim',{token:invites['black-user']},'intruder')).status===400,'single-use invitations');
  ok((await post('addPlayer',{...fields,name:'Intruder',team:'black'},'black-user')).status===403,'non-admin writes blocked');
  ok((await post('profile',{...fields,name:'Black player',team:'red'},'black-user')).status===403,'players cannot switch team through profile editing');
  ok((await get('black-user')).data.players.find(p=>p.id===black.id).team==='black','player cannot switch team');
  const beforeProfile=(await get()).data;
  const personal={name:'Black player updated',age:26,height:181,district:'Pokhara',position:'Forward'};
  await success('profile',personal,'black-user');
  const afterProfile=(await get()).data;
  const changed=afterProfile.players.find(p=>p.id===black.id);
  ok(Object.entries(personal).every(([key,value])=>changed[key]===value),'player can update all personal fields');
  ok(changed.team==='black'&&changed.linked===true,'profile editing preserves team and account');
  ok(JSON.stringify(beforeProfile.players.filter(p=>p.id!==black.id))===JSON.stringify(afterProfile.players.filter(p=>p.id!==black.id)),'profile editing leaves other players unchanged');
  for(const forbidden of [{id:white.id},{userId:'owner'},{active:false},{goals:99},{photo:'players/forged'}]){
    ok((await post('profile',{...personal,...forbidden},'black-user')).status===403,'profile cannot change protected fields');
  }
  ok((await post('profile',personal,'intruder')).status===403,'unlinked account cannot edit a player');
  ok((await post('profile',{...personal,height:999},'black-user')).status===400,'profile validates personal information');
  ok((await post('profile',personal,'black-user',beforeProfile.revision)).status===409,'stale profile save cannot overwrite newer records');
  const legacy=await mf.dispatchFetch(origin+'/?view=vote&day=legacy',{redirect:'manual'});
  ok(legacy.status>=300&&legacy.status<400&&legacy.headers.get('location')==='/winterleague?view=vote&day=legacy','old voting links redirect to the league');
  const date='2026-09-06',roster=[owner.id,red.id,black.id,white.id];
  const created=await success('addDays',{from:date,start:'07:00',end:'08:30'});
  ok(created.dayIds.length===1&&!created.skipped.length,'one-off match day scheduled');
  const dayId=created.dayIds[0];
  const scheduled=(await get('black-user')).data.days[0];ok(scheduled.roster.length===0&&scheduled.opening===null&&scheduled.start==='07:00'&&scheduled.end==='08:30','scheduled day waits for attendance');
  ok((await post('openPoll',{dayId})).status===400,'voting needs a set-up match day');
  ok((await post('addRound',{dayId,scoreA:0,scoreB:0,lineup:roster,goals:[]})).status===400,'rounds need a set-up match day');
  for(const bad of [{a:'red',b:'red'},{firstExit:'white'},{roster:[owner.id,red.id,black.id]}])ok((await post('setupDay',{dayId,roster,a:'red',b:'black',firstExit:'red',...bad})).status===400,'invalid matchday setup rejected: '+JSON.stringify(bad));
  await success('setupDay',{dayId,roster,a:'red',b:'black',firstExit:'red'});
  const futureId=(await success('addDays',{from:'2099-01-04',start:'07:00',end:'08:30'})).dayIds[0];await success('setupDay',{dayId:futureId,roster,a:'red',b:'black',firstExit:'red'});
  ok((await post('openPoll',{dayId:futureId})).status===400,'voting cannot open before the match day');await success('deleteDay',{dayId:futureId});
  await success('openPoll',{dayId});
  ok((await get()).data.days[0].rounds.length===0,'voting opens before any stats');
  ok((await post('setupDay',{dayId,roster:[...roster,absent.id],a:'red',b:'black',firstExit:'red'})).status===400,'vote eligibility roster locked');
  ok((await post('vote',{dayId,candidate:red.id})).status===400,'own-team ballot blocked');
  ok((await post('vote',{dayId,candidate:white.id},'absent-user')).status===403,'absent player cannot vote');
  ok((await post('vote',{dayId,candidate:absent.id},'black-user')).status===400,'absent candidate blocked');
  await success('vote',{dayId,candidate:black.id});
  ok((await post('vote',{dayId,candidate:white.id})).status===409,'duplicate vote blocked');
  let v=(await get('white-user')).data.revision;
  const concurrent=await Promise.all([post('vote',{dayId,candidate:black.id},'white-user',v),post('vote',{dayId,candidate:red.id},'white-user',v)]);
  ok(concurrent.filter(x=>x.status===200).length===1,'concurrent duplicate ballots blocked');
  state=(await get()).data;
  ok(state.polls[dayId].count===2&&state.polls[dayId].tally.length===0,'only participation count exposed while poll open');
  const goal=(team,scorer,assist=null,ownGoal=false)=>({team,scorer,assist,ownGoal});
  await success('addRound',{dayId,scoreA:2,scoreB:1,lineup:[owner.id,red.id,black.id],goals:[goal('red',owner.id,red.id),goal('red',red.id,owner.id),goal('black',black.id)]});
  state=(await get()).data;ok(state.days[0].rounds[0].winner==='red'&&state.days[0].rounds[0].exit==='black','winner stays on');
  await success('addRound',{dayId,scoreA:1,scoreB:1,lineup:[owner.id,white.id],goals:[goal('red',owner.id),goal('white',white.id)]});
  state=(await get()).data;ok(state.days[0].rounds[1].a==='red'&&state.days[0].rounds[1].b==='white'&&state.days[0].rounds[1].exit==='red','draw rotates previous winner off');
  await success('addRound',{dayId,scoreA:0,scoreB:0,lineup:[white.id,black.id],goals:[]});
  state=(await get()).data;ok(state.days[0].rounds[2].exit==='white','consecutive draw rotates longer-staying side');
  await success('undoRound',{dayId,roundId:state.days[0].rounds[2].id});
  ok((await post('addRound',{dayId,scoreA:1,scoreB:0,lineup:[white.id,black.id],goals:[goal('white',white.id,white.id)]})).status===400,'self-assist blocked');
  await success('vote',{dayId,candidate:owner.id},'black-user');
  await success('closePoll',{dayId});
  state=(await get()).data;ok(state.polls[dayId].tally.length>0&&state.polls[dayId].count===3,'results available only after close');
  ok((await post('vote',{dayId,candidate:white.id},'red-user')).status===400,'closed voting rejected');
  await success('addRound',{dayId,scoreA:0,scoreB:1,lineup:[white.id,black.id],goals:[goal('black',black.id)]});
  ok((await get()).data.days[0].rounds.length===3,'scores remain editable after poll closes');

  await success('setMatchVideo',{dayId,videoUrl:'https://youtu.be/dQw4w9WgXcQ'});
  ok((await get()).data.days[0].videoUrl.includes('youtu.be'),'full match link saved');
  ok((await post('setMatchVideo',{dayId,videoUrl:'https://evil.test/video'},'black-user')).status===403,'player cannot edit match replay');
  const clipBytes=Buffer.concat([Buffer.from([0,0,0,20]),Buffer.from('ftyp'),Buffer.alloc(32)]);
  async function videoUpload(user,values){const f=new FormData();for(const [k,v] of Object.entries(values))f.set(k,v);f.set('video',new File([clipBytes],'clip.mp4',{type:'video/mp4'}));const req=new Request(origin+'/api/video',{method:'POST',headers:{Origin:origin,'Cf-Access-Jwt-Assertion':await accessToken(user)},body:f});return mf.dispatchFetch(req.url,{method:'POST',headers:Object.fromEntries(req.headers),body:await req.arrayBuffer()});}
  ok((await videoUpload('black-user',{target:'profile',playerId:black.id,kind:'Goal'})).status===403,'players cannot post their own highlights');
  ok((await videoUpload('owner',{target:'profile',playerId:black.id,kind:'Goal',note:'First strike'})).status===200,'organiser posts player highlight');
  state=(await get()).data;const clipKey=state.players.find(p=>p.id===black.id).highlights[0].key;
  ok((await mf.dispatchFetch(origin+'/api/video?key='+encodeURIComponent(clipKey),{headers:{...await headers('black-user'),Range:'bytes=0-11'}})).status===206,'member can seek highlight video');
  ok((await mf.dispatchFetch(origin+'/api/video?key='+encodeURIComponent(clipKey),{headers:await headers('intruder')})).status===403,'non-member cannot watch video');
  ok((await mf.dispatchFetch(origin+'/api/video?key='+encodeURIComponent(clipKey),{method:'DELETE',headers:await headers('black-user')})).status===403,'player cannot remove highlight');
  await success('archivePlayer',{playerId:red.id});
  state=(await get()).data;ok(state.players.find(p=>p.id===red.id).active===false&&state.days[0].rounds[0].goals.length===3,'archive preserves historical goals');
  ok((await post('vote',{dayId,candidate:black.id},'red-user')).status===400,'archived player cannot vote');
  await success('restorePlayer',{playerId:red.id});
  ok((await get('red-user')).data.me===red.id,'restored player keeps account');
  // Admins: only the owner grants or removes admin rights.
  ok((await post('setAdmin',{playerId:white.id,admin:true},'black-user')).status===403,'players cannot grant admin');
  await success('setAdmin',{playerId:white.id,admin:true});
  const whiteView=(await get('white-user')).data;ok(whiteView.isAdmin&&!whiteView.isOwner&&whiteView.owner===owner.id&&whiteView.admins.includes(white.id),'promoted admin sees admin role');
  await success('addPlayer',{...fields,name:'Admin signing',team:'white'},'white-user');
  const signing=(await get()).data.players.find(p=>p.name==='Admin signing');
  ok((await post('setAdmin',{playerId:signing.id,admin:true})).status===400,'unlinked players cannot be admins');
  await success('setMatchVideo',{dayId,videoUrl:'https://youtu.be/dQw4w9WgXcQ'},'white-user');
  ok((await videoUpload('white-user',{target:'profile',playerId:black.id,kind:'Save'})).status===200,'admin posts player highlight');
  const adminClip=(await get()).data.players.find(p=>p.id===black.id).highlights.at(-1).key;
  ok((await mf.dispatchFetch(origin+'/api/video?key='+encodeURIComponent(adminClip),{method:'DELETE',headers:await headers('white-user')})).status===200,'admin removes highlight');
  ok((await post('setAdmin',{playerId:black.id,admin:true},'white-user')).status===403,'admins cannot grant admin');
  ok((await post('setAdmin',{playerId:owner.id,admin:false},'white-user')).status===403,'admins cannot demote the owner');
  ok((await post('setAdmin',{playerId:owner.id,admin:false})).status===400,'owner always stays an admin');
  ok((await post('setAdmin',{playerId:white.id,admin:true})).status===400,'admin change must change something');
  await success('setAdmin',{playerId:black.id,admin:true});
  ok((await post('archivePlayer',{playerId:black.id},'white-user')).status===403,'admins cannot remove another admin');
  ok((await post('setAdmin',{playerId:black.id,admin:false},'owner',(await get()).data.revision-1)).status===409,'stale admin change rejected');
  await success('setAdmin',{playerId:black.id,admin:false});
  ok(!(await get('black-user')).data.isAdmin,'owner demotes admin');
  await success('archivePlayer',{playerId:white.id});
  ok(!(await get()).data.admins.includes(white.id),'removing a player drops admin rights');
  await success('restorePlayer',{playerId:white.id});
  ok(!(await get('white-user')).data.isAdmin,'restored player is not an admin again');
  ok((await post('addPlayer',{...fields,name:'Too late',team:'red'},'white-user')).status===403,'former admin cannot change records');
  // Teams: admins rename and recolour the three fixed team slots.
  const tigers={team:'black',name:'Tigers',letter:'t',color:'#1F7A4D',motto:'Hunt as one.'};
  ok((await post('editTeam',tigers,'black-user')).status===403,'players cannot edit teams');
  for(const color of ['red','#fff','#ggg000'])ok((await post('editTeam',{...tigers,color})).status===400,'team colour must be #rrggbb: '+color);
  ok((await post('editTeam',{...tigers,name:'team red'})).status===400,'team names must differ');
  const beforeTeams=(await get()).data;
  await success('editTeam',tigers);
  const afterTeams=(await get('black-user')).data;
  ok(JSON.stringify(afterTeams.teams.black)===JSON.stringify({name:'Tigers',color:'#1f7a4d',letter:'T',motto:'Hunt as one.'}),'team details saved and normalised');
  ok(afterTeams.teams.red.name==='Team Red'&&JSON.stringify(afterTeams.days)===JSON.stringify(beforeTeams.days)&&afterTeams.players.find(p=>p.id===black.id).team==='black','renaming keeps rosters, rounds and assignments');
  // Scheduling: weekly series and one-off days, each with a time; set up on the day.
  const slot={start:'18:00',end:'19:30'};
  const series=await success('addDays',{from:'2026-09-13',to:'2026-11-29',...slot});
  const seriesDays=(await get()).data.days.filter(d=>series.dayIds.includes(d.id)).sort((x,y)=>x.date.localeCompare(y.date));
  ok(series.dayIds.length===12&&seriesDays.every((d,i)=>d.start==='18:00'&&d.end==='19:30'&&(!i||Date.parse(d.date)-Date.parse(seriesDays[i-1].date)===7*864e5)),'weekly series repeats at the same time');
  const wednesday=(await success('addDays',{from:'2026-09-16',...slot})).dayIds[0];
  const overlap=await success('addDays',{from:'2026-09-09',to:'2026-09-23',start:'07:00',end:'08:30'});
  ok(overlap.dayIds.length===2&&JSON.stringify(overlap.skipped)===JSON.stringify(['2026-09-16']),'series skips dates that already have a match day');
  for(const bad of [{from:'2026-09-01',to:'2027-09-07'},{from:'2026-12-01',start:'08:30',end:'08:30'},{from:'2026-02-30'},{from:'2026-08-30'},{from:'2026-12-08',to:'2026-12-01'},{from:'2026-09-16'}])ok((await post('addDays',{...slot,...bad})).status===400,'invalid schedule rejected: '+JSON.stringify(bad));
  ok((await post('addDays',{from:'2026-12-08',...slot},'black-user')).status===403,'players cannot schedule match days');
  ok((await post('editDay',{dayId:wednesday,date:'2026-09-13',...slot})).status===400,'edited date cannot clash');
  await success('editDay',{dayId:wednesday,date:'2026-09-17',start:'19:00',end:'20:00'});
  const moved=(await get()).data.days.find(d=>d.id===wednesday);ok(moved.date==='2026-09-17'&&moved.start==='19:00'&&moved.end==='20:00','match day moved to a new date and time');
  ok((await post('editDay',{dayId,date:'2026-09-06',...slot})).status===400,'played match days cannot be moved');
  ok((await post('deleteDay',{dayId},'black-user')).status===403,'players cannot cancel match days');
  ok((await post('deleteDay',{dayId})).status===400,'played match days cannot be cancelled');
  await success('deleteDay',{dayId:wednesday});
  ok(!(await get()).data.days.some(d=>d.id===wednesday),'scheduled match day cancelled');
  ok((await videoUpload('owner',{target:'matchday',dayId:series.dayIds[0]})).status===200,'clip added to a scheduled day');
  ok((await post('deleteDay',{dayId:series.dayIds[0]})).status===400,'match day with a clip cannot be cancelled');
  // Each round can carry its own replay link.
  const rounds=(await get()).data.days.find(d=>d.id===dayId).rounds;
  await success('setRoundVideo',{dayId,roundId:rounds[1].id,videoUrl:'https://www.youtube.com/watch?v=dQw4w9WgXcQ'});
  const withLink=(await get('black-user')).data.days.find(d=>d.id===dayId).rounds;
  ok(withLink[1].videoUrl==='https://www.youtube.com/watch?v=dQw4w9WgXcQ'&&!withLink[0].videoUrl&&!withLink[2].videoUrl,'round link saved on that round only');
  ok((await post('setRoundVideo',{dayId,roundId:rounds[1].id,videoUrl:'https://evil.test/v'})).status===400,'round link must be a video host');
  ok((await post('setRoundVideo',{dayId,roundId:rounds[1].id,videoUrl:''},'black-user')).status===403,'players cannot edit round links');
  ok((await post('setRoundVideo',{dayId,roundId:'missing',videoUrl:''})).status===400,'unknown round rejected');
  await success('setRoundVideo',{dayId,roundId:rounds[1].id,videoUrl:''});
  ok(!(await get()).data.days.find(d=>d.id===dayId).rounds[1].videoUrl,'round link cleared');
  // Ten-minute games of any score, and players arriving after the session starts.
  const lateDay=series.dayIds[1];
  ok((await post('addAttendee',{dayId:lateDay,playerId:white.id})).status===400,'late arrivals need a set-up matchday');
  await success('setupDay',{dayId:lateDay,roster:[owner.id,black.id,white.id],a:'red',b:'black',firstExit:'red'});
  await success('addRound',{dayId:lateDay,scoreA:3,scoreB:1,lineup:[owner.id,black.id],goals:[goal('red',owner.id),goal('red',owner.id),goal('red',null),goal('black',black.id)]});
  ok((await post('addRound',{dayId:lateDay,scoreA:2,scoreB:1,lineup:[owner.id,white.id],goals:[goal('red',owner.id)]})).status===400,'goal entries must match the score');
  await success('addAttendee',{dayId:lateDay,playerId:red.id});
  ok((await get()).data.days.find(d=>d.id===lateDay).roster.some(p=>p.id===red.id&&p.team==='red'),'late arrival joins with their team');
  ok((await post('addAttendee',{dayId:lateDay,playerId:red.id})).status===400,'late arrival cannot be added twice');
  ok((await post('addAttendee',{dayId:lateDay,playerId:'missing'})).status===400,'unknown late arrival rejected');
  await success('archivePlayer',{playerId:signing.id});
  ok((await post('addAttendee',{dayId:lateDay,playerId:signing.id})).status===400,'removed players cannot arrive late');
  await success('restorePlayer',{playerId:signing.id});
  ok((await post('addAttendee',{dayId:lateDay,playerId:signing.id},'black-user')).status===403,'players cannot add attendees');
  await success('addRound',{dayId:lateDay,scoreA:2,scoreB:2,lineup:[owner.id,red.id,white.id],goals:[goal('red',red.id),goal('red',owner.id),goal('white',white.id),goal('white',white.id)]});
  const lateRounds=(await get()).data.days.find(d=>d.id===lateDay).rounds;
  ok(lateRounds[0].scoreA===3&&lateRounds[1].a==='red'&&lateRounds[1].b==='white'&&lateRounds[1].scoreB===2&&lateRounds[1].exit==='red','any score allowed and a draw sends the longest-on team off');
  for(const r of [...lateRounds].reverse())await success('undoRound',{dayId:lateDay,roundId:r.id});
  await success('openPoll',{dayId:lateDay});
  ok((await post('addAttendee',{dayId:lateDay,playerId:signing.id})).status===400,'attendance locks once voting opens');
  const stale=state.revision;
  ok((await post('editPlayer',{...fields,...red,name:'Wrong overwrite'},'owner',stale)).status===409,'stale updates rejected');
  state=(await get()).data;ok(!JSON.stringify(state).includes('userId')&&!JSON.stringify(state).includes('inviteHash'),'private identity and invitation hashes not disclosed');
  const form=new FormData();form.set('photo',new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jq24AAAAASUVORK5CYII=','base64')],'avatar.png',{type:'image/png'}));
  const serialized=new Request(origin+'/api/photo',{method:'POST',headers:{Origin:origin,'Cf-Access-Jwt-Assertion':await accessToken('black-user')},body:form});
  const upload=await mf.dispatchFetch(serialized.url,{method:'POST',headers:Object.fromEntries(serialized.headers),body:await serialized.arrayBuffer()});
  ok(upload.status===200,'authenticated photo upload saved: '+upload.status+' '+await upload.text());
  const photo=(await get()).data.players.find(p=>p.id===black.id).photo;
  const photoRes=await mf.dispatchFetch(origin+'/api/photo?key='+encodeURIComponent(photo),{headers:await headers('black-user')});
  ok(photoRes.status===200&&photoRes.headers.get('content-type')==='image/png','stored photo served');
  ok((await mf.dispatchFetch(origin+'/api/photo?key='+encodeURIComponent(photo))).status===401,'photo needs sign-in');
  const ts=require('typescript');const source=await readFile('lib/club.ts','utf8');const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;const model=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
  ok(model.embedVideo('https://youtu.be/dQw4w9WgXcQ')==='https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'&&!model.isVideoUrl('http://youtube.com/x')&&model.isVideoUrl('https://vimeo.com/1')&&model.weeklyDates('2026-09-13','2026-11-29').length===12,'video links and weekly dates');
  const played=(id,roster)=>({id,date:'2026-09-06',start:'07:00',end:'08:30',roster,opening:['red','black'],firstExit:'red',poll:'ready',rounds:[{id:'r',a:'red',b:'black',scoreA:0,scoreB:0,goals:[],lineup:[],exit:'red',winner:null}]});
  const [regular]=model.playerStats([{id:'p',name:'P',team:'red'}],[played('d1',[{id:'p',team:'red'}]),played('d2',[]),{...played('d3',[{id:'p',team:'red'}]),rounds:[]}]);
  ok(regular.attended===1&&regular.attendance===50,'attendance counts played matchdays only');
  // Past matchdays archive: played days before today, newest first.
  const onDate=(id,date,rounds=1)=>({...played(id,[]),date,rounds:played(id,[]).rounds.slice(0,rounds)});
  const archive=model.pastMatchdays([onDate('sep06','2026-09-06'),onDate('sep20','2026-09-20'),onDate('sep13','2026-09-13'),onDate('today','2026-10-08'),onDate('future','2026-10-15')],'2026-10-08').map(d=>d.id);
  ok(JSON.stringify(archive)==='["sep20","sep13","sep06"]','past matchdays list days before today, newest first');
  ok(model.pastMatchdays([onDate('empty','2026-09-06',0)],'2026-10-08').length===0,'past matchdays skip days with no rounds');
  ok(JSON.stringify(model.awardWinners([{candidate:'a',votes:3},{candidate:'b',votes:3},{candidate:'c',votes:1}]).map(w=>w.candidate))==='["a","b"]'&&model.awardWinners([]).length===0,'player of the day is everyone tied on the most votes');
  const squad=[{id:'r1',team:'red'},{id:'w1',team:'white'}];
  ok(JSON.stringify(model.teamsWithout(squad.map(p=>p.id),squad))==='["black"]'&&JSON.stringify(model.teamsWithout(['r1'],squad))==='["black","white"]'&&model.teamsWithout(['r1','w1','b1'],[...squad,{id:'b1',team:'black'}]).length===0,'matchday setup names the teams with nobody attending');
  // League table: 3 points a win, 1 a draw; GF, GA and GD add up over every game played.
  const game=(a,b,scoreA,scoreB)=>({id:a+b+scoreA+scoreB,a,b,scoreA,scoreB,goals:[],lineup:[],exit:a,winner:scoreA===scoreB?null:scoreA>scoreB?a:b});
  const table=model.teamStats([{...played('t1',[]),rounds:[game('red','black',1,0),game('black','white',0,0),game('white','black',0,0),game('black','red',0,0),game('red','white',0,3)]}]);
  const pts=Object.fromEntries(table.map(s=>[s.team,s]));
  ok(pts.red.points===4&&pts.black.points===3&&pts.white.points===5,'points are 3 per win and 1 per draw');
  ok(table[0].team==='white'&&pts.black.wins===0&&table[1].team==='red','table is ranked by points first');
  function balanced(stats,days){const rounds=days.flatMap(d=>d.rounds);return stats.every(s=>{const mine=rounds.filter(r=>r.a===s.team||r.b===s.team);return s.played===mine.length&&s.wins+s.draws+s.losses===s.played&&s.gf===mine.reduce((n,r)=>n+(r.a===s.team?r.scoreA:r.scoreB),0)&&s.ga===mine.reduce((n,r)=>n+(r.a===s.team?r.scoreB:r.scoreA),0)&&s.gd===s.gf-s.ga&&s.points===3*s.wins+s.draws})&&stats.reduce((n,s)=>n+s.gf,0)===stats.reduce((n,s)=>n+s.ga,0)&&stats.reduce((n,s)=>n+s.gd,0)===0;}
  ok(balanced(table,[{rounds:[game('red','black',1,0),game('black','white',0,0),game('white','black',0,0),game('black','red',0,0),game('red','white',0,3)]}]),'GF, GA, GD and results add up on a mixed session');
  ok(balanced(model.teamStats(state.days),state.days),'GF, GA, GD and results add up over the whole season');
  // Live gameday drafts: score derives from the goals list; the 10-minute clock pauses and resumes.
  const draft={...model.freshDraft(['p1','p2']),goals:[{team:'red',scorer:'p1',assist:null,ownGoal:false},{team:'black',scorer:'p1',assist:null,ownGoal:true},{team:'red',scorer:null,assist:null,ownGoal:false}]};
  const payload=model.roundPayload(draft,'red','black');
  ok(payload.scoreA===2&&payload.scoreB===1&&payload.goals.length===3&&JSON.stringify(payload.lineup)==='["p1","p2"]','round payload derives the score from goals');
  ok(model.gameClock({...draft,elapsed:60000,startedAt:1000},121000)===model.GAME_MS-180000&&model.gameClock({...draft,elapsed:60000,startedAt:null},999999)===model.GAME_MS-60000&&model.gameClock({...draft,elapsed:0,startedAt:0},model.GAME_MS*2)===0,'game clock counts down, pauses, and stops at zero');
  ok(model.draftKey('d1',3)!==model.draftKey('d1',4)&&model.draftKey('d1',3)!==model.draftKey('d2',3),'each game of each day has its own draft');
  ok(model.teamInk('#171918')==='#fffef9'&&model.teamInk('#eceddf')==='#173322'&&model.teamInk('#ff666b')==='#173322','crest text picks the more legible ink');
  const t=model.teamStats(state.days),p=model.playerStats(state.players,state.days);
  ok(t.find(x=>x.team==='red').wins===1&&t.find(x=>x.team==='black').wins===1,'team wins derived correctly');
  ok(p.find(x=>x.id===owner.id).goals===2&&p.find(x=>x.id===red.id).assists===1&&p.find(x=>x.id===red.id).played===1,'goals assists and selective appearances correct');
  // Free-tier guardrails: tiny R2 budgets that the steps below hit exactly.
  const pngBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jq24AAAAASUVORK5CYII=','base64');
  async function send(instance,path,user,fields){const f=new FormData();for(const [k,v] of Object.entries(fields))f.set(k,v);const req=new Request(origin+path,{method:'POST',headers:{Origin:origin,'Cf-Access-Jwt-Assertion':await accessToken(user)},body:f});const r=await instance.dispatchFetch(req.url,{method:'POST',headers:Object.fromEntries(req.headers),body:await req.arrayBuffer()});return {status:r.status,error:(await r.json()).error}}
  const photoFile=()=>new File([pngBytes],'avatar.png',{type:'image/png'}),clipFile=()=>new File([clipBytes],'clip.mp4',{type:'video/mp4'});
  async function setUp(instance){await migrate(instance);const r=await instance.dispatchFetch(origin+'/api/club',{method:'POST',headers:await headers('owner'),body:JSON.stringify({action:'initialize',key:'test-setup-secret',name:'Organiser',team:'red',revision:0})});assert.equal(r.status,200);const club=await (await instance.dispatchFetch(origin+'/api/club',{headers:await headers('owner')})).json();return club.players[0].id}
  async function storedObjects(instance){return (await (await instance.getR2Bucket('BUCKET')).list()).objects.length}
  // Team photos: admins upload a crest picture per team; members can view it.
  const objectsBefore=await storedObjects(mf),bucket=await mf.getR2Bucket('BUCKET');
  ok((await send(mf,'/api/photo','black-user',{target:'team',team:'black',photo:photoFile()})).status===403,'players cannot upload team photos');
  ok(await storedObjects(mf)===objectsBefore,'refused team photo stores nothing');
  ok((await send(mf,'/api/photo','owner',{target:'team',team:'purple',photo:photoFile()})).status===400,'unknown team rejected');
  ok((await send(mf,'/api/photo','owner',{target:'team',team:'black',photo:new File([Buffer.from('not an image')],'x.png',{type:'image/png'})})).status===400,'team photo must be an image');
  ok((await send(mf,'/api/photo','owner',{target:'team',team:'black',photo:photoFile()})).status===200,'admin uploads a team photo');
  const firstCrest=(await get('black-user')).data.teams.black.photo;
  ok(/^teams\//.test(firstCrest),'team photo saved on the team');
  ok((await mf.dispatchFetch(origin+'/api/photo?key='+encodeURIComponent(firstCrest),{headers:await headers('black-user')})).status===200,'members see team photos');
  ok((await mf.dispatchFetch(origin+'/api/photo?key='+encodeURIComponent(firstCrest))).status===401,'team photos need sign-in');
  await success('editTeam',{team:'black',name:'Tigers',letter:'T',color:'#1f7a4d',motto:'Hunt as one.'});
  ok((await get()).data.teams.black.photo===firstCrest,'editing a team keeps its photo');
  ok((await send(mf,'/api/photo','owner',{target:'team',team:'black',photo:photoFile()})).status===200,'admin replaces a team photo');
  const secondCrest=(await get()).data.teams.black.photo;
  ok(secondCrest!==firstCrest&&!(await bucket.head(firstCrest)),'replaced team photo is deleted');
  ok((await mf.dispatchFetch(origin+'/api/photo?team=black',{method:'DELETE',headers:await headers('black-user')})).status===403,'players cannot remove team photos');
  ok((await mf.dispatchFetch(origin+'/api/photo?team=black',{method:'DELETE',headers:await headers('owner')})).status===200,'admin removes a team photo');
  ok(!(await get()).data.teams.black.photo&&!(await bucket.head(secondCrest)),'removed team photo and its object are gone');
  const tight=new Miniflare({...workerOptions,bindings:{...accessBindings,...budget({storage:pngBytes.length+clipBytes.length,classA:4,classB:1})}});
  try{
    const ownerId=await setUp(tight);
    ok((await send(tight,'/api/photo','owner',{photo:new File([Buffer.from('not an image')],'x.png',{type:'image/png'})})).status===400,'invalid upload rejected');
    ok((await send(tight,'/api/photo','intruder',{photo:photoFile()})).status===403,'non-member upload rejected');
    ok((await send(tight,'/api/photo','owner',{photo:photoFile()})).status===200,'photo fits the budget');
    const clip={target:'profile',playerId:ownerId,kind:'Goal'};
    ok((await send(tight,'/api/video','owner',{...clip,video:clipFile()})).status===200,'clip fills storage exactly');
    const full=await send(tight,'/api/video','owner',{...clip,video:clipFile()});
    ok(full.status===503&&/storage is full/i.test(full.error),'upload past the storage quota refused: '+JSON.stringify(full));
    ok(await storedObjects(tight)===2,'refused upload stores nothing');
    const club=await (await tight.dispatchFetch(origin+'/api/club',{headers:await headers('owner')})).json();
    const [firstClip]=club.players[0].highlights;
    ok((await tight.dispatchFetch(origin+'/api/video?key='+encodeURIComponent(firstClip.key),{method:'DELETE',headers:await headers('owner')})).status===200,'organiser removes clip');
    ok((await send(tight,'/api/video','owner',{...clip,video:clipFile()})).status===200,'removing a clip frees its storage');
    const monthly=await send(tight,'/api/video','owner',{...clip,video:clipFile()});
    ok(monthly.status===503&&/next month/i.test(monthly.error),'upload past the monthly Class A limit refused: '+JSON.stringify(monthly));
    const photoKey=(await (await tight.dispatchFetch(origin+'/api/club',{headers:await headers('owner')})).json()).players[0].photo;
    const ownerHeaders=await headers('owner');
    const view=()=>tight.dispatchFetch(origin+'/api/photo?key='+encodeURIComponent(photoKey),{headers:ownerHeaders});
    ok((await view()).status===200,'photo view fits the Class B limit');
    ok((await view()).status===503,'view past the monthly Class B limit refused');
  }finally{await tight.dispose()}
  const unbudgeted=new Miniflare({...workerOptions,bindings:accessBindings});
  try{
    await setUp(unbudgeted);
    ok((await send(unbudgeted,'/api/photo','owner',{photo:photoFile()})).status===503,'missing R2 budget configuration fails closed');
    ok(await storedObjects(unbudgeted)===0,'unbudgeted upload stores nothing');
  }finally{await unbudgeted.dispose()}
  // Data migrations upgrade a club saved before them.
  const oldClub=new Miniflare({...workerOptions,bindings:accessBindings});
  try{
    await migrate(oldClub,f=>f<'0004');
    await (await oldClub.getD1Database('DB')).prepare('INSERT INTO club (id,revision,data) VALUES (1,0,?)').bind(JSON.stringify({adminId:'owner',players:[{id:'legacy-owner',name:'Organiser',team:'red',userId:'owner',age:null,height:null,district:null,position:'All-rounder',photo:null}],days:[{id:'legacy-day',date:'2026-09-06',roster:[{id:'legacy-owner',team:'red'}],opening:['red','black'],firstExit:'red',rounds:[],poll:'ready'}]})).run();
    await migrate(oldClub,f=>f>='0004');
    const view=await (await oldClub.dispatchFetch(origin+'/api/club',{headers:await headers('owner')})).json();
    ok(view.isOwner&&view.isAdmin&&view.owner==='legacy-owner'&&Array.isArray(view.admins)&&view.admins.length===0,'oldClub club gains an empty admin list');
    const added=await oldClub.dispatchFetch(origin+'/api/club',{method:'POST',headers:await headers('owner'),body:JSON.stringify({action:'addPlayer',revision:view.revision,...fields,name:'New signing',team:'black'})});
    ok(added.status===200,'owner keeps admin rights after migration');
    ok(JSON.stringify(view.teams)===JSON.stringify(model.DEFAULT_TEAMS),'legacy club gains the default team details');
    ok(view.days[0].start==='07:00'&&view.days[0].end==='08:30'&&model.isReady(view.days[0]),'legacy match days keep their 7:00–8:30 slot and setup');
  }finally{await oldClub.dispose()}
  console.log(JSON.stringify({passed:checks,productionDataTouched:false}));
}finally{await mf.dispose()}
