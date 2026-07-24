# Snapcast

A SpellTable-style web app for playing paper Magic: The Gathering remotely —
with card recognition that actually works. Runs entirely on free hosting:
Vercel (site), Supabase (multiplayer signaling), GitHub Actions (card index
builder). No terminal required.

**Live:** <https://snapcast.app>

## Documentation

| Doc | Read it for |
| --- | --- |
| [docs/why.md](docs/why.md) | Why this exists, what problem it solves, what "working" means |
| [docs/architecture.md](docs/architecture.md) | How the app is put together — stack, files, index, multiplayer, security |
| [docs/recognition.md](docs/recognition.md) | How a click becomes a card name in ~1.6s across 110k printings |
| [docs/testing.md](docs/testing.md) | SNAPTEST — how we prove it works and avoid fooling ourselves |
| [docs/metadata-recognition.md](docs/metadata-recognition.md) | How v4 mana/type/text evidence will be measured and introduced |
| [docs/design-system.md](docs/design-system.md) | Shared UI tokens and patterns — colors, spacing, radii, tiny buttons |

## Why it beats SpellTable at recognition

- **Every English paper printing indexed** — built from Scryfall bulk data:
  alternate arts, basic lands, showcase frames, promos, Secret Lairs.
- **High-res capture** — clicking a card on an opponent's video makes *their*
  browser photograph it from their local camera at full resolution and send
  the crop peer-to-peer. Recognition never runs on the compressed stream.
- **Low light** — every lookup is matched raw *and* contrast-normalised, and
  white-balanced to strip the room's colour cast.
- **Tilted cameras, tapped and inverted cards** — outlines are detected and
  perspective-corrected, and crops are generated for sideways and upside-down
  cards specifically.

## Deploy (all in the browser, ~15 minutes of clicking + one long wait)

### Step 1 — Put the code on GitHub

1. Create a free account at [github.com](https://github.com) if you don't have one.
2. Click **+** (top right) → **New repository** → name it `snapcast`, keep it **Public** (or Private, both fine) → **Create repository**.
3. On the new repo page click **uploading an existing file**, then drag **the contents of this folder** (all files and folders inside `snapcast-web`, not the folder itself) into the upload area. Commit.
   - If your browser won't upload the `.github` folder by drag-and-drop: in the repo click **Add file → Create new file**, type `.github/workflows/build-index.yml` as the name, paste the contents of that file from this folder, and commit.

### Step 2 — Build the card index (automatic)

1. In your repo, open the **Actions** tab → enable workflows if asked.
2. Click **Build card index** (left sidebar) → **Run workflow**.
   - For a quick test type `set:otj` in the box (≈5 min, one set).
   - For the real thing leave it as `bulk` — every printing ever (runs ~3–4 hours, do it once, then it refreshes itself monthly).
3. When it finishes, the index is committed to the repo automatically.

### Step 3 — Create the (free) multiplayer backend

1. Sign up at [supabase.com](https://supabase.com) → **New project** (any name/region, free plan).
2. When it's ready: **Project Settings → API**. Copy two values:
   - **Project URL** (like `https://abcd1234.supabase.co`)
   - **anon public** API key

### Step 4 — Enable recognition reports

In Supabase, open **SQL Editor** and run
[`supabase/migrations/20260722153000_recognition_reports.sql`](supabase/migrations/20260722153000_recognition_reports.sql).
It creates the private evidence bucket and report table used by the in-game
**Wrong card** button. Reports are write-only from the app; review and curate
them in the Supabase dashboard.

### Step 5 — Deploy on Vercel

1. Sign up at [vercel.com](https://vercel.com) **with your GitHub account**.
2. **Add New → Project** → Import your `snapcast` repo.
3. Before clicking Deploy, expand **Environment Variables** and add:
   - `VITE_SUPABASE_URL` = your Project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon key
   - `CLOUDFLARE_TURN_KEY_ID` = the UID of a Cloudflare Realtime TURN key
   - `CLOUDFLARE_TURN_KEY_TOKEN` = that TURN key's secret bearer token
4. **Deploy.** Done — you get a URL like `https://snapcast.vercel.app`,
   then connect a custom domain (e.g. `snapcast.app`) in Vercel's Domains
   settings if you have one.

The two Cloudflare values are server-only Vercel variables: never prefix them
with `VITE_`. Snapcast's `/api/turn-credentials` function exchanges them for
12-hour credentials when a player enters a game. The browser never receives
the long-lived TURN key. Create a production TURN key in **Cloudflare Dashboard
→ Realtime → TURN**, then redeploy after adding both variables.

Optional usage monitoring requires two additional server-only variables:
`CLOUDFLARE_ACCOUNT_ID` and a `CLOUDFLARE_ANALYTICS_API_TOKEN` limited to
**Account Analytics: Read**. `/api/turn-usage` then reports only aggregate
current-month TURN ingress/egress and allowance percentages; it never returns
the account ID or API token.

If you ran the index build *after* deploying, go to Vercel → your project → **Deployments** → ⋯ → **Redeploy** so the site picks up the new index.

### Step 6 — Play

Open your URL, allow camera + mic, **Create game**, send the 6-character code
to up to 3 friends. Click any card on any video to identify it. Players and
visitors can use chat; type `/` and choose **/whisper**, then select an
autocompleted `@name` to send that person a private, distinctly styled message.
Whispers use the encrypted peer data channel and are never posted to the
room-wide chat broadcast.

## Notes

- **Fast at full scale:** the main thread loads only a 0.67 MB name dictionary; the recognition worker keeps the hash index resident and scans it with a coarse-to-fine strategy rather than brute-forcing all 110,524 printings for every candidate crop. See [docs/recognition.md](docs/recognition.md).
- **Strict NATs and VPNs:** WebRTC prefers a direct peer connection, then falls
  back to Cloudflare Realtime TURN over UDP, TCP, or TLS/443. Cloudflare's TURN
  key stays in the server-side Vercel function; only expiring credentials reach
  a player's browser. Inspect `window.__SNAP_TURN_STATUS` when diagnosing a
  connection (`ready` means relay credentials loaded; `fallback` means only
  direct/STUN connectivity is available). Run `await window.__scTestTurn()` in
  production devtools to gather a relay-only candidate without using the
  camera or microphone, or open `/turntest` for the same credential-safe check.
- **New sets** are picked up by the monthly automatic index rebuild (or run the Action manually).
- Card data and images © Wizards of the Coast, via [Scryfall](https://scryfall.com) under the WotC Fan Content Policy. Unofficial fan project.

## Local development (optional)

```bash
npm install
npm run dev          # needs VITE_SUPABASE_* in a .env.local file
python scripts/build_index.py --query "set:otj"   # small local index
```
