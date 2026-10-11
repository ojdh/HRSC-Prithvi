import { getUser } from '../../auth';
import { CHAT_LIMITS } from '@/lib/club';
import { ClubError, check } from '@/lib/server-club';
import { readJson, readText } from '@/lib/server-forms';
import { boardViewer, logRemoval } from '@/lib/server-board';
import { chatPage, deleteMessage, findMessage, openChat, sendMessage } from '@/lib/server-chat';
export const dynamic = 'force-dynamic';

// One message of the longest allowed length, escaped as JSON, fits well inside this.
const MAX_REQUEST_BYTES = 16_000;

export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const team = openChat(await boardViewer(await getUser()), params.get('team'));
    return Response.json(await chatPage(team, params.get('version'), params.get('before'), params.get('since')), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) { return failure(e); }
}

// Every action is a JSON body with an `action` field: send or delete. Chat is text only.
export async function POST(req: Request) {
  try {
    check(req.headers.get('origin') === new URL(req.url).origin, 'This request must come from the club website.', 403);
    check(req.headers.get('content-type')?.startsWith('application/json'), 'Team chat takes text messages only.', 415);
    const viewer = await boardViewer(await getUser());
    const me = viewer.me;
    check(me, 'Connect your player profile before using the team chat.', 403);
    const body = await readJson(req, MAX_REQUEST_BYTES, `Keep it to ${CHAT_LIMITS.message} characters or fewer.`);
    if (body.action === 'send') {
      const team = openChat(viewer, body.team);
      return Response.json({ ok: true, id: await sendMessage(team, me.id, readText(body.body, CHAT_LIMITS.message)) });
    }
    if (body.action === 'delete') {
      const message = await findMessage(body.messageId);
      openChat(viewer, message.team);
      check(message.author === me.id || viewer.admin, 'You can only delete your own messages.', 403);
      if (message.author !== me.id) await logRemoval(viewer, me.id, 'removeMessage', message.team, message.author);
      await deleteMessage(message);
      return Response.json({ ok: true });
    }
    throw new ClubError('Unknown chat action.');
  } catch (e) { return failure(e); }
}

// Messages never include chat text.
function failure(e: unknown) {
  if (e instanceof ClubError) return Response.json({ error: e.message }, { status: e.status });
  console.error('Chat request failed', e instanceof Error ? e.name : 'unknown');
  return Response.json({ error: 'The team chat could not be updated. Please try again.' }, { status: 503 });
}
