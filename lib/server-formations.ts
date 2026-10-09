import { FORMATION_LIMITS, roundFraction, validLabel, type Formation, type FormationSlot, type PitchPoint } from './formation';
import type { Club, Team } from './club';
import { check, db } from './server-club';
import { openTeamSpace, type BoardViewer } from './server-board';

type FormationRow = { id: string; name: string; slots: string; updated_by: string; updated_at: number };

// Formations: the team's own players and every admin read and edit them, and the last save wins.
export function openFormations(viewer: BoardViewer, team: unknown): Team {
  return openTeamSpace(viewer, team, true, 'Team not found.', 'These formations belong to another team.');
}

// Newest first. A squad slot whose player has left the team or been archived is kept as stored and marked former.
// Slots saved before movement arrows read as having none.
export async function listFormations(club: Club, team: Team): Promise<Formation[]> {
  const rows = await db().prepare('SELECT id,name,slots,updated_by,updated_at FROM formations WHERE team=? ORDER BY updated_at DESC,id DESC').bind(team).all<FormationRow>();
  const squad = activeSquad(club, team);
  return rows.results.map(row => ({
    id: row.id, name: row.name, updatedBy: row.updated_by, updatedAt: row.updated_at,
    slots: (JSON.parse(row.slots) as FormationSlot[]).map(stored => {
      const slot = { ...stored, attack: stored.attack ?? null, defend: stored.defend ?? null };
      return slot.playerId && !squad.has(slot.playerId) ? { ...slot, former: true } : slot;
    }),
  }));
}

export async function findFormation(id: unknown) {
  const row = typeof id === 'string' ? await db().prepare('SELECT id,team,slots FROM formations WHERE id=?').bind(id).first<{ id: string; team: Team; slots: string }>() : null;
  check(row, 'This formation was deleted. Refresh to see the latest.', 404);
  return { id: row.id, team: row.team, playerIds: (JSON.parse(row.slots) as FormationSlot[]).flatMap(s => s.playerId ? [s.playerId] : []) };
}

export function formationName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  check(name.length >= 1 && name.length <= FORMATION_LIMITS.name, `Name the formation in 1 to ${FORMATION_LIMITS.name} characters.`);
  return name;
}

// Checks every slot and rebuilds it from its known fields, with positions and arrowheads rounded to 3 decimals. kept holds the
// players already in the stored formation: one who has since left the team stays until someone removes them.
export function formationSlots(value: unknown, club: Club, team: Team, kept: string[] = []): FormationSlot[] {
  check(Array.isArray(value), 'The formation could not be read. Refresh and try again.');
  check(value.length <= FORMATION_LIMITS.slots, `A formation holds up to ${FORMATION_LIMITS.slots} players.`);
  const squad = activeSquad(club, team), slotIds = new Set<string>(), placed = new Set<string>();
  return value.map((raw: unknown) => {
    check(raw && typeof raw === 'object', 'The formation could not be read. Refresh and try again.');
    const { id, playerId, label, x, y, attack, defend } = raw as Record<string, unknown>;
    check(typeof id === 'string' && /^[\w-]{1,40}$/.test(id) && !slotIds.has(id), 'The formation could not be read. Refresh and try again.');
    check(onPitch(x) && onPitch(y), 'Keep every player on the pitch.');
    slotIds.add(id);
    const position = { x: roundFraction(x), y: roundFraction(y), attack: arrowhead(attack), defend: arrowhead(defend) };
    if (playerId !== null && playerId !== undefined) {
      check(label === null || label === undefined, 'Each spot is a squad player or a placeholder name, not both.');
      check(typeof playerId === 'string' && (squad.has(playerId) || kept.includes(playerId)), 'Choose players from this team’s squad.');
      check(!placed.has(playerId), 'A player can only be on the pitch once.');
      placed.add(playerId);
      return { id, playerId, label: null, ...position };
    }
    const name = typeof label === 'string' ? label.trim() : '';
    check(validLabel(name), `Give each placeholder a name of 1 to ${FORMATION_LIMITS.label} characters.`);
    return { id, playerId: null, label: name, ...position };
  });
}

// A run's arrowhead is optional; when given it is a point on the pitch.
function arrowhead(value: unknown): PitchPoint | null {
  if (value === null || value === undefined) return null;
  const { x, y } = (typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  check(onPitch(x) && onPitch(y), 'Keep every arrow on the pitch.');
  return { x: roundFraction(x), y: roundFraction(y) };
}

function onPitch(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function activeSquad(club: Club, team: Team) {
  return new Set(club.players.filter(p => p.team === team && p.active !== false).map(p => p.id));
}
