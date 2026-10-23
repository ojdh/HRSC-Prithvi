import { getUser } from '../../../auth';
import { ClubError, check } from '@/lib/server-club';
import { getObject } from '@/lib/r2-budget';
import { boardViewer } from '@/lib/server-board';
import { openChat, photoRoom } from '@/lib/server-chat';
export const dynamic = 'force-dynamic';

// A chat photo is shown only to people who can open its chat. Each view is one Class B operation.
export async function GET(req: Request) {
  try {
    const viewer = await boardViewer(await getUser());
    const key = new URL(req.url).searchParams.get('key');
    openChat(viewer, await photoRoom(key));
    const object = await getObject(key!);
    check(object, 'Photo not found.', 404);
    return new Response(object.body, { headers: { 'Content-Type': object.httpMetadata?.contentType || 'image/jpeg', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
  } catch (e) {
    return new Response('Photo unavailable', { status: e instanceof ClubError ? e.status : 503 });
  }
}
