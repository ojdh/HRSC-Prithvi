import handler from 'vinext/server/fetch-handler';
import { cleanupStorage } from '../lib/r2-budget';

// Worker entry: vinext serves every request, and the daily Cron Trigger in
// wrangler.jsonc removes R2 objects the club no longer references.
export default {
  fetch: handler.fetch,
  scheduled(_controller: ScheduledController, _env: Cloudflare.Env, ctx: ExecutionContext) {
    ctx.waitUntil(cleanupStorage());
  },
} satisfies ExportedHandler<Cloudflare.Env>;
