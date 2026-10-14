# Prithvi FC · Club website & Winter league

A mobile-friendly club portal for Red, Black and White. Admins schedule matchdays as a weekly series (one weekday, start and end time, up to 52 weeks) or as one-off days at any date and time; the usual session is 7:00–8:30 AM. A scheduled day has no attendance until it is set up on the day with its opening teams, which marks every active player as attending, and it can be moved or cancelled until voting opens or a round is recorded. After that, deleting it needs approval: the owner can delete a played matchday alone, otherwise it is deleted once three admins approve (the request counts as the first). Deleting removes its results, votes and uploaded clip. Each round can carry its own YouTube, Vimeo or Google Drive link alongside the full-match link. Voting and results entry are independent: open the vote immediately after the session and enter results later.

## Organiser onboarding

The first organiser signs in through Cloudflare Access and supplies the one-use `CLUB_SETUP_KEY` configured as a Worker secret. It is never stored in source or sent to the browser. Add the squads and send each player a personal invitation. The site is publicly reachable, while club records require sign-in and a claimed personal invitation. Sign-in identifies the player; server authorization protects organiser operations.

## Match days and stats

Set up the day by choosing the opening teams: every active player is marked as attending, and admins remove anyone who didn't come under Manage → Attendance. The opening teams become immutable when voting opens or the first result is entered. An admin can remove a player from attendance at any time, even after voting opens or games are saved: they leave the day's attendance and every lineup, and the removal is in the edit log. Removal is refused while the player has a goal, an assist or a game in goal that day, or is their team's only player in a game; edit those games first. Ballots are anonymous, so a vote they cast or received stays counted. Results can be recorded while voting is open or closed. Each game lasts ten minutes and can end with any score; the winner stays. A drawn game sends off the team that has been on longest (the previous winner); for a draw in the first game, the exit chosen at setup leaves. Admins can also add a player to attendance at any time, even after voting closes: a late arrival on the day, or a player missed from a played day, who is then put into their games with Edit under Results. Every addition and removal is in the edit log. A player added while voting is open can vote. Player stats count matchdays attended (played matchdays on which the player was marked attending) and attendance as a share of played matchdays; Standings shows a Most matchdays board.

## Teams and players

Teams opens on the visitor's own team, or on the three sides for someone without one; each team has its own page with a header (photo or crest, motto, table position, points and form) and Squad, Stats, Board, Chat and Formation sections. Squad lists the players by name and Stats ranks them by goals plus assists; both lists show matchdays, wins, goals, assists and G+A, and fit a phone without scrolling sideways. Board, Chat and Formation are shown only to that team's own players, admins and the owner included only for their own team, and the API enforces the same rule. Admins manage a team from its page: edit the team, add players, and edit, invite, make or remove admins, remove and restore players. Every team name or crest in the app (table rows, team cards, round results, matchday summaries, the player card) opens the team page, and every player name (scorers, assists, the player of the day, vote tallies, board authors, leaderboards, squads) opens the player card.

Stats derive from stored results and selected round lineups, with historical team snapshots. Draws grant no wins. The league table awards 3 points for a win, 1 for a draw and 0 for a loss, and ranks teams by points, then goal difference, then goals scored; GF and GA are the sums of each team's scores over every game played, and GD is GF minus GA. On a phone the table drops the crests and the Form column so it fits without scrolling. The Table page also ranks goalkeepers by goals conceded per game in goal, fewest first; a keeper is listed once they have kept goal in at least half of their team's games over the chosen period. Own goals count for the team's score but not individual goals/assists. Unknown scorers can be recorded explicitly. Admins can edit any recorded round to correct its score, scorers or lineup; its winner, and on a draw the team that rotates off, are recalculated, while later rounds stay as played. The latest round of any matchday can also be undone, from Me → Club admin. Every edit, undo and deletion step is kept in an edit log that only admins can see, under Manage on each matchday and under Me → Club admin for the whole club. An organiser can export the public stats and match history as JSON.

## Matchday page

Matchdays is one page per day. A strip of dates runs from past days through today (with a red dot while a session is live) to upcoming days; it opens on today's matchday, or the next one. Each day has three sections: Results (the player of the day, the fair play award, each team's day, the scorers, the film and every round), Live and Vote. Live is for admins, from the day itself on, so games can still be recorded after the session; on earlier days it is labelled Record games. The page opens on Live for admins during the session, on Vote while voting is open, and on Results otherwise. Admins also see a Manage strip for the day: set up the day or update its opening teams, remove players from attendance, edit the date and time, cancel an unplayed day, open, share or close voting, late arrivals, resume an ended matchday, that day's edit log and the deletion approvals. When the session is over, an admin presses End matchday in the Today's session panel under Live, set apart from End game and confirmed in a dialog. It is disabled while a game is in progress. Ending opens voting if it is not open yet, stops the live status and blocks new games until an admin resumes the day; saved games stay editable. Admins schedule new matchdays and export stats from Me → Club admin.

Live starts with Who's here? for the opening teams. The live board then shows the current game and who is waiting, with a 10-minute clock and a Goal button for each team. Each goal records a scorer, optional assist or own goal, and the score follows the goal list. Each team can name a goalkeeper from its players in the game; a team starts each game with the keeper it had in its last game, and admins can change keepers when correcting a played game. End game saves the game, and the board moves to the next game using the winner-stays rule. The session panel lists the games played. A game in progress is kept in the organiser's browser storage until it is saved, so a reload pitch-side does not lose it; nothing reaches the server until End game.

## Voting

One irreversible ballot per attending player, naming one player from each team, the voter's own included; nobody can vote for themselves. A team whose only attending player is the voter is skipped. The ballot screen groups candidates by team and shows each one's goals, assists and wins for the day and the season, and asks for confirmation before submitting. Personal invitations are random, single-use and tied to a preassigned roster record. Recopying an unclaimed invitation returns the same link. Tokens remain server-private; a protected cookie carries the invitation through sign-in. A D1 transactional batch enforces one receipt and its anonymous ballots, with revision checks protecting poll closure races. Participation and ballot choice are stored separately. Member-facing APIs never expose individual choices or identity keys. Aggregate results stay hidden until voting closes.

The player of the day is the attending player with the best combined score once voting closes; tied leaders share the award, and nobody wins on zero. The score is out of 100: half from votes (votes ÷ the day's most votes) and half from stat points (points ÷ the day's most points). Stat points are 1 per game played; per goal and per assist, the average of the player's scoring-position value and tier value; and, for goalkeepers and defenders, a base of 20 or 15 minus 2 per goal their team conceded in the games they played, which can go below zero. Own goals earn nobody points.

| Scoring position | Goal | Assist | Defensive base |
|---|---|---|---|
| Goalkeeper | 15 | 10 | 20 |
| Defender | 12 | 8 | 15 |
| Midfielder | 8 | 5 | — |
| Forward | 5 | 4 | — |

| Tier | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Goal | 5 | 7 | 10 | 13 | 15 |
| Assist | 4 | 5 | 7 | 10 | 10 |

Tier 1 is the strongest group, so its goals are worth least. Admins set each player's scoring position and tier under Me → Club admin → Player scoring; a player without one counts as tier 3 at their profile position, with an all-rounder counted as a midfielder. Changes apply to every closed matchday's scores. Players see only the combined scores; tiers, scoring positions, the vote tally and stat points reach admins only, who see each closed day's breakdown under Club admin → Score breakdown. The logic is `dayScores` in `lib/club.ts`. Small groups or infrastructure-level timing observations may still permit inference; this is not cryptographic anonymity.

The fair play award has its own voters, chosen by any admin under Me → Club admin. A fair-play voter need not have attended. After their player-of-the-day ballot (or straight away, if they did not attend) they see a second screen and name one attending player, never themselves. It opens and closes with the matchday's vote, is stored the same way in its own tables (`fair_play_receipts` and `fair_play_ballots`, migration `0014`), and its tally and winner appear once voting closes. Non-admins learn only whether they are a fair-play voter themselves.

## Team boards

Each team has a private discussion board, the Board section of its team page. Any player on the team can post up to 2,000 characters with up to four photos, and teammates comment (up to 1,000 characters and one photo, 50 comments a post) and react with 👍 ❤️ 😂 🔥 ⚽ or 👏; a second tap removes a reaction. Only the team's own players can read the board; admins and the owner see only their own team's board, not other teams'. A player who changes team keeps authorship of their old posts but stops seeing that board. Authors delete their own posts and comments, and admins delete anything on their own team's board; when an admin removes someone else's content, the Club admin edit log records who removed it, from which board, whose it was and when, never the text. Deleting a post removes its comments, reactions and photos.

Photos are compressed on the device, then stored in R2 under `board/` with the same 2 MB cap and signature check as profile photos; they are served only to people who can open that board and load lazily, since each view is one R2 read. Board text, comments, reactions and photo records live in their own D1 tables (`board_posts`, `board_comments`, `board_reactions`, `board_images`, migration `0010`), not in the club document. The feed loads 20 posts at a time and refreshes every 60 seconds while the tab is visible; there are no push updates.

## Team chat

Each team has a private chat, the Chat section of its team page, open to the same people as the team's board. Home shows the latest three messages in the visitor's team chat with a box to reply, next to the team board's latest posts and a box to post. Messages are text only, up to 1,000 characters; Enter sends and Shift+Enter starts a new line. Authors delete their own messages and admins delete any message in their own team's chat; when an admin removes someone else's message, the Club admin edit log records who removed it, from which chat, whose it was and when, never the text. Messages are kept for 90 days, and the daily cron deletes older ones.

Admins and the owner also share an admin chat, under Me → Club admin and as a card on Home for admins. It works like a team chat across all three teams, except that everyone deletes only their own messages there. An admin who loses the role loses the admin chat. Its messages are stored with `team` set to `admins`.

The chat has no push updates: it polls `/api/chat`, and each answer says how many seconds to wait before the next poll. That is 3 seconds when the last message was under 2 minutes ago, 10 under 10 minutes and 30 otherwise. A device polls at least every 3 seconds while its player is typing and stops while the page is hidden. Each poll sends the chat version it already has; while nothing has changed, the answer carries no messages and costs one D1 row read. Once a player has loaded older messages, each poll also sends the oldest one loaded; when the chat has changed, the answer holds every message from the newest down to it (up to 500), so messages deleted or expired anywhere on screen disappear. Messages live in the D1 tables `chat_messages` and `chat_state` (migration `0012`) and use no R2.

## Team formations

The Formation section of a team page holds up to 10 named formations for that team. Each is a vertical pitch with up to 11 markers in the team's colour: a squad player (with their photo or initials) or a placeholder name of up to 30 characters. Markers are dragged with a mouse or finger, or selected and moved with the arrow keys; positions are stored as fractions of the pitch, so a formation looks the same on every screen. Changes stay on the device until Save, and leaving the section, team or page with unsaved changes asks first. Only the team's own players read and edit its formations (admins included only for their own team), and the last save wins; nobody else can open them. A player who leaves the team or is archived stays in a saved formation as "Former player" until someone removes them. Right-clicking a marker, holding it for 0.8 s on a touch screen, or pressing Shift+F10 opens its menu: add an attacking run (green, solid) or a defensive run (red, dashed), remove its arrows, or remove the player. The next tap on the pitch, or the arrow keys and Enter, sets where the run ends. Each player has at most one run of each kind; the arrow starts at the player and follows them, and its head can be dragged afterwards. Arrows are saved with the formation, and the Attack and Defence chips under the pitch show or hide each kind on this screen only. Share image draws the pitch in the browser and shares the PNG where the device supports it, or downloads it; it includes the arrows that are shown. Formations live in the D1 `formations` table (migration `0011`) and use no R2 storage.

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

The app has five tabs for everyone: Home, Matchdays, Table, Teams and Me. Home shows the next (or current) matchday with one button (Vote now, Follow it live, See results or See matchday), who took the last matchday and its player of the day, and the newest two posts on your team board (text only, so it reads no photos). Table keeps the team cards, the league table and the leaderboards. Me holds your profile, the Club guide and, for admins, Club admin: the admin list, the fair-play voters, player scoring and score breakdowns, new matchdays or weekly series, the stats export and the full edit log. Admin controls otherwise sit on the page they change: Manage on each matchday and on each team page.

The first organiser is the club owner. The owner can make any connected, active player an admin (up to 10) from their row under Manage on their team page, and remove that right again there or in Club admin; only the owner can do this, and the owner cannot be demoted. Removing a player from the roster also removes their admin right, and restoring them does not bring it back. Admins have every other organiser power.

The club always has three team slots. Admins rename them and set each team's crest letter, colour and motto with Edit team under Manage on the team page; text colour on and around the crest is chosen for contrast. Any admin can name one active player as each team's captain, or clear the captaincy, from that player's row under Manage on the team page (with a confirmation). The captain shows in the team header and with a Captain tag on their player card and profile. A captain who is removed from the roster or moved to another team stops being captain. Player assignments, rosters and results are unaffected by renaming. The public homepage keeps the default team names because anonymous visitors do not receive club data.

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

A Web App Manifest (`public/manifest.webmanifest`) and home-screen icons (`public/icons/`) support installation from compatible browsers. Open Winter league and choose the phone icon for installation guidance. iPhone/iPad use Safari → Share → Add to Home Screen. The app launches `/winterleague`; browser accounts and server data stay the same. The service worker (`public/sw.js`) caches only the offline page and the icons, so offline mode displays a reconnect screen (`public/offline.html`). Personal information, invitations, votes and member media are never saved in a service-worker cache.

## Notifications

Players turn phone notifications on under Me → Profile, for one device at a time: turning them on on another device moves them there. A notification is sent when a team chat, or for admins the admin chat, wakes up: a message after five minutes with none. Messages in an ongoing conversation don't notify again, and each chat's notifications replace each other. The text names only the chat ("New message in Team Red chat"), never who wrote or what, because it shows on the lock screen. Tapping it opens that chat. iPhones offer notifications only once the app is added to the Home Screen.

The Worker sends Web Push itself (`lib/web-push.ts`, WebCrypto only): each push is encrypted for its device and signed with the club's VAPID key, and goes straight to the browser's push service (Google, Apple, Mozilla or Microsoft; no other address is accepted). It is sent after the chat reply, so posting never waits on it, and a subscription the push service reports gone is deleted. Subscriptions live in the D1 table `push_subscriptions` (migration `0013`), one row per player. The public key is `VAPID_PUBLIC_KEY` in `wrangler.jsonc`; the private key is the `VAPID_PRIVATE_KEY` Worker secret. Without either, notifications can't be turned on and chat works as before. On Workers Free one request can make at most 50 subrequests, D1 queries included, which is why notifications cover team and admin chats and not club-wide events.

