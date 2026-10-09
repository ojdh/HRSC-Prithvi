'use client';
import { createContext,useCallback,useContext,useEffect,useState,useRef,type CSSProperties,type ReactNode } from 'react';
import { Settings2,UserMinus,UserRoundCheck,MapPin,Sparkles,Activity,CalendarDays,Trophy,Users,UserRound,Vote,Shield,ArrowUpRight,ArrowRight,Plus,ChevronRight,House,Clock3,Check,Upload,Download,LogIn,LogOut,Link2,Undo2,Info,Target,Goal,Flag,Pencil,Loader2,CheckCircle2,Timer,Cake,Trash2,ZoomIn,History,MessagesSquare,ImagePlus,RefreshCw,Send,X,Shirt,Share2,Save } from 'lucide-react';
import { SidebarProvider,Sidebar,SidebarContent,SidebarHeader,SidebarFooter,SidebarMenu,SidebarMenuItem,SidebarMenuButton,SidebarTrigger,useSidebar } from '@/components/ui/sidebar';
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from '@/components/ui/dialog';
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Table,TableHeader,TableRow,TableHead,TableBody,TableCell } from '@/components/ui/table';
import { Empty,EmptyHeader,EmptyTitle,EmptyDescription } from '@/components/ui/empty';
import { AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogTitle,AlertDialogDescription,AlertDialogFooter,AlertDialogCancel,AlertDialogAction } from '@/components/ui/alert-dialog';
import PhoneApp from './phone-app';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import Cropper from 'react-easy-crop';
import { compressPhoto,cropPhoto,type CropArea } from '@/lib/photo-compression';
import { parseRoute,routeSearch,normalizeRoute,type Route,type View } from '@/lib/routes';
import { FORMATION_LIMITS,PITCH,PITCH_MARKINGS,addSlot,canAdd,initials,nudge,pointerSpot,removeSlot,shareFileName,unplaced,type Formation,type FormationSlot } from '@/lib/formation';
import { formationImage } from './formation-image';
import { TEAMS,DEFAULT_TEAMS,teamStyle,emptyClub,teamStats,playerStats,nextMatch,dateLabel,timeLabel,isReady,currentDay,clubToday,ageFrom,isBirthMonth,embedVideo,weeklyDates,validDate,teamsWithout,MAX_SERIES_DAYS,freshDraft,draftKey,gameClock,roundPayload,isPlayed,DELETION_APPROVALS,awardWinners,pastMatchdays,homeAction,dayWinners,tablePosition,matchdaySections,defaultSection,dateStrip,type MatchdaySection,BOARD_LIMITS,BOARD_REACTIONS,type BoardPage,type BoardPost,type BoardReaction,type BoardReactions,type GameDraft,type LogEntry,type LogAction,type RoundSnapshot,type Team,type TeamInfo,type Player,type Round,type ReadyDay,type Goal as GoalEntry,type PublicClub,type Day } from '@/lib/club';

const NAV:readonly (readonly [View,string,typeof House])[]=[['overview','Home',House],['matchdays','Matchdays',CalendarDays],['standings','Table',Trophy],['teams','Teams',Shield],['profile','Me',UserRound]];
// The page the address bar shows now.
const here=()=>parseRoute(location.search);
// Opens a page as a new history entry; replace swaps a section or filter in place. The current route is read from
// the address, so callbacks registered once never act on a stale page. Returns the route now shown.
type RouteOptions={replace?:boolean;state?:{player:true}|null};
function routeTo(next:Route,{replace=false,state=null}:RouteOptions={}):Route{const from=here(),to=normalizeRoute(next),url=location.pathname+routeSearch(to)+location.hash;if(replace)history.replaceState(state,'',url);else if(url!==location.pathname+location.search+location.hash)history.pushState(state,'',url);if(to.view!==from.view)window.scrollTo({top:0,behavior:'smooth'});return to}
// Leaving a formation with unsaved changes asks first. unsaved is set by the formation builder.
// changesPage: whether going to `next` leaves the page or section shown at `from`, as opposed to opening a player card over it.
function changesPage(from:Route,next:Route){const to=normalizeRoute(next);return to.view!==from.view||to.team!==from.team||to.tab!==from.tab}
function leaveFormation(unsaved:{current:boolean},confirm:Confirm,proceed:()=>void){confirm({title:'Leave without saving?',description:'Your changes to this formation have not been saved and will be lost.',action:()=>{unsaved.current=false;proceed()}})}
// Opens a route as routeTo does, after asking when it would leave unsaved formation changes.
function openRoute(next:Route,options:RouteOptions,unsaved:{current:boolean},confirm:Confirm,show:(route:Route)=>void){const open=()=>show(routeTo(next,options));if(unsaved.current&&changesPage(here(),next))leaveFormation(unsaved,confirm,open);else open()}
type Action=(action:string,body?:Record<string,unknown>)=>Promise<Record<string,any>|null>;
function AnimatedNumber({value,pad=0}:{value:number;pad?:number}){
  const [shown,setShown]=useState(0),[moving,setMoving]=useState(false);
  const previous=useRef(0);
  useEffect(()=>{
    const from=previous.current;previous.current=value;
    if(matchMedia('(prefers-reduced-motion: reduce)').matches||from===value){setShown(value);return;}
    let frame=0,start=0;setMoving(true);
    const tick=(time:number)=>{if(!start)start=time;const progress=Math.min((time-start)/650,1);setShown(Math.round(from+(value-from)*(1-Math.pow(1-progress,3))));if(progress<1)frame=requestAnimationFrame(tick);else setMoving(false);};
    frame=requestAnimationFrame(tick);return ()=>cancelAnimationFrame(frame);
  },[value]);
  return <span className={'animated-number'+(moving?' is-changing':'')} aria-label={String(value)}><span aria-hidden="true">{String(shown).padStart(pad,'0')}</span></span>;
}
function Avatar({p,size=''}:{p?:Player;size?:string}){return <span className={'avatar '+size}>{p?.photo?<img src={'/api/photo?key='+encodeURIComponent(p.photo)} alt={p.name}/>:p?.name.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase()||'HP'}</span>}
const TeamsCtx=createContext(DEFAULT_TEAMS);
// Opens a team page or a player card from anywhere in the app.
const LinksCtx=createContext<{team:(team:Team)=>void;player:(id:string)=>void}>({team:()=>{},player:()=>{}});
// Whether the open formation has unsaved changes, so the app asks before leaving it.
const UnsavedCtx=createContext<(dirty:boolean)=>void>(()=>{});
function TeamLink({team,className='',children}:{team:Team;className?:string;children?:ReactNode}){const teamInfo=useContext(TeamsCtx),open=useContext(LinksCtx);return <button type="button" className={'team-link team-name '+className} style={teamVars(teamInfo[team])} onClick={()=>open.team(team)}>{children??teamInfo[team].name}</button>}
// A player's name that opens their card; a player no longer on the roster stays plain text.
function PlayerLink({id,players,fallback='Club player'}:{id:string|null;players:Player[];fallback?:string}){const open=useContext(LinksCtx),p=players.find(x=>x.id===id);return p?<button type="button" className="player-link" onClick={()=>open.player(p.id)}>{p.name}</button>:<>{fallback}</>}
const teamVars=(t:TeamInfo)=>teamStyle(t) as CSSProperties;
function Crest({team}:{team:Team}){const teamInfo=useContext(TeamsCtx),photo=teamInfo[team].photo;return <span className={'team-crest'+(photo?' has-photo':'')} data-team={team} style={teamVars(teamInfo[team])}>{photo?<img src={'/api/photo?key='+encodeURIComponent(photo)} alt={teamInfo[team].name}/>:teamInfo[team].letter}</span>}
function Picker({value,onChange,options,label,className='',disabled=false}:{value:string;onChange:(v:string)=>void;options:{value:string;label:string}[];label:string;className?:string;disabled?:boolean}){return <Select value={value} onValueChange={onChange} disabled={disabled}><SelectTrigger aria-label={label} className={className}><SelectValue placeholder={label}/></SelectTrigger><SelectContent>{options.map(o=><SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>}
const teamOptions=(teamInfo:Record<Team,TeamInfo>)=>TEAMS.map(t=>({value:t,label:teamInfo[t].name}));
function NoData({title,children}:{title:string;children?:ReactNode}){return <Empty className="empty-state"><Flag/><EmptyHeader><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{children}</EmptyDescription></EmptyHeader></Empty>}
function SideNav({view,navigate}:{view:View;navigate:(v:View)=>void}){const {setOpenMobile}=useSidebar();return <Sidebar className="club-sidebar" style={{'--sidebar-width':'238px'} as CSSProperties}><SidebarHeader className="p-0"><a className="brand" href="/" aria-label="Prithvi FC homepage"><span className="brand-mark"><span>HR</span><small>SC</small></span><div><div className="brand-title">HRSC–PRITHVI</div><div className="brand-sub">THE WINTER LEAGUE</div></div></a></SidebarHeader><SidebarContent className="overflow-x-hidden"><SidebarMenu>{NAV.map(([id,label,Icon])=><SidebarMenuItem key={id}><SidebarMenuButton className="nav-button" isActive={view===id} onClick={()=>{navigate(id);setOpenMobile(false)}}><Icon/><span>{label}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarContent></Sidebar>}

export default function ClubApp({identity,signInUrl}:{identity:{name:string}|null;signInUrl:string}){
  const [data,setData]=useState<PublicClub>(emptyClub),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [editingRound,setEditingRound]=useState<Round|null>(null);
  // The open page lives in the address bar; this mirrors it so Back, Forward and shared links restore it.
  const [route,setRoute]=useState<Route>({view:'overview'}),[scope,setScope]=useState('season');
  const {view}=route,dayId=route.day??'';
  const [modal,setModal]=useState(''),[editing,setEditing]=useState<Player|null>(null),[editingTeam,setEditingTeam]=useState<Team>('red'),[invite,setInvite]=useState(''),[setupKey,setSetupKey]=useState(''),[copyValue,setCopyValue]=useState(''),[copyNote,setCopyNote]=useState('');
  const [cropping,setCropping]=useState<File|null>(null);
  const [confirm,setConfirm]=useState<{title:string;description:string;action:()=>void}|null>(null);
  const stateRef=useRef(data);stateRef.current=data;const teamInfo=data.teams;
  const sortedDays=[...data.days].sort((a,b)=>b.date.localeCompare(a.date));const day=data.days.find(d=>d.id===dayId)||currentDay(data.days,clubToday());const playedDays=sortedDays.filter(d=>d.rounds.length),today=clubToday();
  const activePlayers=data.players.filter(p=>p.active!==false),selectedPlayer=route.player?data.players.find(p=>p.id===route.player):undefined;
  const statsDays=scope==='season'?data.days:data.days.filter(d=>d.id===scope);
  const teams=teamStats(statsDays),players=playerStats(activePlayers,statsDays),me=data.players.find(p=>p.id===data.me);
  const member=!!me&&me.active!==false||data.isOwner;
  // A board link without a team opens the visitor's own team.
  const team=route.team??(route.tab==='board'&&member?me?.team:undefined);
  // Me's sections; Club admin is for admins only.
  const meSections:MeSection[]=data.isAdmin?['profile','guide','admin']:['profile','guide'],meSection=meSections.find(s=>s===route.tab)??'profile';
  // The formation builder marks unsaved changes here; leaving its section, team or page then asks first.
  const unsaved=useRef(false),shownRoute=useRef(route),markUnsaved=useCallback((dirty:boolean)=>{unsaved.current=dirty},[]);
  useEffect(()=>{shownRoute.current=route},[route]);
  async function refresh(){try{const r=await fetch('/api/club',{cache:'no-store'});const j=await r.json() as PublicClub & {error?:string};if(!r.ok)throw new Error(j.error);setData(j);setError('');return j as PublicClub;}catch(e){setError(e instanceof Error?e.message:'Unable to load club.');return null;}finally{setLoading(false)}}
  useEffect(()=>{const q=new URLSearchParams(location.search),h=new URLSearchParams(location.hash.slice(1));if(h.get('invite')||q.get('invite')){location.replace('/join?invite='+encodeURIComponent(h.get('invite')||q.get('invite')!));return;}if(q.get('invite_error'))toast.error('This link has been used or is unavailable. Sign in if you already joined, or ask the organiser for your current invite.');if(h.get('setup')){setSetupKey(h.get('setup')!);setModal('setup')}
    // Back or Forward away from a formation with unsaved changes puts its address back and asks first.
    const show=()=>{const next=parseRoute(location.search),from=shownRoute.current;if(unsaved.current&&changesPage(from,next)){history.pushState(history.state,'',location.pathname+routeSearch(from)+location.hash);leaveFormation(unsaved,setConfirm,()=>setRoute(routeTo(next)));return}setRoute(next)};
    show();history.replaceState(history.state,'',location.pathname+routeSearch(parseRoute(location.search))+location.hash);
    window.addEventListener('popstate',show);void refresh();return ()=>window.removeEventListener('popstate',show);},[]);
  const go=(next:Route,options:RouteOptions={})=>openRoute(next,options,unsaved,setConfirm,setRoute);
  function navigate(v:View,id?:string){openRoute({view:v,day:id??here().day},{},unsaved,setConfirm,setRoute)}
  function openPlayer(id:string){go({...here(),player:id},{state:{player:true}})}
  const links={team:(t:Team)=>go({view:'teams',team:t}),player:openPlayer};
  // A card opened in the app closes by going back, so Back never reopens it; one opened from a shared link is dropped from the address.
  function closePlayer(){if((history.state as {player?:boolean}|null)?.player)history.back();else go({...here(),player:undefined},{replace:true})}
  const action:Action=async(a,b={})=>{if(busy)return null;if(!navigator.onLine){toast.error('Reconnect to save changes or vote.');return null;}setBusy(true);try{const r=await fetch('/api/club',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:a,revision:stateRef.current.revision,...b})});const j=await r.json() as Record<string,any>;if(!r.ok){if(r.status===409)await refresh();throw new Error(j.error)}await refresh();return j;}catch(e){toast.error(e instanceof Error?e.message:'Please try again.');return null;}finally{setBusy(false)}};
  useEffect(()=>{const context=(document as unknown as {modelContext?:any}).modelContext;if(!context?.registerTool)return;const life=new AbortController();
    for(const t of [
      {name:'get_club_summary',title:'Read club stats',description:'Read the loaded HRSC–Prithvi standings and recorded match-day totals.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:(input:any)=>{if(input&&Object.keys(input).length)throw new Error('No arguments accepted.');const d=stateRef.current;return {standings:teamStats(d.days),players:d.players.length,days:d.days.map(x=>({date:x.date,rounds:x.rounds.length,voting:x.poll}))}}},
      {name:'open_match_day',title:'Open a match day',description:'Navigate to an existing match day. This does not create or change records.',inputSchema:{type:'object',properties:{dayId:{type:'string'}},required:['dayId'],additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute:(input:any)=>{if(typeof input?.dayId!=='string'||Object.keys(input).length!==1)throw new Error('Supply dayId.');const d=stateRef.current.days.find(x=>x.id===input.dayId);if(!d)throw new Error('Match day not found.');navigate('matchdays',d.id);return {date:d.date,opened:true}}}
    ]){try{Promise.resolve(context.registerTool(t,{signal:life.signal})).catch(()=>{})}catch{}}
    return ()=>life.abort();},[]);
  async function share(url:string,title:string){try{if(navigator.share){await navigator.share({title,text:title,url});return}await navigator.clipboard.writeText(url);toast.success('Link copied. Paste it into your team chat.');}catch(e){if((e as Error).name!=='AbortError'){setCopyValue(url);setCopyNote('');setModal('copy')}}}
  function toggleAdmin(p:Player){const making=!data.admins.includes(p.id);setConfirm({title:(making?'Make ':'Remove ')+p.name+(making?' an admin?':' as admin?'),description:making?'Admins can manage the roster, teams, match days, scores, voting and videos. Only you can add or remove admins.':'They keep their player profile and stats but lose the admin controls.',action:async()=>{if(await action('setAdmin',{playerId:p.id,admin:making}))toast.success(making?p.name+' is now an admin.':p.name+' is no longer an admin.')}})}
  async function invitePlayer(p:Player){const r=await action('invite',{playerId:p.id});if(r){setCopyValue(location.origin+'/join?invite='+encodeURIComponent(r.invite));setCopyNote(r.access==='added'?p.email+' was added to the club sign-in list.':r.access==='already'?p.email+' is already on the club sign-in list.':'This player has no email, so nobody was added to the club sign-in list. Add their email to give them sign-in access.');setModal('copy')}}
  function voteLink(d:Day){return location.origin+'/winterleague'+routeSearch({view:'matchdays',day:d.id,tab:'vote'})}
  function start(){if(!identity)return;setModal(data.initialized?'day':'setup')}
  function exportStats(){const safe={club:'HRSC–Prithvi',exportedAt:new Date().toISOString(),teams:teamInfo,players:data.players,matchDays:data.days,teamStats:teamStats(data.days),playerStats:playerStats(data.players,data.days),awards:Object.entries(data.polls).filter(([id])=>data.days.find(d=>d.id===id)?.poll==='closed').map(([id,p])=>({dayId:id,tally:p.tally}))};const url=URL.createObjectURL(new Blob([JSON.stringify(safe,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='hrsc-prithvi-stats.json';a.click();URL.revokeObjectURL(url)}
  function authLink(){return location.pathname+location.search+location.hash}
  function SignIn(){return <a className="primary-btn" href={signInUrl} onClick={e=>{e.currentTarget.href=authLink()}} target="_top"><LogIn/>Sign in</a>}
  function Scope(){return <Picker label="Stats period" className="day-selector" value={scope} onChange={setScope} options={[{value:'season',label:'All season'},...playedDays.map(d=>({value:d.id,label:dateLabel(d.date,true)}))]}/>}
  function TeamsGrid(){return <div className="team-grid">{teams.map((s,i)=><button className={'team-card rise delay-'+(i+1)} data-team={s.team} style={teamVars(teamInfo[s.team])} key={s.team} onClick={()=>links.team(s.team)}><div className="team-top"><div className="team-title"><Crest team={s.team}/><div><h3>{teamInfo[s.team].name}</h3>{teamInfo[s.team].motto&&<p className="team-motto">{teamInfo[s.team].motto}</p>}</div></div><span className="rank">{s.played?'#'+tablePosition(teams,s.team):'—'}</span></div><div className="team-numbers"><div><strong><AnimatedNumber value={s.points} pad={2}/></strong><span>PTS</span></div><div><strong><AnimatedNumber value={s.gf} pad={2}/></strong><span>GOALS</span></div><div><strong><AnimatedNumber value={s.played} pad={2}/></strong><span>PLAYED</span></div></div><div className="team-foot"><span>{activePlayers.filter(p=>p.team===s.team).length} players</span><span>{s.form.length?s.form.slice(-5).map((f,i)=><span className={'form-dot '+f} key={i}>{f}</span>):'—'} <ArrowUpRight className="inline ml-2" size={14}/></span></div></button>)}</div>}
  function Standings(){return <><div className="table-wrap"><Table><TableHeader><TableRow>{['#','Team','Played','Pts','Wins','Draws','Losses','GF','GA','GD','Form',''].map(x=><TableHead key={x}>{x}</TableHead>)}</TableRow></TableHeader><TableBody>{teams.map(s=><TableRow key={s.team} className="row-link" onClick={()=>links.team(s.team)}><TableCell>{tablePosition(teams,s.team)??'—'}</TableCell><TableCell><div className="cell-team"><Crest team={s.team}/><TeamLink team={s.team}/></div></TableCell><TableCell>{s.played}</TableCell><TableCell className="wins-cell">{s.points}</TableCell><TableCell>{s.wins}</TableCell><TableCell>{s.draws}</TableCell><TableCell>{s.losses}</TableCell><TableCell>{s.gf}</TableCell><TableCell>{s.ga}</TableCell><TableCell>{s.gd>0?'+':''}{s.gd}</TableCell><TableCell><div className="whitespace-nowrap">{s.form.slice(-5).map((f,i)=><span className={'form-dot '+f} key={i}>{f}</span>)}{!s.form.length?'—':''}</div></TableCell><TableCell><ChevronRight className="row-chevron" size={16} aria-hidden="true"/></TableCell></TableRow>)}</TableBody></Table></div><p className="table-note">Points (3 for a win, 1 for a draw), then goal difference, then goals scored.</p></>}

  return <TeamsCtx.Provider value={teamInfo}><LinksCtx.Provider value={links}><UnsavedCtx.Provider value={markUnsaved}><SidebarProvider style={{'--sidebar-width':'238px'} as CSSProperties}><SideNav view={view} navigate={navigate}/><div className="main-shell"><header className="topbar"><div className="breadcrumb"><SidebarTrigger className="mobile-menu"/><span>HRSC–Prithvi</span><ChevronRight size={14}/><strong>{NAV.find(n=>n[0]===view)?.[1]}</strong></div><div className="top-right"><PhoneApp/>{identity?<button className="user-button" onClick={()=>navigate('profile')}><Avatar p={me}/><span className="user-name">{me?.name.split(' ')[0]||identity.name.split(' ')[0]}<small>{data.isOwner?'Club owner':data.isAdmin?'Club admin':'Club member'}</small></span></button>:<a className="secondary-btn" href={signInUrl} onClick={e=>{e.currentTarget.href=authLink()}} target="_top"><LogIn size={15}/>Sign in</a>}</div></header><main className="content" key={view}>
    {error&&<div className="banner error" role="alert"><span>{error}</span><button className="secondary-btn" onClick={()=>refresh()}>Retry</button></div>}
    {!loading&&!error&&!data.initialized&&identity&&modal!=='setup'&&<div className="banner"><span>Welcome, organiser. Set up your club, then add the three squads.</span><button className="primary-btn" onClick={()=>setModal('setup')}>Set up club<ArrowRight/></button></div>}
    {!loading&&data.initialized&&!identity&&<div className="banner guest-banner"><span><strong>Winter league is here.</strong> Sign in to open your player profile and club stats.</span><SignIn/></div>}
    {!loading&&data.initialized&&identity&&!data.me&&<div className="banner guest-banner"><span>Welcome to HRSC–Prithvi. Open your personal player invitation to join the squad.</span><button className="primary-btn" onClick={()=>navigate('profile')}>My invitation<ArrowRight/></button></div>}
    {loading&&<div className="banner" role="status"><span className="flex gap-2 items-center"><Loader2 className="animate-spin" size={16}/>Loading your club…</span></div>}
    {view==='overview'&&<div className="rise"><div className="page-heading"><div><div className="eyebrow">WINTER LEAGUE</div><h1>HRSC–Prithvi</h1><p className="page-intro">Your next matchday, the last result and your team’s board.</p></div></div>
      <NextUp day={currentDay(data.days,today)} today={today} onOpen={(d,tab)=>go({view:'matchdays',day:d.id,tab})}/>
      <div className="two-columns mt-5"><LastMatchday data={data} day={pastMatchdays(data.days,today)[0]} onOpen={d=>go({view:'matchdays',day:d.id,tab:'results'})}/>{member&&me&&<BoardPreview data={data} team={me.team} onOpen={()=>go({view:'teams',team:me.team,tab:'board'})}/>}</div></div>}
    {view==='standings'&&<div className="rise"><div className="page-heading"><div><div className="eyebrow">WINTER LEAGUE / 02</div><h1>Team standings</h1><p className="page-intro">Follow the race across the season or a single matchday.</p></div><Scope/></div><TeamsGrid/><div className="section-title"><h2>The league table</h2></div><Standings/><div className="two-columns"><div className="panel"><div className="panel-head"><h2>Golden boot</h2><Goal size={20}/></div><Leaders players={players}/></div><div className="panel"><div className="panel-head"><h2>The playmakers</h2><Target size={20}/></div><Leaders players={players} kind="assists"/></div><div className="panel"><div className="panel-head"><h2>Most matchdays</h2><CalendarDays size={20}/></div><Leaders players={players} kind="attended"/></div></div></div>}
    {view==='teams'&&!team&&<div className="rise"><div className="page-heading"><div><div className="eyebrow">WINTER LEAGUE / TEAMS</div><h1>The three sides</h1><p className="page-intro">{'The players behind '+TEAMS.map(t=>teamInfo[t].name).join(', ')+'.'}</p></div></div><TeamsGrid/></div>}
    {view==='teams'&&team&&<TeamPage key={team} data={data} team={team} requested={route.tab} players={players} table={teams} season={teamStats(data.days)} scope={<Scope/>} member={member} busy={busy} action={action} confirm={setConfirm}
      onSection={tab=>go({...here(),tab},{replace:true})} onEditTeam={()=>{setEditingTeam(team);setModal('team')}} onAddPlayer={()=>{setEditing(null);setEditingTeam(team);setModal('player')}} onEditPlayer={p=>{setEditing(p);setModal('player')}} onInvite={invitePlayer} onToggleAdmin={toggleAdmin}/>}
    {view==='matchdays'&&<MatchdayPage data={data} day={day} requested={route.tab} today={today} identity={!!identity} busy={busy} action={action} refresh={refresh} confirm={setConfirm} signIn={<SignIn/>}
      onDay={id=>go({view:'matchdays',day:id})} onSection={tab=>go({...here(),tab},{replace:true})} onModal={setModal} onEditRound={setEditingRound}
      onShare={d=>share(voteLink(d),'HRSC–Prithvi · Vote for player of the day')} onDeleted={()=>go({view:'matchdays'},{replace:true})} onProfile={()=>navigate('profile')}/>}
    {view==='profile'&&<div className="rise"><div className="page-heading"><div><div className="eyebrow">WINTER LEAGUE / ME</div><h1>{ME_SECTIONS[meSection][2]}</h1><p className="page-intro">{ME_SECTIONS[meSection][3]}</p></div>{identity&&<a className="secondary-btn" href="/cdn-cgi/access/logout" target="_top"><LogOut/>Sign out</a>}</div>
      <div className="control-switch" role="group" aria-label="Me sections">{meSections.map(s=>{const [label,Icon]=ME_SECTIONS[s];return <button type="button" key={s} aria-pressed={meSection===s} onClick={()=>go({...here(),tab:s},{replace:true})}><Icon size={18}/>{label}</button>})}</div>
      {meSection==='guide'&&<ClubGuide/>}
      {meSection==='admin'&&data.isAdmin&&<ClubAdmin data={data} onNewMatchday={start} onExport={exportStats} onToggleAdmin={toggleAdmin}/>}
      {meSection==='profile'&&(!identity?<div className="panel"><NoData title="Your club identity starts here">Sign in with your email, then use the personal invitation from your organiser to connect your player profile.</NoData><div className="flex justify-center"><SignIn/></div></div>:!me?<div className="panel"><NoData title={(data.invitation||invite)?'Join '+(data.invitation?.name||'your club profile'):'You’re signed in'}>{(data.invitation||invite)?'Connect this player profile to your account.':'Ask your organiser for your personal player invitation. Each invite connects one account to one player.'}</NoData>{(data.invitation||invite)&&<button className="primary-btn mx-auto flex" disabled={busy} onClick={async()=>{if(await action('claim',invite?{token:invite}:{})){setInvite('');history.replaceState(null,'','/winterleague?view=profile');toast.success('Welcome to the club!')}}}>Connect my player profile<ArrowRight/></button>}</div>:<><ProfileStats p={me} data={data} refresh={refresh} confirm={setConfirm}/><div className="player-detail-layout"><div className="panel"><div className="panel-head"><h2>Your player details</h2><UserRound/></div><p className="subtle mb-5">Make this yours. Your team and match stats are managed by the organiser.</p><PlayerForm player={me} admin={false} busy={busy} onSave={async b=>{if(await action('profile',b))toast.success('Your profile is updated.')}}/></div><div className="panel"><div className="panel-head"><h2>Your player photo</h2><Upload/></div><p className="subtle mb-5">JPG, PNG or WebP. Drag and zoom to frame a square portrait; large photos are compressed automatically.</p><div className="action-row"><label className="secondary-btn cursor-pointer"><Upload/>{me.photo?'Replace profile photo':'Upload profile photo'}<input type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)setCropping(file)}}/></label>{me.photo&&<RemovePhotoButton player={me} onRemoved={refresh}/>}</div></div></div></>)}</div>}
    <footer className="footer"><span>HRSC–PRITHVI <span className="mx-2">/</span> WINTER LEAGUE 2026–27.</span><span>Photo: <a href="https://unsplash.com/photos/man-playing-soccer-game-on-field-AWdCgDDedH0" target="_blank" rel="noreferrer">Emilio Garcia</a> · <button className="underline" onClick={()=>go({view:'profile',tab:'guide'})}>Club guide</button></span></footer>
  </main><nav className="mobile-dock" aria-label="Main navigation">{NAV.map(([id,label,Icon])=><button key={id} aria-current={view===id?'page':undefined} onClick={()=>navigate(id)}><Icon size={20}/><span>{label}</span></button>)}</nav></div>
  <Dialog open={!!modal} onOpenChange={v=>{if(!v&&!busy)setModal('')}}><DialogContent className={'dialog-panel '+(['day','setupDay'].includes(modal)?'wide':'')}><DialogHeader><DialogTitle>{({setup:'Welcome to Winter league.',player:editing?'Edit player':'Add a teammate',day:'Schedule matchdays.',setupDay:'Set up the matchday.',editDay:'Move the matchday.',team:'Edit team.',copy:'Your link is ready.'} as Record<string,string>)[modal]}</DialogTitle><DialogDescription>{({setup:'Use your organiser code once to create your club account.',player:'Admins control all roster details and team assignments.',day:'Pick a date and time, or repeat weekly for the season. Attendance is set on the day.',setupDay:'Attendance controls who can vote and which team they cannot vote for.',editDay:'Change the date or time before the matchday is played.',team:'Every admin and player sees the new name and colour.',copy:'Personal invitations belong to one player. Voting links can go in the group chat.'} as Record<string,string>)[modal]}</DialogDescription></DialogHeader>
    {modal==='setup'&&(identity?<SetupForm keyValue={setupKey} name={identity.name} busy={busy} onSave={async b=>{if(await action('initialize',b)){setModal('');history.replaceState(null,'','/winterleague');toast.success('Your club is ready. Add your teammates next.');navigate('teams')}}}/>:<SignIn/>)}
    {modal==='player'&&editing?.photo&&<div className="action-row mb-4"><Avatar p={editing} size="lg"/><RemovePhotoButton player={editing} onRemoved={async()=>{await refresh();setEditing({...editing,photo:null})}}/></div>}
    {modal==='player'&&<PlayerForm player={editing} team={editingTeam} admin busy={busy} onSave={async b=>{if(await action(editing?'editPlayer':'addPlayer',b)){setModal('');toast.success('Player profile saved.')}}}/>}
    {modal==='day'&&<ScheduleForm busy={busy} onSave={async b=>{const r=await action('addDays',b);if(r){setModal('');go({view:'matchdays',day:(r.dayIds as string[])[0]});toast.success((r.dayIds as string[]).length+' matchday'+((r.dayIds as string[]).length>1?'s':'')+' scheduled.'+((r.skipped as string[]).length?' Skipped '+(r.skipped as string[]).map(d=>dateLabel(d,true)).join(', ')+' (already scheduled).':''))}}}/>}
    {modal==='setupDay'&&day&&<SetupDayForm day={day} players={activePlayers} busy={busy} onSave={async b=>{if(await action('setupDay',{dayId:day.id,...b})){setModal('');toast.success('Matchday set up. You can open voting and enter rounds.')}}}/>}
    {modal==='editDay'&&day&&<EditDayForm day={day} busy={busy} onSave={async b=>{if(await action('editDay',{dayId:day.id,...b})){setModal('');toast.success('Matchday moved.')}}}/>}
    {modal==='team'&&<TeamForm team={editingTeam} info={teamInfo[editingTeam]} busy={busy} refresh={refresh} onSave={async b=>{if(await action('editTeam',{team:editingTeam,...b})){setModal('');toast.success('Team updated.')}}}/>}
    {modal==='copy'&&<div className="form-stack">{copyNote&&<p className="help">{copyNote}</p>}<label className="field">Share this link<input value={copyValue} readOnly onFocus={e=>e.currentTarget.select()}/></label><button className="primary-btn" onClick={async()=>{try{await navigator.clipboard.writeText(copyValue);toast.success('Copied.')}catch{toast.info('Select the link above and copy it.')}}}><Link2/>Copy link</button></div>}
  </DialogContent></Dialog>
  {cropping&&<PhotoCropDialog file={cropping} onClose={()=>setCropping(null)} onUploaded={refresh}/>}
  <Dialog open={!!selectedPlayer} onOpenChange={v=>{if(!v)closePlayer()}}><DialogContent className="dialog-panel wide"><DialogHeader><DialogTitle>Player profile</DialogTitle><DialogDescription>Season statistics · HRSC–Prithvi</DialogDescription></DialogHeader>{selectedPlayer&&<ProfileStats p={selectedPlayer} data={data} refresh={refresh} confirm={setConfirm}/>}</DialogContent></Dialog>
  {data.isAdmin&&view==='matchdays'&&day&&isReady(day)&&editingRound&&day.rounds.some(r=>r.id===editingRound.id)&&<EditRoundDialog key={editingRound.id} day={day} round={editingRound} players={data.players} busy={busy} action={action} onClose={()=>setEditingRound(null)}/>}
  <AlertDialog open={!!confirm} onOpenChange={v=>!v&&setConfirm(null)}><AlertDialogContent className="dialog-panel"><AlertDialogHeader><AlertDialogTitle>{confirm?.title}</AlertDialogTitle><AlertDialogDescription>{confirm?.description}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={()=>{confirm?.action();setConfirm(null)}}>Confirm</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog><Toaster position="bottom-right" richColors/>
  </SidebarProvider></UnsavedCtx.Provider></LinksCtx.Provider></TeamsCtx.Provider>
}

function SetupForm({keyValue,name,busy,onSave}:{keyValue:string;name:string;busy:boolean;onSave:(b:Record<string,unknown>)=>void}){const teamInfo=useContext(TeamsCtx);const [key,setKey]=useState(keyValue),[n,setN]=useState(name.includes('@')?'':name),[team,setTeam]=useState<Team>('red');return <form className="form-stack" onSubmit={e=>{e.preventDefault();onSave({key,name:n,team})}}><label className="field">Organiser setup code<input type="password" required value={key} onChange={e=>setKey(e.target.value)} autoComplete="off"/></label><label className="field">Your player name<input required maxLength={60} value={n} onChange={e=>setN(e.target.value)}/></label><label className="field">Your team<Picker label="Your team" value={team} onChange={v=>setTeam(v as Team)} options={teamOptions(teamInfo)}/></label><button disabled={busy} className="primary-btn">{busy?'Creating club…':'Set up my club'}<ArrowRight/></button></form>}
const NOT_SET='none',MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
function ageLabel(p:Player){const age=ageFrom(p.birthYear,p.birthMonth,clubToday());return age===null?'':' · Age '+age}
function BirthdayCake({p}:{p:Player}){return isBirthMonth(p,clubToday())?<span className="birthday-cake" title="Birthday this month"><Cake aria-hidden="true"/><span className="sr-only">Birthday this month</span></span>:null}
function RemovePhotoButton({player,onRemoved}:{player:Player;onRemoved:()=>Promise<unknown>}){
  const [removing,setRemoving]=useState(false);
  async function remove(){setRemoving(true);try{const r=await fetch('/api/photo?player='+encodeURIComponent(player.id),{method:'DELETE'});const j=await r.json() as {error?:string};if(!r.ok)throw new Error(j.error||'The photo could not be removed. Please try again.');await onRemoved();toast.success('Photo removed.')}catch(err){toast.error((err as Error).message)}finally{setRemoving(false)}}
  return <button type="button" className="text-btn inline-flex items-center gap-1" disabled={removing} onClick={remove}><Trash2 size={16}/>{removing?'Removing…':'Remove photo'}</button>
}
// Frames a chosen photo as a square portrait, then compresses and uploads it as the signed-in player's photo.
function PhotoCropDialog({file,onClose,onUploaded}:{file:File;onClose:()=>void;onUploaded:()=>Promise<unknown>}){
  const [source]=useState(()=>URL.createObjectURL(file)),[crop,setCrop]=useState({x:0,y:0}),[zoom,setZoom]=useState(1),[area,setArea]=useState<CropArea|null>(null),[saving,setSaving]=useState(false);
  function close(){if(saving)return;URL.revokeObjectURL(source);onClose()}
  async function save(){if(!area)return;setSaving(true);try{const form=new FormData();form.set('photo',await compressPhoto(await cropPhoto(file,area)));const r=await fetch('/api/photo',{method:'POST',body:form});const j=await r.json() as {error?:string};if(!r.ok)throw new Error(j.error||'The photo did not save. Please try again.');await onUploaded();toast.success('Profile photo updated.');URL.revokeObjectURL(source);onClose()}catch(err){toast.error((err as Error).message);setSaving(false)}}
  return <Dialog open onOpenChange={v=>{if(!v)close()}}><DialogContent className="dialog-panel"><DialogHeader><DialogTitle>Frame your photo.</DialogTitle><DialogDescription>Drag to move the photo and zoom to fit your face in the square.</DialogDescription></DialogHeader>
    <div className="photo-cropper"><Cropper image={source} crop={crop} zoom={zoom} maxZoom={4} aspect={1} showGrid={false} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_,pixels)=>setArea(pixels)}/></div>
    <label className="field photo-zoom"><span className="inline-flex items-center gap-2"><ZoomIn size={16}/>Zoom</span><input type="range" min={1} max={4} step={0.01} value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></label>
    <div className="action-row justify-end"><button type="button" className="secondary-btn" disabled={saving} onClick={close}>Cancel</button><button type="button" className="primary-btn" disabled={saving||!area} onClick={save}>{saving?'Saving photo…':'Save photo'}<Check/></button></div>
  </DialogContent></Dialog>
}
async function teamPhotoForm(team:Team,file:File){const form=new FormData();form.set('target','team');form.set('team',team);form.set('photo',await compressPhoto(file));return form}
function TeamForm({team,info,busy,refresh,onSave}:{team:Team;info:TeamInfo;busy:boolean;refresh:()=>Promise<PublicClub|null>;onSave:(b:TeamInfo)=>void}){
  const [uploading,setUploading]=useState(false);
  async function changePhoto(file:File|null){setUploading(true);try{const r=file?await fetch('/api/photo',{method:'POST',body:await teamPhotoForm(team,file)}):await fetch('/api/photo?team='+team,{method:'DELETE'});const j=await r.json() as {error?:string};if(!r.ok)throw new Error(j.error||'The photo did not save. Please try again.');await refresh();toast.success(file?'Team photo saved.':'Team photo removed.')}catch(err){toast.error((err as Error).message)}finally{setUploading(false)}}
  const [name,setName]=useState(info.name),[letter,setLetter]=useState(info.letter),[color,setColor]=useState(info.color),[motto,setMotto]=useState(info.motto);
  return <form className="form-grid" onSubmit={e=>{e.preventDefault();onSave({name,letter,color,motto})}}>
    <div className="field full team-preview"><TeamsCtx.Provider value={{...DEFAULT_TEAMS,[team]:{name,letter:letter.toUpperCase()||'?',color,motto,photo:info.photo}}}><Crest team={team}/></TeamsCtx.Provider><strong>{name||'Team name'}</strong></div>
    <div className="field full action-row"><label className="secondary-btn upload-control"><Upload/>{uploading?'Saving photo…':info.photo?'Replace team photo':'Upload team photo'}<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)changePhoto(file)}}/></label>{info.photo&&<button type="button" className="text-btn" disabled={uploading} onClick={()=>changePhoto(null)}>Remove photo</button>}</div>
    <label className="field full">Team name<input required maxLength={30} value={name} onChange={e=>setName(e.target.value)}/></label>
    <label className="field">Crest letter<input required maxLength={2} value={letter} onChange={e=>setLetter(e.target.value)}/></label>
    <label className="field">Colour<input type="color" value={color} onChange={e=>setColor(e.target.value)}/></label>
    <label className="field full">Motto<input maxLength={60} value={motto} onChange={e=>setMotto(e.target.value)} placeholder="Optional"/></label>
    <button className="primary-btn full" disabled={busy}>{busy?'Saving…':'Save team'}<Check/></button>
  </form>
}
function PlayerForm({player,team:newTeam='red',admin,busy,onSave}:{player:Player|null;team?:Team;admin:boolean;busy:boolean;onSave:(b:Record<string,unknown>)=>void}){
  const teamInfo=useContext(TeamsCtx);
  const [name,setName]=useState(player?.name||''),[team,setTeam]=useState<Team>(player?.team||newTeam),[position,setPosition]=useState(player?.position||'All-rounder');
  const [birthYear,setBirthYear]=useState(player?.birthYear?String(player.birthYear):NOT_SET),[birthMonth,setBirthMonth]=useState(player?.birthMonth?String(player.birthMonth):NOT_SET);
  const latestYear=Number(clubToday().slice(0,4))-5,picked=(v:string)=>v===NOT_SET?null:Number(v);
  return <form className="form-grid" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);const num=(k:string)=>f.get(k)===''?null:Number(f.get(k));onSave({...(admin?{id:player?.id,team}:{}),...(admin&&!player?.linked?{email:String(f.get('email')||'').trim()||null}:{}),name,position,birthYear:picked(birthYear),birthMonth:picked(birthMonth),height:num('height'),district:String(f.get('district')||'').trim()||null})}}>
    <label className="field full">Player name<input required maxLength={60} value={name} onChange={e=>setName(e.target.value)}/></label>
    {admin&&<label className="field full">Team<Picker label="Team" value={team} onChange={v=>setTeam(v as Team)} options={teamOptions(teamInfo)}/></label>}
    {admin&&!player?.linked&&<label className="field full">Email<input name="email" type="email" maxLength={254} defaultValue={player?.email??''} placeholder="Optional · gets sign-in access when invited"/></label>}
    <label className="field">Birth year<Picker label="Birth year" value={birthYear} onChange={setBirthYear} options={[{value:NOT_SET,label:'Not set'},...Array.from({length:latestYear-1939},(_,i)=>String(latestYear-i)).map(y=>({value:y,label:y}))]}/></label>
    <label className="field">Birth month<Picker label="Birth month" value={birthMonth} onChange={setBirthMonth} options={[{value:NOT_SET,label:'Not set'},...MONTHS.map((m,i)=>({value:String(i+1),label:m}))]}/></label>
    <label className="field full">Height (cm)<input name="height" type="number" min="70" max="250" defaultValue={player?.height??''} placeholder="Optional"/></label>
    <label className="field full">District<input name="district" maxLength={60} defaultValue={player?.district??''} placeholder="e.g. Kathmandu"/></label>
    <label className="field full">Position<Picker label="Position" value={position} onChange={setPosition} options={['Goalkeeper','Defender','Midfielder','Forward','All-rounder'].map(x=>({value:x,label:x}))}/></label>
    <button className="primary-btn full" disabled={busy}>{busy?'Saving…':admin?'Save player':'Save my profile'}<Check/></button>
  </form>
}
function Attendance({players,selected,setSelected}:{players:Player[];selected:string[];setSelected:(s:string[])=>void}){const teamInfo=useContext(TeamsCtx);return <div className="attendance-list">{TEAMS.map(t=><div key={t}><p className="eyebrow mb-2 team-name" style={teamVars(teamInfo[t])}>{teamInfo[t].name}</p>{players.filter(p=>p.team===t).map(p=><label className="checkbox-label" key={p.id}><Checkbox checked={selected.includes(p.id)} onCheckedChange={v=>setSelected(v?[...selected,p.id]:selected.filter(x=>x!==p.id))}/>{p.name}</label>)}{!players.some(p=>p.team===t)&&<p className="help">No players added yet.</p>}</div>)}</div>}
function ScheduleForm({busy,onSave}:{busy:boolean;onSave:(b:Record<string,unknown>)=>void}){
  const today=clubToday(),first=today<'2026-09-01'?'2026-09-01':today;
  const [from,setFrom]=useState(first),[repeat,setRepeat]=useState(false),[to,setTo]=useState(first),[start,setStart]=useState('07:00'),[end,setEnd]=useState('08:30');
  const count=!repeat?1:validDate(from)&&validDate(to)&&to>=from?weeklyDates(from,to).length:0;
  return <form className="form-grid" onSubmit={e=>{e.preventDefault();onSave({from,start,end,...(repeat?{to}:{})})}}>
    <label className="field full">{repeat?'First matchday':'Match date'}<input type="date" required min="2026-09-01" value={from} onChange={e=>{setFrom(e.target.value);if(to<e.target.value)setTo(e.target.value)}}/></label>
    <label className="field">Starts<input type="time" required value={start} onChange={e=>setStart(e.target.value)}/></label>
    <label className="field">Ends<input type="time" required value={end} onChange={e=>setEnd(e.target.value)}/></label>
    <label className="checkbox-label full"><Checkbox checked={repeat} onCheckedChange={v=>setRepeat(!!v)}/>Repeat every week</label>
    {repeat&&<label className="field full">Last matchday<input type="date" required min={from} value={to} onChange={e=>setTo(e.target.value)}/></label>}
    <p className="help full">{count>MAX_SERIES_DAYS?`A series can hold up to ${MAX_SERIES_DAYS} matchdays.`:`Creates ${count} matchday${count===1?'':'s'}. Dates that already have a matchday are skipped. Attendance and opening teams are set on the day.`}</p>
    <button className="primary-btn full" disabled={busy||!count||count>MAX_SERIES_DAYS||end<=start}>{busy?'Saving…':'Schedule'}<ArrowRight/></button>
  </form>
}
function SetupDayForm({day,players,busy,onSave}:{day:Day;players:Player[];busy:boolean;onSave:(b:Record<string,unknown>)=>void}){const teamInfo=useContext(TeamsCtx);const [roster,setRoster]=useState(isReady(day)?day.roster.map(p=>p.id):players.map(p=>p.id)),[a,setA]=useState<Team>(day.opening?.[0]??'red'),[b,setB]=useState<Team>(day.opening?.[1]??'black'),[exit,setExit]=useState<Team>(day.firstExit??'red');return <form className="form-stack" onSubmit={e=>{e.preventDefault();onSave({roster,a,b,firstExit:exit})}}><div><div className="field mb-2">Attending players · {roster.length} selected</div><Attendance players={players} selected={roster} setSelected={setRoster}/></div><div className="form-grid"><label className="field">Opening team 1<Picker label="Opening team 1" value={a} onChange={v=>{setA(v as Team);setExit(v as Team)}} options={teamOptions(teamInfo)}/></label><label className="field">Opening team 2<Picker label="Opening team 2" value={b} onChange={v=>setB(v as Team)} options={teamOptions(teamInfo).filter(t=>t.value!==a)}/></label><label className="field full">If the opening round is a draw, who exits?<Picker label="Opening draw exit" value={exit} onChange={v=>setExit(v as Team)} options={teamOptions(teamInfo).filter(t=>t.value===a||t.value===b)}/></label></div><p className="help">Attendance and team assignments for this day lock when voting opens or the first result is saved. You can enter all scores later.</p>{(()=>{const empty=teamsWithout(players.map(p=>p.id),players),absent=teamsWithout(roster,players),names=(ts:Team[])=>ts.map(t=>teamInfo[t].name).join(', ');return empty.length?<p className="form-blocker">Every team needs at least one player. Add a player to {names(empty)} on its team page.</p>:absent.length?<p className="form-blocker">Tick at least one attending player from {names(absent)}.</p>:null})()}<button className="primary-btn" disabled={busy||teamsWithout(roster,players).length>0}>{busy?'Saving…':'Save matchday'}<ArrowRight/></button></form>}
function EditDayForm({day,busy,onSave}:{day:Day;busy:boolean;onSave:(b:Record<string,unknown>)=>void}){const [date,setDate]=useState(day.date),[start,setStart]=useState(day.start),[end,setEnd]=useState(day.end);return <form className="form-grid" onSubmit={e=>{e.preventDefault();onSave({date,start,end})}}><label className="field full">Match date<input type="date" required min="2026-09-01" value={date} onChange={e=>setDate(e.target.value)}/></label><label className="field">Starts<input type="time" required value={start} onChange={e=>setStart(e.target.value)}/></label><label className="field">Ends<input type="time" required value={end} onChange={e=>setEnd(e.target.value)}/></label><button className="primary-btn full" disabled={busy||end<=start}>{busy?'Saving…':'Save'}<Check/></button></form>}
function Voting({data,day,busy,action,identity,signIn,share,onProfile,confirm}:{data:PublicClub;day:Day;busy:boolean;action:Action;identity:boolean;signIn:ReactNode;share:()=>void;onProfile:()=>void;confirm:(c:{title:string;description:string;action:()=>void})=>void}){const teamInfo=useContext(TeamsCtx);
  const [candidate,setCandidate]=useState('');useEffect(()=>setCandidate(''),[day.id]);const poll=data.polls[day.id];const voter=day.roster.find(p=>p.id===data.me);const eligible=day.roster.filter(p=>p.team!==voter?.team&&data.players.find(x=>x.id===p.id)?.active!==false);const max=poll?.tally[0]?.votes||0;const winners=awardWinners(poll?.tally||[]);
  return <div><div className="poll-intro"><Trophy className="text-primary" size={32}/><h2>Player of the day.</h2><p>A great goal, a sharp save, or the pass that made it happen. Choose a player from another team.</p></div>{day.poll==='ready'&&<div className="panel mt-5"><NoData title="Voting has not opened yet">{data.isAdmin?'Set up attendance under Manage, then open voting. No scores are needed first.':'Come back once your organiser opens voting after the session.'}</NoData></div>}{day.poll==='closed'&&<>{winners.length?<>{winners.map(w=><AwardWinner key={w.candidate} winner={w} joint={winners.length>1} players={data.players}/>)}<div className="panel"><h3 className="text-xl font-bold mb-3">The final votes</h3>{poll?.tally.map(t=><div key={t.candidate} className="mb-4"><div className="flex justify-between text-sm"><PlayerLink id={t.candidate} players={data.players}/><strong>{t.votes}</strong></div><div className="progress-bar"><i style={{width:(max?t.votes/max*100:0)+'%'}}/></div></div>)}</div></>:<div className="panel mt-5"><NoData title="No votes were submitted">There is no player-of-the-day award for this session.</NoData></div>}</>}{day.poll==='open'&&<><div className="section-title"><h2>{poll?.voted?'Your vote is in.':voter?'Pick your standout player.':'Voting is open.'}</h2><span className="subtle">{poll?.count||0} / {day.roster.length} votes</span></div>{!identity?<div className="panel"><p className="help mb-4">Sign in with your connected player account to vote.</p>{signIn}</div>:!data.me?<div className="panel"><p className="help mb-4">Use your personal invitation from the organiser to connect your player profile first.</p><button className="primary-btn" onClick={onProfile}>Connect my profile<ArrowRight/></button></div>:!voter?<div className="panel"><NoData title="You weren’t marked as attending">Only active players on this matchday’s attendance list can vote.</NoData></div>:poll?.voted?<div className="panel text-center py-10"><CheckCircle2 className="text-primary mx-auto mb-4" size={42}/><h3 className="text-2xl font-bold">Vote recorded.</h3><p className="subtle mt-2">Your anonymous vote is saved. Results appear when voting closes.</p></div>:<><p className="help">{teamInfo[voter.team].name} players cannot be selected.</p><div className="voting-grid">{eligible.map(r=>{const p=data.players.find(x=>x.id===r.id)!;return <button className="candidate" data-team={p.team} style={teamVars(teamInfo[p.team])} aria-pressed={candidate===p.id} key={p.id} onClick={()=>setCandidate(p.id)}><Avatar p={p} size="lg"/><strong>{p.name}</strong><span className="subtle">{teamInfo[r.team].name}</span><span className="tick">{candidate===p.id?<Check size={23}/>:null}</span></button>})}</div><button className="primary-btn w-full" disabled={!candidate||busy} onClick={()=>confirm({title:'Submit your vote?',description:'Your vote for '+data.players.find(p=>p.id===candidate)?.name+' will be anonymous and cannot be changed.',action:async()=>{if(await action('vote',{dayId:day.id,candidate})){toast.success('Your vote is saved.');setCandidate('')}}})}>Submit anonymous vote<Vote/></button></>}<div className="action-row mt-5"><button className="secondary-btn" onClick={share}><Link2/>Share voting link</button></div></>}</div>
}

const SECTION_ICONS={results:Flag,live:Timer,vote:Vote};
// One page per matchday: pick a date on the strip, then read its Results, run it Live (admins) or Vote. Admins manage the day from the strip above the sections.
function MatchdayPage({data,day,requested,today,identity,busy,action,refresh,confirm,signIn,onDay,onSection,onModal,onEditRound,onShare,onDeleted,onProfile}:{data:PublicClub;day?:Day;requested?:string;today:string;identity:boolean;busy:boolean;action:Action;refresh:()=>Promise<PublicClub|null>;confirm:Confirm;signIn:ReactNode;onDay:(id:string)=>void;onSection:(section:MatchdaySection)=>void;onModal:(modal:'setupDay'|'editDay')=>void;onEditRound:(round:Round)=>void;onShare:(day:Day)=>void;onDeleted:()=>void;onProfile:()=>void}){
  const strip=dateStrip(data.days,today),live=!!strip.find(s=>s.day.id===day?.id)?.live;
  const sections=day?matchdaySections(day,today,data.isAdmin):[];
  const section=sections.find(s=>s===requested)??(day?defaultSection(day,today,data.isAdmin):'results');
  const status=!day?'':live?'Live':day.poll==='open'?'Voting open':isPlayed(day)?'Played':'Scheduled';
  const labels:Record<MatchdaySection,string>={results:'Results',live:day?.date===today?'Live':'Record games',vote:'Vote'};
  return <div className="rise"><div className="page-heading"><div><div className="eyebrow">WINTER LEAGUE / MATCHDAYS</div><h1>{day?dateLabel(day.date):'Matchdays'}</h1>{day&&<p className="page-intro">{timeLabel(day)} · {isReady(day)?day.roster.length+' attending':'teams are set on the day'}<span className={'day-status'+(live?' is-live':'')}>{status}</span></p>}</div></div>
    {strip.length>0&&<DateStrip strip={strip} selected={day?.id} onDay={onDay}/>}
    {!day?<div className="panel"><NoData title="The Winter league starts September 1">{data.isAdmin?'Schedule a match day or a weekly series under Me → Club admin. Attendance and opening teams are set on the day.':'Your matchdays and every recorded result will appear here.'}</NoData></div>:<>
      {data.isAdmin&&<ManageDay data={data} day={day} today={today} busy={busy} action={action} confirm={confirm} onModal={onModal} onShare={onShare} onDeleted={onDeleted}/>}
      <div className="control-switch" role="group" aria-label="Matchday sections">{sections.map(s=>{const Icon=SECTION_ICONS[s];return <button type="button" key={s} aria-pressed={section===s} onClick={()=>onSection(s)}><Icon size={18}/>{labels[s]}</button>})}</div>
      {section==='results'&&<MatchResults data={data} day={day} busy={busy} action={action} refresh={refresh} confirm={confirm} onEditRound={onEditRound}/>}
      {section==='live'&&(isReady(day)?<Gameday key={day.id+':'+day.rounds.length} day={day} players={data.players} busy={busy} action={action} confirm={confirm}/>
        :<div className="panel"><div className="panel-head"><h2>Who’s here?</h2><Users size={22}/></div><SetupDayForm key={day.id} day={day} players={data.players.filter(p=>p.active!==false)} busy={busy} onSave={async b=>{if(await action('setupDay',{dayId:day.id,...b}))toast.success('Attendance saved. Kick off when ready.')}}/></div>)}
      {section==='vote'&&<Voting data={data} day={day} busy={busy} action={action} identity={identity} signIn={signIn} share={()=>onShare(day)} onProfile={onProfile} confirm={confirm}/>}
    </>}
  </div>
}
const STRIP_MONTH=new Intl.DateTimeFormat('en-CA',{month:'short',timeZone:'UTC'});
// Every matchday as a scrolling row of dates; the selected one is kept in view.
function DateStrip({strip,selected,onDay}:{strip:ReturnType<typeof dateStrip>;selected?:string;onDay:(id:string)=>void}){
  const row=useRef<HTMLDivElement>(null);
  useEffect(()=>{row.current?.querySelector('[aria-pressed=true]')?.scrollIntoView({block:'nearest',inline:'center'})},[selected]);
  return <div className="date-strip" ref={row} role="group" aria-label="Matchdays">{strip.map(({day,when,live})=><button type="button" key={day.id} data-when={when} aria-pressed={day.id===selected} aria-label={dateLabel(day.date)+(when==='today'?', today':'')+(live?', live now':'')} onClick={()=>onDay(day.id)}>
    <small>{when==='today'?'Today':STRIP_MONTH.format(new Date(day.date+'T12:00:00Z'))}</small><strong>{Number(day.date.slice(8))}</strong>{live&&<i className="live-dot" aria-hidden="true"/>}</button>)}</div>
}
// What happened on a matchday: the award, the teams' day, the scorers, the film and every round.
function MatchResults({data,day,busy,action,refresh,confirm,onEditRound}:{data:PublicClub;day:Day;busy:boolean;action:Action;refresh:()=>Promise<PublicClub|null>;confirm:Confirm;onEditRound:(round:Round)=>void}){
  const teamInfo=useContext(TeamsCtx);
  const winners=day.poll==='closed'?awardWinners(data.polls[day.id]?.tally||[]):[];
  const scorers=playerStats(data.players,[day]).filter(p=>p.goals>0||p.assists>0);
  return <>
    {winners.map(w=><AwardWinner key={w.candidate} winner={w} joint={winners.length>1} players={data.players}/>)}
    <div className="two-columns"><div className="panel"><div className="panel-head"><h2>The day</h2><CalendarDays size={22}/></div><p className="subtle">{isReady(day)?day.roster.length+' attending · '+day.rounds.length+' rounds recorded':'Scheduled · teams are set on the day'}</p><div className="mini-stats mt-5">{teamStats([day]).map(s=><div className="mini-stat" key={s.team}><TeamLink team={s.team}/><strong>{s.wins} wins</strong><span>{s.gf} goals · {s.draws} draws</span></div>)}</div></div>
      <div className="panel"><div className="panel-head"><h2>Scorers</h2><Goal size={22}/></div>{scorers.length?scorers.map(p=><div className="leader-row" key={p.id}><Avatar p={p}/><div className="grow"><strong><PlayerLink id={p.id} players={data.players}/></strong><small>{teamInfo[day.roster.find(r=>r.id===p.id)?.team??p.team].name}{p.assists?' · '+p.assists+(p.assists===1?' assist':' assists'):''}</small></div><span className="leader-value">{p.goals}</span></div>):<p className="help">No goals recorded yet.</p>}</div></div>
    <MatchVideoPanel day={day} admin={data.isAdmin} busy={busy} action={action} refresh={refresh} confirm={confirm}/>
    <div className="section-title"><h2>Round by round</h2></div>
    {data.isAdmin&&<p className="help mb-4">Enter rounds in the order played, under Live. Edit any round to correct its score or scorers, or undo the latest round under Manage.</p>}
    {day.rounds.length?day.rounds.map((r,i)=><RoundCard key={r.id} day={day} round={r} index={i} players={data.players} admin={data.isAdmin} busy={busy} action={action} onEdit={data.isAdmin&&isReady(day)?()=>onEditRound(r):undefined}/>):<div className="panel"><NoData title="No results yet">Add scores later.</NoData></div>}
  </>
}
// Every admin action for one matchday, in one place: attendance, date, voting, late arrivals, undo, the edit log and deletion.
function ManageDay({data,day,today,busy,action,confirm,onModal,onShare,onDeleted}:{data:PublicClub;day:Day;today:string;busy:boolean;action:Action;confirm:Confirm;onModal:(modal:'setupDay'|'editDay')=>void;onShare:(day:Day)=>void;onDeleted:()=>void}){
  const unplayed=day.poll==='ready'&&!day.rounds.length,latest=day.rounds.length;
  return <section className="panel manage-day" aria-label="Manage this matchday"><span className="eyebrow">MANAGE · ADMINS ONLY</span>
    <div className="action-row">
      {unplayed&&<><button className={isReady(day)?'secondary-btn':'primary-btn'} onClick={()=>onModal('setupDay')}><Users size={14}/>{isReady(day)?'Update attendance & teams':'Set up matchday'}</button>
        <button className="secondary-btn" onClick={()=>onModal('editDay')}><Clock3 size={14}/>Edit date & time</button>
        <button className="secondary-btn remove-btn" disabled={busy} onClick={()=>confirm({title:'Cancel the '+dateLabel(day.date)+' matchday?',description:'It will be removed from the schedule. Nothing has been played or voted on yet.',action:async()=>{if(await action('deleteDay',{dayId:day.id})){onDeleted();toast.success('Matchday cancelled.')}}})}><UserMinus size={14}/>Cancel matchday</button></>}
      {day.poll==='ready'&&isReady(day)&&day.date<=today&&<button disabled={busy} className="primary-btn" onClick={()=>confirm({title:'Open player-of-the-day voting?',description:`${day.roster.length} attending players will be eligible. Attendance and teams for this day will be locked. You can keep recording games and enter results later.`,action:async()=>{if(await action('openPoll',{dayId:day.id}))toast.success('Voting is open. Share the link with your players.')}})}><Vote/>Open voting</button>}
      {day.poll==='open'&&<><button className="primary-btn" onClick={()=>onShare(day)}><Link2/>Share voting link</button><button className="secondary-btn" disabled={busy} onClick={()=>confirm({title:'Close voting and reveal the award?',description:'After closing, no more votes can be cast. The results will be shown to club members.',action:async()=>{if(await action('closePoll',{dayId:day.id}))toast.success('Voting closed. The award is ready.')}})}>Close voting & reveal</button></>}
      {latest>0&&<button className="text-btn" disabled={busy} onClick={()=>confirm({title:'Undo round '+latest+'?',description:'Its goals, assists and win are removed and the live board goes back to that game. Voting is unchanged.',action:async()=>{if(await action('undoRound',{dayId:day.id,roundId:day.rounds.at(-1)!.id}))toast.success('Round '+latest+' removed.')}})}><Undo2/>Undo round {latest}</button>}
    </div>
    {day.poll==='ready'&&!isReady(day)&&<p className="help">Set up attendance and opening teams before opening the vote.</p>}
    {day.poll==='ready'&&isReady(day)&&day.date>today&&<p className="help">Voting opens on the match day.</p>}
    {day.poll==='open'&&<p className="tiny-label">{data.polls[day.id]?.count??0} / {day.roster.length} votes received</p>}
    {day.poll==='ready'&&isReady(day)&&<LateArrival key={day.id} day={day} players={data.players} busy={busy} action={action}/>}
    <details className="manage-more"><summary>{isPlayed(day)?'Edit log and deletion':'Edit log'}</summary>
      <EditLog entries={(data.log??[]).filter(e=>'dayId' in e&&e.dayId===day.id)} players={data.players}/>
      {isPlayed(day)&&<DayDeletion day={day} data={data} busy={busy} action={action} confirm={confirm} onDeleted={onDeleted}/>}
    </details>
  </section>
}
type PlayerLine=ReturnType<typeof playerStats>[number];
function Leaders({players,kind='goals'}:{players:PlayerLine[];kind?:'goals'|'assists'|'wins'|'attended'}){const teamInfo=useContext(TeamsCtx),open=useContext(LinksCtx);const ranked=[...players].sort((a,b)=>b[kind]-a[kind]).filter(p=>p[kind]>0).slice(0,5);return ranked.length?<div>{ranked.map((p,i)=><button className="leader-row w-full text-left" key={p.id} onClick={()=>open.player(p.id)}><span className="tiny-label w-4">{i+1}</span><Avatar p={p}/><div className="grow"><strong>{p.name}</strong><small>{teamInfo[p.team].name} · {p.position}</small></div><span className="leader-value">{p[kind]}</span></button>)}</div>:<NoData title="No stats yet">The leaderboard fills in as match results are added.</NoData>}
// The player card: season stats and highlights, with a link to the player's team.
function ProfileStats({p,data,refresh,confirm}:{p:Player;data:PublicClub;refresh:()=>Promise<PublicClub|null>;confirm:Confirm}){const s=playerStats([p],data.days)[0];return <><div className="profile-top"><Avatar p={p} size="xl"/><div><span className="eyebrow"><TeamLink team={p.team}/> · {p.position}</span><h2>{p.name}<BirthdayCake p={p}/></h2><div className="profile-meta"><span>{ageFrom(p.birthYear,p.birthMonth,clubToday())??'—'} years</span><span>{p.height??'—'} cm</span><span><MapPin className="inline mr-1" size={14}/>{p.district||'District not set'}</span></div></div></div><div className="metric-strip">{[[s.attended,'Matchdays'],[s.played,'Games played'],[s.wins,'Games won'],[s.goals,'Goals scored'],[s.assists,'Assists']].map(([v,l])=><div className="metric" key={l}><div><span className="metric-label">{l}</span><strong><AnimatedNumber value={Number(v)}/></strong></div></div>)}</div><p className="help"></p><HighlightGallery player={p} editable={data.isAdmin&&p.active!==false} canRemove={data.isAdmin} onUpdate={refresh} confirm={confirm}/></>}
function PlayerCard({p}:{p:PlayerLine}){const teamInfo=useContext(TeamsCtx),open=useContext(LinksCtx);return <article className="player-card" data-team={p.team} style={teamVars(teamInfo[p.team])}><button className="player-cover w-full" onClick={()=>open.player(p.id)} aria-label={'View '+p.name}><span className="player-number">{teamInfo[p.team].letter}</span><Avatar p={p} size="lg"/></button><div className="player-info"><h3>{p.name}<BirthdayCake p={p}/></h3><div className="position">{teamInfo[p.team].name} · {p.position}{ageLabel(p)}</div><div className="player-card-stats"><div><strong>{p.attended}</strong><span>MATCHDAYS</span></div><div><strong>{p.wins}</strong><span>WINS</span></div><div><strong>{p.goals}</strong><span>GOALS</span></div><div><strong>{p.assists}</strong><span>ASSISTS</span></div></div></div><div className="player-actions"><button className="text-btn" onClick={()=>open.player(p.id)}>Player profile<ArrowUpRight/></button></div></article>}
type TeamSection='squad'|'stats'|'board'|'formation';
const TEAM_SECTIONS:Record<TeamSection,[string,typeof Users]>={squad:['Squad',Users],stats:['Stats',Trophy],board:['Board',MessagesSquare],formation:['Formation',Shirt]};
// One team's page: its header, then Squad, Stats and, for its own players and admins, its private Board and Formation. Admins manage the team from the strip above.
function TeamPage({data,team,requested,players,table,season,scope,member,busy,action,confirm,onSection,onEditTeam,onAddPlayer,onEditPlayer,onInvite,onToggleAdmin}:{data:PublicClub;team:Team;requested?:string;players:PlayerLine[];table:ReturnType<typeof teamStats>;season:ReturnType<typeof teamStats>;scope:ReactNode;member:boolean;busy:boolean;action:Action;confirm:Confirm;onSection:(section:TeamSection)=>void;onEditTeam:()=>void;onAddPlayer:()=>void;onEditPlayer:(p:Player)=>void;onInvite:(p:Player)=>void;onToggleAdmin:(p:Player)=>void}){
  const teamInfo=useContext(TeamsCtx),info=teamInfo[team],me=data.players.find(p=>p.id===data.me);
  // The API also refuses a board or formation to anyone but its team's players and admins.
  const sections:TeamSection[]=member&&(data.isAdmin||me?.team===team)?['squad','stats','board','formation']:['squad','stats'];
  const section=sections.find(s=>s===requested)??'squad';
  const record=season.find(s=>s.team===team)!,stats=table.find(s=>s.team===team)!,position=tablePosition(season,team),squad=players.filter(p=>p.team===team);
  return <div className="rise">
    <section className="team-hero" data-team={team} style={teamVars(info)}><Crest team={team}/><div className="team-hero-name"><span className="eyebrow">WINTER LEAGUE / TEAMS</span><h1>{info.name}</h1>{info.motto&&<p>{info.motto}</p>}</div>
      <div className="team-hero-numbers"><div><strong>{position?ordinal(position):'—'}</strong><span>TABLE</span></div><div><strong>{record.points}</strong><span>POINTS</span></div><div><strong className="team-hero-form">{record.form.length?record.form.slice(-5).map((f,i)=><span className={'form-dot '+f} key={i}>{f}</span>):'—'}</strong><span>FORM</span></div></div></section>
    {data.isAdmin&&<ManageTeam data={data} team={team} busy={busy} action={action} confirm={confirm} onEditTeam={onEditTeam} onAddPlayer={onAddPlayer} onEditPlayer={onEditPlayer} onInvite={onInvite} onToggleAdmin={onToggleAdmin}/>}
    <div className="control-switch" role="group" aria-label="Team sections">{sections.map(s=>{const [label,Icon]=TEAM_SECTIONS[s];return <button type="button" key={s} aria-pressed={section===s} onClick={()=>onSection(s)}><Icon size={18}/>{label}</button>})}</div>
    {section==='squad'&&(squad.length?<div className="players-grid">{squad.map(p=><PlayerCard key={p.id} p={p}/>)}</div>:<div className="panel"><NoData title="No players yet">{data.isAdmin?'Add players to this team under Manage.':'The organiser will add this squad before the first game.'}</NoData></div>)}
    {section==='stats'&&<><div className="flex justify-end mb-4">{scope}</div>
      <div className="metric-strip">{[[stats.played,'PLAYED'],[stats.points,'POINTS'],[stats.wins+'–'+stats.draws+'–'+stats.losses,'W–D–L'],[stats.gf,'GOALS FOR'],[stats.ga,'GOALS AGAINST'],[(stats.gd>0?'+':'')+stats.gd,'GOAL DIFFERENCE']].map(([v,l])=><div className="metric" key={l}><div><span className="metric-label">{l}</span><strong>{v}</strong></div></div>)}</div>
      <div className="two-columns"><div className="panel"><div className="panel-head"><h2>Top scorers</h2><Goal size={20}/></div><Leaders players={squad}/></div><div className="panel"><div className="panel-head"><h2>Playmakers</h2><Target size={20}/></div><Leaders players={squad} kind="assists"/></div><div className="panel"><div className="panel-head"><h2>Most matchdays</h2><CalendarDays size={20}/></div><Leaders players={squad} kind="attended"/></div></div></>}
    {section==='board'&&<TeamBoard data={data} team={team} confirm={confirm}/>}
    {section==='formation'&&<TeamFormation data={data} team={team} confirm={confirm}/>}
  </div>
}
const ORDINAL=new Intl.PluralRules('en-CA',{type:'ordinal'}),SUFFIX:Record<string,string>={one:'st',two:'nd',few:'rd',other:'th'};
function ordinal(n:number){return n+SUFFIX[ORDINAL.select(n)]}
// Admin controls for one team: edit it, add players, and every roster action, including restoring removed players.
function ManageTeam({data,team,busy,action,confirm,onEditTeam,onAddPlayer,onEditPlayer,onInvite,onToggleAdmin}:{data:PublicClub;team:Team;busy:boolean;action:Action;confirm:Confirm;onEditTeam:()=>void;onAddPlayer:()=>void;onEditPlayer:(p:Player)=>void;onInvite:(p:Player)=>void;onToggleAdmin:(p:Player)=>void}){
  const roster=data.players.filter(p=>p.team===team),active=roster.filter(p=>p.active!==false),removed=roster.filter(p=>p.active===false);
  return <section className="panel manage-day" aria-label="Manage this team"><span className="eyebrow">MANAGE · ADMINS ONLY</span>
    <div className="action-row"><button className="secondary-btn" onClick={onEditTeam}><Pencil/>Edit team</button><button className="primary-btn" onClick={onAddPlayer}><Plus/>Add player</button></div>
    <details className="manage-more"><summary>Roster · {active.length} active · {active.filter(p=>!p.linked).length} still to connect</summary>
      {active.length?active.map(p=><div className="roster-row" key={p.id}><Avatar p={p}/><div className="roster-name"><strong>{p.name}{p.id===data.owner?<span className="role-tag">Owner</span>:data.admins.includes(p.id)&&<span className="role-tag">Admin</span>}</strong><span>{p.position}{p.district?' · '+p.district:''} · {p.linked?'Account connected':'Invite pending'}{!p.linked&&p.email?(p.accessEmail?' · Sign-in added':' · Sign-in not added yet'):''}</span></div><div className="roster-actions"><button className="secondary-btn" onClick={()=>onEditPlayer(p)}><Pencil/>Edit</button>{!p.linked&&<button className="secondary-btn" onClick={()=>onInvite(p)}><Link2/>Invite</button>}{data.isOwner&&p.linked&&p.id!==data.owner&&<button className="secondary-btn" onClick={()=>onToggleAdmin(p)}><Shield/>{data.admins.includes(p.id)?'Remove admin':'Make admin'}</button>}{(data.isOwner||!data.admins.includes(p.id))&&p.id!==data.owner&&<button className="secondary-btn remove-btn" onClick={()=>confirm({title:'Remove '+p.name+' from the roster?',description:'This hides the player from active squads and future matchdays. Past scores, assists, wins, votes, account link and invitation remain saved. You can restore the player later.',action:async()=>{if(await action('archivePlayer',{playerId:p.id}))toast.success('Player removed from the active squad.')}})}><UserMinus/>Remove</button>}</div></div>):<NoData title="No active players yet">Add a player to this team from the button above.</NoData>}
      {removed.length>0&&<><h3 className="manage-subhead">Removed players</h3><p className="help">Past statistics stay intact.</p>{removed.map(p=><div className="roster-row" key={p.id}><Avatar p={p}/><div className="roster-name"><strong>{p.name}</strong><span>Archived profile</span></div><button className="secondary-btn" disabled={busy} onClick={async()=>{if(await action('restorePlayer',{playerId:p.id}))toast.success('Player restored to their squad.')}}><UserRoundCheck/>Restore</button></div>)}</>}
    </details>
  </section>
}
const HOME_BUTTONS={vote:['Vote now',Vote],live:['Follow it live',Timer],results:['See results',Flag],preview:['See matchday',CalendarDays]} as const;
// Home's first card: today's or the next matchday, else the latest, with the one thing to do about it.
function NextUp({day,today,onOpen}:{day?:Day;today:string;onOpen:(day:Day,tab?:MatchdaySection)=>void}){
  if(!day)return <div className="panel"><NoData title="The Winter league starts September 1">Matchdays appear here once the organiser schedules them.</NoData></div>;
  const next=homeAction(day,today),[label,Icon]=HOME_BUTTONS[next];
  return <section className="next-up"><span className="eyebrow">{day.date===today?'NEXT UP · TODAY':day.date>today?'NEXT UP':'LATEST MATCHDAY'}</span><h2>{dateLabel(day.date)}</h2><p>{timeLabel(day)}{isReady(day)?' · '+day.roster.length+' attending':''}{day.poll==='open'?' · voting is open':''}</p>
    <button className="primary-btn" onClick={()=>onOpen(day,next==='vote'?'vote':next==='results'?'results':undefined)}><Icon/>{label}</button></section>
}
// Home's second card: who took the last played matchday, and its player of the day.
function LastMatchday({data,day,onOpen}:{data:PublicClub;day?:Day;onOpen:(day:Day)=>void}){
  if(!day)return <div className="panel"><div className="panel-head"><h2>Last matchday</h2><Trophy size={20}/></div><p className="help">Results appear here after the first matchday.</p></div>;
  const winners=dayWinners(day),record=teamStats([day]).find(s=>s.team===winners[0]),award=day.poll==='closed'?awardWinners(data.polls[day.id]?.tally||[]):[];
  return <div className="panel"><div className="panel-head"><h2>Last matchday</h2><Trophy size={20}/></div><p className="subtle">{dateLabel(day.date)}</p>
    <div className="home-line">{winners.map(t=><Crest key={t} team={t}/>)}<span>{winners.map((t,i)=><span key={t}>{i?' and ':''}<TeamLink team={t}/></span>)} {winners.length>1?'shared the day':'took the day'}{record&&<small> · {record.wins} W · {record.draws} D</small>}</span></div>
    {award.length>0&&<div className="home-line"><Trophy size={16}/><span>Player of the day: {award.map((w,i)=><span key={w.candidate}>{i?' & ':''}<PlayerLink id={w.candidate} players={data.players}/></span>)}</span></div>}
    <button className="text-btn mt-3" onClick={()=>onOpen(day)}>See results<ArrowRight size={14}/></button></div>
}
const BOARD_PREVIEW_POSTS=2;
// Home's third card: the newest posts on the visitor's team board, text only, so it costs no photo reads.
function BoardPreview({data,team,onOpen}:{data:PublicClub;team:Team;onOpen:()=>void}){
  const teamInfo=useContext(TeamsCtx);const [posts,setPosts]=useState<BoardPost[]|null>(null),[failed,setFailed]=useState('');
  useEffect(()=>{let live=true;(async()=>{try{const r=await fetch('/api/board?team='+team,{cache:'no-store'});const j=await r.json() as BoardPage&{error?:string};if(!r.ok)throw new Error(j.error||'The team board could not load.');if(live)setPosts(j.posts.slice(0,BOARD_PREVIEW_POSTS))}catch(e){if(live)setFailed((e as Error).message)}})();return ()=>{live=false}},[team]);
  return <div className="panel"><div className="panel-head"><h2>{teamInfo[team].name} board</h2><MessagesSquare size={20}/></div>
    {failed?<p className="help">{failed}</p>:posts===null?<p className="help">Loading the board…</p>:!posts.length?<p className="help">Nothing posted yet.</p>
      :posts.map(post=><div className="board-preview-post" key={post.id}><Avatar p={data.players.find(p=>p.id===post.author)}/><div><strong><PlayerLink id={post.author} players={data.players} fallback="Former player"/></strong> <small>{postedAgo(post.createdAt)}</small><p>{post.body}</p></div></div>)}
    <button className="text-btn mt-3" onClick={onOpen}>Open the board<ArrowRight size={14}/></button></div>
}
type MeSection='profile'|'guide'|'admin';
const ME_SECTIONS:Record<MeSection,[string,typeof Users,string,string]>={profile:['Profile',UserRound,'My player profile','Your season so far, with the moments worth replaying.'],guide:['Club guide',Info,'How matchdays work.','The rules of the Winter league and how the app runs a matchday.'],admin:['Club admin',Settings2,'Club admin','Admins, new matchdays, exports and the full edit log. Only admins see this.']};
function ClubGuide(){return <><div className="rules-grid">{[['01','The winter ritual','Organisers schedule matchdays, usually as a weekly series. Season begins September 1, 2026. Two teams play; the third waits.'],['02','Win and stay','Each game lasts 10 minutes, whatever the score. The winner stays and the waiting team comes in. In the table a win is worth 3 points, a draw 1.'],['03','Keep things moving','On a draw, the team that has been on longest leaves. For a draw in the first game, the organiser picks who leaves when setting up the day.']].map(([n,t,p])=><div className="rule" key={n}><b>{n}</b><h3>{t}</h3><p>{p}</p></div>)}</div><div className="two-columns mt-6"><div className="panel"><h2 className="text-xl font-bold mb-3">The matchday routine</h2><ol className="space-y-4 pl-5 list-decimal text-sm text-muted-foreground"><li>Set up the squads and send each player their personal invitation once.</li><li>After the game, create that matchday and confirm attendance.</li><li>Open voting and share the voting link in the team chat. No scores are needed.</li><li>At home, enter each round’s score, goals, assists and players who took part.</li><li>Close voting when you’re ready. The club can then see the winning player or joint winners.</li></ol></div><div className="panel"><h2 className="text-xl font-bold mb-3">Fair votes. Real stats.</h2><p className="help">One vote per attending player. You cannot vote for your team, and you cannot change your team yourself. A vote cannot be changed after submission.</p><p className="help mt-4">Votes are anonymous to club members: the ballot is stored separately from the record that says you voted. Only combined totals are shown, after voting closes. Small groups may still be able to infer a choice.</p><p className="help mt-4">Team wins count match results. Individual wins count only selected round participants. Own goals count for the team score, not a player’s goal tally. No result is invented.</p></div></div><div className="panel mt-6"><h2 className="text-xl font-bold mb-3">Getting everyone in</h2><p className="help">Open your personal invite, sign in with your own email, then tap Connect my player profile. Send personal invitations privately; use the shared voting link after every game.</p></div></>}
// Club-wide admin tools: the admin list, scheduling, export and the full edit log.
function ClubAdmin({data,onNewMatchday,onExport,onToggleAdmin}:{data:PublicClub;onNewMatchday:()=>void;onExport:()=>void;onToggleAdmin:(p:Player)=>void}){
  const admins=data.players.filter(p=>p.id===data.owner||data.admins.includes(p.id));
  return <div className="form-stack">
    <div className="two-columns"><section className="panel"><div className="panel-head"><h2>Admins</h2><Shield size={20}/></div>
      {admins.map(p=><div className="roster-row" key={p.id}><Avatar p={p}/><div className="roster-name"><strong><PlayerLink id={p.id} players={data.players}/><span className="role-tag">{p.id===data.owner?'Owner':'Admin'}</span></strong></div>{data.isOwner&&p.id!==data.owner&&<button className="secondary-btn" onClick={()=>onToggleAdmin(p)}><Shield/>Remove admin</button>}</div>)}
      <p className="help mt-3">Only the owner adds or removes admins. Make someone an admin from their row under Manage on their team page.</p></section>
      <section className="panel"><div className="panel-head"><h2>Matchdays and data</h2><CalendarDays size={20}/></div><p className="subtle mb-4">Schedule one matchday or a weekly series. Attendance and opening teams are set on the day.</p>
        <div className="action-row"><button className="primary-btn" onClick={onNewMatchday}><Plus/>New matchday</button><button className="secondary-btn" onClick={onExport}><Download/>Export stats</button></div></section></div>
    <section className="panel"><div className="panel-head"><h2>Edit log</h2><History size={22}/></div><p className="subtle">Every corrected or undone game, every matchday deletion and every board post or comment an admin removed, newest first.</p><EditLog entries={data.log??[]} players={data.players} showDay/></section>
  </div>
}
function AwardWinner({winner,joint,players}:{winner:{candidate:string;votes:number};joint:boolean;players:Player[]}){const p=players.find(x=>x.id===winner.candidate);return <div className="trophy-winner"><Avatar p={p} size="lg"/><div><div className="eyebrow">{joint?'JOINT PLAYER OF THE DAY':'PLAYER OF THE DAY'}</div><h3><PlayerLink id={winner.candidate} players={players}/></h3><p className="subtle">{winner.votes} votes · Chosen by the other teams</p></div></div>}
function RoundCard({day,round:r,index,players,admin,busy,action,onEdit}:{day:Day;round:Round;index:number;players:Player[];admin:boolean;busy:boolean;action:Action;onEdit?:()=>void}){const teamInfo=useContext(TeamsCtx);return <article className="round-card"><div className="round-main"><span className="round-number">ROUND {String(index+1).padStart(2,'0')}</span><TeamLink team={r.a}/><span className="score"><AnimatedNumber value={r.scoreA}/> : <AnimatedNumber value={r.scoreB}/></span><TeamLink team={r.b} className="away"/></div><div className="round-goals">{r.goals.length?r.goals.map((g,k)=><span key={k}><Goal/>{g.ownGoal?'Own goal':<PlayerLink id={g.scorer} players={players} fallback="Scorer not recorded"/>}{g.assist&&<> · assist: <PlayerLink id={g.assist} players={players}/></>}</span>):<span>No goals</span>}<span className="ml-auto">{r.winner?teamInfo[r.winner].name+' stay on':'Draw · '+teamInfo[r.exit].name+' rotate off'}</span>{onEdit&&<button className="text-btn" disabled={busy} onClick={onEdit}><Pencil size={14}/>Edit</button>}</div>{(r.videoUrl||admin)&&<RoundVideo day={day} round={r} admin={admin} busy={busy} action={action}/>}</article>}

function VideoEmbed({url,title}:{url:string;title:string}){const embed=embedVideo(url);return <div className="video-frame">{embed?<iframe title={title} src={embed} allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen loading="lazy"/>:<a className="video-external" href={url} target="_blank" rel="noopener noreferrer"><span className="video-play">▶</span><strong>{title}</strong><small>Opens the shared video in a new tab</small></a>}</div>}
function Gameday({day,players,busy,action,confirm}:{day:ReadyDay;players:Player[];busy:boolean;action:Action;confirm:(c:{title:string;description:string;action:()=>void})=>void}){
  const teamInfo=useContext(TeamsCtx);const n=nextMatch(day),game=day.rounds.length+1,key=draftKey(day.id,game);
  const inPlay=day.roster.filter(r=>r.team===n.a||r.team===n.b).map(r=>({...players.find(p=>p.id===r.id)!,team:r.team}));
  const [draft,setDraft]=useState<GameDraft>(()=>loadDraft(key)??freshDraft(inPlay.map(p=>p.id))),[now,setNow]=useState(()=>Date.now());const buzzed=useRef(false);
  useEffect(()=>storeDraft(key,draft),[key,draft]);
  useEffect(()=>{if(draft.startedAt===null)return;const t=setInterval(()=>setNow(Date.now()),500);return ()=>clearInterval(t)},[draft.startedAt]);
  const left=gameClock(draft,now),{scoreA,scoreB}=roundPayload(draft,n.a,n.b);
  useEffect(()=>{if(left>0){buzzed.current=false;return}if(draft.startedAt!==null&&!buzzed.current){buzzed.current=true;navigator.vibrate?.([300,150,300])}},[left,draft.startedAt]);
  function toggleClock(){const t=Date.now();setNow(t);setDraft(d=>d.startedAt===null?{...d,startedAt:t}:{...d,elapsed:d.elapsed+t-d.startedAt,startedAt:null})}
  function endGame(){const winner=scoreA===scoreB?null:scoreA>scoreB?n.a:n.b;confirm({title:`End game ${game}: ${teamInfo[n.a].name} ${scoreA}–${scoreB} ${teamInfo[n.b].name}?`,description:(winner?teamInfo[winner].name+' stay on':'A draw: '+teamInfo[n.incumbent].name+' leave')+' and '+teamInfo[n.waiting].name+' come on. You can undo the last game if needed.',action:async()=>{if(await action('addRound',{dayId:day.id,...roundPayload(draft,n.a,n.b)})){forgetDraft(key);toast.success('Game '+game+' saved. Stats updated.')}}})}
  return <div className="gameday">
    <section className="panel live-board">
      <div className="live-head"><span className="eyebrow">GAME {game}</span><span className="subtle">{teamInfo[n.waiting].name} waiting · on a draw {teamInfo[n.incumbent].name} leave</span></div>
      <div className={'game-clock'+(left===0?' done':'')} role="timer">{left===0?'Time’s up':Math.floor(left/60000)+':'+String(Math.floor(left%60000/1000)).padStart(2,'0')}</div>
      <div className="action-row clock-controls"><button className="secondary-btn" onClick={toggleClock}>{draft.startedAt!==null?'Pause':draft.elapsed?'Resume':'Start 10 minutes'}</button><button className="text-btn" onClick={()=>setDraft(d=>({...d,elapsed:0,startedAt:null}))}>Reset clock</button></div>
      <ScoreSheet a={n.a} b={n.b} players={inPlay} lineup={draft.lineup} goals={draft.goals} emptyHint="Tap Goal for each goal as it happens." onChange={patch=>setDraft(d=>({...d,...patch}))}/>
      <button className="primary-btn end-game" disabled={busy} onClick={endGame}><Flag/>End game {game}</button>
    </section>
    <section className="panel">
      <div className="panel-head"><h2>Today’s session</h2><CalendarDays size={22}/></div>
      <p className="subtle">{day.roster.length} attending · {day.rounds.length} games played</p>
      {day.rounds.length>0&&<ol className="session-results">{day.rounds.map((r,i)=><li key={r.id}><span className="tiny-label">G{i+1}</span><strong className="team-name" style={teamVars(teamInfo[r.a])}>{teamInfo[r.a].name}</strong> {r.scoreA}–{r.scoreB} <strong className="team-name" style={teamVars(teamInfo[r.b])}>{teamInfo[r.b].name}</strong></li>)}</ol>}
    </section>
  </div>
}
// Score buttons, the goal list and the lineup for one game: used live on Gameday and when an admin corrects a played game.
function ScoreSheet({a,b,players,lineup,goals,emptyHint,onChange}:{a:Team;b:Team;players:Player[];lineup:string[];goals:GoalEntry[];emptyHint:string;onChange:(patch:{lineup?:string[];goals?:GoalEntry[]})=>void}){
  const teamInfo=useContext(TeamsCtx);const [goalFor,setGoalFor]=useState<Team|null>(null);
  const {scoreA,scoreB}=roundPayload({...freshDraft(lineup),goals},a,b),name=(pid:string|null)=>players.find(p=>p.id===pid)?.name;
  return <>
    <div className="live-score">{([[a,scoreA],[b,scoreB]] as const).map(([t,count])=><div className="live-side" key={t} style={teamVars(teamInfo[t])}><Crest team={t}/><strong>{teamInfo[t].name}</strong><span className="live-goals">{count}</span><button type="button" className="primary-btn goal-btn" onClick={()=>setGoalFor(t)}><Plus/>Goal</button></div>)}</div>
    {goals.length?<ol className="goal-log">{goals.map((g,i)=><li key={i}><span><strong className="team-name" style={teamVars(teamInfo[g.team])}>{teamInfo[g.team].name}</strong> · {g.ownGoal?'Own goal'+(g.scorer?' by '+name(g.scorer):''):name(g.scorer)||'Scorer not recorded'}{g.assist?' · assist '+name(g.assist):''}</span><button type="button" className="text-btn" onClick={()=>onChange({goals:goals.filter((_,k)=>k!==i)})}>Remove</button></li>)}</ol>:<p className="help">{emptyHint}</p>}
    <details><summary className="text-sm cursor-pointer text-primary">Players in this game · {lineup.length} selected</summary><Attendance players={players} selected={lineup} setSelected={next=>onChange({lineup:next})}/><p className="help mt-2">Deselect anyone who sat out. Players in the game get the appearance and, if their team wins, the win.</p></details>
    {goalFor&&<GoalDialog team={goalFor} against={goalFor===a?b:a} players={players.filter(p=>lineup.includes(p.id))} onClose={()=>setGoalFor(null)} onAdd={g=>{onChange({goals:[...goals,g]});setGoalFor(null)}}/>}
  </>
}
// Corrects a played game. Its teams stay fixed; the winner, and on a draw who rotates off, are recalculated on save.
function EditRoundDialog({day,round,players,busy,action,onClose}:{day:ReadyDay;round:Round;players:Player[];busy:boolean;action:Action;onClose:()=>void}){
  const teamInfo=useContext(TeamsCtx);const [lineup,setLineup]=useState(round.lineup),[goals,setGoals]=useState(round.goals);
  const number=day.rounds.findIndex(r=>r.id===round.id)+1,payload=roundPayload({...freshDraft(lineup),goals},round.a,round.b);
  const inPlay=day.roster.filter(r=>r.team===round.a||r.team===round.b).map(r=>({...players.find(p=>p.id===r.id)!,team:r.team}));
  async function save(){if(await action('editRound',{dayId:day.id,roundId:round.id,...payload})){toast.success('Round '+number+' updated.');onClose()}}
  return <Dialog open onOpenChange={v=>{if(!v&&!busy)onClose()}}><DialogContent className="dialog-panel wide"><DialogHeader><DialogTitle>Edit round {number}</DialogTitle><DialogDescription>{teamInfo[round.a].name} {payload.scoreA}–{payload.scoreB} {teamInfo[round.b].name}. The score follows the goal list. Later rounds stay as they were played.</DialogDescription></DialogHeader>
    <div className="form-stack edit-round"><ScoreSheet a={round.a} b={round.b} players={inPlay} lineup={lineup} goals={goals} emptyHint="No goals: a 0–0 draw." onChange={patch=>{if(patch.lineup)setLineup(patch.lineup);if(patch.goals)setGoals(patch.goals)}}/>
      <button type="button" className="primary-btn" disabled={busy} onClick={save}><Check/>Save round {number}</button></div>
  </DialogContent></Dialog>
}
// A played matchday is deleted by the owner alone or by three admins; approvals only count while their giver is an admin.
function DayDeletion({day,data,busy,action,confirm,onDeleted}:{day:Day;data:PublicClub;busy:boolean;action:Action;confirm:(c:{title:string;description:string;action:()=>void})=>void;onDeleted:()=>void}){
  const request=day.deletion,approved=!!data.me&&!!request?.approvals.includes(data.me);
  const counted=request?request.approvals.filter(pid=>pid===data.owner||data.admins.includes(pid)).length:0;
  const name=(pid:string)=>data.players.find(p=>p.id===pid)?.name??'A former admin';
  const done=(reply:Record<string,unknown>|null,pending:string)=>{if(!reply)return;if(reply.deleted){onDeleted();toast.success('Matchday deleted.')}else toast.success(pending)};
  const consequence='Its results, votes and uploaded clip are removed for everyone, and the standings are recalculated. This cannot be undone.';
  return <section className="panel day-deletion mt-5"><div className="panel-head"><h2>Delete matchday</h2><Trash2 size={22}/></div>
    {request?<>
      <p className="subtle">Requested by {name(request.requestedBy)} · <strong>{counted} of {DELETION_APPROVALS} admin approvals</strong></p>
      <p className="help">The matchday is deleted at {DELETION_APPROVALS} admin approvals, or as soon as the owner approves.</p>
      <div className="action-row">{!approved&&<button className="secondary-btn remove-btn" disabled={busy} onClick={()=>confirm({title:(data.isOwner?'Delete':'Approve deleting')+' the '+dateLabel(day.date)+' matchday?',description:consequence,action:async()=>done(await action('approveDayDeletion',{dayId:day.id}),'Approval recorded.')})}><Trash2 size={14}/>{data.isOwner?'Approve and delete':'Approve deletion'}</button>}
        <button className="text-btn" disabled={busy} onClick={async()=>{if(await action('cancelDayDeletion',{dayId:day.id}))toast.success('Deletion request withdrawn.')}}>Withdraw request</button></div>
    </>:<>
      <p className="help">{data.isOwner?'As the owner, you can delete this played matchday straight away.':'A played matchday is deleted once '+DELETION_APPROVALS+' admins approve, or the owner does. Your request counts as the first approval.'}</p>
      <button className="secondary-btn remove-btn" disabled={busy} onClick={()=>confirm({title:(data.isOwner?'Delete':'Request deleting')+' the '+dateLabel(day.date)+' matchday?',description:consequence,action:async()=>done(await action('requestDayDeletion',{dayId:day.id}),'Deletion requested. Other admins can now approve it.')})}><Trash2 size={14}/>Delete matchday</button>
    </>}
  </section>
}
const LOG_LABELS:Record<LogAction,string>={editRound:'Corrected a game',undoRound:'Undid a game',requestDayDeletion:'Asked to delete the matchday',approveDayDeletion:'Approved deleting the matchday',cancelDayDeletion:'Withdrew the deletion request',deleteDay:'Matchday deleted',removePost:'Removed a board post',removeComment:'Removed a board comment'};
const LOGGED_AT=new Intl.DateTimeFormat('en-CA',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Edmonton'});
function EditLog({entries,players,showDay=false}:{entries:LogEntry[];players:Player[];showDay?:boolean}){
  const teamInfo=useContext(TeamsCtx);const name=(pid:string,missing='A former admin')=>players.find(p=>p.id===pid)?.name??missing;
  const game=(s:RoundSnapshot)=>teamInfo[s.a].name+' '+s.scoreA+'–'+s.scoreB+' '+teamInfo[s.b].name;
  if(!entries.length)return <p className="help">No corrections or deletions yet.</p>;
  return <ol className="edit-log">{entries.map(e=><li key={e.id}>{'dayId' in e?<>
    <strong>{LOG_LABELS[e.action]}{showDay&&<span> · {dateLabel(e.date)}</span>}</strong>
    {(e.before||e.after)&&<span>{e.before&&game(e.before)}{e.before&&e.after&&' → '}{e.after&&game(e.after)}</span>}
  </>:<><strong>{LOG_LABELS[e.action]} · {teamInfo[e.team].name} board</strong><span>Written by {name(e.author,'a former player')}</span></>}
    <small>{name(e.by)} · {LOGGED_AT.format(new Date(e.at))}</small></li>)}</ol>
}
function GoalDialog({team,against,players,onClose,onAdd}:{team:Team;against:Team;players:Player[];onClose:()=>void;onAdd:(g:GoalEntry)=>void}){
  const teamInfo=useContext(TeamsCtx);const [ownGoal,setOwnGoal]=useState(false),[scorer,setScorer]=useState('unknown'),[assist,setAssist]=useState('none');
  const scorers=players.filter(p=>p.team===(ownGoal?against:team)),assists=players.filter(p=>p.team===team&&p.id!==scorer);
  return <Dialog open onOpenChange={v=>{if(!v)onClose()}}><DialogContent className="dialog-panel"><DialogHeader><DialogTitle>Goal for {teamInfo[team].name}</DialogTitle><DialogDescription>Record who scored. You can remove it from the game log.</DialogDescription></DialogHeader>
    <form className="form-stack" onSubmit={e=>{e.preventDefault();onAdd({team,scorer:scorer==='unknown'?null:scorer,assist:ownGoal||assist==='none'?null:assist,ownGoal})}}>
      <label className="checkbox-label"><Checkbox checked={ownGoal} onCheckedChange={v=>{setOwnGoal(!!v);setScorer('unknown');setAssist('none')}}/>Own goal by {teamInfo[against].name}</label>
      <label className="field">{ownGoal?'Own-goal scorer':'Goalscorer'}<Picker label="Goalscorer" value={scorer} onChange={v=>{setScorer(v);if(v===assist)setAssist('none')}} options={[{value:'unknown',label:'Not recorded'},...scorers.map(p=>({value:p.id,label:p.name}))]}/></label>
      {!ownGoal&&<label className="field">Assist<Picker label="Assist" value={assist} onChange={setAssist} options={[{value:'none',label:'No assist / not recorded'},...assists.map(p=>({value:p.id,label:p.name}))]}/></label>}
      <button className="primary-btn"><Check/>Add goal</button>
    </form></DialogContent></Dialog>
}
// A game in progress is a per-device convenience: storage may be unavailable (private browsing), so the board keeps working from memory.
function loadDraft(key:string):GameDraft|null{try{const saved=localStorage.getItem(key);return saved?JSON.parse(saved) as GameDraft:null}catch{return null}}
function storeDraft(key:string,draft:GameDraft){try{localStorage.setItem(key,JSON.stringify(draft))}catch{/* storage unavailable: the draft stays in memory */}}
function forgetDraft(key:string){try{localStorage.removeItem(key)}catch{/* storage unavailable: nothing was saved */}}
function LateArrival({day,players,busy,action}:{day:Day;players:Player[];busy:boolean;action:Action}){
  const [playerId,setPlayerId]=useState('');const absent=players.filter(p=>p.active!==false&&!day.roster.some(r=>r.id===p.id));
  if(!absent.length)return null;
  return <div className="action-row mt-4"><label className="field">Late arrival<Picker label="Late arrival" value={playerId} onChange={setPlayerId} options={absent.map(p=>({value:p.id,label:p.name}))}/></label><button className="secondary-btn" disabled={busy||!playerId} onClick={async()=>{const name=absent.find(p=>p.id===playerId)?.name;if(await action('addAttendee',{dayId:day.id,playerId})){setPlayerId('');toast.success(name+' added to attendance.')}}}><UserRoundCheck size={14}/>Add late arrival</button></div>
}
function RoundVideo({day,round,admin,busy,action}:{day:Day;round:Round;admin:boolean;busy:boolean;action:Action}){
  const [url,setUrl]=useState(round.videoUrl||'');useEffect(()=>setUrl(round.videoUrl||''),[round.id,round.videoUrl]);
  return <div className="round-video">{round.videoUrl&&<details><summary>Watch this round</summary><VideoEmbed url={round.videoUrl} title="Round video"/></details>}
    {admin&&<div className="video-controls"><label className="field">Round link · YouTube, Vimeo or Google Drive<input type="url" value={url} onChange={e=>setUrl(e.target.value)} placeholder="Paste a link to this round"/></label><button className="secondary-btn" disabled={busy||url===(round.videoUrl||'')} onClick={async()=>{if(await action('setRoundVideo',{dayId:day.id,roundId:round.id,videoUrl:url}))toast.success(url?'Round link saved.':'Round link removed.')}}>Save link</button></div>}
  </div>
}

function MatchVideoPanel({day,admin,busy,action,refresh,confirm}:{day:Day;admin:boolean;busy:boolean;action:Action;refresh:()=>Promise<PublicClub|null>;confirm:(c:{title:string;description:string;action:()=>void})=>void}){
  const [url,setUrl]=useState(day.videoUrl||''),[uploading,setUploading]=useState(false);
  useEffect(()=>setUrl(day.videoUrl||''),[day.id,day.videoUrl]);
  return <section className="match-video-panel"><div className="section-title"><h2>Matchday film</h2><span className="subtle"></span></div>
    {(day.videoKey||day.videoUrl)?<div className="match-video-grid">
      {day.videoKey&&<div className="video-frame"><video src={'/api/video?key='+encodeURIComponent(day.videoKey)} controls playsInline preload="metadata" aria-label="Matchday video clip"/></div>}
      {day.videoUrl&&<VideoEmbed url={day.videoUrl} title="Watch the full match"/>}
    </div>:<div className="video-empty"><span className="video-play">▶</span><div><strong>No video yet</strong><p>Add a match video.</p></div></div>}
    {admin&&<div className="video-controls"><label className="field">Full match link · YouTube, Vimeo or Google Drive<input type="url" value={url} onChange={e=>setUrl(e.target.value)} placeholder="Paste a shareable full match video link"/></label><button className="secondary-btn" disabled={busy||url===(day.videoUrl||'')} onClick={async()=>{if(await action('setMatchVideo',{dayId:day.id,videoUrl:url}))toast.success('Match replay link saved.')}}>Save link</button><label className="secondary-btn upload-control"><Upload/>{uploading?'Uploading…':'Upload short match clip'}<input className="sr-only" type="file" accept="video/mp4,video/webm" disabled={uploading} onChange={async e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>20*1024*1024){toast.error('Choose a clip under 20 MB. For the full game, add a video link.');return}setUploading(true);try{const f=new FormData();f.set('target','matchday');f.set('dayId',day.id);f.set('video',file);const r=await fetch('/api/video',{method:'POST',body:f});const j=await r.json() as {error?:string};if(!r.ok)throw new Error(j.error||'Upload failed');await refresh();toast.success('Match clip uploaded.')}catch(err){toast.error((err as Error).message)}finally{setUploading(false);e.target.value=''}}}/></label>{day.videoKey&&<button className="text-btn" onClick={()=>confirm({title:'Remove the match clip?',description:'The uploaded clip will be deleted. The full match link and match statistics will stay saved.',action:async()=>{const r=await fetch('/api/video?key='+encodeURIComponent(day.videoKey!),{method:'DELETE'});if(r.ok){await refresh();toast.success('Match clip removed.')}else toast.error(((await r.json()) as {error?:string}).error)}})}>Remove clip</button>}<p className="help">Full-length games work best as a shared video link. Direct uploads are for short MP4 or WebM clips up to 20 MB.</p></div>}
  </section>;
}

function HighlightGallery({player,editable,canRemove,onUpdate,confirm}:{player:Player;editable:boolean;canRemove:boolean;onUpdate:()=>Promise<PublicClub|null>;confirm:(c:{title:string;description:string;action:()=>void})=>void}){
  const [kind,setKind]=useState('Goal'),[note,setNote]=useState(''),[uploading,setUploading]=useState(false);
  const items=player.highlights||[];
  return <section className="highlights-section"><div className="section-title"><h2>Personal highlights</h2><span className="subtle">Goals · assists · saves · fouls</span></div>
    {items.length?<div className="highlights-grid">{items.map(h=><article className="highlight-card" key={h.id}><div className="video-frame"><video controls playsInline preload="metadata" src={'/api/video?key='+encodeURIComponent(h.key)} aria-label={h.kind+' highlight by '+player.name}/></div><div className="highlight-caption"><div><strong>{h.kind}</strong>{h.note&&<p>{h.note}</p>}</div>{(editable||canRemove)&&<button className="text-btn" aria-label={'Remove '+h.kind+' clip'} onClick={()=>confirm({title:'Remove this highlight?',description:'This video will be deleted from the player profile. Goals, assists and game statistics remain saved.',action:async()=>{const r=await fetch('/api/video?key='+encodeURIComponent(h.key),{method:'DELETE'});if(r.ok){await onUpdate();toast.success('Highlight removed.')}else toast.error(((await r.json()) as {error?:string}).error)}})}><UserMinus size={16}/></button>}</div></article>)}</div>:<div className="video-empty"><span className="video-play">▶</span><div><strong>No highlights yet.</strong><p></p></div></div>}
    {editable&&<div className="highlight-upload"><Picker label="Highlight type" value={kind} onChange={setKind} options={['Goal','Assist','Save','Skill','Foul','Other'].map(v=>({value:v,label:v}))}/><label className="field"><span className="sr-only">Clip caption</span><input placeholder="A short caption (optional)" maxLength={100} value={note} onChange={e=>setNote(e.target.value)}/></label><label className="primary-btn upload-control"><Upload/>{uploading?'Uploading…':'Add highlight'}<input className="sr-only" type="file" accept="video/mp4,video/webm" disabled={uploading||items.length>=12} onChange={async e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>20*1024*1024){toast.error('Choose a short MP4 or WebM clip under 20 MB.');return}setUploading(true);try{const f=new FormData();f.set('target','profile');f.set('playerId',player.id);f.set('kind',kind);f.set('note',note);f.set('video',file);const r=await fetch('/api/video',{method:'POST',body:f});const j=await r.json() as {error?:string};if(!r.ok)throw new Error(j.error||'Upload failed');await onUpdate();setNote('');toast.success('Highlight added to your profile.')}catch(err){toast.error((err as Error).message)}finally{setUploading(false);e.target.value=''}}}/></label><p className="help">Up to twelve short clips per player, 20 MB each. The organiser posts clips to player profiles.</p></div>}
  </section>;
}

type Confirm=(c:{title:string;description:string;action:()=>void})=>void;
type Preview={file:File;url:string};
const BOARD_REFRESH_MS=60_000;
const RELATIVE=new Intl.RelativeTimeFormat('en-CA',{numeric:'auto'}),POSTED_ON=new Intl.DateTimeFormat('en-CA',{month:'short',day:'numeric',timeZone:'America/Edmonton'});
function postedAgo(at:number){const seconds=Math.round((at-Date.now())/1000);if(seconds<-7*86400)return POSTED_ON.format(new Date(at));for(const [unit,size] of [['day',86400],['hour',3600],['minute',60]] as const)if(Math.abs(seconds)>=size)return RELATIVE.format(Math.round(seconds/size),unit);return 'just now'}
const boardImage=(key:string)=>'/api/board/image?key='+encodeURIComponent(key);
async function boardRequest(fields:Record<string,string|File[]>){const form=new FormData();for(const [k,v] of Object.entries(fields))for(const item of [v].flat())form.append(k,item);const r=await fetch('/api/board',{method:'POST',body:form});const j=await r.json() as {error?:string};if(!r.ok)throw new Error(j.error||'The team board could not be updated. Please try again.');return j}
// A team's private discussion, shown on its team page to its players and to admins, who moderate every board.
function TeamBoard({data,team,confirm}:{data:PublicClub;team:Team;confirm:Confirm}){
  const teamInfo=useContext(TeamsCtx);const me=data.players.find(p=>p.id===data.me);
  const [posts,setPosts]=useState<BoardPost[]|null>(null),[next,setNext]=useState<string|null>(null),[loadingMore,setLoadingMore]=useState(false),[viewing,setViewing]=useState('');
  // What is on screen now, so a response that arrives after a team switch is dropped.
  const shown=useRef({team,posts});useEffect(()=>{shown.current={team,posts}});
  const canTakePart=me?.team===team;
  async function fetchPage(before?:string){const r=await fetch('/api/board?team='+team+(before?'&before='+encodeURIComponent(before):''),{cache:'no-store'});const j=await r.json() as BoardPage&{error?:string};if(!r.ok)throw new Error(j.error||'The team board could not load.');return j}
  // Reloads the newest page and keeps any older posts of this board already loaded beneath it.
  async function refresh(){const forTeam=team;try{const first=await fetchPage();if(shown.current.team!==forTeam)return;const oldest=first.posts.at(-1);
    const older=first.next&&oldest?(shown.current.posts??[]).filter(p=>p.team===forTeam&&(p.createdAt<oldest.createdAt||p.createdAt===oldest.createdAt&&p.id<oldest.id)):[];
    setPosts([...first.posts,...older]);if(!older.length)setNext(first.next)}catch(e){toast.error((e as Error).message)}}
  async function loadMore(){if(!next)return;setLoadingMore(true);try{const page=await fetchPage(next);setPosts(current=>[...(current??[]),...page.posts.filter(p=>!current?.some(c=>c.id===p.id))]);setNext(page.next)}catch(e){toast.error((e as Error).message)}finally{setLoadingMore(false)}}
  useEffect(()=>{void refresh();const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh()},BOARD_REFRESH_MS);return ()=>clearInterval(timer)},[team]); // eslint-disable-line react-hooks/exhaustive-deps
  async function act(fields:Record<string,string|File[]>,done?:string){try{await boardRequest(fields);if(done)toast.success(done);await refresh();return true}catch(e){toast.error((e as Error).message);return false}}
  function remove(kind:'post'|'comment',id:string,author:string){const others=author!==data.me;
    confirm({title:kind==='post'?'Delete this post?':'Delete this comment?',description:(kind==='post'?'Its photos, comments and reactions are removed for everyone.':'Its photo and reactions are removed for everyone.')+' This cannot be undone.'+(others?' The removal is recorded in the admin edit log, without the text.':''),
      action:()=>void act(kind==='post'?{action:'deletePost',postId:id}:{action:'deleteComment',commentId:id},kind==='post'?'Post deleted.':'Comment deleted.')})}
  const author=(id:string)=>data.players.find(p=>p.id===id);
  const react=(targetId:string,emoji:BoardReaction)=>void act({action:'react',targetId,emoji});
  return <div><div className="board-intro"><p className="help">{canTakePart?'Private: plans, photos and banter for your team only.':'Private to this team. Admins can read every board and remove posts.'}</p><button type="button" className="secondary-btn" onClick={()=>void refresh()}><RefreshCw/>Refresh</button></div>
    {canTakePart&&<BoardComposer key={team} onPost={(body,photos)=>act({action:'createPost',team,body,images:photos},'Posted to the board.')}/>}
    {posts===null?<div className="banner" role="status"><span className="flex gap-2 items-center"><Loader2 className="animate-spin" size={16}/>Loading the board…</span></div>
      :!posts.length?<div className="panel"><NoData title="Nothing posted yet">{canTakePart?'Start the conversation: share a plan, a photo or a shout-out.':'This team has not posted anything yet.'}</NoData></div>
      :<div className="board-feed">{posts.map(post=>{const writer=author(post.author);return <article className="panel board-post" key={post.id}>
        <header className="board-head"><Avatar p={writer}/><div><strong><PlayerLink id={post.author} players={data.players} fallback="Former player"/></strong><small>{postedAgo(post.createdAt)}</small></div>{(post.author===data.me||data.isAdmin)&&<button type="button" className="text-btn remove-btn" aria-label="Delete post" onClick={()=>remove('post',post.id,post.author)}><Trash2 size={16}/></button>}</header>
        <p className="board-text">{post.body}</p>
        {post.images.length>0&&<div className="board-photos" data-count={post.images.length}>{post.images.map(key=><button type="button" key={key} onClick={()=>setViewing(key)} aria-label="Open photo full size"><img src={boardImage(key)} loading="lazy" alt="Shared on the team board"/></button>)}</div>}
        <ReactionBar reactions={post.reactions} me={data.me} players={data.players} canReact={canTakePart} onReact={emoji=>react(post.id,emoji)}/>
        {(post.comments.length>0||canTakePart)&&<div className="board-comments">{post.comments.map(c=>{const commenter=author(c.author);return <div className="board-comment" key={c.id}><Avatar p={commenter}/><div className="board-comment-body">
          <div className="board-comment-head"><strong><PlayerLink id={c.author} players={data.players} fallback="Former player"/></strong><small>{postedAgo(c.createdAt)}</small>{(c.author===data.me||data.isAdmin)&&<button type="button" className="text-btn remove-btn" aria-label="Delete comment" onClick={()=>remove('comment',c.id,c.author)}><Trash2 size={14}/></button>}</div>
          <p className="board-text">{c.body}</p>
          {c.image&&<button type="button" className="board-comment-photo" onClick={()=>setViewing(c.image!)} aria-label="Open photo full size"><img src={boardImage(c.image)} loading="lazy" alt="Shared in a comment"/></button>}
          <ReactionBar reactions={c.reactions} me={data.me} players={data.players} canReact={canTakePart} onReact={emoji=>react(c.id,emoji)}/>
        </div></div>})}
          {canTakePart&&(post.comments.length<BOARD_LIMITS.comments?<BoardComposer comment onPost={(body,photos)=>act({action:'comment',postId:post.id,body,images:photos})}/>:<p className="help">This post has reached {BOARD_LIMITS.comments} comments.</p>)}</div>}
      </article>})}
      {next&&<button type="button" className="secondary-btn mx-auto flex" disabled={loadingMore} onClick={loadMore}>{loadingMore?'Loading…':'Load older posts'}</button>}</div>}
    <Dialog open={!!viewing} onOpenChange={v=>{if(!v)setViewing('')}}><DialogContent className="dialog-panel wide"><DialogHeader><DialogTitle>Photo</DialogTitle><DialogDescription>Shared on the {teamInfo[team].name} board.</DialogDescription></DialogHeader>{viewing&&<img className="board-full-photo" src={boardImage(viewing)} alt="Shared on the team board, full size"/>}</DialogContent></Dialog>
  </div>
}
function ReactionBar({reactions,me,players,canReact,onReact}:{reactions:BoardReactions;me:string|null;players:Player[];canReact:boolean;onReact:(emoji:BoardReaction)=>void}){
  const shown=BOARD_REACTIONS.filter(e=>canReact||reactions[e]?.length);
  if(!shown.length)return null;
  return <div className="reaction-bar">{shown.map(emoji=>{const who=reactions[emoji]??[],mine=!!me&&who.includes(me),names=who.map(id=>players.find(p=>p.id===id)?.name??'Former player').join(', ');
    return <button type="button" key={emoji} className="reaction" aria-pressed={mine} disabled={!canReact} title={names||undefined} aria-label={emoji+(who.length?' '+who.length+': '+names:'')} onClick={()=>onReact(emoji)}><span aria-hidden="true">{emoji}</span>{who.length>0&&<small>{who.length}</small>}</button>})}</div>
}
// Writes a post (up to four photos) or a comment (one photo). Photos are compressed on the device before upload.
function BoardComposer({comment=false,onPost}:{comment?:boolean;onPost:(body:string,photos:File[])=>Promise<boolean>}){
  const max=comment?BOARD_LIMITS.commentImages:BOARD_LIMITS.postImages,limit=comment?BOARD_LIMITS.comment:BOARD_LIMITS.post;
  const [body,setBody]=useState(''),[previews,setPreviews]=useState<Preview[]>([]),[busy,setBusy]=useState(false);
  const live=useRef(previews);useEffect(()=>{live.current=previews});
  useEffect(()=>()=>{for(const p of live.current)URL.revokeObjectURL(p.url)},[]);
  async function addPhotos(files:File[]){const room=max-previews.length;if(files.length>room)toast.error(comment?'A comment can hold one photo.':`A post can hold up to ${max} photos.`);
    setBusy(true);try{const added:Preview[]=[];for(const file of files.slice(0,room)){const small=await compressPhoto(file);added.push({file:small,url:URL.createObjectURL(small)})}setPreviews(current=>[...current,...added])}catch(e){toast.error((e as Error).message)}finally{setBusy(false)}}
  function dropPhoto(index:number){URL.revokeObjectURL(previews[index].url);setPreviews(previews.filter((_,i)=>i!==index))}
  async function submit(){setBusy(true);if(await onPost(body,previews.map(p=>p.file))){for(const p of previews)URL.revokeObjectURL(p.url);setPreviews([]);setBody('')}setBusy(false)}
  return <form className={comment?'board-composer is-comment':'panel board-composer'} onSubmit={e=>{e.preventDefault();void submit()}}>
    <textarea aria-label={comment?'Write a comment':'Write a post for your team'} value={body} maxLength={limit} rows={comment?1:3} placeholder={comment?'Write a comment…':'Share something with your team…'} onChange={e=>setBody(e.target.value)}/>
    {previews.length>0&&<div className="board-previews">{previews.map((p,i)=><span className="board-preview" key={p.url}><img src={p.url} alt={'Photo '+(i+1)+' to upload'}/><button type="button" aria-label={'Remove photo '+(i+1)} onClick={()=>dropPhoto(i)}><X size={14}/></button></span>)}</div>}
    <div className="board-composer-actions"><label className={'text-btn cursor-pointer'+(previews.length>=max||busy?' is-disabled':'')}><ImagePlus size={16}/>{comment?'Add photo':'Add photos'}<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" multiple={!comment} disabled={previews.length>=max||busy} onChange={e=>{const files=Array.from(e.target.files??[]);e.target.value='';if(files.length)void addPhotos(files)}}/></label>
      <button className="primary-btn" disabled={busy||!body.trim()}>{busy?'Sending…':comment?'Comment':'Post'}<Send/></button></div>
  </form>
}
// Formation builder: a team's saved line-ups of up to ten players on a vertical pitch. Its players and admins edit
// them and the last save wins. Changes stay on this device until Save.
type FormationDraft={name:string;slots:FormationSlot[]};
const draftOf=({name,slots}:Formation):FormationDraft=>({name,slots});
const sameDraft=(a:FormationDraft,b:FormationDraft)=>JSON.stringify(a)===JSON.stringify(b);
async function formationRequest(body:Record<string,unknown>){const r=await fetch('/api/formation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json() as {id?:string;error?:string};if(!r.ok)throw new Error(j.error||'The formation could not be saved. Please try again.');return j}
function TeamFormation({data,team,confirm}:{data:PublicClub;team:Team;confirm:Confirm}){
  const teamInfo=useContext(TeamsCtx),markUnsaved=useContext(UnsavedCtx),info=teamInfo[team];
  const [formations,setFormations]=useState<Formation[]|null>(null),[failed,setFailed]=useState(''),[selectedId,setSelectedId]=useState(''),[draft,setDraft]=useState<FormationDraft|null>(null);
  const [picked,setPicked]=useState(''),[dragging,setDragging]=useState(''),[naming,setNaming]=useState<'new'|'rename'|null>(null),[nameValue,setNameValue]=useState(''),[guest,setGuest]=useState(''),[busy,setBusy]=useState(false);
  const pitch=useRef<HTMLDivElement>(null),field=useRef<HTMLDivElement>(null);
  const saved=formations?.find(f=>f.id===selectedId),dirty=!!saved&&!!draft&&!sameDraft(draft,draftOf(saved));
  const squad=data.players.filter(p=>p.team===team&&p.active!==false),selected=draft?.slots.find(s=>s.id===picked);
  // While there are unsaved changes, leaving within the app asks first and closing the tab asks through the browser.
  useEffect(()=>{markUnsaved(dirty);if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',warn);return ()=>{window.removeEventListener('beforeunload',warn);markUnsaved(false)}},[dirty,markUnsaved]);
  async function fetchFormations(){const r=await fetch('/api/formation?team='+team,{cache:'no-store'});const j=await r.json() as {formations?:Formation[];error?:string};if(!r.ok||!j.formations)throw new Error(j.error||'The formations could not load.');return j.formations}
  // Shows the saved formations, opening `select` if it is still there, else the newest. Any unsaved changes are dropped.
  function show(list:Formation[],select:string){const chosen=list.find(f=>f.id===select)??list[0];setFormations(list);setSelectedId(chosen?.id??'');setDraft(chosen?draftOf(chosen):null);setPicked('');setFailed('')}
  const load=(select:string)=>fetchFormations().then(list=>show(list,select));
  const firstLoad=()=>fetchFormations().then(list=>show(list,''),(e:Error)=>setFailed(e.message));
  useEffect(()=>{void firstLoad()},[]); // eslint-disable-line react-hooks/exhaustive-deps -- the team page remounts for each team
  const player=(s:FormationSlot)=>s.playerId&&!s.former?data.players.find(p=>p.id===s.playerId):undefined;
  const nameOf=(s:FormationSlot)=>s.label??player(s)?.name??'Former player';
  const setSlots=(change:(slots:FormationSlot[])=>FormationSlot[])=>setDraft(d=>d&&{...d,slots:change(d.slots)});
  const move=(id:string,to:{x:number;y:number})=>setSlots(slots=>slots.map(s=>s.id===id?{...s,...to}:s));
  const add=(who:{playerId:string}|{label:string})=>setSlots(slots=>addSlot(slots,who,crypto.randomUUID()));
  // Switching to another formation drops unsaved changes, so it asks first.
  function leaveDraft(then:()=>void){if(dirty)confirm({title:'Leave without saving?',description:'Your changes to '+draft?.name+' have not been saved and will be lost.',action:then});else then()}
  function choose(id:string){leaveDraft(()=>{const f=formations?.find(x=>x.id===id);if(f){setSelectedId(f.id);setDraft(draftOf(f));setPicked('')}})}
  async function act(run:()=>Promise<void>){setBusy(true);try{await run()}catch(e){toast.error((e as Error).message)}finally{setBusy(false)}}
  const save=()=>act(async()=>{if(!saved||!draft)return;await formationRequest({action:'save',id:saved.id,name:draft.name,slots:draft.slots.map(({id,playerId,label,x,y})=>({id,playerId,label,x,y}))});toast.success('Formation saved.');await load(saved.id)});
  function submitName(){const name=nameValue.trim();if(!name)return;if(naming==='rename'){setDraft(d=>d&&{...d,name});setNaming(null);return}
    void act(async()=>{const {id}=await formationRequest({action:'create',team,name});setNaming(null);toast.success('Formation created.');await load(id??'')})}
  function remove(){if(saved)confirm({title:'Delete '+saved.name+'?',description:'It is removed for the whole team. This cannot be undone.',action:()=>void act(async()=>{await formationRequest({action:'delete',id:saved.id});toast.success('Formation deleted.');await load('')})})}
  // Shares the PNG where the device can, otherwise downloads it.
  const shareImage=()=>act(async()=>{if(!draft||!pitch.current)return;
    const blob=await formationImage(pitch.current,info.name,draft.name,draft.slots.map(s=>{const name=nameOf(s),photo=player(s)?.photo;return {name,initials:initials(name),photo:photo?'/api/photo?key='+encodeURIComponent(photo):null,x:s.x,y:s.y}}));
    const file=new File([blob],shareFileName(team,draft.name),{type:'image/png'});
    if(navigator.canShare?.({files:[file]}))try{await navigator.share({files:[file],title:draft.name});return}catch(e){if((e as Error).name==='AbortError')return}
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=file.name;link.click();URL.revokeObjectURL(url)});
  if(!formations)return failed?<div className="banner error" role="alert"><span>{failed}</span><button type="button" className="secondary-btn" onClick={()=>void firstLoad()}>Retry</button></div>
    :<div className="banner" role="status"><span className="flex gap-2 items-center"><Loader2 className="animate-spin" size={16}/>Loading formations…</span></div>;
  const full=formations.length>=FORMATION_LIMITS.formations,room=!!draft&&canAdd(draft.slots);
  return <div className="formation">
    <div className="formation-toolbar">
      {formations.length>0&&<Picker label="Formation" className="formation-picker" value={selectedId} onChange={choose} options={formations.map(f=>({value:f.id,label:f.name}))}/>}
      <button type="button" className="secondary-btn" disabled={busy||full} title={full?`A team can keep up to ${FORMATION_LIMITS.formations} formations.`:undefined} onClick={()=>leaveDraft(()=>{setNameValue('');setNaming('new')})}><Plus/>New</button>
      {draft&&<><button type="button" className="secondary-btn" disabled={busy} onClick={()=>{setNameValue(draft.name);setNaming('rename')}}><Pencil/>Rename</button><button type="button" className="secondary-btn remove-btn" disabled={busy} onClick={remove}><Trash2/>Delete</button></>}
    </div>
    {!draft?<div className="panel"><NoData title="No formations yet">Start one with New, then add up to {FORMATION_LIMITS.slots} players and drag them into place.</NoData></div>
    :<div className="formation-layout">
      <div className="formation-pitch" ref={pitch} style={teamVars(info)}><PitchLines/>
        <div className="formation-field" ref={field}>{draft.slots.map(s=>{const name=nameOf(s),p=player(s);return <button type="button" key={s.id} className="formation-marker" aria-pressed={picked===s.id} aria-label={name} aria-describedby="formation-help" data-former={s.former||undefined} data-dragging={dragging===s.id||undefined} style={{left:s.x*100+'%',top:s.y*100+'%'}}
          onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);setDragging(s.id);setPicked(s.id)}}
          onPointerMove={e=>{if(dragging===s.id&&field.current)move(s.id,pointerSpot(e.clientX,e.clientY,field.current.getBoundingClientRect()))}}
          onPointerUp={()=>setDragging('')} onPointerCancel={()=>setDragging('')} onFocus={()=>setPicked(s.id)}
          onKeyDown={e=>{const to=nudge(s,e.key);if(to){e.preventDefault();move(s.id,to)}}}>
          {p?<Avatar p={p}/>:<span className="avatar">{initials(name)}</span>}<span className="formation-name">{name}</span></button>})}</div>
      </div>
      <div className="formation-side">
        <p className="help" id="formation-help">Drag players into place, or select one and move it with the arrow keys.</p>
        {selected&&<div className="formation-selected"><span>Selected: <strong>{nameOf(selected)}</strong></span><button type="button" className="secondary-btn remove-btn" onClick={()=>{setSlots(slots=>removeSlot(slots,selected.id));setPicked('')}}><UserMinus/>Remove</button></div>}
        <section className="panel formation-add"><div className="panel-head"><h2>Add a player</h2><span className="help">{draft.slots.length} of {FORMATION_LIMITS.slots}</span></div>
          <div className="field">From the squad<Picker label="Choose a squad player" disabled={!room||!unplaced(squad,draft.slots).length} value="" onChange={id=>add({playerId:id})} options={unplaced(squad,draft.slots).map(p=>({value:p.id,label:p.name}))}/></div>
          <form className="formation-guest" onSubmit={e=>{e.preventDefault();add({label:guest});setGuest('')}}><label className="field">Or a placeholder name<input value={guest} maxLength={FORMATION_LIMITS.label} disabled={!room} placeholder="Guest striker" onChange={e=>setGuest(e.target.value)}/></label><button className="secondary-btn" disabled={!room||!guest.trim()}><Plus/>Add</button></form>
          {!room&&<p className="help">The pitch is full. Remove a player to add another.</p>}
        </section>
        <div className="formation-actions"><button type="button" className="primary-btn" disabled={busy||!dirty} onClick={()=>void save()}><Save/>{busy?'Working…':'Save'}</button>{dirty&&<span className="formation-unsaved" role="status">Unsaved changes</span>}<button type="button" className="secondary-btn" disabled={busy} onClick={()=>void shareImage()}><Share2/>Share image</button></div>
        {saved&&<p className="help">Last saved by <PlayerLink id={saved.updatedBy} players={data.players} fallback="a former player"/> {postedAgo(saved.updatedAt)}.</p>}
      </div>
    </div>}
    <Dialog open={!!naming} onOpenChange={v=>{if(!v&&!busy)setNaming(null)}}><DialogContent className="dialog-panel"><DialogHeader><DialogTitle>{naming==='new'?'New formation':'Rename formation'}</DialogTitle><DialogDescription>{naming==='new'?'Name it so your team recognises it, like Sunday 3-2-1.':'The new name is kept when you save.'}</DialogDescription></DialogHeader>
      <form className="form-stack" onSubmit={e=>{e.preventDefault();submitName()}}><label className="field">Name<input value={nameValue} maxLength={FORMATION_LIMITS.name} required onChange={e=>setNameValue(e.target.value)}/></label><button className="primary-btn" disabled={busy||!nameValue.trim()}>{naming==='new'?'Create':'Rename'}</button></form></DialogContent></Dialog>
  </div>
}
const PITCH_BOX=`${-PITCH.margin} ${-PITCH.margin} ${PITCH.width+2*PITCH.margin} ${PITCH.length+2*PITCH.margin}`;
function PitchLines(){return <svg className="formation-lines" viewBox={PITCH_BOX} aria-hidden="true">
  {PITCH_MARKINGS.rects.map(([x,y,width,height])=><rect key={`${x},${y}`} x={x} y={y} width={width} height={height}/>)}
  {PITCH_MARKINGS.lines.map(([x1,y1,x2,y2])=><line key={`${x1},${y1}`} x1={x1} y1={y1} x2={x2} y2={y2}/>)}
  {PITCH_MARKINGS.circles.map(([cx,cy,r])=><circle key={`${cx},${cy}`} cx={cx} cy={cy} r={r}/>)}
  {PITCH_MARKINGS.spots.map(([cx,cy])=><circle key={`${cx},${cy}`} className="spot" cx={cx} cy={cy} r={0.5}/>)}</svg>}
