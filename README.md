# Snapcaster

A SpellTable-style web app for playing paper Magic: The Gathering remotely — with card recognition that actually works. Runs entirely on free hosting: Vercel (site), Supabase (multiplayer signaling), GitHub Actions (card index builder). No terminal required.

## Why it beats SpellTable at recognition

- **Every printing indexed** — built from Scryfall bulk data: all printings, alternate arts, showcase frames, promos.
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

- **First lookup is slower** (~10 MB of OpenCV + index loads in the background; cached after that).
- **Strict NATs:** WebRTC is peer-to-peer; a small % of home networks need a TURN relay. Free option: [metered.ca TURN](https://www.metered.ca/tools/openrelay/) — add `VITE_TURN_URL`, `VITE_TURN_USER`, `VITE_TURN_PASS` env vars in Vercel and redeploy.
- **New sets** are picked up by the monthly automatic index rebuild (or run the Action manually).
- Card data and images © Wizards of the Coast, via [Scryfall](https://scryfall.com) under the WotC Fan Content Policy. Unofficial fan project.

## Local development (optional)

```bash
npm install
npm run dev          # needs VITE_SUPABASE_* in a .env.local file
python scripts/build_index.py --query "set:otj"   # small local index
```
