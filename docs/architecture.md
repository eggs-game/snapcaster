# How Snapcast is built

The app is primarily static files plus small same-origin serverless routes for
TURN, account deletion, and scheduled maintenance. Supabase provides private
Realtime signaling, optional/anonymous authentication, and the durable account
data layer. Recognition remains in the browser.

```
┌─────────────┐   signaling only    ┌──────────────┐
│  Browser A  │◀───────────────────▶│   Supabase   │  presence + broadcast
└─────┬───────┘   (no media, no     │   Realtime   │  (SDP, ICE, life, chat)
      │            card images)     └──────────────┘
      │
      │  encrypted WebRTC mesh: audio, video, and capture data channels
      │  direct when possible; Cloudflare TURN relay when required
      │
┌─────▼───────┐                     ┌──────────────┐
│  Browser B  │                     │    Vercel    │  app bundle + card index
└─────────────┘                     │              │  + TURN serverless routes
                                    └──────────────┘
```

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Build | Vite | Fast, and bundles the Web Worker without extra config |
| UI | React 18 | Lightweight pathname dispatch for lobby/game, discovery, profiles, policy, moderation, benchmark, and TURN-health pages |
| Accounts | Supabase Auth + Postgres | Optional Discord identity, profiles, private contact data, and preferences |
| Transport | WebRTC mesh (2–6 players) + Cloudflare TURN | Direct first; encrypted relay fallback for strict VPN/NAT/firewall paths |
| Signaling | Supabase Realtime | Presence + broadcast, free tier, no server code |
| Vision | OpenCV.js (WASM) in a Worker | Contour detection and ORB, off the main thread |
| OCR | tesseract.js | Title reading, main thread, heavily gated (see below) |
| Hosting | Vercel | Auto-deploys `main`; static files plus narrowly scoped stateless serverless routes |

Dependencies are deliberately few: `react`, `react-dom`, `@supabase/supabase-js`,
`tesseract.js`, `lucide-react`. OpenCV loads at runtime from `docs.opencv.org`.

## Optional accounts

Guest play remains available. A player may instead sign in with Discord through
Supabase Auth. The browser requests only Discord's `identify` and `email`
scopes and uses the PKCE authorization-code flow. The OAuth client secret stays
in the Supabase provider configuration and is never shipped in the browser
bundle.

Guests receive an anonymous Supabase Auth identity solely to authorize a
private Realtime room. The account trigger skips anonymous users, so they have
no Snapcast profile, contact row, preferences, public history, or social
identity. A signed-in player can securely claim the same capability-backed
membership after OAuth.

Local profile, social, history, and public-room fixtures live only in the
ignored `public/mock-data.local.json` working-copy file. `localMock.js` refuses
to load them away from loopback hosts, and the Vite production build removes
that filename from `dist` as a second boundary. This keeps local feature tours
realistic without putting fake people or game records in Git or a deployment.

`supabase/migrations/20260726090000_accounts_phase_one.sql` creates three
separate account surfaces:

- `profiles` contains public display name and avatar data.
- `account_private` contains the Discord provider ID and email, readable only
  by that account.
- `account_preferences` contains owner-only game-entry preferences.

Row-level security keeps private contact and preference rows owner-only. Public
profiles deliberately do not include email. The auth trigger creates all three
rows and safely backfills accounts that predate the migration.

To enable Discord sign-in, enable the Discord provider in Supabase, add the
Supabase callback URL to the Discord application, and allow both the production
origin and local development origin as Supabase redirect URLs. Existing
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` variables are reused; the
Discord secret belongs only in Supabase.

## Source layout

```
src/
  main.jsx              entry; lazy routes /snaptest and /turntest vs the app
  App.jsx               Lobby ↔ lazy-loaded Game, theme
  AccountPrompt.jsx     optional post-setup Discord account prompt
  AccountProfile.jsx    shared account content for profile, settings, and friends pages
  accountIdentity.js    dependency-free display-name/avatar helpers for the landing bundle
  SettingsPage.jsx      profile, devices, preferences, and account data
  FriendsPage.jsx       player search, presence, and friend management
  NotificationsPage.jsx friend requests plus received and sent review activity
  localMock.js          loopback-only loader for ignored local fixture data
  PublicGames.jsx       public Lobby and Live Game directories
  ProfilePage.jsx       public finished-game statistics and matchups
  GameManagement.jsx    owner lifecycle and participant moderation controls
  ReviewPrompt.jsx      private post-game review flow
  ModerationPage.jsx    least-privilege report and appeal queue
  account.js            auth session, Discord OAuth, pending-game restoration
  gameRooms.js          capability-backed room and durable-game RPC client
  supabase.js           shared browser Supabase client
  Lobby.jsx             create/join, device pick, idle recognition warm-up
  Game.jsx              video tiles, life, turns, public chat/whispers, dice, capture clicks
  CardSidebar.jsx       results panel + ?debug=1 diagnostics
  cardNameIndex.js      local card-name search index and query cache
  chatCommands.js       /whisper parsing and @recipient matching
  roomCode.js           room-code generation/config check without Supabase
  soundEffects.js       vetted local sound catalogue and 3-second playback cap
  TurnTest.jsx          credential-safe production relay health page
  webrtc.js             mesh, data channels, capture request/response
  signaling.js          Supabase Realtime room join and persistence helpers
  captureGeometry.js    crop maths shared by production and the benchmark
  cardSearch.js         Scryfall-backed name and partner suggestions
  commanderRules.js     pure Commander legality rules shared with the API
  recognition/
    recognizer.js       ★ Web Worker: OpenCV, crops, hashing, ORB
    matcher.js          main-thread front end: worker plumbing, OCR, gating
    hash.js             hashing reference implementation (see the note below)
  snaptest/
    scene.js            renders realistic multi-card table scenes
    degrade.js          single-card degradations
scripts/
  build_index.py        builds the card index from Scryfall bulk data
  analyze_metadata.py   measures metadata signals before they enter ranking
  build_popularity.py   EDHREC-ranked names + token names, for the benchmark
  test_hash_compat.py   asserts JS and Python hash identically
  check_hash_duplication.py  asserts the worker's copy has not drifted
```

`api/turn-credentials.js` keeps the Cloudflare
TURN key server-side and issues 12-hour credentials after a same-origin,
room-code-shaped request. It filters out Cloudflare's browser-blocked port 53
URLs and returns UDP, TCP/80, TLS/5349 and TLS/443 options. A best-effort
per-IP/room rate limit reduces casual credential abuse; production usage should
also be watched in Cloudflare Realtime analytics.
`await window.__scTestTurn()` performs a relay-only ICE gathering check without
opening media devices and reports only candidate counts/protocols, never the
short-lived credential. `/turntest` exposes the same safe result as a small
production health page.
`api/turn-usage.js` is a read-only, same-origin analytics broker. With a
Cloudflare Account Analytics token in Vercel, it aggregates current-month TURN
egress and projects month-end use against the 1,000 GB allowance without
exposing the account ID or analytics token.

`api/account-delete.js` revalidates a signed-in user before running the
service-only anonymization and Auth deletion path. `api/maintenance.js` accepts
only Vercel's cron secret, runs retention, finalizes due results, and processes
the delayed deletion queue. The service-role key exists only in these
serverless functions. Moderator access is an explicit service-managed
allowlist; the browser can reach report evidence only through
moderator-checking RPCs.

`api/commanders.js` revalidates both account and anonymous game sessions, loads
current Oracle data from Scryfall, and applies the shared Commander/partner
legality rules. It is the only writer for saved decks and live membership
Commander fields. Presence heartbeats ignore their legacy Commander
parameters, and peers refresh the database-authorized membership snapshot
instead of accepting Commander names broadcast by another browser.

## The card index

Built by `scripts/build_index.py`, run by the **Build card index** GitHub
Action (monthly, or manually), which commits the result to `main`. Version 4,
currently **110,592 printings / 35,052 names / 256 shards**.

| File | Size | Loaded by | Purpose |
| --- | --- | --- | --- |
| `manifest.json` | tiny | both | version, counts |
| `names.json` | 0.67 MB | main thread | name list for OCR matching + count |
| `hashes.bin` | 7.1 MB | worker | 64-byte pHash+dHash per printing |
| `colors.bin` | 1.4 MB | worker | 13-byte hue histogram per printing |
| `arthashes.bin` | 3.4 MB | worker | 32-byte art-region hash per printing |
| `cards.json` | 8.1 MB | worker | name/set/collector number/id per printing |
| `shards/00..ff.json` | sharded | main thread | on demand; visual data plus mana cost, type line and Oracle text |

The worker loads the four bulk files once and keeps them resident. The main
thread loads only `names.json` — it used to pull `hashes.bin` + `cards.json`
(15 MB) because a version check read `=== 2` against a v3 manifest.

`/carddata/*` is served with a week of caching plus a month of
`stale-while-revalidate`; it changes monthly.

Version 4 appends `mana_cost`, `type_line`, and `oracle_text` to every shard
row. They are face-specific for independently imaged double-faced cards and
use empty strings when Scryfall has no value (for example, a token's mana
cost). The manifest publishes `shard_fields` and `cards_fields`, so future
consumers do not have to infer the positional schemas. The global `cards.json`
stays deliberately compact because the worker loads it for every recognition
session; future metadata-assisted recognition can derive purpose-built compact
tables from the v4 shards without putting full Oracle text on the startup path.

## Recognition boundary

Everything expensive lives in the Worker (`recognizer.js`): OpenCV WASM,
contour detection, all hashing, the 110k-printing scan, and ORB verification.
The main thread (`matcher.js`) owns worker plumbing, the OCR pool, and the
decision gates about which answer to trust.

This split exists because OpenCV's WASM compile froze the UI when it ran on
the main thread — an early bug that made the lobby unresponsive.

> **Hashing is a cross-language contract.** `scripts/build_index.py` writes the
> index; `recognizer.js` queries it. They must produce bit-identical hashes.
> Because the worker is a *classic* worker (it needs `importScripts` for
> OpenCV) it cannot import `hash.js`, so it carries its own copy of the hashing
> functions. `test_hash_compat.py` checks `hash.js` against Python, and
> `check_hash_duplication.py` asserts the worker's copy is identical to
> `hash.js` — together they cover the path production actually uses. Both run
> in CI. Never edit one side alone.

## Multiplayer

- **Room codes** are 6 characters from `crypto.getRandomValues` (~887M). They
  are unguessable discovery capabilities; database membership and private
  Realtime policies separately authorize the room transport.
- **Roles**: up to 6 `player`s (camera + mic) and up to 8 `visitor`s (audio
  only, cannot be captured, cannot change game state). A visitor chooses their
  microphone before entering and can join live or muted, then mute, unmute, or
  switch microphones from Settings. Visitors hear one another as well as every
  player's audio, receive every player video stream, and can use card lookup
  and Chat (including sound effects). They can inspect Commander damage and
  poison totals in a read-only panel, but do not see Dice or any counter
  editing controls.
- **Two transports, one authorisation model.** Supabase broadcast carries game
  state (life, commander, turn, chat) and gates every privileged message on
  sender role. Official clients replace self-published Realtime identity and
  role fields with capability-authorized database membership state, close
  removed peers, and discard broadcasts from memberships that are no longer
  active. Private Realtime policies require an active membership for the
  current room epoch; removal rotates that epoch so an already-connected or
  modified client cannot stay on the new topic. WebRTC data channels carry
  capture requests and apply the same rule —
  a visitor cannot request a capture, requests are rate limited per peer, and
    every peer-controlled field is bounds-checked.
- **Late-join state is batched.** A presence sync sends one targeted,
  bounds-checked state snapshot per new protocol-2 peer instead of rebroadcasting
  every life, commander, counter, color, and camera field to the whole room.
  Presence advertises the protocol version; older open tabs receive targeted
  legacy messages during a rolling deploy.
- **Connection failures are observable.** Supabase Realtime heartbeats run in
  its worker so a backgrounded tab is less likely to disappear from presence.
  The client keeps the latest 80 connection events locally at
  `window.__SNAP_CONNECTION_DIAGNOSTICS` and in
  `localStorage["snapcast-connection-diagnostics"]`. Signaling errors,
  presence loss, offline/online transitions, and WebRTC failures/recoveries are
  also written to the insert-only `connection_events` table. Durable reports
  exclude names, messages, media/device data, and raw room codes; a one-way
  room fingerprint groups reports from the same game. A deliberate
  **Leave game** announces departure first, while an unannounced presence loss
  enters a 15-second reconnect grace period. During that window the player's
  tile and seat remain in place with a Reconnecting overlay. Returning with the
  same room-scoped participant ID cancels removal and negotiates a fresh peer
  connection; only an expired grace period becomes an unexpected-drop report.
  Presence can transiently contain duplicate metadata for that stable ID, so
  roster construction selects the newest non-empty display name and peers
  rebroadcast their own identity as a fallback. Video banners still render a
  generic Player/Visitor label if both sources are malformed.
  The active room, stable participant ID, original seat timestamp, life,
  commander/partner, color, mute/camera state, poison, commander damage, and
  video counters live in session storage so a refresh automatically rejoins
  the same seat and republishes the restored state. Lifecycle heartbeat and
  navigation evidence classify recovery as a refresh, connectivity loss,
  likely crash, or generic session resume.
- **Recognition latency is observable without storing card content.** The
  latest 50 scans remain available in the scanning browser at
  `window.__SNAP_RECOGNITION_TIMINGS`. A bounded copy is also submitted
  asynchronously to the insert-only `recognition_timing_events` table so live
  capture/network time can be separated from worker stages after the fact.
  Rows use a one-way room fingerprint and temporary room-scoped participant
  IDs; they exclude raw room codes, names, card identities/results, images,
  OCR text, device labels, and raw errors. Anonymous clients cannot select
  telemetry rows.
- **Recent-card hints are ephemeral, bounded room state.** A strong lookup by
  any player or visitor broadcasts the Scryfall printing ID, board owner,
  approximate normalized click position, and timestamp to the current room.
  Every participant's browser contributes to and consumes the same shared
  shortlist. Each browser keeps at most 32 hints for four hours and considers
  at most 12 nearby hints per scan.
  The worker never trusts a hint as the result: it compares the named printing
  with the new capture and accepts only a near-exact visual hash or decisive
  ORB art match, otherwise it runs the unchanged full-index pipeline. Hints
  are not chat, are not written to Supabase tables or Storage, and disappear
  when the room/tab ends.
- **Card clicks are latest-request-wins.** A second click on the same board
  spot while recognition is active is coalesced instead of queueing duplicate
  work. Recognition has one active job and at most one waiting job; a newer
  click replaces the waiting job. A slow earlier scan cannot replace the card
  the player most recently requested, and rapid clicking cannot build an
  unbounded bitmap/OCR queue.
- **Public chat and private whispers take different routes.** Ordinary chat is
  a Supabase room broadcast. `/whisper @name` resolves the selected roster ID
  and sends only over that participant's encrypted WebRTC data channel. Both
  players and visitors can send and receive whispers. A sender keeps a local
  copy, the recipient sees a separately styled “Whisper from” entry, and no
  other room participant receives the message. If that private channel is not
  ready, the UI reports the failure and does not fall back to public chat.
- **Chat sounds are public, short, and allow-listed.** A public chat message
  may carry one catalogue `soundId`, which each browser resolves to a bundled
  local clip. A shared Web Audio context decodes it, seeks to the curated
  audible offset, and stops after 2–3 seconds. The room never receives
  arbitrary audio URLs or uploads. Private whispers remain text-only. Sender UI and
recipient playback both enforce a two-minute per-sender sound cooldown. Clips
use a fixed 30% gain relative to the listener's browser/tab volume; there is
no separate in-app sound setting.
- **Shared game events live in Chat.** Dice rolls, shared cards, life-total
  changes, and ready-check outcomes are compact structured Chat objects. Consecutive
  life clicks synchronize immediately but coalesce into one net Chat entry after a
  two-second pause. Choosing a die
  does not roll it; the explicit Roll dice/Flip coin action broadcasts the
  result and shows every participant a centered three-second video-panel overlay.
  Coin results are displayed as Heads or Tails.
- **Video counters are owner-scoped, allow-listed room state.** A player can
  generate a known Magic counter type in the Dice panel and drag it onto only
  their own video. The owner broadcasts normalized coordinates and may later
  move, adjust, or remove that sticker; receivers validate the type and render
  it read-only. Current stickers are rebroadcast during roster synchronization
  for late joiners. +1/+1 and −1/−1 counters track a magnitude from 0–99 and
  render it directly in their label (for example, +2/+2); a value that remains
  exactly zero for ten seconds is removed automatically.
- **Capture is never silent.** When a peer photographs your camera you see
  "<name> scanned your board" on your own tile.
- **Cards can be shared deliberately.** A player can reveal a hover-only chat
  button on a recent card to share it with the room. Every participant receives
  the normal card details and image in Recent and can click it to open locally;
  no camera capture is repeated.
- **Video quality has sender and receiver ceilings.** Every player chooses an
  outgoing ceiling of 720p, 1080p, 2K/1440p, or 4K/2160p in Settings; 1080p is
  the default. That ceiling is persisted locally and retunes every active
  `RTCRtpSender` without reconnecting. Each remote tile can separately request
  Auto, 720p, or 1080p. The effective stream uses the lower of the sender's
  ceiling and that receiver's request, so a viewer can save bandwidth but can
  never force the camera owner to encode above their chosen limit. The raw
  local camera track remains at native detail for card-recognition captures;
  only the encoded WebRTC stream is capped. WebRTC may still adapt down when
  the source camera or network cannot sustain the target, and the tile reports
  the decoded resolution it is actually receiving. Hidden tabs and non-primary
  Follow/Hero tiles request 720p automatically; the visible tile view caps Auto
  at 1080p. The user's explicit per-player choice returns when that stream is
  primary again.

## Runtime performance

- The landing bundle excludes the Game, WebRTC/Supabase room code, recognition
  worker front end, and Tesseract. Game loads only when a session starts;
  recognition warms during lobby idle time; OCR loads after entry when the
  browser is idle. `Lobby.jsx` must not statically import the recognition
  matcher: doing so collapses the idle `import()` back into the initial bundle.
  Account hydration starts after first paint from its own chunk, and multiplayer
  room RPCs load when a create/join flow opens. The production build enforces an
  80 KiB gzip ceiling on the initial JavaScript entry so these boundaries cannot
  silently regress.
- Card-name suggestions use the bundled 35k-name index first. In-memory query
  and Scryfall-response caches deduplicate autocomplete, exact-card, fuzzy-card,
  and commander-partner requests without persisting browsing data.
- Camera capture reuses one video element and three canvases per local track.
  The chosen JPEG travels as bounded 48KB binary data-channel chunks rather
  than a base64 JSON string; object URLs are bounded and revoked.
- Video tiles and the card sidebar are memoized away from unrelated game-state
  renders. Speaking meters sample at roughly 15Hz with a 256-bin analyser, and
  decoded-resolution polling runs every five seconds.

## Security posture

- Camera stills use the encrypted WebRTC data channel. They travel directly
  when possible or through Cloudflare TURN when relaying is required; TURN
  stores neither the still nor the live stream.
- Whispers use the same encrypted peer channel and are addressed by roster ID,
  not trusted display-name text. They are not placed on the Supabase public
  chat broadcast.
- CSP, HSTS, `Permissions-Policy` (camera/mic scoped to self),
  `X-Frame-Options: DENY`, nosniff and a referrer policy are set in
  `vercel.json`. CSP explicitly permits Google Fonts and Tesseract's pinned
  jsDelivr runtime/data origins; the early theme initializer is a same-origin
  external script so the policy does not require inline-script permission.
- No `dangerouslySetInnerHTML`, `innerHTML` or `eval` anywhere in `src/`.
- Opt-in recognition evidence accepts both guest and signed-in game sessions,
  but remains write-only to browsers. Database rows enforce bounded strings
  and JSON shapes/sizes; Storage accepts only UUID-scoped capture/OCR image
  paths, allow-listed image MIME types, and fixed byte ceilings. The browser
  rejects invalid UUIDs, media types, and oversized blobs before upload.
- External Cloudflare and Scryfall calls have bounded deadlines. Commander and
  partner validation fetches run concurrently, while the trusted server route
  remains the only writer for validated Commander state.
- The Cloudflare TURN key is held only in server-side Vercel environment
  variables. Browsers receive expiring credentials, never the key itself.
- The Supabase key is publishable. Realtime handles the game; opt-in
  recognition reports use a private Storage bucket plus a write-only table and
  token-scoped labeling function from `supabase/migrations/`. Optional account
  tables use Row Level Security, and email/preferences are readable only by
  their owner. Narrow same-origin serverless routes validate sensitive
  mutations; live video is never uploaded to an application server.

## Conventions

- `main` is the only branch and auto-deploys. Confirm a deploy via the
  commit's GitHub status before claiming something is live.
- Bump the `BUILD` marker in `main.jsx` on every recognition change so
  stale-cache confusion is immediately visible in the console.
- UI copy is sentence case; functional values like room codes stay uppercase.
- Panel forms reuse the Settings field pattern (14px secondary labels, 8px
  label-to-control spacing, 34px controls, 8px radii, shared tokens).
- Node 22 or newer is required by the current Supabase client. CI and the
  package engine declaration stay aligned so an unsupported serverless runtime
  cannot drift in unnoticed.
