export const TEAMS = ['red','black','white'] as const;
export type Team = typeof TEAMS[number];
export const TEAM: Record<Team,{name:string; color:string; letter:string; motto:string}> = {
  red:{name:'Team Red',color:'#ff666b',letter:'R',motto:'Bring the fire.'},
  black:{name:'Team Black',color:'#171918',letter:'B',motto:'Own the moment.'},
  white:{name:'Team White',color:'#eceddf',letter:'W',motto:'Make your mark.'},
};
export type Highlight = {id:string;key:string;kind:'Goal'|'Assist'|'Save'|'Skill'|'Foul'|'Other';note:string};
export type Player = {id:string;name:string;team:Team;age:number|null;height:number|null;position:string;number?:number|null;district?:string|null;active?:boolean;photo:string|null;highlights?:Highlight[];userId?:string;inviteHash?:string;legacyInviteHash?:string;inviteToken?:string;linked?:boolean};
export type Goal = {team:Team;scorer:string|null;assist:string|null;ownGoal:boolean};
export type Round = {id:string;a:Team;b:Team;scoreA:number;scoreB:number;goals:Goal[];lineup:string[];exit:Team;winner:Team|null};
export type Day = {id:string;date:string;roster:{id:string;team:Team}[];opening:[Team,Team];firstExit:Team;rounds:Round[];poll:'ready'|'open'|'closed';videoUrl?:string|null;videoKey?:string|null};
export type Club = {adminId:string;players:Player[];days:Day[]};
export type PublicClub = {invitation?:{name:string;team:Team};players:Player[];days:Day[];revision:number;initialized:boolean;isAdmin:boolean;me:string|null;polls:Record<string,{count:number;voted:boolean;tally:{candidate:string;votes:number}[]}>};
export const emptyClub:PublicClub={players:[],days:[],revision:0,initialized:false,isAdmin:false,me:null,polls:{}};
export function nextMatch(day:Day):{a:Team;b:Team;waiting:Team;incumbent:Team} {
  const last=day.rounds.at(-1);
  if(!last){const [a,b]=day.opening;return {a,b,waiting:TEAMS.find(t=>t!==a&&t!==b)!,incumbent:day.firstExit};}
  const survivor=last.a===last.exit?last.b:last.a;
  const waiting=TEAMS.find(t=>t!==last.a&&t!==last.b)!;
  return {a:survivor,b:waiting,waiting:last.exit,incumbent:survivor};
}
export function result(a:Team,b:Team,scoreA:number,scoreB:number,incumbent:Team){
  const winner=scoreA===scoreB?null:scoreA>scoreB?a:b;
  return {winner,exit:winner?(winner===a?b:a):incumbent};
}
export function teamStats(days:Day[]){
  const stats=TEAMS.map(team=>({team,played:0,wins:0,losses:0,draws:0,gf:0,ga:0,gd:0,form:[] as string[]}));
  for(const d of [...days].sort((a,b)=>a.date.localeCompare(b.date)))for(const r of d.rounds)for(const s of stats){
    if(r.a!==s.team&&r.b!==s.team)continue;
    const f=r.a===s.team?r.scoreA:r.scoreB, a=r.a===s.team?r.scoreB:r.scoreA;
    s.played++;s.gf+=f;s.ga+=a;s.gd=s.gf-s.ga;
    if(f>a)s.wins++;else if(f<a)s.losses++;else s.draws++;
    s.form.push(f>a?'W':f<a?'L':'D');
  }
  return stats.sort((a,b)=>b.wins-a.wins||b.gd-a.gd||b.gf-a.gf);
}
export function playerStats(players:Player[],days:Day[]){
  return players.map(p=>{
    let played=0,wins=0,goals=0,assists=0;
    for(const d of days){const team=d.roster.find(x=>x.id===p.id)?.team;
      for(const r of d.rounds){if(r.lineup.includes(p.id)){played++;if(r.winner===team)wins++;}
        for(const g of r.goals){if(!g.ownGoal&&g.scorer===p.id)goals++;if(!g.ownGoal&&g.assist===p.id)assists++;}}
    }
    return {...p,played,wins,goals,assists};
  }).sort((a,b)=>b.goals-a.goals||b.assists-a.assists||b.wins-a.wins||a.name.localeCompare(b.name));
}
export function dateLabel(date:string,short=false){return new Intl.DateTimeFormat('en-CA',{month:short?'short':'long',day:'numeric',...(short?{}:{year:'numeric'}),timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));}
export function upcomingSunday(){const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Edmonton'});let d=new Date(today+'T12:00:00Z');if(today<'2026-09-01')return '2026-09-06';d.setUTCDate(d.getUTCDate()+(7-d.getUTCDay())%7);return d.toISOString().slice(0,10);}
