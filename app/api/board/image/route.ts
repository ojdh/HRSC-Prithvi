import { getUser } from '../../../auth';
import { ClubError, check, db } from '@/lib/server-club';
import { getObject } from '@/lib/r2-budget';
import { boardViewer, openTeam } from '@/lib/server-board';
export const dynamic = 'force-dynamic';

// A board photo is shown only to people who can open its team's board. Each view is one Class B operation.
export async function GET(req: Request) {
  try {
    const viewer = await boardViewer(await getUser());
    const key = new URL(req.url).searchParams.get('key');
    check(key && /^board\/[a-f0-9-]{36}$/.test(key), 'Photo not found.', 404);
    const image = await db().prepare('SELECT team FROM board_images WHERE key=?').bind(key).first<{ team: string }>();
    check(image, 'Photo not found.', 404);
    openTeam(viewer, image.team);
    const object = await getObject(key);
    check(object, 'Photo not found.', 404);
    return new Response(object.body, { headers: { 'Content-Type': object.httpMetadata?.contentType || 'image/jpeg', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
  } catch (e) {
    return new Response('Photo unavailable', { status: e instanceof ClubError ? e.status : 503 });
  }
}
