# How Snapcaster is built

There is no stateful application backend. The app is static files plus a small
same-origin TURN credential function, and recognition remains in the browser.

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
│  Browser B  │                     │    Vercel    │  static hosting:
└─────────────┘                     │              │  app bundle + card index
                                    └──────────────┘
```

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Build | Vite | Fast, and bundles the Web Worker without extra config |
| UI | React 18 | No router — the app has two screens plus a benchmark page |
| Transport | WebRTC mesh (≤4 players) + Cloudflare TURN | Direct first; encrypted relay fallback for strict VPN/NAT/firewall paths |
| Signaling | Supabase Realtime | Presence + broadcast, free tier, no server code |
| Vision | OpenCV.js (WASM) in a Worker | Contour detection and ORB, off the main thread |
| OCR | tesseract.js | Title reading, main thread, heavily gated (see below) |
| Hosting | Vercel | Auto-deploys `main`; static files only |

Dependencies are deliberately few: `react`, `react-dom`, `@supabase/supabase-js`,
`tesseract.js`, `lucide-react`. OpenCV loads at runtime from `docs.opencv.org`.

## Source layout

```
src/
  main.jsx              entry; routes /snaptest (lazy-loaded) vs the app
  App.jsx               Lobby ↔ Game switch, theme
  Lobby.jsx             create/join, device pick, index readiness
  Game.jsx              video tiles, life, turns, chat, dice, capture clicks
  CardSidebar.jsx       results panel + ?debug=1 diagnostics
  webrtc.js             mesh, data channels, capture request/response
  signaling.js          Supabase Realtime room join, room codes
  captureGeometry.js    crop maths shared by production and the benchmark
  cardSearch.js         local name autocomplete
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

`api/turn-credentials.js` is the sole Vercel function. It keeps the Cloudflare
TURN key server-side and issues 12-hour credentials after a same-origin,
room-code-shaped request. It filters out Cloudflare's browser-blocked port 53
URLs and returns UDP, TCP/80, TLS/5349 and TLS/443 options. A best-effort
per-IP/room rate limit reduces casual credential abuse; production usage should
also be watched in Cloudflare Realtime analytics.
`await window.__scTestTurn()` performs a relay-only ICE gathering check without
opening media devices and reports only candidate counts/protocols, never the
short-lived credential. `/turntest` exposes the same safe result as a small
production health page.

## The card index

Built by `scripts/build_index.py`, run by the **Build card index** GitHub
Action (monthly, or manually), which commits the result to `main`. Version 4,
currently **110,524 printings / 35,026 names / 256 shards**.

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

- **Room codes** are 6 characters from `crypto.getRandomValues` (~887M). A code
  is the only thing protecting a game, so it must not be guessable.
- **Roles**: up to 4 `player`s (camera + mic) and up to 8 `visitor`s (audio
  only, cannot be captured, cannot change game state).
- **Two transports, one authorisation model.** Supabase broadcast carries game
  state (life, commander, turn, chat) and gates every privileged message on
  sender role. WebRTC data channels carry capture requests and apply the same
  rule — a visitor cannot request a capture, requests are rate limited per
  peer, and every peer-controlled field is bounds-checked.
- **Capture is never silent.** When a peer photographs your camera you see
  "<name> scanned your board" on your own tile.

## Security posture

- Camera stills use the encrypted WebRTC data channel. They travel directly
  when possible or through Cloudflare TURN when relaying is required; TURN
  stores neither the still nor the live stream.
- CSP, HSTS, `Permissions-Policy` (camera/mic scoped to self),
  `X-Frame-Options: DENY`, nosniff and a referrer policy are set in
  `vercel.json`.
- No `dangerouslySetInnerHTML`, `innerHTML` or `eval` anywhere in `src/`.
- The Cloudflare TURN key is held only in server-side Vercel environment
  variables. Browsers receive expiring credentials, never the key itself.
- The Supabase key is publishable. Realtime handles the game; opt-in
  recognition reports use a private Storage bucket plus a write-only table and
  token-scoped labeling function from `supabase/migrations/`. There is still
  no app server and no live video upload.

## Conventions

- `main` is the only branch and auto-deploys. Confirm a deploy via the
  commit's GitHub status before claiming something is live.
- Bump the `BUILD` marker in `main.jsx` on every recognition change so
  stale-cache confusion is immediately visible in the console.
- UI copy is sentence case; functional values like room codes stay uppercase.
- Panel forms reuse the Settings field pattern (14px secondary labels, 8px
  label-to-control spacing, 34px controls, 8px radii, shared tokens).
