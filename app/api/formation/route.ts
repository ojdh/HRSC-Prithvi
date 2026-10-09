import { getUser } from '../../auth';
import { FORMATION_LIMITS } from '@/lib/formation';
import { ClubError, check, db } from '@/lib/server-club';
import { readJson } from '@/lib/server-forms';
import { boardViewer } from '@/lib/server-board';
import { findFormation, formationName, formationSlots, listFormations, openFormations } from '@/lib/server-formations';
export const dynamic = 'force-dynamic';

// Ten slots with their ids, names and positions fit well inside this.
const MAX_REQUEST_BYTES = 8_000;

export async function GET(req: Request) {
  try {
    const viewer = await boardViewer(await getUser());
    const team = openFormations(viewer, new URL(req.url).searchParams.get('team'));
    return Response.json({ formations: await listFormations(viewer.club, team) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) { return failure(e); }
}

// Every action is a JSON body with an `action` field: create, save (replaces the whole formation) or delete.
export async function POST(req: Request) {
  try {
    check(req.headers.get('origin') === new URL(req.url).origin, 'This request must come from the club website.', 403);
    const viewer = await boardViewer(await getUser());
    const me = viewer.me;
    check(me, 'Connect your player profile before editing formations.', 403);
    const body = await readJson(req, MAX_REQUEST_BYTES, 'This formation is too large to save.');
    if (body.action === 'create') {
      const team = openFormations(viewer, body.team);
      const name = formationName(body.name), slots = formationSlots(body.slots ?? [], viewer.club, team);
      const id = crypto.randomUUID();
      // The count is checked in the insert itself, so two creates at once cannot pass the limit.
      const created = await db().prepare('INSERT INTO formations(id,team,name,slots,updated_by,updated_at) SELECT ?1,?2,?3,?4,?5,?6 WHERE (SELECT COUNT(*) FROM formations WHERE team=?2)<?7')
        .bind(id, team, name, JSON.stringify(slots), me.id, Date.now(), FORMATION_LIMITS.formations).run();
      check(created.meta.changes === 1, `A team can keep up to ${FORMATION_LIMITS.formations} formations. Delete one first.`);
      return Response.json({ ok: true, id });
    }
    if (body.action === 'save') {
      const stored = await findFormation(body.id);
      openFormations(viewer, stored.team);
      const name = formationName(body.name), slots = formationSlots(body.slots, viewer.club, stored.team, stored.playerIds);
      const saved = await db().prepare('UPDATE formations SET name=?,slots=?,updated_by=?,updated_at=? WHERE id=?').bind(name, JSON.stringify(slots), me.id, Date.now(), stored.id).run();
      check(saved.meta.changes === 1, 'This formation was deleted. Refresh to see the latest.', 404);
      return Response.json({ ok: true });
    }
    if (body.action === 'delete') {
      const stored = await findFormation(body.id);
      openFormations(viewer, stored.team);
      await db().prepare('DELETE FROM formations WHERE id=?').bind(stored.id).run();
      return Response.json({ ok: true });
    }
    throw new ClubError('Unknown formation action.');
  } catch (e) { return failure(e); }
}

// Messages never include formation names or placeholder names.
function failure(e: unknown) {
  if (e instanceof ClubError) return Response.json({ error: e.message }, { status: e.status });
  console.error('Formation request failed', e instanceof Error ? e.name : 'unknown');
  return Response.json({ error: 'The formation could not be saved. Please try again.' }, { status: 503 });
}
