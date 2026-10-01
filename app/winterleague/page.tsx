import type { Metadata } from 'next';
export const metadata:Metadata={title:'HRSC–Prithvi | Winter league'};
import ClubApp from '../club-app';
import {cookies} from 'next/headers';
import {INVITE_COOKIE} from '@/lib/server-invitations';
import { getChatGPTUser, chatGPTSignInPath } from '../chatgpt-auth';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const user = await getChatGPTUser();
  return <ClubApp identity={user ? {name:user.displayName} : null} signInUrl={chatGPTSignInPath((await cookies()).has(INVITE_COOKIE)?'/winterleague?view=profile':'/winterleague')} />;
}
