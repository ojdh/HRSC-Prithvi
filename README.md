# Prithvi FC · Club website & Winter league

A mobile-friendly club portal for Red, Black and White. Admins schedule matchdays as a weekly series (one weekday, start and end time, up to 52 weeks) or as one-off days at any date and time; the usual session is 7:00–8:30 AM. A scheduled day has no attendance until it is set up on the day with the attending players and opening teams, and it can be moved or cancelled until voting opens or a round is recorded. Each round can carry its own YouTube, Vimeo or Google Drive link alongside the full-match link. Voting and results entry are independent: open the vote immediately after the session and enter results later.

## Organiser onboarding

The first organiser signs in through Cloudflare Access and supplies the one-use `CLUB_SETUP_KEY` configured as a Worker secret. It is never stored in source or sent to the browser. Add the squads and send each player a personal invitation. The site is publicly reachable, while club records require sign-in and a claimed personal invitation. Sign-in identifies the player; server authorization protects organiser operations.

## Match days and stats

Confirm attendance and opening teams. Attendance and that day's team assignments become immutable when voting opens or the first result is entered. Results can be recorded while voting is open or closed. Each game lasts ten minutes and can end with any score; the winner stays. A drawn game sends off the team that has been on longest (the previous winner); for a draw in the first game, the exit chosen at setup leaves. Players who arrive after the first game can be added to the day's attendance until voting opens. Player stats count matchdays attended (played matchdays on which the player was marked attending) and attendance as a share of played matchdays; Standings shows a Most matchdays board.

Stats derive from stored results and selected round lineups, with historical team snapshots. Draws grant no wins. Own goals count for the team's score but not individual goals/assists. Unknown scorers can be recorded explicitly. Undo the latest round to correct a result, then re-enter it. An organiser can export the public stats and match history as JSON.

## Gameday

Admins run a session from Gameday (Live on phones). It opens on today's matchday, or the next one, and starts with Who's here? for attendance and the opening teams. The live board then shows the current game and who is waiting, with a 10-minute clock and a Goal button for each team. Each goal records a scorer, optional assist or own goal, and the score follows the goal list. End game saves the game, and the board moves to the next game using the winner-stays rule. The session panel lists the games played and handles late arrivals, Undo last game and opening the vote. A game in progress is kept in the organiser's browser storage until it is saved, so a reload pitch-side does not lose it; nothing reaches the server until End game.

## Voting

One irreversible vote per attending player; no own-team candidates. Personal invitations are random, single-use and tied to a preassigned roster record. Recopying an unclaimed invitation returns the same link. Tokens remain server-private; a protected cookie carries the invitation through sign-in. A D1 transactional batch enforces one receipt and one anonymous ballot, with revision checks protecting poll closure races. Participation and ballot choice are stored separately. Member-facing APIs never expose individual choices or identity keys. Aggregate results stay hidden until voting closes; tied leaders share the award. Small groups or infrastructure-level timing observations may still permit inference; this is not cryptographic anonymity.

## Storage

Cloudflare D1 stores the club document with optimistic concurrency and separate ballot/participation tables. R2 stores authenticated profile photos, admin-uploaded matchday clips, and admin-uploaded player highlights. Full match replays use a shareable YouTube, Vimeo, or Drive URL. Uploaded video clips are MP4 or WebM, capped at 20 MB each; member video playback supports byte ranges. JPG/PNG/WebP uploads are restricted to 2 MB and checked for image signatures; larger profile photos are scaled down and re-encoded as JPEG in the browser (`lib/photo-compression.ts`) before upload. All write permissions and vote restrictions are enforced server-side. Browser storage is not the data source.

## Validation

Run `pnpm build`, then `node tests/club-integration.mjs` for isolated Worker, D1, R2 and Access-token integration checks. The test creates no production records. Photo compression has unit checks: `node --test tests/photo-compression.mjs`. Typecheck with `node node_modules/typescript/bin/tsc --noEmit`.

## Sign-in

Cloudflare Access protects the member paths (`/winterleague`, `/join`, `/api/`) and forwards a signed JWT (`Cf-Access-Jwt-Assertion`) with every request to them. The homepage, static assets and the web app manifest stay public. `app/auth.ts` verifies its RS256 signature against the team's published keys and checks the issuer, audience and expiry; no other identity header is trusted. The player's identity is the token's `sub`, so a person must sign in with the same email each time. Missing `CF_ACCESS_TEAM_URL` or `CF_ACCESS_AUD` fails closed.

## Local development

```sh
pnpm install --frozen-lockfile
npx wrangler d1 migrations apply DB --local
echo 'CLUB_SETUP_KEY=local-setup-key' > .dev.vars
pnpm dev
```

`pnpm dev` serves http://localhost:5173 and `build/access-dev-plugin.ts` stands in for Access: it signs every local request in as `organiser@localhost.test` with a throwaway key, so the Worker runs the same verification as production.

## Deploying to Cloudflare

One-time setup, from a shell logged in with `npx wrangler login`:

1. `npx wrangler d1 create hrsc-prithvi` and copy the printed `database_id` into `wrangler.jsonc`.
2. `npx wrangler r2 bucket create hrsc-prithvi-media`.
3. `npx wrangler d1 migrations apply DB --remote --config wrangler.jsonc`.
4. `npx wrangler secret put CLUB_SETUP_KEY` (choose a long random value; share it only with the organiser).
5. With `prithvifc.ca` active as a zone in the same Cloudflare account, `pnpm build && npx wrangler deploy` creates the Worker and attaches it to the custom domain declared in `wrangler.jsonc` `routes`. The `workers.dev` URL is disabled.
6. In Cloudflare Zero Trust, create a self-hosted Access application for `prithvifc.ca` with the paths `winterleague`, `join` and `api`. Leave the rest of the site public. Turn on the One-time PIN login method, create an Access group of club members' emails, and add an Allow policy for that group. Do not use "Everyone": each person who signs in takes one of the Zero Trust Free plan's 50 seats, so strangers could fill them. When inviting a new player, add their email to the group. Free seats by removing departed users on the Users page.
7. Copy the application's Audience (AUD) tag and your team URL (`https://<team>.cloudflareaccess.com`) into `wrangler.jsonc` `vars`, then deploy again.

### Free-tier guardrails

R2 is the only service here that can bill past its free tier, so `lib/r2-budget.ts` charges every R2 call against limits in D1 before R2 is reached. The limits are `wrangler.jsonc` `vars`, set below R2's free tier:

| Var | Value | R2 free tier |
|---|---|---|
| `R2_STORAGE_QUOTA_BYTES` | 8 GB | 10 GB-month |
| `R2_CLASS_A_MONTHLY_LIMIT` (uploads) | 500,000 | 1M a month |
| `R2_CLASS_B_MONTHLY_LIMIT` (photo views, video chunks) | 5,000,000 | 10M a month |

At the storage limit, uploads are refused until a clip is removed. At a monthly limit, uploads or media views pause until the next UTC month. Missing limits make uploads and views fail closed. The ledger (`r2_usage`, `r2_objects`) starts empty with the database; if existing photos or videos are ever imported, add one `r2_objects` row per imported object. Keep the Workers account on the Free plan, which rejects requests past its daily limit instead of billing. Rules for changing this code are in `AGENTS.md`.

Afterwards, run the Deploy workflow in GitHub Actions (`.github/workflows/deploy.yml`). It needs the repository secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts, D1 and R2 edit) and `CLOUDFLARE_ACCOUNT_ID`. It refuses to deploy while any `REPLACE_WITH_` placeholder remains.

## Assets

Football photograph: Emilio Garcia, https://unsplash.com/photos/man-playing-soccer-game-on-field-AWdCgDDedH0 (Unsplash License). Nimbus fonts: URW base35; license notice in `public/fonts/LICENSE.txt`; upstream source https://github.com/ArtifexSoftware/urw-base35-fonts.

## Control room

The first organiser is the club owner. From Control room the owner can make any connected, active player an admin (up to 10) and remove that right again; only the owner can do this, and the owner cannot be demoted. Removing a player from the roster also removes their admin right, and restoring them does not bring it back. Admins have every other organiser power.

The club always has three team slots. Admins rename them and set each team's crest letter, colour and motto from the squad headers in Control room; text colour on and around the crest is chosen for contrast. Player assignments, rosters and results are unaffected by renaming. The public homepage keeps the default team names because anonymous visitors do not receive club data.

The organiser and admins manage roster details (including district), invitations, archival and restoration, matches, goals, assists, videos and voting from Control room. Archiving a player keeps their historical statistics and account mapping. The organiser can open a player profile through the Players screen and post short Goal, Assist, Save, Skill or Foul clips. Players edit their own name, age, height, district, position and portrait from My profile. They cannot change teams, match records, accounts, invitations or video clips. The server derives the editable player from the signed-in account.

## Editing the website

- Homepage text, sections and pictures: `app/home-page.tsx`.
- Homepage colours, typography and animations: `app/home.css`.
- League screens and labels: `app/club-app.tsx`.
- Colours, fonts, layout and motion: `app/globals.css`, `app/editorial.css`, `app/motion.css`.
- Images and bundled fonts: `public/`.
- League calculations and data types: `lib/club.ts`.
- Admin, invitation and voting backend: `app/api/club/route.ts`, `app/join/route.ts`, `lib/server-invitations.ts`.
- Database schema and migrations: `db/schema.ts`, `drizzle/`.

Use Control room on the hosted site for routine score and roster updates. Source code does not contain the live player database or uploaded media. Those remain in the hosted D1/R2 services. Do not put live database exports, invitation tokens or credentials in a public repository.

## Homepage and routes

The public club homepage is `/`. The existing member app is `/winterleague`. Older `/?view=...` links redirect while preserving parameters; legacy hash invitations and setup links are forwarded. Invitation cookies, accounts, APIs and storage remain unchanged. Teams link to filtered squads. Stock football images are editorial photographs, not pictures of club members; replace their source paths in `app/home-page.tsx` with your club photographs.

The future domain `prithvifc.ca` can use this same root and `/winterleague` structure once connected to hosting and DNS. It has not been registered or connected by this code change.

## Phone app

A Web App Manifest and home-screen icons support installation from compatible browsers. Open Winter league and choose the phone icon for installation guidance. iPhone/iPad use Safari → Share → Add to Home Screen. The app launches `/winterleague`; browser accounts and server data stay the same. Offline mode displays a reconnect screen. Personal information, invitations, votes and member media are never saved in a service-worker cache.
