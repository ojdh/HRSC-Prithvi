# Prithvi FC · Club website & Winter league

A mobile-friendly club portal for Red, Black and White. Admins schedule matchdays as a weekly series (one weekday, start and end time, up to 52 weeks) or as one-off days at any date and time; the usual session is 7:00–8:30 AM. A scheduled day has no attendance until it is set up on the day with the attending players and opening teams, and it can be moved or cancelled until voting opens or a round is recorded. After that, deleting it needs approval: the owner can delete a played matchday alone, otherwise it is deleted once three admins approve (the request counts as the first). Deleting removes its results, votes and uploaded clip. Each round can carry its own YouTube, Vimeo or Google Drive link alongside the full-match link. Voting and results entry are independent: open the vote immediately after the session and enter results later.

## Organiser onboarding

The first organiser signs in through Cloudflare Access and supplies the one-use `CLUB_SETUP_KEY` configured as a Worker secret. It is never stored in source or sent to the browser. Add the squads and send each player a personal invitation. The site is publicly reachable, while club records require sign-in and a claimed personal invitation. Sign-in identifies the player; server authorization protects organiser operations.

## Match days and stats

Confirm attendance and opening teams. Attendance and that day's team assignments become immutable when voting opens or the first result is entered. Results can be recorded while voting is open or closed. Each game lasts ten minutes and can end with any score; the winner stays. A drawn game sends off the team that has been on longest (the previous winner); for a draw in the first game, the exit chosen at setup leaves. Players who arrive after the first game can be added to the day's attendance until voting opens. Player stats count matchdays attended (played matchdays on which the player was marked attending) and attendance as a share of played matchdays; Standings shows a Most matchdays board.

## Teams and players

Teams opens on the three sides; each has its own page with a header (photo or crest, motto, table position, points and form) and Squad, Stats, Board and Formation sections. Board and Formation are shown only to that team's players and admins, and the API enforces the same rule. Admins manage a team from its page: edit the team, add players, and edit, invite, make or remove admins, remove and restore players. Every team name or crest in the app (table rows, team cards, round results, matchday summaries, the player card) opens the team page, and every player name (scorers, assists, the player of the day, vote tallies, board authors, leaderboards, squads) opens the player card.

Stats derive from stored results and selected round lineups, with historical team snapshots. Draws grant no wins. The league table awards 3 points for a win, 1 for a draw and 0 for a loss, and ranks teams by points, then goal difference, then goals scored; GF and GA are the sums of each team's scores over every game played, and GD is GF minus GA. Own goals count for the team's score but not individual goals/assists. Unknown scorers can be recorded explicitly. Admins can edit any recorded round to correct its score, scorers or lineup; its winner, and on a draw the team that rotates off, are recalculated, while later rounds stay as played. The latest round can also be undone. Every edit, undo and deletion step is kept in an edit log that only admins can see, under Manage on each matchday and under Me → Club admin for the whole club. An organiser can export the public stats and match history as JSON.

## Matchday page

Matchdays is one page per day. A strip of dates runs from past days through today (with a red dot while a session is live) to upcoming days; it opens on today's matchday, or the next one. Each day has three sections: Results (the player of the day, each team's day, the scorers, the film and every round), Live and Vote. Live is for admins, from the day itself on, so games can still be recorded after the session; on earlier days it is labelled Record games. The page opens on Live for admins during the session, on Vote while voting is open, and on Results otherwise. Admins also see a Manage strip for the day: set up or update attendance, edit the date and time, cancel an unplayed day, open, share or close voting, late arrivals, undo the latest round, that day's edit log and the deletion approvals. Admins schedule new matchdays and export stats from Me → Club admin.

Live starts with Who's here? for attendance and the opening teams. The live board then shows the current game and who is waiting, with a 10-minute clock and a Goal button for each team. Each goal records a scorer, optional assist or own goal, and the score follows the goal list. End game saves the game, and the board moves to the next game using the winner-stays rule. The session panel lists the games played. A game in progress is kept in the organiser's browser storage until it is saved, so a reload pitch-side does not lose it; nothing reaches the server until End game.

## Voting

One irreversible vote per attending player; no own-team candidates. Personal invitations are random, single-use and tied to a preassigned roster record. Recopying an unclaimed invitation returns the same link. Tokens remain server-private; a protected cookie carries the invitation through sign-in. A D1 transactional batch enforces one receipt and one anonymous ballot, with revision checks protecting poll closure races. Participation and ballot choice are stored separately. Member-facing APIs never expose individual choices or identity keys. Aggregate results stay hidden until voting closes; tied leaders share the award. Small groups or infrastructure-level timing observations may still permit inference; this is not cryptographic anonymity.

## Team boards

Each team has a private discussion board, the Board section of its team page. Any player on the team can post up to 2,000 characters with up to four photos, and teammates comment (up to 1,000 characters and one photo, 50 comments a post) and react with 👍 ❤️ 😂 🔥 ⚽ or 👏; a second tap removes a reaction. Only the team's own players can read the board, plus admins and the owner, who can open every team's Board to moderate but do not post on another team's board. A player who changes team keeps authorship of their old posts but stops seeing that board. Authors delete their own posts and comments, and admins delete anything; when an admin removes someone else's content, the Club admin edit log records who removed it, from which board, whose it was and when, never the text. Deleting a post removes its comments, reactions and photos.

Photos are compressed on the device, then stored in R2 under `board/` with the same 2 MB cap and signature check as profile photos; they are served only to people who can open that board and load lazily, since each view is one R2 read. Board text, comments, reactions and photo records live in their own D1 tables (`board_posts`, `board_comments`, `board_reactions`, `board_images`, migration `0010`), not in the club document. The feed loads 20 posts at a time and refreshes every 60 seconds while the tab is visible; there are no push updates.

## Team formations

The Formation section of a team page holds up to 10 named formations for that team. Each is a vertical pitch with up to 10 markers in the team's colour: a squad player (with their photo or initials) or a placeholder name of up to 30 characters. Markers are dragged with a mouse or finger, or selected and moved with the arrow keys; positions are stored as fractions of the pitch, so a formation looks the same on every screen. Changes stay on the device until Save, and leaving the section, team or page with unsaved changes asks first. The team's players and every admin read and edit its formations, and the last save wins; nobody else can open them. A player who leaves the team or is archived stays in a saved formation as "Former player" until someone removes them. Right-clicking a marker, holding it for 0.8 s on a touch screen, or pressing Shift+F10 opens its menu: add an attacking run (green, solid) or a defensive run (red, dashed), remove its arrows, or remove the player. The next tap on the pitch, or the arrow keys and Enter, sets where the run ends. Each player has at most one run of each kind; the arrow starts at the player and follows them, and its head can be dragged afterwards. Arrows are saved with the formation, and the Attack and Defence chips under the pitch show or hide each kind on this screen only. Share image draws the pitch in the browser and shares the PNG where the device supports it, or downloads it; it includes the arrows that are shown. Formations live in the D1 `formations` table (migration `0011`) and use no R2 storage.

## Storage

Cloudflare D1 stores the club document with optimistic concurrency and separate ballot/participation tables. R2 stores authenticated profile photos, admin-uploaded team photos (shown in place of the crest letter; replacing or removing one deletes the old object), admin-uploaded matchday clips, admin-uploaded player highlights, and team board photos. Full match replays use a shareable YouTube, Vimeo, or Drive URL. Uploaded video clips are MP4 or WebM, capped at 20 MB each; member video playback supports byte ranges. JPG/PNG/WebP uploads are restricted to 2 MB and checked for image signatures; larger profile photos are scaled down and re-encoded as JPEG in the browser (`lib/photo-compression.ts`) before upload. All write permissions and vote restrictions are enforced server-side. Browser storage is not the data source.

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
6. In Cloudflare Zero Trust, create a self-hosted Access application for `prithvifc.ca` with the paths `winterleague`, `join` and `api`. Leave the rest of the site public. Turn on the One-time PIN login method, create an Access group of club members' emails, and add an Allow policy for that group. Do not use "Everyone": each person who signs in takes one of the Zero Trust Free plan's 50 seats, so strangers could fill them. Free seats by removing departed users on the Users page.

   The app adds invited players to that group itself (Access sync): an admin enters a placeholder player's email, and inviting that player adds the email to the group. Archiving the player removes it, and the app never touches emails it didn't add. It refuses to go past 50 emails, the Zero Trust Free seat cap. To turn it on, create an API token with only **Account → Access: Organizations, Identity Providers, and Groups → Edit** on this account, store it with `npx wrangler secret put CF_API_TOKEN`, store the account ID with `npx wrangler secret put CF_ACCOUNT_ID`, and set the Club members group's id as `CF_ACCESS_GROUP_ID` in `wrangler.jsonc`. `docs/cloudflare.md` ("Access sync on invite") shows how to find the group id. Until they are set (the group id ships as a `REPLACE_WITH_` placeholder), inviting a player who has an email fails with "Access sync isn't configured"; invites without an email still work.
7. Copy the application's Audience (AUD) tag and your team URL (`https://<team>.cloudflareaccess.com`) into `wrangler.jsonc` `vars`, then deploy again.

### Free-tier guardrails

R2 is the only service here that can bill past its free tier, so `lib/r2-budget.ts` charges every R2 call against limits in D1 before R2 is reached. The limits are `wrangler.jsonc` `vars`, set below R2's free tier:

| Var | Value | R2 free tier |
|---|---|---|
| `R2_STORAGE_QUOTA_BYTES` | 8 GB | 10 GB-month |
| `R2_CLASS_A_MONTHLY_LIMIT` (uploads) | 500,000 | 1M a month |
| `R2_CLASS_B_MONTHLY_LIMIT` (photo views, video chunks) | 5,000,000 | 10M a month |

At the storage limit, uploads are refused until a clip is removed. At a monthly limit, uploads or media views pause until the next UTC month. Missing limits make uploads and views fail closed. The ledger (`r2_usage`, `r2_objects`) starts empty with the database; if existing photos or videos are ever imported, add one `r2_objects` row per imported object. A daily Cron Trigger (`17 9 * * *` in `wrangler.jsonc`, handled by `worker/index.ts`) runs `cleanupStorage`, which deletes ledger objects the club no longer references (team board photos count as referenced while their `board_images` row exists) and that are more than an hour old, so a failed delete or an interrupted upload does not hold storage for good. It makes no R2 list call, and Cron Triggers are part of Workers Free. Keep the Workers account on the Free plan, which rejects requests past its daily limit instead of billing. Rules for changing this code are in `AGENTS.md`.

Afterwards, run the Deploy workflow in GitHub Actions (`.github/workflows/deploy.yml`). It needs the repository secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts, D1 and R2 edit) and `CLOUDFLARE_ACCOUNT_ID`.

## Assets

Football photograph: Emilio Garcia, https://unsplash.com/photos/man-playing-soccer-game-on-field-AWdCgDDedH0 (Unsplash License). Nimbus fonts: URW base35; license notice in `public/fonts/LICENSE.txt`; upstream source https://github.com/ArtifexSoftware/urw-base35-fonts.

## Navigation and admin

The app has five tabs for everyone: Home, Matchdays, Table, Teams and Me. Home shows the next (or current) matchday with one button (Vote now, Follow it live, See results or See matchday), who took the last matchday and its player of the day, and the newest two posts on your team board (text only, so it reads no photos). Table keeps the team cards, the league table and the leaderboards. Me holds your profile, the Club guide and, for admins, Club admin: the admin list, new matchdays or weekly series, the stats export and the full edit log. Admin controls otherwise sit on the page they change: Manage on each matchday and on each team page.

The first organiser is the club owner. The owner can make any connected, active player an admin (up to 10) from their row under Manage on their team page, and remove that right again there or in Club admin; only the owner can do this, and the owner cannot be demoted. Removing a player from the roster also removes their admin right, and restoring them does not bring it back. Admins have every other organiser power.

The club always has three team slots. Admins rename them and set each team's crest letter, colour and motto with Edit team under Manage on the team page; text colour on and around the crest is chosen for contrast. Player assignments, rosters and results are unaffected by renaming. The public homepage keeps the default team names because anonymous visitors do not receive club data.

The organiser and admins manage roster details (including district), invitations, archival and restoration from each team page, and matches, goals, assists, videos and voting from each matchday page. Archiving a player keeps their historical statistics and account mapping. The organiser can open a player card from any player name and post short Goal, Assist, Save, Skill or Foul clips. Players edit their own name, birth year and month, height, district, position and portrait from Me; profiles show the age, never the birth year, and a cake marks a birthday month. Portraits are cropped square before upload, and a player can remove their own photo (admins can remove anyone's). They cannot change teams, match records, accounts, invitations or video clips. The server derives the editable player from the signed-in account.

## Editing the website

- Homepage text, sections and pictures: `app/home-page.tsx`.
- Homepage colours, typography and animations: `app/home.css`.
- League screens and labels: `app/club-app.tsx`.
- Colours, fonts, layout and motion: `app/globals.css`, `app/editorial.css`, `app/motion.css`.
- Images and bundled fonts: `public/`.
- League calculations and data types: `lib/club.ts`.
- Admin, invitation and voting backend: `app/api/club/route.ts`, `app/join/route.ts`, `lib/server-invitations.ts`.
- Database schema and migrations: `db/schema.ts`, `drizzle/`.

Use the matchday and team pages on the hosted site for routine score and roster updates. Source code does not contain the live player database or uploaded media. Those remain in the hosted D1/R2 services. Do not put live database exports, invitation tokens or credentials in a public repository.

## Homepage and routes

The public club homepage is `/`. The existing member app is `/winterleague`. Older `/?view=...` links redirect while preserving parameters; legacy hash invitations and setup links are forwarded. Inside the app every page has its own address, built and read by `lib/routes.ts`: `view` (the page), `day`, `tab` (the section on the page), `team` and `player` (an open player card). Opening a page or a player card adds a browser history entry, so Back and Forward move between them, and links shared before a page moved are mapped to its current place. Invitation cookies, accounts, APIs and storage remain unchanged. The website's team cards link to each team's page. Stock football images are editorial photographs, not pictures of club members; replace their source paths in `app/home-page.tsx` with your club photographs.

The future domain `prithvifc.ca` can use this same root and `/winterleague` structure once connected to hosting and DNS. It has not been registered or connected by this code change.

## Phone app

A Web App Manifest and home-screen icons support installation from compatible browsers. Open Winter league and choose the phone icon for installation guidance. iPhone/iPad use Safari → Share → Add to Home Screen. The app launches `/winterleague`; browser accounts and server data stay the same. Offline mode displays a reconnect screen. Personal information, invitations, votes and member media are never saved in a service-worker cache.
