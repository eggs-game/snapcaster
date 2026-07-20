# Snapcaster

A SpellTable-style web app for playing paper Magic: The Gathering remotely — with card recognition that actually works. Runs entirely on free hosting: Vercel (site), Supabase (multiplayer signaling), GitHub Actions (card index builder). No terminal required.

## Why it beats SpellTable at recognition

- **Every English paper printing indexed** — built from Scryfall bulk data: alternate arts, basic lands, showcase frames, promos, and Secret Lairs.
- **High-res capture** — clicking a card on an opponent's video makes *their* browser photograph it from their local camera at full resolution and send the crop over a peer-to-peer channel. Recognition never runs on the compressed video stream.
- **Low light** — every lookup is matched raw *and* contrast-normalized; best score wins.
- **Tilted cameras and tapped cards** — the card outline is detected, perspective-corrected, and matched at all 4 rotations.

## Deploy (all in the browser, ~15 minutes of clicking + one long wait)

### Step 1 — Put the code on GitHub

1. Create a free account at [github.com](https://github.com) if you don't have one.
2. Click **+** (top right) → **New repository** → name it `snapcaster`, keep it **Public** (or Private, both fine) → **Create repository**.
3. On the new repo page click **uploading an existing file**, then drag **the contents of this folder** (all files and folders inside `snapcaster-web`, not the folder itself) into the upload area. Commit.
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

### Step 4 — Deploy on Vercel

1. Sign up at [vercel.com](https://vercel.com) **with your GitHub account**.
2. **Add New → Project** → Import your `snapcaster` repo.
3. Before clicking Deploy, expand **Environment Variables** and add:
   - `VITE_SUPABASE_URL` = your Project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon key
4. **Deploy.** Done — you get a URL like `https://snapcaster.vercel.app`.

If you ran the index build *after* deploying, go to Vercel → your project → **Deployments** → ⋯ → **Redeploy** so the site picks up the new index.

### Step 5 — Play

Open your URL, allow camera + mic, **Create game**, send the 4-letter code to up to 3 friends. Click any card on any video to identify it.

## Notes

- **Fast at full scale:** the browser loads a compact name dictionary, then downloads only the small printing shard for the OCR-matched card. It never scans the complete 96,000+ printing index on each click.
- **Strict NATs:** WebRTC is peer-to-peer; a small % of home networks need a TURN relay. Free option: [metered.ca TURN](https://www.metered.ca/tools/openrelay/) — add `VITE_TURN_URL`, `VITE_TURN_USER`, `VITE_TURN_PASS` env vars in Vercel and redeploy.
- **New sets** are picked up by the monthly automatic index rebuild (or run the Action manually).
- Card data and images © Wizards of the Coast, via [Scryfall](https://scryfall.com) under the WotC Fan Content Policy. Unofficial fan project.

## Local development (optional)

```bash
npm install
npm run dev          # needs VITE_SUPABASE_* in a .env.local file
python scripts/build_index.py --query "set:otj"   # small local index
```


## Development handoff — July 19, 2026

Context for any tool or agent continuing work on this project. Everything below
is deployed and verified in production.

### State

- **Production:** <https://snapcaster.vercel.app> — deploys automatically on
  every push to `main` (Vercel GitHub integration). `main` is the only branch;
  the commander-banner feature branch is merged and deleted.
- **Repo:** `eggs-game/snapcaster` on GitHub.
- **Env vars (Vercel project):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
  (Supabase Realtime is the only backend; no server code).
- **Card index:** v2 sharded format, **110,451 printings / 34,996 names /
  256 shards** (`public/carddata/manifest.json`). Rebuilt monthly by the
  `Build card index` GitHub Action, which commits results to `main`.
  - Workflow gotcha: the manual `scope` input is interpolated into bash
    unquoted-safe only — card names containing quotes/apostrophes break it.
    Use Scryfall regex syntax instead, e.g. `name:/offer.you.can/`.

### Design system

- UI headings and labels use sentence case; do not style interface copy in all
  caps. Functional values such as room codes may remain uppercase.
- Panel forms reuse the Settings field pattern: 14px regular secondary labels,
  8px label-to-control spacing, 34px controls, 8px corner radii, and the shared
  surface, border, focus, and disabled tokens. Do not create bespoke field
  treatments for individual panels.

### Card recognition pipeline (src/recognition/ + src/webrtc.js)

A click on any video runs these stages in order; the sidebar shows per-stage
diagnostics for every scan.

1. **Capture** (`webrtc.js · captureLocalFrame`) — native-resolution crop
   centered on the clicked point (never downscaled; the old code shrank frames
   to 1280px and destroyed small cards). Takes the sharpest of 3 frames
   (gradient-variance ranking) to dodge motion blur. Camera is requested at up
   to 4K. Remote captures run the same function on the *owner's* browser and
   return over a WebRTC data channel; the click point always maps to the crop
   center, so downstream uses `{nx: 0.5, ny: 0.5}`.
2. **Candidate crops** (`recognizer.js`, Web Worker) — OpenCV contour quads
   (up to 8, perspective-rectified near native resolution, capped `OCR_MAX_W`),
   click-centered crops at 5 scales, and counter-rotated crops at ±20°/±40°
   for tilted cards (90° steps are covered by hash rotations, so tapped cards
   work).
3. **Hash ranking** — every candidate is scored against **all** printings
   (pHash+dHash, 8 variants: raw/contrast-stretched × 4 rotations; early exit
   at distance ≤ 60). The global `hashes.bin` (7 MB) loads eagerly in the
   worker — this ranking was silently disabled for the sharded index at one
   point and recognition quality collapsed; do not regress it.
4. **Art verification** (`verifyTopMatches`) — fetches the real Scryfall
   images for the top 12 guesses and ORB-matches keypoints (RANSAC homography
   inliers) between the query crop and each reference. Correct card ≈ 20–190
   agreeing keypoints; wrong card < 12. Decisive (≥16 inliers and 1.5× the
   runner-up) settles identity as `identified_by: "art-match"` and skips OCR.
5. **Title OCR** (`matcher.js`, main thread, tesseract.js) — reads title
   strips (plain + illumination-flattened variants for glare/low light) upright
   first across all candidates. Acceptance scales with name length (≥12 chars:
   0.74, ≥8: 0.88, else 0.95); 1–3 letter names require an exact read. Names
   that normalize to empty (Unhinged's "_____") are skipped — they used to
   perfect-score every read.
6. **Result UI** (`CardSidebar.jsx`) — confident results show as Art/Title
   match; anything weaker shows ranked "Best guesses" thumbnails the player
   can click. Matches survive to hash distance ≤ 210 (real correct scans land
   170–205; unrelated cards 220+). Never silently discard the ranked list.

### Verified behavior (live production tests via `window.__scIdentifyUrl`)

- Windfall @ 220px, busy background: #1, art check 176 keypoints (runner-up 10).
- Windfall @ 180px tilted 30°: #1, art check 190 keypoints.
- Full Throttle @ 120–240px, tilted ±25–35°, sideways 90°: #1 at distances
  10–36.

### Debugging conveniences

- `main.jsx` logs a `BUILD` marker to the console — bump it on every
  recognition change so stale-cache confusion is instantly visible.
- `window.__scIdentifyUrl(imageUrl, {nx, ny})` runs the full pipeline on any
  image URL from the browser console — no camera needed.
- The sidebar renders the exact preprocessed title strip OCR saw.

### Known limits / next ideas

- Physics: a 20-card playmat on a 720p camera leaves too few pixels per card;
  1080p is borderline, 4K comfortable. The pipeline no longer wastes any
  captured pixels, but it cannot invent them.
- First scan after page load takes a few extra seconds (OpenCV WASM + 7 MB
  index warm in the background; worker preloads on game mount).
- OpenCV.js loads from docs.opencv.org — could be self-hosted/pinned.
- Possible index enrichment (needs a bulk rebuild): per-printing art-region
  hash and border color histogram for an even stronger first-stage ranking.

### Commander banner (merged)

Translucent banner over each occupied video tile; the local player types their
commander (Scryfall autocomplete), synced to all players via Supabase
signaling and rebroadcast on roster changes. The banner is outside the video
click target, so it never triggers card recognition.
