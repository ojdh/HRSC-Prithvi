import { BOARD_LIMITS, LOG_LIMIT, TEAMS, type BoardLogAction, type BoardPage, type BoardReaction, type BoardReactions, type Team } from './club';
import { check, db, readClub, role, saveClub } from './server-club';

// Board access, checked first on every board request: signed in, an active club member,
// and on that team or an admin. Owners and admins can open every board to moderate it.
export type BoardViewer = Awaited<ReturnType<typeof boardViewer>>;
type PostRow = { id: string; team: Team; author: string; body: string; created_at: number };
type CommentRow = { id: string; post_id: string; author: string; body: string; created_at: number };

export async function boardViewer(user: { userId: string } | null) {
  check(user, 'Sign in first.', 401);
  const stored = await readClub();
  check(stored, 'Club not found.', 404);
  const { me, owner, admin } = role(stored.club, user.userId);
  check(owner || (me && me.active !== false), 'Only club members can open team boards.', 403);
  return { ...stored, me: me?.active !== false ? me : undefined, admin };
}

// A team's private spaces (its board, its formations) open to its own players and, where admins are let in, to admins.
export function openTeamSpace(viewer: BoardViewer, team: unknown, admins: boolean, missing: string, refused: string): Team {
  check(TEAMS.includes(team as Team), missing);
  check(viewer.me?.team === team || (viewer.admin && admins), refused, 403);
  return team as Team;
}

// Admins can read and moderate any board, but only a team's own players post, comment and react on it.
export function openTeam(viewer: BoardViewer, team: unknown, takePart = false): Team {
  return openTeamSpace(viewer, team, !takePart, 'Team board not found.', takePart && viewer.admin ? 'Only this team’s players can post on its board.' : 'This board belongs to another team.');
}

// Newest first. The cursor is the last post's created_at and id, so paging stays stable when posts are added or removed.
export async function boardPage(team: Team, before: string | null): Promise<BoardPage> {
  const cursor = before === null ? null : /^(\d{1,15}):([a-f0-9-]{36})$/.exec(before);
  check(before === null || cursor, 'Refresh the board to load more posts.');
  const after = cursor ? Number(cursor[1]) : null, afterId = cursor?.[2] ?? null, size = BOARD_LIMITS.page;
  const page = `WITH page AS (SELECT id FROM board_posts WHERE team=?1 AND (?2 IS NULL OR created_at<?2 OR (created_at=?2 AND id<?3)) ORDER BY created_at DESC,id DESC LIMIT ?4) `;
  const bind = (sql: string) => db().prepare(sql).bind(team, after, afterId, size);
  const [posts, comments, reactions, images] = await db().batch([
    db().prepare('SELECT id,team,author,body,created_at FROM board_posts WHERE team=?1 AND (?2 IS NULL OR created_at<?2 OR (created_at=?2 AND id<?3)) ORDER BY created_at DESC,id DESC LIMIT ?4').bind(team, after, afterId, size + 1),
    bind(page + 'SELECT id,post_id,author,body,created_at FROM board_comments WHERE post_id IN (SELECT id FROM page) ORDER BY created_at,id'),
    bind(page + 'SELECT target_id,player,emoji FROM board_reactions WHERE target_id IN (SELECT id FROM page) OR target_id IN (SELECT id FROM board_comments WHERE post_id IN (SELECT id FROM page)) ORDER BY rowid'),
    bind(page + 'SELECT key,post_id,comment_id FROM board_images WHERE post_id IN (SELECT id FROM page) ORDER BY rowid'),
  ]);
  const postRows = posts.results as PostRow[], reactionRows = reactions.results as { target_id: string; player: string; emoji: BoardReaction }[];
  const imageRows = images.results as { key: string; post_id: string; comment_id: string | null }[];
  const reactionsOf = (id: string) => {
    const chosen: BoardReactions = {};
    for (const r of reactionRows) if (r.target_id === id) (chosen[r.emoji] ??= []).push(r.player);
    return chosen;
  };
  const shown = postRows.slice(0, size), last = shown.at(-1);
  return {
    posts: shown.map(p => ({
      id: p.id, team: p.team, author: p.author, body: p.body, createdAt: p.created_at,
      images: imageRows.filter(i => i.post_id === p.id && !i.comment_id).map(i => i.key),
      reactions: reactionsOf(p.id),
      comments: (comments.results as CommentRow[]).filter(c => c.post_id === p.id).map(c => ({
        id: c.id, author: c.author, body: c.body, createdAt: c.created_at,
        image: imageRows.find(i => i.comment_id === c.id)?.key ?? null, reactions: reactionsOf(c.id),
      })),
    })),
    next: postRows.length > size && last ? `${last.created_at}:${last.id}` : null,
  };
}

export async function findPost(id: unknown) {
  const post = typeof id === 'string' ? await db().prepare('SELECT id,team,author FROM board_posts WHERE id=?').bind(id).first<Pick<PostRow, 'id' | 'team' | 'author'>>() : null;
  check(post, 'This post was removed. Refresh the board.', 404);
  return post;
}

export async function findComment(id: unknown) {
  const comment = typeof id === 'string' ? await db().prepare('SELECT c.id,c.post_id,c.author,p.team FROM board_comments c JOIN board_posts p ON p.id=c.post_id WHERE c.id=?').bind(id).first<{ id: string; post_id: string; author: string; team: Team }>() : null;
  check(comment, 'This comment was removed. Refresh the board.', 404);
  return comment;
}

// The board a reaction target (a post or a comment) belongs to.
export async function reactionTeam(targetId: unknown) {
  const row = typeof targetId === 'string' ? await db().prepare('SELECT team FROM board_posts WHERE id=?1 UNION ALL SELECT p.team FROM board_comments c JOIN board_posts p ON p.id=c.post_id WHERE c.id=?1').bind(targetId).first<{ team: Team }>() : null;
  check(row, 'This post was removed. Refresh the board.', 404);
  return row.team;
}

// Records an admin removing someone else's post or comment: who, which board, whose content and when, never the text.
export async function logRemoval(viewer: BoardViewer, by: string, action: BoardLogAction, team: Team, author: string) {
  const { club, revision } = viewer;
  club.log = [{ id: crypto.randomUUID(), at: new Date().toISOString(), by, action, team, author }, ...(club.log ?? [])].slice(0, LOG_LIMIT);
  await saveClub(club, revision);
}
