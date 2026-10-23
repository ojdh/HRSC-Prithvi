import { ADMIN_CHAT, CHAT_LIMITS, type ChatPage, type ChatRoom } from './club';
import { openTeamSpace, type BoardViewer } from './server-board';
import { check, db } from './server-club';
import { deleteObject, putObject } from './r2-budget';
import type { UploadedImage } from './server-images';

const MINUTE = 60_000;
export const CHAT_RETENTION_MS = 90 * 24 * 60 * MINUTE;
// A message after this long without one wakes the chat up, which is when its members get a notification.
const WAKE_AFTER_MS = 5 * MINUTE;
type MessageRow = { id: string; author: string; body: string; image: string | null; created_at: number };

// A team chat opens like the team's board; the admin chat opens to the owner and active admins from every team.
export function openChat(viewer: BoardViewer, room: unknown): ChatRoom {
  if (room !== ADMIN_CHAT) return openTeamSpace(viewer, room, 'Team chat not found.', 'This chat belongs to another team.');
  check(viewer.admin, 'Only admins can open the admin chat.', 403);
  return ADMIN_CHAT;
}

// Seconds until the client's next poll: quick while a conversation is going, slower as the chat goes quiet.
export function refreshIn(lastMessageAt: number | null) {
  const quiet = lastMessageAt === null ? Infinity : Date.now() - lastMessageAt;
  return quiet < 2 * MINUTE ? 3 : quiet < 10 * MINUTE ? 10 : 30;
}

// Newest first. A poll that sends the version it already has gets only the version and pace back,
// so an idle chat costs one row read. Cursors are a message's created_at and id, as on the board:
// `before` pages to older messages; `since` is the oldest message a client has loaded, and a changed chat
// then returns every message from the newest down to it (up to CHAT_LIMITS.window), so messages deleted
// or expired anywhere in what the client shows drop out.
export async function chatPage(team: ChatRoom, known: string | null, before: string | null, since: string | null): Promise<ChatPage> {
  check(known === null || /^\d{1,15}$/.test(known), 'Refresh the chat to catch up.');
  const older = readCursor(before), from = readCursor(since);
  check(!(older && from), 'Refresh the chat to load older messages.');
  const state = await db().prepare('SELECT version,last_message_at FROM chat_state WHERE team=?').bind(team).first<{ version: number; last_message_at: number | null }>();
  const version = state?.version ?? 0, pace = refreshIn(state?.last_message_at ?? null);
  if (!older && known !== null && Number(known) === version) return { version, refreshIn: pace, unchanged: true };
  const size = from ? CHAT_LIMITS.window : CHAT_LIMITS.page;
  const page = db().prepare('SELECT id,author,body,image,created_at FROM chat_messages WHERE team=?1 AND (?2 IS NULL OR created_at<?2 OR (created_at=?2 AND id<?3)) AND (?4 IS NULL OR created_at>?4 OR (created_at=?4 AND id>=?5)) ORDER BY created_at DESC,id DESC LIMIT ?6')
    .bind(team, older?.createdAt ?? null, older?.id ?? null, from?.createdAt ?? null, from?.id ?? null, size + 1);
  // A window also asks whether anything is older than it, which costs at most one more row.
  const beneath = from && db().prepare('SELECT 1 FROM chat_messages WHERE team=?1 AND (created_at<?2 OR (created_at=?2 AND id<?3)) LIMIT 1').bind(team, from.createdAt, from.id);
  const [{ results }, probe] = await db().batch(beneath ? [page, beneath] : [page]);
  const rows = results as MessageRow[], shown = rows.slice(0, size), last = shown.at(-1);
  const more = rows.length > size || !!probe?.results.length;
  return {
    version, refreshIn: pace,
    messages: shown.map(m => ({ id: m.id, author: m.author, body: m.body, image: m.image, createdAt: m.created_at })),
    next: !more ? null : last ? `${last.created_at}:${last.id}` : since,
  };
}

function readCursor(cursor: string | null) {
  if (cursor === null) return null;
  const parts = /^(\d{1,15}):([a-f0-9-]{36})$/.exec(cursor);
  check(parts, 'Refresh the chat to load older messages.');
  return { createdAt: Number(parts[1]), id: parts[2] };
}

// Stores the message, and its photo under chat/<message id>, and says whether it woke the chat up: no message
// before it for WAKE_AFTER_MS. The previous message time is read in the same transaction as the update.
// Callers validate the photo first. If saving the message fails, the photo is left for the daily storage
// clean-up rather than deleted here: a failure reported after the save committed would otherwise leave
// the message pointing at a deleted photo.
export async function sendMessage(team: ChatRoom, author: string, body: string, photo?: UploadedImage) {
  const id = crypto.randomUUID(), now = Date.now(), image = photo ? 'chat/' + id : null;
  if (photo && image) await putObject(image, photo.bytes, photo.type);
  const [before] = await db().batch([
    db().prepare('SELECT last_message_at FROM chat_state WHERE team=?').bind(team),
    db().prepare('INSERT INTO chat_messages(id,team,author,body,image,created_at) VALUES(?,?,?,?,?,?)').bind(id, team, author, body, image, now),
    db().prepare('INSERT INTO chat_state(team,version,last_message_at) VALUES(?1,1,?2) ON CONFLICT(team) DO UPDATE SET version=version+1,last_message_at=?2').bind(team, now),
  ]);
  const previous = (before.results as { last_message_at: number | null }[])[0]?.last_message_at ?? null;
  return { id, wokeUp: previous === null || now - previous >= WAKE_AFTER_MS };
}

export async function findMessage(id: unknown) {
  const message = typeof id === 'string' ? await db().prepare('SELECT id,team,author,image FROM chat_messages WHERE id=?').bind(id).first<{ id: string; team: ChatRoom; author: string; image: string | null }>() : null;
  check(message, 'This message was removed. Refresh the chat.', 404);
  return message;
}

// Deletes the message, then its photo. A failed photo delete is left to the daily storage clean-up.
export async function deleteMessage(message: { id: string; team: ChatRoom; image: string | null }) {
  const [removed] = await db().batch([
    db().prepare('DELETE FROM chat_messages WHERE id=?').bind(message.id),
    db().prepare('UPDATE chat_state SET version=version+1 WHERE team=?').bind(message.team),
  ]);
  check(removed.meta.changes === 1, 'This message was removed. Refresh the chat.', 404);
  if (message.image) await deleteObject(message.image);
}

// The chat a photo belongs to, so it is shown only to people who can open that chat.
export async function photoRoom(key: string | null) {
  const id = key && /^chat\/([a-f0-9-]{36})$/.exec(key)?.[1];
  const message = id ? await db().prepare('SELECT team FROM chat_messages WHERE id=? AND image=?').bind(id, key).first<{ team: ChatRoom }>() : null;
  check(message, 'Photo not found.', 404);
  return message.team;
}

// Daily cron: deletes messages past the retention period, and their photos, and moves each affected chat's
// version, so open chats drop them on their next poll.
export async function deleteOldMessages() {
  const cutoff = Date.now() - CHAT_RETENTION_MS;
  const [photos, , removed] = await db().batch([
    db().prepare('SELECT image FROM chat_messages WHERE created_at<? AND image IS NOT NULL').bind(cutoff),
    db().prepare('UPDATE chat_state SET version=version+1 WHERE team IN (SELECT DISTINCT team FROM chat_messages WHERE created_at<?)').bind(cutoff),
    db().prepare('DELETE FROM chat_messages WHERE created_at<?').bind(cutoff),
  ]);
  for (const { image } of photos.results as { image: string }[]) await deleteObject(image);
  console.log('Chat clean-up finished', { removed: removed.meta.changes, photos: photos.results.length });
}
