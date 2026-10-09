import {TEAMS,type Team} from './club';
// The app's address: which page is open, and the day, section, team and player card shown on it.
export const VIEWS=['overview','matchdays','gameday','standings','players','board','vote','profile','guide','admin'] as const;
export type View=typeof VIEWS[number];
export type Route={view:View;day?:string;tab?:string;team?:Team;player?:string};
// The sections a page can open on; the first is its default.
export const TABS:Partial<Record<View,readonly string[]>>={admin:['roster','results','log']};
const DAY_VIEWS:readonly View[]=['matchdays','gameday','vote','admin'],TEAM_VIEWS:readonly View[]=['players'];
// Reads an address, including links shared before the current layout: a team on its own opens that squad.
export function parseRoute(search:string):Route{
  const q=new URLSearchParams(search),view=q.get('view');
  return normalizeRoute({view:(VIEWS as readonly string[]).includes(view??'')?view as View:q.get('team')&&!view?'players':'overview',day:q.get('day')??undefined,tab:q.get('tab')??undefined,team:q.get('team') as Team??undefined,player:q.get('player')??undefined});
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
