import { waitUntil } from 'cloudflare:workers';
import { getUser } from '../../auth';
import { ADMIN_CHAT, CHAT_LIMITS } from '@/lib/club';
import { ClubError, check } from '@/lib/server-club';
import { readForm, readJson, readText } from '@/lib/server-forms';
import { readImage, type UploadedImage } from '@/lib/server-images';
import { PHOTO_LIMIT_BYTES } from '@/lib/photo-compression';
import { boardViewer, logRemoval } from '@/lib/server-board';
import { chatPage, deleteMessage, findMessage, openChat, sendMessage } from '@/lib/server-chat';
import { notifyChat } from '@/lib/server-push';
export const dynamic = 'force-dynamic';

// One message of the longest allowed length, escaped as JSON, fits well inside this.
const MAX_REQUEST_BYTES = 16_000;
// A photo message: the photo plus its text and form overhead.
const MAX_PHOTO_REQUEST_BYTES = PHOTO_LIMIT_BYTES + MAX_REQUEST_BYTES;

export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const team = openChat(await boardViewer(await getUser()), params.get('team'));
    return Response.json(await chatPage(team, params.get('version'), params.get('before'), params.get('since')), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) { return failure(e); }
}

// Every action is a JSON body with an `action` field: send or delete. A message with a photo is instead
// multipart form data with action `send`, team, body (optional) and one `image`, which is validated in full
// before R2 is reached.
export async function POST(req: Request) {
  try {
    check(req.headers.get('origin') === new URL(req.url).origin, 'This request must come from the club website.', 403);
    const type = req.headers.get('content-type') ?? '', withPhoto = type.startsWith('multipart/form-data');
    check(withPhoto || type.startsWith('application/json'), 'Chat takes text messages and photos only.', 415);
    const viewer = await boardViewer(await getUser());
    const me = viewer.me;
    check(me, 'Connect your player profile before using the team chat.', 403);
    const form = withPhoto ? await readForm(req, MAX_PHOTO_REQUEST_BYTES, 'Choose a photo of 2 MB or less.') : null;
    const body = form ? { action: form.get('action'), team: form.get('team'), body: form.get('body') } : await readJson(req, MAX_REQUEST_BYTES, `Keep it to ${CHAT_LIMITS.message} characters or fewer.`);
    if (body.action === 'send') {
      const team = openChat(viewer, body.team);
      let photo: UploadedImage | undefined, text: string;
      if (form) {
        check(form.get('image'), 'Write something or add a photo first.');
        photo = await readImage(form.get('image'));
        text = typeof body.body === 'string' && body.body.trim() ? readText(body.body, CHAT_LIMITS.message) : '';
      } else text = readText(body.body, CHAT_LIMITS.message);
      const { id, wokeUp } = await sendMessage(team, me.id, text, photo);
      // Notifications go out after the reply, so sending never waits on the push services.
      if (wokeUp) waitUntil(notifyChat(viewer.club, team, me.id));
      return Response.json({ ok: true, id });
    }
    check(!form, 'Only new messages can carry a photo.');
    if (body.action === 'delete') {
      const message = await findMessage(body.messageId);
      openChat(viewer, message.team);
      // Admins moderate team chats; in the admin chat everyone is an admin, so each deletes only their own.
      if (message.author !== me.id) {
        check(viewer.admin && message.team !== ADMIN_CHAT, 'You can only delete your own messages.', 403);
        await logRemoval(viewer, me.id, 'removeMessage', message.team, message.author);
      }
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
  return Response.json({ error: 'The chat could not be updated. Please try again.' }, { status: 503 });
}
