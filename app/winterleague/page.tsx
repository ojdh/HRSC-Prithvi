import type { Metadata } from 'next';
export const metadata:Metadata={title:'HRSC–Prithvi | Winter league'};
import ClubApp from '../club-app';
import {cookies} from 'next/headers';
import {INVITE_COOKIE} from '@/lib/server-invitations';
import { getUser, signInPath } from '../auth';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const user = await getUser();
  return <ClubApp identity={user ? {name:user.displayName} : null} signInUrl={signInPath((await cookies()).has(INVITE_COOKIE)?'/winterleague?view=profile':'/winterleague')} />;
}
