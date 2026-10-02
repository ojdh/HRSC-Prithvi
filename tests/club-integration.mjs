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
const mf=new Miniflare({...workerOptions,bindings:{CLUB_SETUP_KEY:'test-setup-secret',CF_ACCESS_TEAM_URL:teamUrl,CF_ACCESS_AUD:audience}});
const origin='https://club.test';
let checks=0;
const ok=(value,message)=>{assert.ok(value,message);checks++};
async function headers(user){return {'Content-Type':'application/json',Origin:origin,...(user?{'Cf-Access-Jwt-Assertion':await accessToken(user)}:{})}}
async function get(user='owner'){const r=await mf.dispatchFetch(origin+'/api/club',{headers:await headers(user)});return {status:r.status,data:await r.json()}}
async function post(action,body={},user='owner',revision){const v=revision??(await get(user)).data.revision;const r=await mf.dispatchFetch(origin+'/api/club',{method:'POST',headers:await headers(user),body:JSON.stringify({action,revision:v,...body})});return {status:r.status,data:await r.json()}}
async function success(action,body={},user='owner'){const r=await post(action,body,user);assert.equal(r.status,200,JSON.stringify(r));checks++;return r.data}
try{
  const sql=await readFile('drizzle/0000_simple_lightspeed.sql','utf8');
  async function migrate(instance){const db=await instance.getD1Database('DB');for(const statement of sql.split('--> statement-breakpoint').filter(x=>x.trim()))await db.prepare(statement).run();}
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
  const created=await success('createDay',{date,roster,a:'red',b:'black',firstExit:'red'});
  const dayId=created.dayId;
  await success('openPoll',{dayId});
  ok((await get()).data.days[0].rounds.length===0,'voting opens before any stats');
  ok((await post('attendance',{dayId,roster:[...roster,absent.id]})).status===400,'vote eligibility roster locked');
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
  state=(await get()).data;ok(state.days[0].rounds[0].winner==='red'&&state.days[0].rounds[0].exit==='black','first-to-two result');
  await success('addRound',{dayId,scoreA:1,scoreB:1,lineup:[owner.id,white.id],goals:[goal('red',owner.id),goal('white',white.id)]});
  state=(await get()).data;ok(state.days[0].rounds[1].a==='red'&&state.days[0].rounds[1].b==='white'&&state.days[0].rounds[1].exit==='red','draw rotates previous winner off');
  await success('addRound',{dayId,scoreA:0,scoreB:0,lineup:[white.id,black.id],goals:[]});
  state=(await get()).data;ok(state.days[0].rounds[2].exit==='white','consecutive draw rotates longer-staying side');
  await success('undoRound',{dayId,roundId:state.days[0].rounds[2].id});
  ok((await post('addRound',{dayId,scoreA:2,scoreB:2,lineup:[white.id,black.id],goals:[]})).status===400,'invalid 2-2 score blocked');
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
  const t=model.teamStats(state.days),p=model.playerStats(state.players,state.days);
  ok(t.find(x=>x.team==='red').wins===1&&t.find(x=>x.team==='black').wins===1,'team wins derived correctly');
  ok(p.find(x=>x.id===owner.id).goals===2&&p.find(x=>x.id===red.id).assists===1&&p.find(x=>x.id===red.id).played===1,'goals assists and selective appearances correct');
  console.log(JSON.stringify({passed:checks,productionDataTouched:false}));
}finally{await mf.dispose()}
