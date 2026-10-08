import { getUser } from '../../auth';
import { BOARD_LIMITS, BOARD_REACTIONS, type BoardReaction } from '@/lib/club';
import { ClubError, check, db } from '@/lib/server-club';
import { deleteObject, putObject } from '@/lib/r2-budget';
import { readImage, type UploadedImage } from '@/lib/server-images';
import { readForm } from '@/lib/server-forms';
import { PHOTO_LIMIT_BYTES } from '@/lib/photo-compression';
import { boardPage, boardViewer, findComment, findPost, logRemoval, openTeam, reactionTeam } from '@/lib/server-board';
export const dynamic = 'force-dynamic';

// A post's photos plus its text and form overhead.
const MAX_REQUEST_BYTES = BOARD_LIMITS.postImages * PHOTO_LIMIT_BYTES + 300_000;

export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const team = openTeam(await boardViewer(await getUser()), params.get('team'));
    return Response.json(await boardPage(team, params.get('before')), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) { return failure(e); }
}

// Every action is multipart form data with an `action` field. Photos are validated in full
// before the first R2 call, and any already stored are deleted if a later step fails.
export async function POST(req: Request) {
  const stored: string[] = [];
  try {
    check(req.headers.get('origin') === new URL(req.url).origin, 'This request must come from the club website.', 403);
    const viewer = await boardViewer(await getUser());
    const me = viewer.me;
    check(me, 'Connect your player profile before using the team board.', 403);
    const form = await readForm(req, MAX_REQUEST_BYTES, 'Choose up to 4 photos of 2 MB or less.'), action = form.get('action');
    const store = async (images: UploadedImage[]) => {
      for (const image of images) {
        const key = 'board/' + crypto.randomUUID();
        await putObject(key, image.bytes, image.type);
        stored.push(key);
      }
      return [...stored];
    };
    if (action === 'createPost') {
      const team = openTeam(viewer, form.get('team'), true);
      const body = text(form.get('body'), BOARD_LIMITS.post), images = await photos(form, BOARD_LIMITS.postImages);
      const id = crypto.randomUUID(), now = Date.now(), keys = await store(images);
      await db().batch([
        db().prepare('INSERT INTO board_posts(id,team,author,body,created_at) VALUES(?,?,?,?,?)').bind(id, team, me.id, body, now),
        ...keys.map(key => db().prepare('INSERT INTO board_images(key,team,post_id,comment_id,created_at) VALUES(?,?,?,NULL,?)').bind(key, team, id, now)),
      ]);
      return Response.json({ ok: true, id });
    }
    if (action === 'comment') {
      const post = await findPost(form.get('postId'));
      openTeam(viewer, post.team, true);
      const body = text(form.get('body'), BOARD_LIMITS.comment), images = await photos(form, BOARD_LIMITS.commentImages);
      const full = await db().prepare('SELECT COUNT(*) AS n FROM board_comments WHERE post_id=?').bind(post.id).first<number>('n');
      check((full ?? 0) < BOARD_LIMITS.comments, `This post has reached ${BOARD_LIMITS.comments} comments.`);
      const id = crypto.randomUUID(), now = Date.now(), keys = await store(images);
      // The post may be deleted, or fill up, while the photo uploads.
      const [saved] = await db().batch([
        db().prepare('INSERT INTO board_comments(id,post_id,author,body,created_at) SELECT ?1,?2,?3,?4,?5 WHERE EXISTS(SELECT 1 FROM board_posts WHERE id=?2) AND (SELECT COUNT(*) FROM board_comments WHERE post_id=?2)<?6').bind(id, post.id, me.id, body, now, BOARD_LIMITS.comments),
        ...keys.map(key => db().prepare('INSERT INTO board_images(key,team,post_id,comment_id,created_at) SELECT ?1,?2,?3,?4,?5 WHERE EXISTS(SELECT 1 FROM board_comments WHERE id=?4)').bind(key, post.team, post.id, id, now)),
      ]);
      check(saved.meta.changes === 1, 'This post was removed or is full. Refresh the board.', 409);
      return Response.json({ ok: true, id });
    }
    if (action === 'react') {
      const targetId = form.get('targetId'), emoji = form.get('emoji');
      openTeam(viewer, await reactionTeam(targetId), true);
      check(BOARD_REACTIONS.includes(emoji as BoardReaction), 'Choose one of the board reactions.');
      const removed = await db().prepare('DELETE FROM board_reactions WHERE target_id=? AND player=? AND emoji=?').bind(targetId, me.id, emoji).run();
      if (!removed.meta.changes) await db().prepare('INSERT OR IGNORE INTO board_reactions(target_id,player,emoji) SELECT ?1,?2,?3 WHERE EXISTS(SELECT 1 FROM board_posts WHERE id=?1) OR EXISTS(SELECT 1 FROM board_comments WHERE id=?1)').bind(targetId, me.id, emoji).run();
      return Response.json({ ok: true, reacted: !removed.meta.changes });
    }
    if (action === 'deletePost') {
      const post = await findPost(form.get('postId'));
      openTeam(viewer, post.team);
      check(post.author === me.id || viewer.admin, 'You can only delete your own posts.', 403);
      if (post.author !== me.id) await logRemoval(viewer, me.id, 'removePost', post.team, post.author);
      const [images] = await db().batch([
        db().prepare('SELECT key FROM board_images WHERE post_id=?1').bind(post.id),
        db().prepare('DELETE FROM board_reactions WHERE target_id=?1 OR target_id IN (SELECT id FROM board_comments WHERE post_id=?1)').bind(post.id),
        db().prepare('DELETE FROM board_comments WHERE post_id=?1').bind(post.id),
        db().prepare('DELETE FROM board_images WHERE post_id=?1').bind(post.id),
        db().prepare('DELETE FROM board_posts WHERE id=?1').bind(post.id),
      ]);
      for (const { key } of images.results as { key: string }[]) await deleteObject(key);
      return Response.json({ ok: true });
    }
    if (action === 'deleteComment') {
      const comment = await findComment(form.get('commentId'));
      openTeam(viewer, comment.team);
      check(comment.author === me.id || viewer.admin, 'You can only delete your own comments.', 403);
      if (comment.author !== me.id) await logRemoval(viewer, me.id, 'removeComment', comment.team, comment.author);
      const [images] = await db().batch([
        db().prepare('SELECT key FROM board_images WHERE post_id=?2 AND comment_id=?1').bind(comment.id, comment.post_id),
        db().prepare('DELETE FROM board_reactions WHERE target_id=?1').bind(comment.id),
        db().prepare('DELETE FROM board_images WHERE post_id=?2 AND comment_id=?1').bind(comment.id, comment.post_id),
        db().prepare('DELETE FROM board_comments WHERE id=?1').bind(comment.id),
      ]);
      for (const { key } of images.results as { key: string }[]) await deleteObject(key);
      return Response.json({ ok: true });
    }
    throw new ClubError('Unknown board action.');
  } catch (e) {
    for (const key of stored) await deleteObject(key);
    return failure(e);
  }
}

// Multipart form encoding sends line breaks as CRLF; they are stored as LF.
function text(value: FormDataEntryValue | null, max: number) {
  const trimmed = typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
  check(trimmed, 'Write something first.');
  check(trimmed.length <= max, `Keep it to ${max} characters or fewer.`);
  return trimmed;
}

async function photos(form: FormData, max: number) {
  const files = form.getAll('images');
  check(files.length <= max, max === 1 ? 'A comment can hold one photo.' : `A post can hold up to ${max} photos.`);
  return Promise.all(files.map(readImage));
}

// Messages never include board text.
function failure(e: unknown) {
  if (e instanceof ClubError) return Response.json({ error: e.message }, { status: e.status });
  console.error('Board request failed', e instanceof Error ? e.message : 'unknown');
  return Response.json({ error: 'The team board could not be updated. Please try again.' }, { status: 503 });
}
