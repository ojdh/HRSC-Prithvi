import { env } from 'cloudflare:workers';
import type { Club } from './club';
import { db, saveClub, ClubError } from './server-club';
// The Zero Trust Free plan has 50 seats; each email in the club-members group can take one.
export const ACCESS_SEAT_LIMIT = 50;
// Each Cloudflare call is cut off after REQUEST_MS, so a change (at most four calls and a save) ends well inside its LOCK_MS lease.
const REQUEST_MS = 10_000, LOCK_MS = 60_000;
export type AccessChange = { add?: string | null; remove?: string | null };
export type AccessResult = { added: boolean; removed: boolean };
type Rule = Record<string, unknown> & { email?: { email?: string } };
// Fields of an Access group that PUT accepts; see https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/groups/methods/update/
type Group = { name: string; include?: Rule[]; exclude?: Rule[]; require?: Rule[]; is_default?: boolean };
type Envelope = { success?: boolean; result?: Group | null };

// Applies `change` to the Cloudflare side, then saves the club. A failed save puts the group back,
// so a stale revision cannot leave an email in Access that the club does not record. The group has no
// conditional update, so the whole read-write-save-rollback runs under a D1 lock: changes never interleave.
export async function saveClubWithAccess(club: Club, revision: number, change: AccessChange, apply: (r: AccessResult) => void) {
  const lock = await acquireLock();
  try {
    const synced = await syncAccessGroup(change);
    apply(synced);
    try { await saveClub(club, revision); } catch (e) {
      if (synced.added || synced.removed) {
        try { await syncAccessGroup({ add: synced.removed ? change.remove : null, remove: synced.added ? change.add : null }); }
        catch { console.error('Access group rollback failed after a failed club save'); }
      }
      throw e;
    }
  } finally { await releaseLock(lock); }
}

// Adds and/or removes one email in the club-members Access group, keeping every other rule.
async function syncAccessGroup(change: AccessChange): Promise<AccessResult> {
  const add = change.add?.toLowerCase() || null, remove = change.remove?.toLowerCase() || null;
  const { url, token } = config();
  const group = await request(url, token, 'GET');
  const include = group.include ?? [];
  const has = (email: string) => include.some(r => ruleEmail(r) === email);
  const added = !!add && !has(add), removed = !!remove && remove !== add && has(remove);
  if (!added && !removed) return { added, removed };
  const next = [...(removed ? include.filter(r => ruleEmail(r) !== remove) : include), ...(added ? [{ email: { email: add! } }] : [])];
  const emails = next.filter(r => ruleEmail(r)).length;
  if (added && emails > ACCESS_SEAT_LIMIT) throw new ClubError(`Cloudflare Access is limited to ${ACCESS_SEAT_LIMIT} member emails on the free plan. Remove a departed member from the Access group first.`, 409);
  const body: Group = { name: group.name, include: next };
  if (group.exclude) body.exclude = group.exclude;
  if (group.require) body.require = group.require;
  if (group.is_default !== undefined) body.is_default = group.is_default;
  await request(url, token, 'PUT', body);
  console.log('Access group updated', { emails, added, removed });
  return { added, removed };
}

async function acquireLock() {
  const token = crypto.randomUUID(), now = Date.now();
  const r = await db().prepare('INSERT INTO access_sync_lock (id,token,expires) VALUES (1,?1,?2) ON CONFLICT(id) DO UPDATE SET token=?1,expires=?2 WHERE access_sync_lock.expires<?3').bind(token, now + LOCK_MS, now).run();
  if (r.meta.changes !== 1) throw new ClubError('Another sign-in access change is in progress. Please try again in a moment.', 409);
  return token;
}
async function releaseLock(token: string) { await db().prepare('DELETE FROM access_sync_lock WHERE id=1 AND token=?').bind(token).run(); }
function ruleEmail(rule: Rule) { return typeof rule.email?.email === 'string' ? rule.email.email.toLowerCase() : null; }
function config() {
  const account = env.CF_ACCOUNT_ID, group = env.CF_ACCESS_GROUP_ID, token = env.CF_API_TOKEN;
  // CF_ACCESS_GROUP_ID ships as a wrangler.jsonc placeholder until the owner fills it in; that counts as not configured.
  if (!account || !group || !token || group.startsWith('REPLACE_WITH_'))
    throw new ClubError("Access sync isn't configured, so this player's email can't be given sign-in access. The site owner needs to set the CF_ACCOUNT_ID and CF_API_TOKEN secrets and the CF_ACCESS_GROUP_ID var (see docs/cloudflare.md).", 503);
  return { url: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/access/groups/${encodeURIComponent(group)}`, token };
}
async function request(url: string, token: string, method: 'GET' | 'PUT', body?: Group): Promise<Group> {
  let status = 0;
  try {
    const res = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(REQUEST_MS) });
    status = res.status;
    const json = await res.json().catch(() => null) as Envelope | null;
    if (res.ok && json?.success && json.result) return json.result;
  } catch { /* network failure or timeout: reported below with status 0 */ }
  console.error('Access group request failed', { method, status });
  throw new ClubError(`Cloudflare Access could not be updated (${method} returned ${status || 'no response'}). Nothing was saved; please try again.`, 502);
}
