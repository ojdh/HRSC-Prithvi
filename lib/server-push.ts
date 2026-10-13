import { env } from 'cloudflare:workers';
import { ADMIN_CHAT, type ChatRoom, type Club } from './club';
import { routeSearch } from './routes';
import { db } from './server-club';
import { isPushEndpoint, isPushKeys, sendPush, type PushTarget, type VapidKeys } from './web-push';

// A notification is useless after a day, so push services may drop it then.
const PUSH_TTL_SECONDS = 86_400;

// Both keys must be set; without them notifications fail closed and chat carries on.
export function vapidKeys(): VapidKeys | null {
  const publicKey = env.VAPID_PUBLIC_KEY, privateKey = env.VAPID_PRIVATE_KEY;
  return publicKey && privateKey ? { publicKey, privateKey } : null;
}

export function readSubscription(value: unknown): PushTarget | null {
  const subscription = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (!subscription || typeof subscription !== 'object' || !isPushEndpoint(subscription.endpoint) || !isPushKeys(subscription.keys?.p256dh, subscription.keys?.auth)) return null;
  return { endpoint: subscription.endpoint, p256dh: subscription.keys!.p256dh as string, auth: subscription.keys!.auth as string };
}

// Tells everyone else in a chat that it woke up: a team's active players, or for the admin chat the owner and active
// admins. The text names only the chat, never the sender or the message, because it shows on a lock screen.
// It runs after the reply, so failures are logged rather than raised; endpoints are never logged, since anyone
// holding one can push to that device.
export async function notifyChat(club: Club, room: ChatRoom, author: string) {
  try {
    const keys = vapidKeys();
    if (!keys) { console.warn('Chat notification skipped: VAPID keys are not set'); return; }
    const recipients = club.players.filter(p => p.active !== false && p.id !== author
      && (room === ADMIN_CHAT ? p.userId === club.adminId || club.admins.includes(p.id) : p.team === room)).map(p => p.id);
    if (!recipients.length) return;
    const { results } = await db().prepare(`SELECT player,endpoint,p256dh,auth FROM push_subscriptions WHERE player IN (${recipients.map(() => '?').join(',')})`)
      .bind(...recipients).all<PushTarget & { player: string }>();
    const message = room === ADMIN_CHAT
      ? { title: 'HRSC–Prithvi', body: 'New message in Admin chat', tag: 'chat-' + room, url: '/winterleague' + routeSearch({ view: 'profile', tab: 'admin' }) }
      : { title: 'HRSC–Prithvi', body: `New message in ${club.teams[room].name} chat`, tag: 'chat-' + room, url: '/winterleague' + routeSearch({ view: 'teams', team: room, tab: 'chat' }) };
    const statuses = await Promise.all(results.map(target => sendPush(target, message, keys, PUSH_TTL_SECONDS).catch((error: unknown) => {
      console.error('Push request failed', error instanceof Error ? error.name : 'unknown');
      return 0;
    })));
    // 404 and 410 mean the browser dropped the subscription. The endpoint is matched too, so a device turned on meanwhile stays.
    const gone = results.filter((_, i) => statuses[i] === 404 || statuses[i] === 410);
    if (gone.length) await db().batch(gone.map(target => db().prepare('DELETE FROM push_subscriptions WHERE player=? AND endpoint=?').bind(target.player, target.endpoint)));
    const failed = statuses.filter(status => status !== 404 && status !== 410 && (status < 200 || status >= 300));
    console.log('Chat notifications sent', { room, devices: results.length, gone: gone.length, failed: failed.length });
  } catch (error) {
    console.error('Chat notifications failed', error instanceof Error ? error.message : 'unknown');
  }
}
