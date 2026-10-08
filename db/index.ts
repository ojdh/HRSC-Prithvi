import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Check the `d1_databases` binding in wrangler.jsonc."
    );
  }

  return drizzle(env.DB, { schema });
}
