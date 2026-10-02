import { env } from 'cloudflare:workers';
import { ClubError, db } from './server-club';

// The only module that touches R2. Every call is charged against the free-tier
// budget in D1 before R2 is reached, so the club cannot be billed for storage
// or operations (see AGENTS.md). Limits are Worker vars; missing ones fail closed.

type BudgetVar = 'R2_STORAGE_QUOTA_BYTES' | 'R2_CLASS_A_MONTHLY_LIMIT' | 'R2_CLASS_B_MONTHLY_LIMIT';
type OperationClass = 'class_a' | 'class_b';

export class BudgetExceeded extends ClubError {
  constructor(message: string) { super(message, 503); }
}

export async function putObject(key: string, bytes: Uint8Array, contentType: string) {
  const storageQuota = limit('R2_STORAGE_QUOTA_BYTES'), classA = limit('R2_CLASS_A_MONTHLY_LIMIT'), bucket = r2();
  await chargeOperation('class_a', classA, "Uploads are paused until next month to keep the club on Cloudflare's free plan.");
  const reserved = await db().prepare('INSERT INTO r2_objects(key,bytes) SELECT ?1,?2 WHERE (SELECT coalesce(sum(bytes),0) FROM r2_objects)+?2<=?3').bind(key, bytes.byteLength, storageQuota).run();
  if (reserved.meta.changes !== 1) throw new BudgetExceeded('Club media storage is full. Remove an old clip before uploading another.');
  try {
    await bucket.put(key, bytes, { httpMetadata: { contentType } });
  } catch (error) {
    await db().prepare('DELETE FROM r2_objects WHERE key=?').bind(key).run();
    throw error;
  }
}

export async function getObject(key: string, options?: R2GetOptions) {
  const classB = limit('R2_CLASS_B_MONTHLY_LIMIT'), bucket = r2();
  await chargeOperation('class_b', classB, "Photos and videos are paused until next month to keep the club on Cloudflare's free plan.");
  return bucket.get(key, options);
}

// Deleting is free in R2. A failed delete keeps the object's ledger row, so its
// storage stays counted; the caller's action has already succeeded, so it is
// logged rather than raised.
export async function deleteObject(key: string) {
  try {
    await r2().delete(key);
    await db().prepare('DELETE FROM r2_objects WHERE key=?').bind(key).run();
  } catch (error) {
    console.error('R2 delete failed; its storage stays counted', { key, error: error instanceof Error ? error.message : 'unknown' });
  }
}

async function chargeOperation(column: OperationClass, monthlyLimit: number, message: string) {
  const month = new Date().toISOString().slice(0, 7);
  const charged = await db().prepare(`INSERT INTO r2_usage(month,${column}) VALUES(?1,1) ON CONFLICT(month) DO UPDATE SET ${column}=${column}+1 WHERE ${column}<?2`).bind(month, monthlyLimit).run();
  if (charged.meta.changes !== 1) throw new BudgetExceeded(message);
}

function limit(name: BudgetVar): number {
  const value = Number(env[name]);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`R2 budget is not configured: set ${name} to a positive integer for this Worker.`);
  }
  return value;
}

function r2() {
  if (!env.BUCKET) throw new ClubError('Photo and video storage is temporarily unavailable.', 503);
  return env.BUCKET;
}
