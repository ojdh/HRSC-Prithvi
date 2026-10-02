# Prithvi FC · Club website & Winter league

A mobile-friendly club portal for Red, Black and White. Matchdays run weekly from 7:00–8:30 AM. Voting and results entry are independent: open the vote immediately after the session and enter results later.

## Organiser onboarding

The first organiser signs in with ChatGPT and supplies the one-use `CLUB_SETUP_KEY` configured in the hosted environment. It is never stored in source or sent to the browser. Add the squads and send each player a personal invitation. The site is publicly reachable, while club records require sign-in and a claimed personal invitation. Sign-in identifies the player; server authorization protects organiser operations.

## Match days and stats

Confirm attendance and opening teams. Attendance and that day's team assignments become immutable when voting opens or the first result is entered. Results can be recorded while voting is open or closed. Rounds end at ten minutes or first to two goals; winner stays. A drawn round rotates the incumbent off. If there is no previous winner, the longer-staying side exits; the opening-round exit is explicitly selected.

Stats derive from stored results and selected round lineups, with historical team snapshots. Draws grant no wins. Own goals count for the team's score but not individual goals/assists. Unknown scorers can be recorded explicitly. Undo the latest round to correct a result, then re-enter it. An organiser can export the public stats and match history as JSON.

## Voting

One irreversible vote per attending player; no own-team candidates. Personal invitations are random, single-use and tied to a preassigned roster record. Recopying an unclaimed invitation returns the same link. Tokens remain server-private; a protected cookie carries the invitation through sign-in. A D1 transactional batch enforces one receipt and one anonymous ballot, with revision checks protecting poll closure races. Participation and ballot choice are stored separately. Member-facing APIs never expose individual choices or identity keys. Aggregate results stay hidden until voting closes; tied leaders share the award. Small groups or infrastructure-level timing observations may still permit inference; this is not cryptographic anonymity.

## Storage

Cloudflare D1 stores the club document with optimistic concurrency and separate ballot/participation tables. R2 stores authenticated profile photos, admin-uploaded matchday clips, and admin-uploaded player highlights. Full match replays use a shareable YouTube, Vimeo, or Drive URL. Uploaded video clips are MP4 or WebM, capped at 20 MB each; member video playback supports byte ranges. JPG/PNG/WebP uploads are restricted to 2 MB and checked for image signatures; larger profile photos are scaled down and re-encoded as JPEG in the browser (`lib/photo-compression.ts`) before upload. All write permissions and vote restrictions are enforced server-side. Browser storage is not the data source.

## Validation

Run the Sites build workflow, then `node --import ./scripts/sites-env.mjs tests/club-integration.mjs` for isolated Worker, D1 and R2 integration checks. The test creates no production records. Photo compression has unit checks: `node --test tests/photo-compression.mjs`. Typecheck with `node node_modules/typescript/bin/tsc --noEmit`.

Production ChatGPT sign-in uses the platform-owned flow.

## Assets

Football photograph: Emilio Garcia, https://unsplash.com/photos/man-playing-soccer-game-on-field-AWdCgDDedH0 (Unsplash License). Nimbus fonts: URW base35; license notice in `public/fonts/LICENSE.txt`; upstream source https://github.com/ArtifexSoftware/urw-base35-fonts.

## Control room

The organiser manages roster details (including district), invitations, archival and restoration, matches, goals, assists, videos and voting from Control room. Archiving a player keeps their historical statistics and account mapping. The organiser can open a player profile through the Players screen and post short Goal, Assist, Save, Skill or Foul clips. Players edit their own name, age, height, district, position and portrait from My profile. They cannot change teams, match records, accounts, invitations or video clips. The server derives the editable player from the signed-in account.

## Editing the website

- Homepage text, sections and pictures: `app/home-page.tsx`.
- Homepage colours, typography and animations: `app/home.css`.
- League screens and labels: `app/club-app.tsx`.
- Colours, fonts, layout and motion: `app/globals.css`, `app/editorial.css`, `app/motion.css`.
- Images and bundled fonts: `public/`.
- League calculations and data types: `lib/club.ts`.
- Admin, invitation and voting backend: `app/api/club/route.ts`, `app/join/route.ts`, `lib/server-invitations.ts`.
- Database schema and migrations: `db/schema.ts`, `drizzle/`.

Use Control room on the hosted site for routine score and roster updates. Source code does not contain the live player database or uploaded media. Those remain in the hosted D1/R2 services. GitHub changes do not automatically deploy to Sites; publish the updated source through the Sites workflow. Running elsewhere also requires replacing platform ChatGPT authentication and configuring D1/R2 bindings. Do not put live database exports, invitation tokens or credentials in a public repository.

## Homepage and routes

The public club homepage is `/`. The existing member app is `/winterleague`. Older `/?view=...` links redirect while preserving parameters; legacy hash invitations and setup links are forwarded. Invitation cookies, accounts, APIs and storage remain unchanged. Teams link to filtered squads. Stock football images are editorial photographs, not pictures of club members; replace their source paths in `app/home-page.tsx` with your club photographs.

The future domain `prithvifc.ca` can use this same root and `/winterleague` structure once connected to hosting and DNS. It has not been registered or connected by this code change.

## Phone app

A Web App Manifest and home-screen icons support installation from compatible browsers. Open Winter league and choose the phone icon for installation guidance. iPhone/iPad use Safari → Share → Add to Home Screen. The app launches `/winterleague`; browser accounts and server data stay the same. Offline mode displays a reconnect screen. Personal information, invitations, votes and member media are never saved in a service-worker cache.
