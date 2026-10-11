import handler from 'vinext/server/fetch-handler';
import { cleanupStorage } from '../lib/r2-budget';
import { deleteOldMessages } from '../lib/server-chat';

// Worker entry: vinext serves every request, and the daily Cron Trigger in
// wrangler.jsonc removes R2 objects the club no longer references and chat
// messages past their 90 days.
export default {
  fetch: handler.fetch,
  scheduled(_controller: ScheduledController, _env: Cloudflare.Env, ctx: ExecutionContext) {
    ctx.waitUntil(cleanupStorage());
    ctx.waitUntil(deleteOldMessages());
  },
} satisfies ExportedHandler<Cloudflare.Env>;
