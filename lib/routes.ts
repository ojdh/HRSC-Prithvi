import {TEAMS,type Team} from './club';
// The app's address: which page is open, and the day, section, team and player card shown on it.
export const VIEWS=['overview','matchdays','standings','players','board','profile','guide','admin'] as const;
export type View=typeof VIEWS[number];
export type Route={view:View;day?:string;tab?:string;team?:Team;player?:string};
// The sections a page can open on; the first is its default.
export const TABS:Partial<Record<View,readonly string[]>>={matchdays:['results','live','vote'],admin:['roster','log']};
const DAY_VIEWS:readonly View[]=['matchdays'],TEAM_VIEWS:readonly View[]=['players'];
// Pages that became sections of another page, keyed by their old view and, for the Control room, its old tab.
const MOVED:Record<string,{view:View;tab?:string}>={vote:{view:'matchdays',tab:'vote'},gameday:{view:'matchdays',tab:'live'},'admin/results':{view:'matchdays'}};
// Reads an address, including links shared before the current layout: a team on its own opens that squad.
export function parseRoute(search:string):Route{
  const q=new URLSearchParams(search),view=q.get('view'),tab=q.get('tab')??undefined;
  const moved=MOVED[view+'/'+tab]??MOVED[view??''];
  const page=moved?moved.view:(VIEWS as readonly string[]).includes(view??'')?view as View:q.get('team')&&!view?'players':'overview';
  return normalizeRoute({view:page,day:q.get('day')??undefined,tab:moved?moved.tab:tab,team:q.get('team') as Team??undefined,player:q.get('player')??undefined});
}
// The query string for a route ('' for home), keeping only what its page uses.
export function routeSearch(route:Route):string{
  const r=normalizeRoute(route),q=new URLSearchParams();
  if(r.view!=='overview')q.set('view',r.view);
  for(const key of ['day','tab','team','player'] as const){const value=r[key];if(value)q.set(key,value);}
  return q.size?'?'+q:'';
}
export function normalizeRoute({view,day,tab,team,player}:Route):Route{
  return {view,
    ...(day&&DAY_VIEWS.includes(view)?{day}:{}),
    ...(tab&&TABS[view]?.includes(tab)?{tab}:{}),
    ...(team&&TEAM_VIEWS.includes(view)&&TEAMS.includes(team)?{team}:{}),
    ...(player?{player}:{})};
}
