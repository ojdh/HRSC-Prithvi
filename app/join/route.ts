import {readClub} from '@/lib/server-club';
import {findInvitation,inviteCookie} from '@/lib/server-invitations';
export const dynamic='force-dynamic';
export async function GET(req:Request){
  const url=new URL(req.url),token=url.searchParams.get('invite')||'';
  try{const stored=await readClub();const player=stored?await findInvitation(stored.club,token):undefined;
    const valid=player&&!player.userId;
    return new Response(null,{status:303,headers:{Location:'/winterleague?view=profile'+(valid?'':'&invite_error=unavailable'),'Set-Cookie':inviteCookie(valid?token:'',url.protocol==='https:'),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  }catch{return new Response('The invitation could not be checked. Please reopen your link in a moment.',{status:503,headers:{'Cache-Control':'no-store'}});}
}
