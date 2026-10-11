import { CHAT_LIMITS, type ChatPage, type Team } from './club';
import { openTeamSpace, type BoardViewer } from './server-board';
import { check, db } from './server-club';

const MINUTE = 60_000;
export const CHAT_RETENTION_MS = 90 * 24 * 60 * MINUTE;
type MessageRow = { id: string; author: string; body: string; created_at: number };

export function openChat(viewer: BoardViewer, team: unknown): Team {
  return openTeamSpace(viewer, team, 'Team chat not found.', 'This chat belongs to another team.');
}

// Seconds until the client's next poll: quick while a conversation is going, slower as the chat goes quiet.
export function refreshIn(lastMessageAt: number | null) {
  const quiet = lastMessageAt === null ? Infinity : Date.now() - lastMessageAt;
  return quiet < 2 * MINUTE ? 3 : quiet < 10 * MINUTE ? 10 : 30;
}

// Newest first. A poll that sends the version it already has gets only the version and pace back,
// so an idle chat costs one row read. The cursor is the last message's created_at and id, as on the board.
export async function chatPage(team: Team, known: string | null, before: string | null): Promise<ChatPage> {
  check(known === null || /^\d{1,15}$/.test(known), 'Refresh the chat to catch up.');
  const cursor = before === null ? null : /^(\d{1,15}):([a-f0-9-]{36})$/.exec(before);
  check(before === null || cursor, 'Refresh the chat to load older messages.');
  const state = await db().prepare('SELECT version,last_message_at FROM chat_state WHERE team=?').bind(team).first<{ version: number; last_message_at: number | null }>();
  const version = state?.version ?? 0, pace = refreshIn(state?.last_message_at ?? null);
  if (!cursor && known !== null && Number(known) === version) return { version, refreshIn: pace, unchanged: true };
  const size = CHAT_LIMITS.page;
  const { results } = await db().prepare('SELECT id,author,body,created_at FROM chat_messages WHERE team=?1 AND (?2 IS NULL OR created_at<?2 OR (created_at=?2 AND id<?3)) ORDER BY created_at DESC,id DESC LIMIT ?4')
    .bind(team, cursor ? Number(cursor[1]) : null, cursor?.[2] ?? null, size + 1).all<MessageRow>();
  const shown = results.slice(0, size), last = shown.at(-1);
  return {
    version, refreshIn: pace,
    messages: shown.map(m => ({ id: m.id, author: m.author, body: m.body, createdAt: m.created_at })),
    next: results.length > size && last ? `${last.created_at}:${last.id}` : null,
  };
}

export async function sendMessage(team: Team, author: string, body: string) {
  const id = crypto.randomUUID(), now = Date.now();
  await db().batch([
    db().prepare('INSERT INTO chat_messages(id,team,author,body,created_at) VALUES(?,?,?,?,?)').bind(id, team, author, body, now),
    db().prepare('INSERT INTO chat_state(team,version,last_message_at) VALUES(?1,1,?2) ON CONFLICT(team) DO UPDATE SET version=version+1,last_message_at=?2').bind(team, now),
  ]);
  return id;
}

export async function findMessage(id: unknown) {
  const message = typeof id === 'string' ? await db().prepare('SELECT id,team,author FROM chat_messages WHERE id=?').bind(id).first<{ id: string; team: Team; author: string }>() : null;
  check(message, 'This message was removed. Refresh the chat.', 404);
  return message;
}

export async function deleteMessage(message: { id: string; team: Team }) {
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
