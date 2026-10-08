export const TEAMS = ['red','black','white'] as const;
export type Team = typeof TEAMS[number];
export type TeamInfo = {name:string; color:string; letter:string; motto:string; photo?:string|null};
export const DEFAULT_TEAMS: Record<Team,TeamInfo> = {
  red:{name:'Team Red',color:'#ff666b',letter:'R',motto:'Bring the fire.'},
  black:{name:'Team Black',color:'#171918',letter:'B',motto:'Own the moment.'},
  white:{name:'Team White',color:'#eceddf',letter:'W',motto:'Make your mark.'},
};
export type Highlight = {id:string;key:string;kind:'Goal'|'Assist'|'Save'|'Skill'|'Foul'|'Other';note:string};
export type Player = {id:string;name:string;team:Team;birthYear?:number|null;birthMonth?:number|null;height:number|null;position:string;number?:number|null;district?:string|null;active?:boolean;photo:string|null;highlights?:Highlight[];userId?:string;inviteHash?:string;legacyInviteHash?:string;inviteToken?:string;linked?:boolean};
export type Goal = {team:Team;scorer:string|null;assist:string|null;ownGoal:boolean};
export type Round = {id:string;a:Team;b:Team;scoreA:number;scoreB:number;goals:Goal[];lineup:string[];exit:Team;winner:Team|null;videoUrl?:string|null};
// A scheduled day has an empty roster and no opening teams until it is set up on the day. start/end are club-local HH:MM.
export type Day = {id:string;date:string;start:string;end:string;roster:{id:string;team:Team}[];opening:[Team,Team]|null;firstExit:Team|null;rounds:Round[];poll:'ready'|'open'|'closed';videoUrl?:string|null;videoKey?:string|null;deletion?:DayDeletion};
// A request to delete a played matchday. approvals holds player ids; the requester's counts as the first.
export type DayDeletion = {requestedBy:string;approvals:string[]};
export const DELETION_APPROVALS=3;
// A game as the edit log records it: the score and goals, without the lineup.
export type RoundSnapshot = Pick<Round,'a'|'b'|'scoreA'|'scoreB'|'winner'|'exit'|'goals'>;
export type LogAction = 'editRound'|'undoRound'|'requestDayDeletion'|'approveDayDeletion'|'cancelDayDeletion'|'deleteDay';
// Admin-only history of corrections and deletions, newest first. by is a player id; date keeps an entry readable once its day is gone.
export type LogEntry = {id:string;at:string;by:string;action:LogAction;dayId:string;date:string;roundId?:string;before?:RoundSnapshot;after?:RoundSnapshot};
export const LOG_LIMIT=500;
// adminId is the owner's account: the only person who can grant or remove admin rights. admins holds player ids.
export type Club = {adminId:string;admins:string[];teams:Record<Team,TeamInfo>;players:Player[];days:Day[];log?:LogEntry[]};
export type PublicClub = {invitation?:{name:string;team:Team};players:Player[];days:Day[];revision:number;initialized:boolean;isAdmin:boolean;isOwner:boolean;owner:string|null;admins:string[];teams:Record<Team,TeamInfo>;me:string|null;log?:LogEntry[];polls:Record<string,{count:number;voted:boolean;tally:{candidate:string;votes:number}[]}>};
export const emptyClub:PublicClub={players:[],days:[],revision:0,initialized:false,isAdmin:false,isOwner:false,owner:null,admins:[],teams:DEFAULT_TEAMS,me:null,polls:{}};
// Teams with no attending player among `ids`: a matchday needs all three teams present.
export function teamsWithout(ids:string[],players:{id:string;team:Team}[]){return TEAMS.filter(t=>!players.some(p=>p.team===t&&ids.includes(p.id)));}
export type ReadyDay = Day&{opening:[Team,Team];firstExit:Team};
export const isReady=(day:Day):day is ReadyDay=>!!day.opening&&!!day.firstExit;
export function nextMatch(day:ReadyDay):{a:Team;b:Team;waiting:Team;incumbent:Team} {
  const last=day.rounds.at(-1);
  if(!last){const [a,b]=day.opening;return {a,b,waiting:TEAMS.find(t=>t!==a&&t!==b)!,incumbent:day.firstExit};}
  const survivor=last.a===last.exit?last.b:last.a;
  const waiting=TEAMS.find(t=>t!==last.a&&t!==last.b)!;
  return {a:survivor,b:waiting,waiting:last.exit,incumbent:survivor};
}
// The team that had stayed on longer when round `index` was played: the first draw exit for the opening game,
// otherwise whichever of that round's teams also played the game before it. Stored teams never change, so this
// holds even after an earlier result is corrected.
export function incumbentAt(day:ReadyDay,index:number):Team {
  const round=day.rounds[index],previous=day.rounds[index-1];
  if(!previous)return day.firstExit;
  return round.a===previous.a||round.a===previous.b?round.a:round.b;
}
export const snapshot=({a,b,scoreA,scoreB,winner,exit,goals}:Round):RoundSnapshot=>({a,b,scoreA,scoreB,winner,exit,goals});
// A played matchday is deleted only through approvals; an unplayed one can simply be cancelled.
export const isPlayed=(day:Day)=>day.rounds.length>0||day.poll!=='ready';
export function result(a:Team,b:Team,scoreA:number,scoreB:number,incumbent:Team){
  const winner=scoreA===scoreB?null:scoreA>scoreB?a:b;
  return {winner,exit:winner?(winner===a?b:a):incumbent};
}
// League table: 3 points a win, 1 a draw; ranked by points, then goal difference, then goals scored.
export function teamStats(days:Day[]){
  const stats=TEAMS.map(team=>({team,played:0,points:0,wins:0,losses:0,draws:0,gf:0,ga:0,gd:0,form:[] as string[]}));
  for(const d of [...days].sort((a,b)=>a.date.localeCompare(b.date)))for(const r of d.rounds)for(const s of stats){
    if(r.a!==s.team&&r.b!==s.team)continue;
    const f=r.a===s.team?r.scoreA:r.scoreB, a=r.a===s.team?r.scoreB:r.scoreA;
    s.played++;s.gf+=f;s.ga+=a;s.gd=s.gf-s.ga;
    if(f>a)s.wins++;else if(f<a)s.losses++;else s.draws++;s.points=3*s.wins+s.draws;
    s.form.push(f>a?'W':f<a?'L':'D');
  }
  return stats.sort((a,b)=>b.points-a.points||b.gd-a.gd||b.gf-a.gf);
}
// attended counts played matchdays (at least one round) the player was marked attending; attendance is that share as a whole percent.
export function playerStats(players:Player[],days:Day[]){
  const playedDays=days.filter(d=>d.rounds.length);
  return players.map(p=>{
    let played=0,wins=0,goals=0,assists=0;const attended=playedDays.filter(d=>d.roster.some(x=>x.id===p.id)).length;
    for(const d of days){const team=d.roster.find(x=>x.id===p.id)?.team;
      for(const r of d.rounds){if(r.lineup.includes(p.id)){played++;if(r.winner===team)wins++;}
        for(const g of r.goals){if(!g.ownGoal&&g.scorer===p.id)goals++;if(!g.ownGoal&&g.assist===p.id)assists++;}}
    }
    return {...p,played,wins,goals,assists,attended,attendance:playedDays.length?Math.round(attended/playedDays.length*100):0};
  }).sort((a,b)=>b.goals-a.goals||b.assists-a.assists||b.wins-a.wins||a.name.localeCompare(b.name));
}
export function dateLabel(date:string,short=false){return new Intl.DateTimeFormat('en-CA',{month:short?'short':'long',day:'numeric',...(short?{}:{year:'numeric'}),timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));}
// A game being played pitch-side, kept on the organiser's device until it is saved as a round.
export type GameDraft = {lineup:string[];goals:Goal[];elapsed:number;startedAt:number|null};
export const GAME_MS=10*60*1000;
export const freshDraft=(lineup:string[]):GameDraft=>({lineup,goals:[],elapsed:0,startedAt:null});
export const draftKey=(dayId:string,game:number)=>`hrsc-game:${dayId}:${game}`;
export function gameClock(draft:GameDraft,now:number){return Math.max(0,GAME_MS-draft.elapsed-(draft.startedAt===null?0:now-draft.startedAt));}
export function roundPayload(draft:GameDraft,a:Team,b:Team){return {scoreA:draft.goals.filter(g=>g.team===a).length,scoreB:draft.goals.filter(g=>g.team===b).length,goals:draft.goals,lineup:draft.lineup};}
export const SEASON_START='2026-09-01';
export const MAX_SERIES_DAYS=52;
export function validDate(date:string){const d=new Date(date+'T12:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(date)&&!isNaN(d.valueOf())&&d.toISOString().slice(0,10)===date&&date>=SEASON_START;}
// Every date from `from` to `to` inclusive that falls on from's weekday.
export function weeklyDates(from:string,to:string){const dates:string[]=[];for(const d=new Date(from+'T12:00:00Z');d.toISOString().slice(0,10)<=to;d.setUTCDate(d.getUTCDate()+7))dates.push(d.toISOString().slice(0,10));return dates;}
// Whole years since a birth year and month (1-12) as of `today` (YYYY-MM-DD). Only the month is known, so the birthday counts as reached from the first of its month.
export function ageFrom(year:number|null|undefined,month:number|null|undefined,today:string){if(!year||!month)return null;const [y,m]=today.split('-').map(Number);return y-year-(m<month?1:0);}
export function isBirthMonth(p:Pick<Player,'birthMonth'>,today:string){return !!p.birthMonth&&Number(today.slice(5,7))===p.birthMonth;}
export function clubToday(){return new Date().toLocaleDateString('en-CA',{timeZone:'America/Edmonton'});}
// Today's match day, else the next upcoming one, else the most recent.
export function currentDay(days:Day[],today:string){const sorted=[...days].sort((a,b)=>a.date.localeCompare(b.date));return sorted.find(d=>d.date>=today)??sorted.at(-1);}
// Played matchdays (at least one round) before today, newest first.
export function pastMatchdays(days:Day[],today:string){return days.filter(d=>d.date<today&&d.rounds.length).sort((a,b)=>b.date.localeCompare(a.date));}
// Player of the day: everyone tied on the most votes. A closed poll's tally arrives sorted by votes, highest first.
export function awardWinners(tally:{candidate:string;votes:number}[]){const max=tally[0]?.votes||0;return tally.filter(x=>x.votes===max);}
export function timeLabel(day:Day){return clockLabel(day.start)+'–'+clockLabel(day.end);}
export const VIDEO_HOSTS=['youtube.com','www.youtube.com','youtu.be','vimeo.com','www.vimeo.com','drive.google.com'];
export function isVideoUrl(url:string){try{const u=new URL(url);return u.protocol==='https:'&&VIDEO_HOSTS.includes(u.hostname);}catch{return false;}}
export function embedVideo(url:string){try{const u=new URL(url);if(['youtube.com','www.youtube.com'].includes(u.hostname)){
  const id=u.searchParams.get('v')||u.pathname.match(/^\/shorts\/([\w-]+)/)?.[1];return id&&/^[\w-]{6,20}$/.test(id)?'https://www.youtube-nocookie.com/embed/'+id:null;}
  if(u.hostname==='youtu.be'&&/^[\w-]{6,20}$/.test(u.pathname.slice(1)))return 'https://www.youtube-nocookie.com/embed/'+u.pathname.slice(1);
  if(['vimeo.com','www.vimeo.com'].includes(u.hostname)&&/^\d+$/.test(u.pathname.slice(1)))return 'https://player.vimeo.com/video/'+u.pathname.slice(1);
  return null;}catch{return null;}}
function clockLabel(time:string){const [h,m]=time.split(':').map(Number);return (h%12||12)+':'+String(m).padStart(2,'0')+(h<12?' AM':' PM');}
const LIGHT_INK='#fffef9',DARK_INK='#173322',PAGE='#fffefa';
// Text drawn on a team-coloured fill: whichever of the club's light or dark ink reads better.
export function teamInk(color:string){return contrast(color,LIGHT_INK)>=contrast(color,DARK_INK)?LIGHT_INK:DARK_INK;}
// CSS variables for a team: its fill, legible ink on that fill, and a text colour legible on the page.
export function teamStyle(t:TeamInfo):Record<string,string>{return {'--team-color':t.color,'--team-ink':teamInk(t.color),'--team-text':contrast(t.color,PAGE)>=3?t.color:`color-mix(in srgb,${t.color} 45%,${DARK_INK})`};}
function luminance(hex:string){const [r,g,b]=[1,3,5].map(i=>{const c=parseInt(hex.slice(i,i+2),16)/255;return c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4;});return 0.2126*r+0.7152*g+0.0722*b;}
function contrast(a:string,b:string){const [hi,lo]=[luminance(a),luminance(b)].sort((x,y)=>y-x);return (hi+0.05)/(lo+0.05);}
