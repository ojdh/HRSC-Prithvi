# AGENTS.md

Project rules for anyone (human or agent) changing this repo. The README covers setup and features.

## Stay inside Cloudflare's free tier

The site runs on a Cloudflare account that must never be billed. Workers Free and D1 Free stop at their limits; R2 does not, so R2 is guarded in code.

- **Every R2 call goes through `lib/r2-budget.ts`** (`putObject`, `getObject`, `deleteObject`). Never use `env.BUCKET` anywhere else. `tests/r2-boundary.mjs` fails CI if you do.
- **Charge before R2 is touched, and only after validation and permission checks.** A rejected or anonymous request must cost no R2 operation.
- **Limits live in `wrangler.jsonc` `vars` and stay below R2's free tier:** 10 GB-month storage, 1M Class A and 10M Class B operations a month. Do not raise a limit to or past those numbers, and do not remove the fail-closed check for missing limits.
- **Every upload path needs a per-file size cap** checked before the body is stored. Current caps: photos 2 MB, video clips 20 MB.
- **Prefer designs that read R2 less:** each photo view and each video chunk of up to 1 MB is one Class B operation.
- **Do not add a Cloudflare product or binding beyond Workers, D1, R2 and Access** without the club owner's explicit approval, and keep the Workers account on the Free plan.
- **Tests for new R2 behaviour** go in `tests/club-integration.mjs` with a tightly budgeted Miniflare instance, as the existing budget checks do.
