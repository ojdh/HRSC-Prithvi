import { ADMIN_CHAT, CHAT_LIMITS, type ChatPage, type ChatRoom } from './club';
import { openTeamSpace, type BoardViewer } from './server-board';
import { check, db } from './server-club';

const MINUTE = 60_000;
export const CHAT_RETENTION_MS = 90 * 24 * 60 * MINUTE;
type MessageRow = { id: string; author: string; body: string; created_at: number };

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
  const page = db().prepare('SELECT id,author,body,created_at FROM chat_messages WHERE team=?1 AND (?2 IS NULL OR created_at<?2 OR (created_at=?2 AND id<?3)) AND (?4 IS NULL OR created_at>?4 OR (created_at=?4 AND id>=?5)) ORDER BY created_at DESC,id DESC LIMIT ?6')
    .bind(team, older?.createdAt ?? null, older?.id ?? null, from?.createdAt ?? null, from?.id ?? null, size + 1);
  // A window also asks whether anything is older than it, which costs at most one more row.
  const beneath = from && db().prepare('SELECT 1 FROM chat_messages WHERE team=?1 AND (created_at<?2 OR (created_at=?2 AND id<?3)) LIMIT 1').bind(team, from.createdAt, from.id);
  const [{ results }, probe] = await db().batch(beneath ? [page, beneath] : [page]);
  const rows = results as MessageRow[], shown = rows.slice(0, size), last = shown.at(-1);
  const more = rows.length > size || !!probe?.results.length;
  return {
    version, refreshIn: pace,
    messages: shown.map(m => ({ id: m.id, author: m.author, body: m.body, createdAt: m.created_at })),
    next: !more ? null : last ? `${last.created_at}:${last.id}` : since,
  };
}

function readCursor(cursor: string | null) {
  if (cursor === null) return null;
  const parts = /^(\d{1,15}):([a-f0-9-]{36})$/.exec(cursor);
  check(parts, 'Refresh the chat to load older messages.');
  return { createdAt: Number(parts[1]), id: parts[2] };
}

export async function sendMessage(team: ChatRoom, author: string, body: string) {
  const id = crypto.randomUUID(), now = Date.now();
  await db().batch([
    db().prepare('INSERT INTO chat_messages(id,team,author,body,created_at) VALUES(?,?,?,?,?)').bind(id, team, author, body, now),
    db().prepare('INSERT INTO chat_state(team,version,last_message_at) VALUES(?1,1,?2) ON CONFLICT(team) DO UPDATE SET version=version+1,last_message_at=?2').bind(team, now),
  ]);
  return id;
}

export async function findMessage(id: unknown) {
  const message = typeof id === 'string' ? await db().prepare('SELECT id,team,author FROM chat_messages WHERE id=?').bind(id).first<{ id: string; team: ChatRoom; author: string }>() : null;
  check(message, 'This message was removed. Refresh the chat.', 404);
  return message;
}

export async function deleteMessage(message: { id: string; team: ChatRoom }) {
  const [removed] = await db().batch([
    db().prepare('DELETE FROM chat_messages WHERE id=?').bind(message.id),
    db().prepare('UPDATE chat_state SET version=version+1 WHERE team=?').bind(message.team),
  ]);
  check(removed.meta.changes === 1, 'This message was removed. Refresh the chat.', 404);
}

// Daily cron: deletes messages past the retention period and moves each affected chat's version,
// so open chats drop them on their next poll.
export async function deleteOldMessages() {
  const cutoff = Date.now() - CHAT_RETENTION_MS;
  const [, removed] = await db().batch([
    db().prepare('UPDATE chat_state SET version=version+1 WHERE team IN (SELECT DISTINCT team FROM chat_messages WHERE created_at<?)').bind(cutoff),
    db().prepare('DELETE FROM chat_messages WHERE created_at<?').bind(cutoff),
  ]);
  console.log('Chat clean-up finished', { removed: removed.meta.changes });
}
