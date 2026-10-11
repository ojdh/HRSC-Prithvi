import { getUser } from '../../auth';
import { check, ClubError, db } from '@/lib/server-club';
import { readJson } from '@/lib/server-forms';
import { boardViewer } from '@/lib/server-board';
import { readSubscription, vapidKeys } from '@/lib/server-push';
export const dynamic = 'force-dynamic';

// A push subscription's endpoint and keys fit well inside this.
const MAX_REQUEST_BYTES = 4_000;

// Whether this player has notifications on, and whether on the device asking (identified by its endpoint).
// publicKey is what the browser needs to subscribe; it is null until notifications are set up.
export async function GET(req: Request) {
  try {
    const me = (await boardViewer(await getUser())).me;
    check(me, 'Connect your player profile before turning on notifications.', 403);
    const row = await db().prepare('SELECT endpoint FROM push_subscriptions WHERE player=?').bind(me.id).first<{ endpoint: string }>();
    const endpoint = new URL(req.url).searchParams.get('endpoint');
    return Response.json({ enabled: !!row, thisDevice: !!row && row.endpoint === endpoint, publicKey: vapidKeys()?.publicKey ?? null }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) { return failure(e); }
}

// subscribe stores this device for the player, replacing any other device; unsubscribe removes it.
export async function POST(req: Request) {
  try {
    check(req.headers.get('origin') === new URL(req.url).origin, 'This request must come from the club website.', 403);
    const me = (await boardViewer(await getUser())).me;
    check(me, 'Connect your player profile before turning on notifications.', 403);
    const body = await readJson(req, MAX_REQUEST_BYTES, 'This subscription is too large.');
    if (body.action === 'subscribe') {
      check(vapidKeys(), "Notifications aren't set up yet.", 503);
      const subscription = readSubscription(body.subscription);
      check(subscription, "This browser's notification subscription isn't supported.");
      await db().prepare('INSERT INTO push_subscriptions(player,endpoint,p256dh,auth,created_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(player) DO UPDATE SET endpoint=?2,p256dh=?3,auth=?4,created_at=?5')
        .bind(me.id, subscription.endpoint, subscription.p256dh, subscription.auth, Date.now()).run();
      return Response.json({ ok: true });
    }
    if (body.action === 'unsubscribe') {
      await db().prepare('DELETE FROM push_subscriptions WHERE player=?').bind(me.id).run();
      return Response.json({ ok: true });
    }
    throw new ClubError('Unknown notification action.');
  } catch (e) { return failure(e); }
}

// Messages never include subscription endpoints.
function failure(e: unknown) {
  if (e instanceof ClubError) return Response.json({ error: e.message }, { status: e.status });
  console.error('Notification request failed', e instanceof Error ? e.name : 'unknown');
  return Response.json({ error: 'Notifications could not be updated. Please try again.' }, { status: 503 });
}
