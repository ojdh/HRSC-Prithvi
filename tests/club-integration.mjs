// Runs against an isolated Worker/D1/R2 emulator. Never touches the hosted club.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
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
  const fields={birthYear:2000,birthMonth:5,height:170,district:'Kathmandu',position:'Midfielder'};
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
  const personal={name:'Black player updated',birthYear:1999,birthMonth:12,height:181,district:'Pokhara',position:'Forward'};
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
  const thisYear=Number(new Date().toLocaleDateString('en-CA',{timeZone:'America/Edmonton'}).slice(0,4));
  for(const bad of [{birthMonth:0},{birthMonth:13},{birthMonth:5.5},{birthYear:1939},{birthYear:thisYear-4},{birthYear:'2000'},{birthYear:2000,birthMonth:null},{birthYear:null,birthMonth:5}])ok((await post('profile',{...personal,...bad},'black-user')).status===400,'invalid birth year or month rejected: '+JSON.stringify(bad));
  ok((await post('addPlayer',{...fields,birthMonth:null,name:'Half birthday',team:'red'})).status===400,'admins also need both birth year and month, or neither');
  ok((await post('profile',{...personal,age:30},'black-user')).status===403,'age is no longer a profile field');
  await success('profile',{...personal,birthYear:null,birthMonth:null},'black-user');
  ok((await get()).data.players.find(p=>p.id===black.id).birthYear===null,'birth year and month can both be cleared');
  await success('profile',personal,'black-user');
  ok((await post('profile',personal,'black-user',beforeProfile.revision)).status===409,'stale profile save cannot overwrite newer records');
  const legacy=await mf.dispatchFetch(origin+'/?view=vote&day=legacy',{redirect:'manual'});
  ok(legacy.status>=300&&legacy.status<400&&legacy.headers.get('location')==='/winterleague?view=vote&day=legacy','old voting links redirect to the league');
  for(const query of ['team=red','tab=log','player=p1']){const r=await mf.dispatchFetch(origin+'/?'+query,{redirect:'manual'});ok(r.status>=300&&r.status<400&&r.headers.get('location')==='/winterleague?'+query,'site links with '+query+' redirect to the league')}
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
  // Player photos: a player removes their own; admins remove anyone's.
  const removePhoto=async(user,playerId,extra={})=>(await mf.dispatchFetch(origin+'/api/photo?player='+encodeURIComponent(playerId),{method:'DELETE',headers:{...await headers(user),...extra}})).status;
  const photoBucket=await mf.getR2Bucket('BUCKET'),ledger=async key=>(await (await mf.getD1Database('DB')).prepare('SELECT COUNT(*) AS n FROM r2_objects WHERE key=?').bind(key).first()).n;
  ok(await removePhoto('white-user',black.id)===403,'players cannot remove another player\'s photo');
  ok(await removePhoto(null,black.id)===401,'removing a photo needs sign-in');
  ok(await removePhoto('black-user',black.id,{Origin:'https://evil.test'})===403,'photo removal must come from the club website');
  ok((await get()).data.players.find(p=>p.id===black.id).photo===photo&&!!(await photoBucket.head(photo))&&await ledger(photo)===1,'refused photo removal leaves the photo and its object');
  ok(await removePhoto('owner','missing-player')===404,'unknown player photo rejected');
  ok(await removePhoto('black-user',black.id)===200,'player removes their own photo');
  ok((await get()).data.players.find(p=>p.id===black.id).photo===null&&!(await photoBucket.head(photo))&&await ledger(photo)===0,'removed player photo and its object are gone');
  ok(await removePhoto('black-user',black.id)===400,'removing a missing photo is rejected');
  const again=await send(mf,'/api/photo','black-user',{photo:new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jq24AAAAASUVORK5CYII=','base64')],'avatar.png',{type:'image/png'})});
  ok(again.status===200,'player uploads a new photo');
  const secondPhoto=(await get()).data.players.find(p=>p.id===black.id).photo;
  ok(await removePhoto('owner',black.id)===200&&!(await photoBucket.head(secondPhoto))&&(await get()).data.players.find(p=>p.id===black.id).photo===null,'admin removes another player\'s photo');
  // lib modules load as data URLs, so a lib import of './club' is pointed at the loaded club module.
  const ts=require('typescript');
  async function libModule(file,deps={}){let js=ts.transpileModule(await readFile(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;for(const [name,url] of Object.entries(deps))js=js.replaceAll(`from '${name}'`,`from '${url}'`);const url='data:text/javascript;base64,'+Buffer.from(js).toString('base64');return {url,module:await import(url)}}
  const club=await libModule('lib/club.ts'),model=club.module;
  // URL routing: every address parses to one page state and builds back to the same address.
  const routes=(await libModule('lib/routes.ts',{'./club':club.url})).module;
  const parsed=search=>JSON.stringify(routes.parseRoute(search));
  for(const route of [{view:'overview'},{view:'matchdays',day:'d1'},{view:'vote',day:'d1'},{view:'gameday',day:'d1'},{view:'admin',day:'d1',tab:'results'},{view:'admin',tab:'log'},{view:'players',team:'red'},{view:'standings',player:'p1'},{view:'players',team:'white',player:'p2'},{view:'board'},{view:'profile'},{view:'guide'}])
    ok(parsed(routes.routeSearch(route))===JSON.stringify(route),'route round trip '+JSON.stringify(route));
  ok(routes.routeSearch({view:'overview'})===''&&routes.routeSearch({view:'vote',day:'d 1'})==='?view=vote&day=d+1','home has a bare address; values are encoded');
  ok(parsed('?view=vote&day=legacy')===JSON.stringify({view:'vote',day:'legacy'}),'shared vote links keep their day');
  ok(parsed('?team=black')===JSON.stringify({view:'players',team:'black'}),'a team on its own opens that squad');
  ok(parsed('?view=players&team=purple')===JSON.stringify({view:'players'})&&parsed('?view=nowhere&day=x')===JSON.stringify({view:'overview'}),'unknown teams and pages fall back');
  ok(parsed('?view=admin&tab=bogus')===JSON.stringify({view:'admin'})&&parsed('?view=standings&day=x&tab=log&team=red')===JSON.stringify({view:'standings'}),'parameters a page does not use are dropped');
  ok(parsed('?player=p9&invite_error=1')===JSON.stringify({view:'overview',player:'p9'}),'a player card opens over any page; other parameters are ignored');
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
  // Ages come from birth year and month; the birthday counts as reached on the first of its month.
  ok(model.ageFrom(2000,5,'2026-05-01')===26&&model.ageFrom(2000,6,'2026-05-31')===25&&model.ageFrom(2000,12,'2026-11-30')===25&&model.ageFrom(2000,12,'2026-12-01')===26&&model.ageFrom(2000,1,'2027-01-15')===27&&model.ageFrom(null,null,'2026-05-01')===null&&model.ageFrom(2000,null,'2026-05-01')===null,'age counts whole years from birth year and month');
  ok(model.isBirthMonth({birthYear:2000,birthMonth:12},'2026-12-31')&&!model.isBirthMonth({birthYear:2000,birthMonth:1},'2026-12-31')&&model.isBirthMonth({birthYear:2000,birthMonth:1},'2027-01-01')&&!model.isBirthMonth({birthYear:null,birthMonth:null},'2026-12-01')&&!model.isBirthMonth({},'2026-12-01'),'birthday month spans the month boundary correctly');
  ok(model.teamInk('#171918')==='#fffef9'&&model.teamInk('#eceddf')==='#173322'&&model.teamInk('#ff666b')==='#173322','crest text picks the more legible ink');
  const t=model.teamStats(state.days),p=model.playerStats(state.players,state.days);
  ok(t.find(x=>x.team==='red').wins===1&&t.find(x=>x.team==='black').wins===1,'team wins derived correctly');
  ok(p.find(x=>x.id===owner.id).goals===2&&p.find(x=>x.id===red.id).assists===1&&p.find(x=>x.id===red.id).played===1,'goals assists and selective appearances correct');
  // Free-tier guardrails: tiny R2 budgets that the steps below hit exactly.
  const pngBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jq24AAAAASUVORK5CYII=','base64');
  // An array value sends that field once per item, as a multi-file input does.
  async function send(instance,path,user,fields){const f=new FormData();for(const [k,v] of Object.entries(fields))for(const item of [v].flat())f.append(k,item);const req=new Request(origin+path,{method:'POST',headers:{Origin:origin,'Cf-Access-Jwt-Assertion':await accessToken(user)},body:f});const r=await instance.dispatchFetch(req.url,{method:'POST',headers:Object.fromEntries(req.headers),body:await req.arrayBuffer()});const body=await r.json();return {status:r.status,error:body.error,data:body}}
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
  // Correcting a played game, the admin-only edit log, and deleting a played matchday.
  const d1=await mf.getD1Database('DB'),rowsFor=async(table,day)=>(await d1.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE day=?`).bind(day).first('n'));
  const dayOf=async(id,user='owner')=>(await get(user)).data.days.find(d=>d.id===id);
  const editDay=series.dayIds[0];
  await success('setupDay',{dayId:editDay,roster,a:'red',b:'black',firstExit:'red'});
  await success('addRound',{dayId:editDay,scoreA:1,scoreB:0,lineup:[owner.id,black.id],goals:[goal('red',owner.id)]});
  await success('addRound',{dayId:editDay,scoreA:0,scoreB:1,lineup:[owner.id,white.id],goals:[goal('white',white.id)]});
  let edited=(await dayOf(editDay)).rounds;
  const editBody=(round,scoreA,scoreB,goals,lineup)=>({dayId:editDay,roundId:round.id,scoreA,scoreB,goals,lineup});
  for(const [action,body] of [['editRound',editBody(edited[0],0,0,[],[owner.id,black.id])],['requestDayDeletion',{dayId:editDay}],['approveDayDeletion',{dayId:editDay}],['cancelDayDeletion',{dayId:editDay}]])
    ok((await post(action,body,'absent-user')).status===403,'players cannot '+action);
  ok((await post('editRound',editBody(edited[0],2,0,[goal('black',black.id),goal('black',black.id)],[owner.id,black.id]))).status===400,'edited goals must match the edited score');
  ok((await post('editRound',editBody(edited[1],1,0,[goal('red',owner.id)],[owner.id,black.id]))).status===400,'edited lineup must come from that round’s two teams');
  ok((await post('editRound',{...editBody(edited[0],0,0,[],[owner.id,black.id]),roundId:'missing'})).status===400,'unknown round cannot be edited');
  await success('editRound',editBody(edited[0],0,2,[goal('black',black.id),goal('black',null)],[owner.id,black.id]));
  edited=(await dayOf(editDay)).rounds;
  ok(edited[0].winner==='black'&&edited[0].exit==='red'&&edited[0].scoreB===2&&edited[0].goals.length===2,'editing a game recomputes its winner');
  ok(edited[1].a==='red'&&edited[1].b==='white'&&edited[1].winner==='white','later games stay as they were played');
  ok(JSON.stringify(model.nextMatch(await dayOf(editDay)))===JSON.stringify({a:'white',b:'black',waiting:'red',incumbent:'white'}),'next match before editing the last game');
  await success('editRound',editBody(edited[1],2,0,[goal('red',owner.id),goal('red',owner.id)],[owner.id,white.id]));
  const nextAfterEdit=model.nextMatch(await dayOf(editDay));
  ok(nextAfterEdit.a==='red'&&nextAfterEdit.b==='black'&&nextAfterEdit.waiting==='white','editing the last game changes the next match');
  await success('editRound',editBody(edited[1],0,0,[],[owner.id,white.id]));
  ok((await dayOf(editDay)).rounds[1].exit==='red','a drawn edit sends off the team that had stayed on, replayed from earlier games');
  await success('editRound',editBody(edited[0],1,1,[goal('red',owner.id),goal('black',black.id)],[owner.id,black.id]));
  ok((await dayOf(editDay)).rounds[0].exit==='red','a drawn first game sends off the chosen first draw exit');
  const ownerView=(await get()).data,editLog=ownerView.log.filter(e=>e.dayId===editDay&&e.action==='editRound');
  ok(editLog.length===4&&editLog[0].by===owner.id&&editLog[0].roundId===edited[0].id&&editLog[0].before.scoreB===2&&editLog[0].after.scoreA===1&&editLog[0].date==='2026-09-13'&&Date.parse(editLog[0].at)<=Date.now(),'edits are logged newest first with who, when, before and after');
  ok(!('log' in (await get('absent-user')).data),'players never receive the edit log');
  // Voting and a clip on the played day, so deletion has something to clean up.
  await success('openPoll',{dayId:editDay});await success('vote',{dayId:editDay,candidate:owner.id},'black-user');
  const editClip=(await dayOf(editDay)).videoKey;
  ok(editClip&&await bucket.head(editClip)&&await rowsFor('ballots',editDay)===1&&await rowsFor('vote_receipts',editDay)===1,'played day has a ballot, a receipt and a clip');
  ok((await post('deleteDay',{dayId:editDay})).status===400,'a played matchday cannot be cancelled outright');
  ok((await post('requestDayDeletion',{dayId:series.dayIds[3]})).status===400,'unplayed days are cancelled, not put to approval');
  for(const p of [red,white,black])await success('setAdmin',{playerId:p.id,admin:true});
  await success('requestDayDeletion',{dayId:editDay},'red-user');
  ok((await post('requestDayDeletion',{dayId:editDay},'white-user')).status===400,'a deletion is only requested once');
  ok((await post('approveDayDeletion',{dayId:editDay},'red-user')).status===400,'the same admin cannot approve twice');
  ok(!(await success('approveDayDeletion',{dayId:editDay},'white-user')).deleted,'an approval short of the threshold reports the day as kept');
  const pending=await dayOf(editDay);
  ok(pending&&pending.deletion.requestedBy===red.id&&pending.deletion.approvals.length===2,'two admin approvals do not delete a played matchday');
  ok(!('deletion' in await dayOf(editDay,'absent-user')),'players never see deletion requests');
  const third=await success('approveDayDeletion',{dayId:editDay},'black-user');
  ok(!await dayOf(editDay)&&third.deleted===true,'a third admin approval deletes the matchday and says so');
  ok(await rowsFor('ballots',editDay)===0&&await rowsFor('vote_receipts',editDay)===0,'deleting a matchday removes its ballots and receipts');
  ok(!await bucket.head(editClip),'deleting a matchday removes its clip from storage');
  const deletionLog=(await get()).data.log.filter(e=>e.dayId===editDay).map(e=>e.action);
  ok(JSON.stringify(deletionLog.slice(0,4))===JSON.stringify(['deleteDay','approveDayDeletion','approveDayDeletion','requestDayDeletion'])&&(await get()).data.log[0].date==='2026-09-13','deletion steps are logged and the log outlives the day');
  // Approvals count only people who are admins when the decision is made.
  await success('requestDayDeletion',{dayId:lateDay},'red-user');await success('approveDayDeletion',{dayId:lateDay},'white-user');
  await success('setAdmin',{playerId:white.id,admin:false});
  await success('approveDayDeletion',{dayId:lateDay},'black-user');
  ok(await dayOf(lateDay),'approvals from a former admin do not count');
  await success('cancelDayDeletion',{dayId:lateDay},'black-user');
  ok(!(await dayOf(lateDay)).deletion&&(await get()).data.log[0].action==='cancelDayDeletion','any admin can withdraw a deletion request');
  ok((await post('approveDayDeletion',{dayId:lateDay},'red-user')).status===400,'a withdrawn request cannot be approved');
  await success('requestDayDeletion',{dayId});
  ok(!await dayOf(dayId)&&await rowsFor('ballots',dayId)===0&&await rowsFor('vote_receipts',dayId)===0,'the owner alone deletes a played matchday');
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
    const objectsBeforeRemoval=await storedObjects(tight);
    ok((await tight.dispatchFetch(origin+'/api/photo?player='+encodeURIComponent(ownerId),{method:'DELETE',headers:ownerHeaders})).status===200,'photo removal still works with every monthly R2 budget spent');
    ok(await storedObjects(tight)===objectsBeforeRemoval-1,'removing a photo frees its storage');
  }finally{await tight.dispose()}
  const unbudgeted=new Miniflare({...workerOptions,bindings:accessBindings});
  try{
    await setUp(unbudgeted);
    ok((await send(unbudgeted,'/api/photo','owner',{photo:photoFile()})).status===503,'missing R2 budget configuration fails closed');
    ok(await storedObjects(unbudgeted)===0,'unbudgeted upload stores nothing');
  }finally{await unbudgeted.dispose()}
  // Access sync: inviting a player with an email adds it to the club-members Access group.
  await success('addPlayer',{...fields,name:'Emailed signing',team:'red',email:'signing@example.com'});
  const unsyncedSigning=(await get()).data.players.find(p=>p.name==='Emailed signing');
  const unconfiguredInvite=await post('invite',{playerId:unsyncedSigning.id});
  ok(unconfiguredInvite.status===503&&/Access sync isn't configured/.test(unconfiguredInvite.data.error),'inviting an emailed player without Access config fails loudly: '+JSON.stringify(unconfiguredInvite));
  const manualRules=()=>[{email:{email:'owner@manual.test'}},{email:{email:'admin@manual.test'}},{email_domain:{domain:'partner.test'}}];
  const cfApi={group:null,calls:[],fail:false,onPut:null};
  const groupPath='/client/v4/accounts/test-account/access/groups/test-group';
  async function cloudflareApi(req){
    const url=new URL(req.url);if(url.origin!=='https://api.cloudflare.com')return accessService(req);
    cfApi.calls.push({method:req.method,path:url.pathname,auth:req.headers.get('authorization')});
    const envelope=(result,status=200,errors=[])=>Response.json({success:!errors.length,errors,messages:[],result},{status});
    if(url.pathname!==groupPath)return envelope(null,404,[{code:7003,message:'Could not route'}]);
    if(cfApi.fail)return envelope(null,500,[{code:10000,message:'Internal error'}]);
    if(req.method==='GET')return envelope(cfApi.group);
    if(req.method==='PUT'){const body=await req.json();cfApi.lastPut=body;if(cfApi.onPut)await cfApi.onPut();cfApi.group={...cfApi.group,...body};return envelope(cfApi.group);}
    return envelope(null,405,[{code:10405,message:'Method not allowed'}]);
  }
  const groupEmails=()=>(cfApi.group.include??[]).filter(r=>r.email).map(r=>r.email.email);
  const synced=new Miniflare({...workerOptions,outboundService:cloudflareApi,bindings:{...accessBindings,...budget({storage:1e9,classA:1e6,classB:1e7}),CF_ACCOUNT_ID:'test-account',CF_ACCESS_GROUP_ID:'test-group',CF_API_TOKEN:'test-api-token'}});
  try{
    await setUp(synced);
    const read=async(user='owner')=>(await (await synced.dispatchFetch(origin+'/api/club',{headers:await headers(user)})).json());
    async function call(action,body={},user='owner'){const revision=(await read(user)).revision;const r=await synced.dispatchFetch(origin+'/api/club',{method:'POST',headers:await headers(user),body:JSON.stringify({action,revision,...body})});return {status:r.status,data:await r.json()}}
    const resetGroup=(include=manualRules())=>{cfApi.group={id:'test-group',name:'Club members',include,exclude:[{email:{email:'banned@manual.test'}}],require:[],is_default:false,created_at:'2026-09-01T00:00:00Z'};cfApi.calls=[];cfApi.fail=false;cfApi.onPut=null;};
    resetGroup();
    ok((await call('addPlayer',{...fields,name:'Synced signing',team:'red',email:'  New.Player@Example.COM '})).status===200,'admin sets an email on a new placeholder player');
    ok((await call('addPlayer',{...fields,name:'No email',team:'black'})).status===200,'email stays optional');
    ok((await call('addPlayer',{...fields,name:'Bad email',team:'black',email:'not-an-email'})).status===400,'invalid email rejected');
    ok((await call('addPlayer',{...fields,name:'Twin',team:'black',email:'new.player@example.com'})).status===400,'emails are unique across players');
    let club=await read();const syncedPlayer=club.players.find(p=>p.name==='Synced signing'),noEmail=club.players.find(p=>p.name==='No email');
    ok(syncedPlayer.email==='new.player@example.com'&&!syncedPlayer.accessEmail,'email trimmed and lower-cased, not yet in Access');
    ok(cfApi.calls.length===0,'setting an email never calls Cloudflare');
    // A linked non-admin member for the permission checks.
    const memberToken=(await call('invite',{playerId:noEmail.id})).data.invite;
    ok(cfApi.calls.length===0,'inviting a player without an email never calls Cloudflare');
    ok((await call('claim',{token:memberToken},'member')).status===200,'member claims their invite');
    ok((await call('invite',{playerId:syncedPlayer.id},'member')).status===403&&cfApi.calls.length===0,'non-admin invite refused before any Cloudflare call');
    ok((await call('archivePlayer',{playerId:syncedPlayer.id},'member')).status===403&&cfApi.calls.length===0,'non-admin archive refused before any Cloudflare call');
    ok((await call('profile',{...fields,name:'No email',email:'member@example.com'},'member')).status===403,'players cannot set their own email');
    const memberView=JSON.stringify(await read('member'));
    ok(!memberView.includes('"email"')&&!memberView.includes('accessEmail')&&!memberView.includes('new.player@example.com'),'non-admins never see player emails');
    // Invite: the email joins the group; every other rule is kept.
    const invited=await call('invite',{playerId:syncedPlayer.id});
    ok(invited.status===200&&invited.data.access==='added'&&invited.data.invite,'invite adds the email to Access: '+JSON.stringify(invited));
    ok(JSON.stringify(groupEmails())===JSON.stringify(['owner@manual.test','admin@manual.test','new.player@example.com'])&&cfApi.group.include.some(r=>r.email_domain)&&cfApi.group.exclude.length===1&&cfApi.group.name==='Club members','invite keeps manual emails and other rules');
    ok(cfApi.calls.every(c=>c.path===groupPath&&c.auth==='Bearer test-api-token')&&cfApi.calls.map(c=>c.method).join()==='GET,PUT','invite reads then writes the configured group with the API token');
    ok(!('id' in cfApi.lastPut)&&!('created_at' in cfApi.lastPut)&&cfApi.lastPut.is_default===false&&Array.isArray(cfApi.lastPut.require),'PUT sends only the group fields Cloudflare accepts');
    ok((await read()).players.find(p=>p.id===syncedPlayer.id).accessEmail==='new.player@example.com','accessEmail recorded after the group update');
    cfApi.calls=[];
    const again=await call('invite',{playerId:syncedPlayer.id});
    ok(again.status===200&&again.data.invite===invited.data.invite&&again.data.access==='already'&&groupEmails().length===3&&!cfApi.calls.some(c=>c.method==='PUT'),'re-invite is idempotent');
    // Changing the email of an invited, unclaimed player swaps it in Access.
    ok((await call('editPlayer',{...fields,id:syncedPlayer.id,name:'Synced signing',team:'red',email:'Other@Example.com'})).status===200,'admin changes an invited player\'s email');
    ok(JSON.stringify(groupEmails())===JSON.stringify(['owner@manual.test','admin@manual.test','other@example.com']),'email change swaps old for new in Access');
    ok((await read()).players.find(p=>p.id===syncedPlayer.id).accessEmail==='other@example.com','accessEmail follows the swap');
    ok((await call('editPlayer',{...fields,id:noEmail.id,name:'No email',team:'black',email:'claimed@example.com'})).status===400,'email cannot be set on a claimed player');
    // A failed Cloudflare call leaves the club unchanged.
    cfApi.fail=true;const before=(await read()).revision;
    const failed=await call('editPlayer',{...fields,id:syncedPlayer.id,name:'Synced signing',team:'red',email:'third@example.com'});
    ok(failed.status===502&&/Cloudflare Access/.test(failed.data.error)&&(await read()).revision===before,'Cloudflare failure saves nothing: '+JSON.stringify(failed));
    cfApi.fail=false;
    // A save that loses the revision race undoes its group change.
    cfApi.onPut=async()=>{cfApi.onPut=null;await (await synced.getD1Database('DB')).prepare('UPDATE club SET revision=revision+1 WHERE id=1').run();};
    const raced=await call('editPlayer',{...fields,id:syncedPlayer.id,name:'Synced signing',team:'red',email:'third@example.com'});
    ok(raced.status===409&&JSON.stringify(groupEmails())===JSON.stringify(['owner@manual.test','admin@manual.test','other@example.com']),'failed save rolls the Access change back: '+JSON.stringify(raced));
    // Access changes run one at a time: an overlapping one is refused before it touches the group.
    ok((await call('addPlayer',{...fields,name:'Overlap',team:'white',email:'overlap@example.com'})).status===200,'placeholder for the overlap check');
    const overlapPlayer=(await read()).players.find(p=>p.name==='Overlap');
    let overlapping;cfApi.calls=[];
    cfApi.onPut=async()=>{cfApi.onPut=null;const callsBefore=cfApi.calls.length;overlapping=await call('archivePlayer',{playerId:syncedPlayer.id});overlapping.calls=cfApi.calls.length-callsBefore;};
    const first=await call('invite',{playerId:overlapPlayer.id});
    ok(first.status===200&&overlapping.status===409&&/sign-in access/i.test(overlapping.data.error)&&overlapping.calls===0,'overlapping Access change refused without calling Cloudflare: '+JSON.stringify(overlapping));
    ok(groupEmails().includes('overlap@example.com')&&groupEmails().includes('other@example.com'),'the first change is kept');
    ok((await call('archivePlayer',{playerId:overlapPlayer.id})).status===200&&!groupEmails().includes('overlap@example.com'),'the lock is released after each change');
    await (await synced.getD1Database('DB')).prepare('INSERT INTO access_sync_lock (id,token,expires) VALUES (1,?,?)').bind('abandoned',Date.now()-1).run();
    ok((await call('restorePlayer',{playerId:overlapPlayer.id})).status===200,'overlap player restored');
    ok((await call('invite',{playerId:overlapPlayer.id})).status===200&&groupEmails().includes('overlap@example.com'),'an abandoned lock expires');
    ok((await call('archivePlayer',{playerId:overlapPlayer.id})).status===200,'overlap player archived');
    // Archiving removes only the email the app added.
    cfApi.calls=[];
    ok((await call('archivePlayer',{playerId:syncedPlayer.id})).status===200,'admin archives an invited player');
    ok(JSON.stringify(groupEmails())===JSON.stringify(['owner@manual.test','admin@manual.test'])&&cfApi.group.include.some(r=>r.email_domain),'archive removes the player\'s email and keeps the rest');
    ok(!(await read()).players.find(p=>p.id===syncedPlayer.id).accessEmail,'archive clears accessEmail');
    // An email someone added by hand is never claimed or removed by the app.
    ok((await call('addPlayer',{...fields,name:'Manual admin',team:'white',email:'admin@manual.test'})).status===200,'placeholder may use an email already in Access');
    const manualPlayer=(await read()).players.find(p=>p.name==='Manual admin');
    const manualInvite=await call('invite',{playerId:manualPlayer.id});
    ok(manualInvite.status===200&&manualInvite.data.access==='already'&&!(await read()).players.find(p=>p.id===manualPlayer.id).accessEmail,'manual Access email is not recorded as app-managed');
    cfApi.calls=[];
    ok((await call('archivePlayer',{playerId:manualPlayer.id})).status===200&&groupEmails().includes('admin@manual.test')&&cfApi.calls.length===0,'archiving never removes a manually added email');
    // The Zero Trust Free plan has 50 seats.
    resetGroup(Array.from({length:50},(_,i)=>({email:{email:`member${i}@manual.test`}})));
    ok((await call('addPlayer',{...fields,name:'Seat 51',team:'white',email:'seat51@example.com'})).status===200,'placeholder for the 51st seat');
    const seat51=(await read()).players.find(p=>p.name==='Seat 51');
    const full=await call('invite',{playerId:seat51.id});
    ok(full.status===409&&/50/.test(full.data.error)&&groupEmails().length===50&&!cfApi.calls.some(c=>c.method==='PUT'),'51st Access email refused: '+JSON.stringify(full));
    ok(!(await read()).players.find(p=>p.id===seat51.id).accessEmail,'refused invite records nothing');
  }finally{await synced.dispose()}
  // A group id still at its wrangler.jsonc placeholder counts as unconfigured: deploys go ahead, invites with an email fail loudly.
  const placeholderGroup=new Miniflare({...workerOptions,outboundService:cloudflareApi,bindings:{...accessBindings,CF_ACCOUNT_ID:'test-account',CF_ACCESS_GROUP_ID:'REPLACE_WITH_CLUB_MEMBERS_ACCESS_GROUP_ID',CF_API_TOKEN:'test-api-token'}});
  try{
    await setUp(placeholderGroup);
    const call=async(action,body)=>{const revision=(await (await placeholderGroup.dispatchFetch(origin+'/api/club',{headers:await headers('owner')})).json()).revision;const r=await placeholderGroup.dispatchFetch(origin+'/api/club',{method:'POST',headers:await headers('owner'),body:JSON.stringify({action,revision,...body})});return {status:r.status,data:await r.json()}};
    ok((await call('addPlayer',{...fields,name:'Pending group',team:'red',email:'pending@example.com'})).status===200,'email accepted before Access sync is configured');
    const pending=(await (await placeholderGroup.dispatchFetch(origin+'/api/club',{headers:await headers('owner')})).json()).players.find(p=>p.name==='Pending group');
    cfApi.calls=[];const refused=await call('invite',{playerId:pending.id});
    ok(refused.status===503&&/Access sync isn't configured/.test(refused.data.error)&&cfApi.calls.length===0,'placeholder group id fails loudly without calling Cloudflare: '+JSON.stringify(refused));
  }finally{await placeholderGroup.dispose()}
  // Daily storage clean-up: the cron removes R2 objects nothing references, keeps
  // referenced and freshly uploaded ones, and retries a delete that failed.
  const storageDir=await mkdtemp(join(tmpdir(),'hrsc-cleanup-'));
  const janitorOptions={...workerOptions,bindings:{...accessBindings,...budget({storage:1e9,classA:1e6,classB:1e7})},d1Persist:join(storageDir,'d1'),r2Persist:join(storageDir,'r2')};
  const janitor=new Miniflare(janitorOptions);
  try{
    // Arrange: one stored object of every referenced kind, aged past the grace period, plus orphans a crash could leave
    const ownerId=await setUp(janitor);
    const clubOf=async()=>(await janitor.dispatchFetch(origin+'/api/club',{headers:await headers('owner')})).json();
    const scheduledDay=await janitor.dispatchFetch(origin+'/api/club',{method:'POST',headers:await headers('owner'),body:JSON.stringify({action:'addDays',revision:(await clubOf()).revision,from:'2026-09-06',start:'07:00',end:'08:30'})});
    const [cleanupDay]=(await scheduledDay.json()).dayIds;
    ok((await send(janitor,'/api/photo','owner',{photo:photoFile()})).status===200,'clean-up fixture: player photo stored');
    ok((await send(janitor,'/api/photo','owner',{target:'team',team:'red',photo:photoFile()})).status===200,'clean-up fixture: team photo stored');
    ok((await send(janitor,'/api/video','owner',{target:'profile',playerId:ownerId,kind:'Goal',video:clipFile()})).status===200,'clean-up fixture: highlight stored');
    ok((await send(janitor,'/api/video','owner',{target:'matchday',dayId:cleanupDay,video:clipFile()})).status===200,'clean-up fixture: matchday clip stored');
    ok((await send(janitor,'/api/board','owner',{action:'createPost',team:'red',body:'Kit photos',images:photoFile()})).status===200,'clean-up fixture: board image stored');
    const boardKey=(await (await janitor.dispatchFetch(origin+'/api/board?team=red',{headers:await headers('owner')})).json()).posts[0].images[0];
    const fixture=await clubOf(),referenced=[fixture.players[0].photo,fixture.players[0].highlights[0].key,fixture.teams.red.photo,fixture.days[0].videoKey,boardKey];
    const ledger=await janitor.getD1Database('DB');
    ok((await ledger.prepare('SELECT count(*) AS n FROM r2_objects WHERE created_at>=unixepoch()-60').first()).n===referenced.length,'uploads record when they were stored');
    await ledger.prepare('UPDATE r2_objects SET created_at=unixepoch()-7200').run();
    const orphans={old:'players/orphan-old',legacy:'videos/orphan-legacy',fresh:'players/orphan-fresh'};
    for(const [key,age] of [[orphans.old,7200],[orphans.legacy,null],[orphans.fresh,60]]){
      await (await janitor.getR2Bucket('BUCKET')).put(key,pngBytes);
      await ledger.prepare('INSERT INTO r2_objects(key,bytes,created_at) VALUES(?1,?2,CASE WHEN ?3 IS NULL THEN NULL ELSE unixepoch()-?3 END)').bind(key,pngBytes.length,age).run();
    }
    const runCron=async()=>{const run=await (await janitor.getWorker()).scheduled({cron:'17 9 * * *'});assert.equal(run.outcome,'ok')};
    const inLedger=async key=>!!(await (await janitor.getD1Database('DB')).prepare('SELECT 1 AS found FROM r2_objects WHERE key=?').bind(key).first());
    const inBucket=async key=>!!(await (await janitor.getR2Bucket('BUCKET')).head(key));
    // Act: a run while R2 deletes fail
    await janitor.setOptions({...janitorOptions,r2Buckets:{}});
    await runCron();
    // Assert: the failed deletes keep their ledger rows, so storage stays counted
    ok(await inLedger(orphans.old)&&await inLedger(orphans.legacy),'failed clean-up delete keeps the ledger row');
    // Act: the next daily run, with R2 reachable again
    await janitor.setOptions(janitorOptions);
    await runCron();
    // Assert
    ok(!await inBucket(orphans.old)&&!await inLedger(orphans.old),'orphaned object and its ledger row removed');
    ok(!await inBucket(orphans.legacy)&&!await inLedger(orphans.legacy),'orphan stored before upload times were recorded is removed');
    ok(await inBucket(orphans.fresh)&&await inLedger(orphans.fresh),'object uploaded within the last hour kept');
    for(const key of referenced)ok(await inBucket(key)&&await inLedger(key),'referenced object kept: '+key.split('/')[0]);
  }finally{await janitor.dispose();await rm(storageDir,{recursive:true,force:true})}
  // Team boards: each team's private discussion. Admins read and moderate every board.
  async function clubCall(instance,action,body={},user='owner'){const read=await (await instance.dispatchFetch(origin+'/api/club',{headers:await headers(user)})).json();const r=await instance.dispatchFetch(origin+'/api/club',{method:'POST',headers:await headers(user),body:JSON.stringify({action,revision:read.revision,...body})});const reply=await r.json();assert.equal(r.status,200,action+': '+JSON.stringify(reply));return reply}
  async function linkMember(instance,name,team,user){await clubCall(instance,'addPlayer',{...fields,name,team});const id=(await (await instance.dispatchFetch(origin+'/api/club',{headers:await headers('owner')})).json()).players.find(p=>p.name===name).id;await clubCall(instance,'claim',{token:(await clubCall(instance,'invite',{playerId:id})).invite},user);return id}
  const boards=new Miniflare({...workerOptions,bindings:{...accessBindings,...budget({storage:1e9,classA:1e6,classB:1e7})}});
  try{
    // Arrange: two red players, one black player and one archived white player
    const ownerId=await setUp(boards);
    const redId=await linkMember(boards,'Board red','red','board-red'),red2Id=await linkMember(boards,'Board red two','red','board-red2');
    await linkMember(boards,'Board black','black','board-black');
    await clubCall(boards,'archivePlayer',{playerId:await linkMember(boards,'Board gone','white','board-gone')});
    const readBoard=async(user,team,before)=>{const r=await boards.dispatchFetch(origin+'/api/board?team='+team+(before?'&before='+encodeURIComponent(before):''),{headers:user?await headers(user):{}});return {status:r.status,data:r.status===200?await r.json():null}};
    const boardSend=(user,values)=>send(boards,'/api/board',user,values);
    const boardImage=async(user,key)=>boards.dispatchFetch(origin+'/api/board/image?key='+encodeURIComponent(key),{headers:user?await headers(user):{}});
    const react=(user,targetId,emoji)=>boardSend(user,{action:'react',targetId,emoji});
    const boardDb=await boards.getD1Database('DB'),boardBucket=await boards.getR2Bucket('BUCKET');
    const rows=async table=>(await boardDb.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n'));
    const inLedger=async key=>!!(await boardDb.prepare('SELECT 1 AS found FROM r2_objects WHERE key=?').bind(key).first());
    // Privacy
    const created=await boardSend('board-red',{action:'createPost',team:'red',body:'Training moved to 7.\nBring both kits.',images:[photoFile(),photoFile()]});
    ok(created.status===200,'player posts with two photos on their own team board: '+JSON.stringify(created));
    const redBoard=await readBoard('board-red','red'),post=redBoard.data?.posts[0];
    ok(redBoard.status===200&&post.body==='Training moved to 7.\nBring both kits.'&&post.author===redId&&post.team==='red'&&post.images.length===2,'player reads their own team board');
    ok((await readBoard('board-red','black')).status===403,'another team’s board is private');
    ok((await boardSend('board-red',{action:'createPost',team:'black',body:'Hello rivals'})).status===403,'players cannot post on another team’s board');
    ok((await Promise.all(['red','black','white'].map(t=>readBoard('owner',t)))).every(r=>r.status===200),'admins read every board');
    ok((await boardSend('owner',{action:'createPost',team:'black',body:'From the owner'})).status===403,'admins moderate other boards but do not post on them');
    ok((await readBoard(null,'red')).status===401,'boards need sign-in');
    ok((await readBoard('board-gone','white')).status===403,'archived players lose their board');
    ok((await readBoard('intruder','red')).status===403,'non-members cannot read boards');
    ok((await readBoard('owner','purple')).status===400,'unknown board rejected');
    for(const key of post.images){const r=await boardImage('board-red2',key);ok(r.status===200&&r.headers.get('content-type')==='image/png'&&/^private/.test(r.headers.get('cache-control')),'teammates see post photos privately')}
    ok((await boardImage('board-black',post.images[0])).status===403,'another team’s board photo is private');
    ok((await boardImage(null,post.images[0])).status===401,'board photos need sign-in');
    ok((await boardImage('owner','board/'+crypto.randomUUID())).status===404,'unknown board photo not found');
    // Posting limits: refused before anything is stored
    const objectsBefore=await storedObjects(boards),postsBefore=await rows('board_posts');
    ok((await boardSend('board-red',{action:'createPost',team:'red',body:'Too many',images:Array.from({length:5},photoFile)})).status===400,'a post holds at most four photos');
    ok((await boardSend('board-red',{action:'createPost',team:'red',body:'Not a photo',images:new File([Buffer.from('not an image')],'x.png',{type:'image/png'})})).status===400,'board photos must be images');
    ok((await boardSend('board-red',{action:'createPost',team:'red',body:'   '})).status===400,'a post needs text');
    ok((await boardSend('board-red',{action:'createPost',team:'red',body:'x'.repeat(2001)})).status===400,'posts are capped at 2000 characters');
    ok(await storedObjects(boards)===objectsBefore&&await rows('board_posts')===postsBefore,'refused posts store nothing');
    // The body limit holds while the body is read, so a request that declares no length cannot bypass it.
    const oversized={action:'createPost',team:'red',body:'x'.repeat(9_000_000)};
    async function streamedSend(user,values){const f=new FormData();for(const [k,v] of Object.entries(values))f.append(k,v);const req=new Request(origin+'/api/board',{method:'POST',body:f});const bytes=new Uint8Array(await req.arrayBuffer());
      const body=new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=65536)controller.enqueue(bytes.slice(i,i+65536));controller.close()}});
      return (await boards.dispatchFetch(req.url,{method:'POST',headers:{Origin:origin,'Cf-Access-Jwt-Assertion':await accessToken(user),'Content-Type':req.headers.get('content-type')},body,duplex:'half'})).status}
    ok(await streamedSend('board-red',oversized)===413,'an oversized board request without a declared length is refused while it is read');
    ok(await rows('board_posts')===postsBefore,'oversized requests store nothing');
    // Comments and reactions
    ok((await boardSend('board-red2',{action:'comment',postId:post.id,body:'On my way',images:photoFile()})).status===200,'teammate comments with a photo');
    let fresh=(await readBoard('board-red','red')).data.posts[0];const comment=fresh.comments[0];
    ok(fresh.comments.length===1&&comment.author===red2Id&&comment.body==='On my way'&&!!comment.image&&(await boardImage('board-red',comment.image)).status===200,'the comment and its photo appear on the post');
    ok((await boardSend('board-red2',{action:'comment',postId:post.id,body:'Two photos',images:[photoFile(),photoFile()]})).status===400,'a comment holds one photo');
    ok((await boardSend('board-red2',{action:'comment',postId:post.id,body:'x'.repeat(1001)})).status===400,'comments are capped at 1000 characters');
    ok((await boardSend('board-black',{action:'comment',postId:post.id,body:'Sneaky'})).status===403,'other teams cannot comment');
    ok((await react('board-red2',post.id,'🔥')).status===200&&(await react('board-red',comment.id,'👏')).status===200,'teammates react to posts and comments');
    fresh=(await readBoard('board-red','red')).data.posts[0];
    ok(JSON.stringify(fresh.reactions)===JSON.stringify({'🔥':[red2Id]})&&JSON.stringify(fresh.comments[0].reactions)===JSON.stringify({'👏':[redId]}),'reactions show who reacted');
    ok((await react('board-red2',post.id,'🔥')).status===200&&!(await readBoard('board-red','red')).data.posts[0].reactions['🔥'],'a second tap removes the reaction');
    ok((await react('board-red2',post.id,'💩')).status===400,'only the fixed reactions are allowed');
    ok((await react('board-black',post.id,'👍')).status===403,'other teams cannot react');
    await react('board-red2',post.id,'👍');
    // Deleting: the author or an admin
    ok((await boardSend('board-red2',{action:'deletePost',postId:post.id})).status===403,'a teammate cannot delete someone else’s post');
    const postKeys=[...post.images,comment.image];
    ok((await boardSend('board-red',{action:'deletePost',postId:post.id})).status===200,'the author deletes their own post');
    ok(!(await readBoard('board-red','red')).data.posts.some(p=>p.id===post.id),'the deleted post leaves the board');
    ok(await rows('board_comments')===0&&await rows('board_reactions')===0&&await rows('board_images')===0,'its comments, reactions and photo records are gone');
    for(const key of postKeys)ok(!(await boardBucket.head(key))&&!await inLedger(key),'its stored photos are deleted');
    const adminLog=async()=>(await (await boards.dispatchFetch(origin+'/api/club',{headers:await headers('owner')})).json()).log;
    ok((await adminLog()).length===0,'an author deleting their own post is not logged');
    await boardSend('board-red',{action:'createPost',team:'red',body:'Secret team talk'});
    const victim=(await readBoard('owner','red')).data.posts[0];
    ok((await boardSend('owner',{action:'deletePost',postId:victim.id})).status===200,'an admin removes another player’s post');
    let log=await adminLog();
    ok(log.length===1&&log[0].action==='removePost'&&log[0].by===ownerId&&log[0].team==='red'&&log[0].author===redId&&Date.parse(log[0].at)<=Date.now(),'the removal is logged with who, which team, the author and when');
    ok(!JSON.stringify(log).includes('Secret team talk'),'the log never records the post text');
    await boardSend('board-red',{action:'createPost',team:'red',body:'Kit colours?'});
    const thread=(await readBoard('board-red','red')).data.posts[0];
    await boardSend('board-red2',{action:'comment',postId:thread.id,body:'Red, obviously',images:photoFile()});
    await boardSend('board-red',{action:'comment',postId:thread.id,body:'Agreed'});
    const [ownComment,otherComment]=(await readBoard('board-red','red')).data.posts[0].comments;
    ok((await boardSend('board-red',{action:'deleteComment',commentId:ownComment.id})).status===403,'a teammate cannot delete someone else’s comment');
    ok((await boardSend('board-red2',{action:'deleteComment',commentId:ownComment.id})).status===200&&!(await boardBucket.head(ownComment.image))&&await rows('board_images')===0,'the author deletes their own comment and its photo');
    ok((await boardSend('owner',{action:'deleteComment',commentId:otherComment.id})).status===200&&(await readBoard('board-red','red')).data.posts[0].comments.length===0,'an admin removes another player’s comment');
    log=await adminLog();
    ok(log.length===2&&log[0].action==='removeComment'&&log[0].team==='red'&&log[0].author===redId&&!JSON.stringify(log).includes('Agreed'),'comment removal is logged without its text');
    // Paging: newest first, twenty at a time
    for(let i=0;i<21;i++)await boardSend('board-black',{action:'createPost',team:'black',body:'Post '+i});
    const firstPage=(await readBoard('board-black','black')).data,secondPage=(await readBoard('board-black','black',firstPage.next)).data;
    const paged=[...firstPage.posts,...secondPage.posts].map(p=>p.body);
    ok(firstPage.posts.length===20&&secondPage.posts.length===1&&secondPage.next===null&&new Set(paged).size===21&&firstPage.posts.every((p,i,all)=>!i||all[i-1].createdAt>=p.createdAt),'the feed pages twenty posts at a time, newest first');
  }finally{await boards.dispose()}
  // Board uploads are charged only after sign-in, team access and validation.
  const boardTight=new Miniflare({...workerOptions,bindings:{...accessBindings,...budget({storage:1e9,classA:1,classB:1})}});
  try{
    await setUp(boardTight);await linkMember(boardTight,'Tight black','black','tight-black');
    const used=async column=>(await (await boardTight.getD1Database('DB')).prepare(`SELECT coalesce(sum(${column}),0) AS n FROM r2_usage`).first('n'));
    ok((await send(boardTight,'/api/board','owner',{action:'createPost',team:'red',body:'Bad file',images:new File([Buffer.from('not an image')],'x.png',{type:'image/png'})})).status===400,'invalid board photo rejected');
    ok((await send(boardTight,'/api/board','tight-black',{action:'createPost',team:'red',body:'Wrong board',images:photoFile()})).status===403,'upload to another team’s board refused');
    ok(await used('class_a')===0&&await storedObjects(boardTight)===0,'refused board uploads cost no R2 operation');
    ok((await send(boardTight,'/api/board','owner',{action:'createPost',team:'red',body:'Fits',images:photoFile()})).status===200,'the one budgeted board upload still fits');
    const key=(await (await boardTight.dispatchFetch(origin+'/api/board?team=red',{headers:await headers('owner')})).json()).posts[0].images[0];
    ok((await boardTight.dispatchFetch(origin+'/api/board/image?key='+encodeURIComponent(key),{headers:await headers('tight-black')})).status===403&&await used('class_b')===0,'a refused board photo view costs no R2 operation');
    ok((await boardTight.dispatchFetch(origin+'/api/board/image?key='+encodeURIComponent(key),{headers:await headers('owner')})).status===200,'the one budgeted board photo view still fits');
  }finally{await boardTight.dispose()}
  // Data migrations upgrade a club saved before them.
  const oldClub=new Miniflare({...workerOptions,bindings:accessBindings});
  try{
    await migrate(oldClub,f=>f<'0004');
    await (await oldClub.getD1Database('DB')).prepare('INSERT INTO club (id,revision,data) VALUES (1,0,?)').bind(JSON.stringify({adminId:'owner',players:[{id:'legacy-owner',name:'Organiser',team:'red',userId:'owner',age:null,height:null,district:null,position:'All-rounder',photo:null},{id:'legacy-aged',name:'Aged player',team:'black',age:31,height:null,district:null,position:'Forward',photo:null}],days:[{id:'legacy-day',date:'2026-09-06',roster:[{id:'legacy-owner',team:'red'}],opening:['red','black'],firstExit:'red',rounds:[],poll:'ready'}]})).run();
    await migrate(oldClub,f=>f>='0004');
    const view=await (await oldClub.dispatchFetch(origin+'/api/club',{headers:await headers('owner')})).json();
    ok(view.isOwner&&view.isAdmin&&view.owner==='legacy-owner'&&Array.isArray(view.admins)&&view.admins.length===0,'oldClub club gains an empty admin list');
    const added=await oldClub.dispatchFetch(origin+'/api/club',{method:'POST',headers:await headers('owner'),body:JSON.stringify({action:'addPlayer',revision:view.revision,...fields,name:'New signing',team:'black'})});
    ok(added.status===200,'owner keeps admin rights after migration');
    ok(JSON.stringify(view.teams)===JSON.stringify(model.DEFAULT_TEAMS),'legacy club gains the default team details');
    ok(view.days[0].start==='07:00'&&view.days[0].end==='08:30'&&model.isReady(view.days[0]),'legacy match days keep their 7:00–8:30 slot and setup');
    ok(view.players.length===2&&view.players.every(p=>!('age' in p))&&view.players.find(p=>p.id==='legacy-aged').name==='Aged player','ages are cleared from every player by the birth-month migration');
  }finally{await oldClub.dispose()}
  console.log(JSON.stringify({passed:checks,productionDataTouched:false}));
}finally{await mf.dispose()}
