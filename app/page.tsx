import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import HomePage from './home-page';
export const metadata:Metadata={title:'Prithvi FC',description:'The home of Prithvi FC. Explore the Winter league, teams, player profiles and match days.'};
export default async function Home({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const params=await searchParams;
  if(['view','day','invite','invite_error'].some(key=>params?.[key])){
    const query=new URLSearchParams();
    for(const [key,value] of Object.entries(params))if(typeof value==='string')query.set(key,value);
    redirect('/winterleague?'+query);
  }
  return <HomePage/>;
}
