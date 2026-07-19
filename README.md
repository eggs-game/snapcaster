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

## Development handoff — July 18, 2026

This section records the current project state so work can continue from
Cursor, Claude Code, or another development tool without losing context.

### Repository and deployment state

- Production site: <https://snapcaster.vercel.app>
- Production branch: `main`
- Active feature branch: `feature/commander-banner`
- Production Supabase configuration is working. Vercel Preview deployments
  also need `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` enabled for the
  **Preview** environment if multiplayer needs to be tested there.
- Do not merge `feature/commander-banner` into `main` until the initial bulk
  card-index workflow finishes. The running workflow was checked out from
  `main` commit `65fd90b`; advancing `main` can make its final index push fail.

### Card recognition work completed

- OpenCV runs in a Web Worker so contour detection does not freeze the UI.
- The OpenCV/Emscripten loader handles its non-native Promise/thenable and has
  bounded startup waits instead of leaving the UI on “Identifying…” forever.
- Camera clicks capture the complete high-resolution frame. The click position
  is sent separately and is used to prioritize the intended card outline.
- Outline detection tries multiple edge thresholds, contour modes, polygon
  approximations, convex hull/min-area rectangles, and up to eight plausible
  card quadrilaterals.
- Detected cards are perspective-corrected and checked at multiple rotations,
  including strongly angled and foreshortened cards.
- Title OCR uses Tesseract and fuzzy matching against indexed card names.
  Multiple rectified candidates and 0/90/180/270-degree title rotations are
  tested. Short names such as Forest require stricter confidence.
- Weak scans are suppressed rather than displaying unrelated cards. A visual
  result is only shown when the outline and distance are credible.
- Diagnostics report OpenCV state, outline state, strategy, distance, OCR text,
  OCR confidence, and candidate count.

Representative local tests passed for:

- Taunt from the Rampart through OCR and exact-printing shard matching.
- Forest without the earlier short-name false positives.
- A stylized Secret Lair Felidar Retreat whose title OCR failed; the lazy
  visual fallback still selected SLD collector number 2378 at distance 9.

### Full Scryfall index architecture

The previous index had only 406 card faces and 280 names. The new builder uses
Scryfall `default_cards` and indexes every English paper printing—currently
about 96,000 print records, including basic lands, promos, alternate art,
showcase variants, and Secret Lairs.

Generated files under `public/carddata`:

- `manifest.json` — format version and counts.
- `names.json` — compact unique-name dictionary for OCR.
- `shards/00.json` through `shards/ff.json` — printing metadata and image
  hashes partitioned by normalized card name.
- `cards.json` and `hashes.bin` — lazy global visual fallback for cards with
  OCR-unfriendly title treatments.

Normal scans load only the name dictionary and one small shard after OCR finds
a title. The complete global index is downloaded only if OCR fails. This keeps
the browser responsive with every printing indexed.

`scripts/build_index.py`:

- Downloads current Scryfall bulk metadata.
- Filters out digital-only cards.
- Hashes new card faces concurrently while respecting Scryfall request rates.
- Reuses hashes by Scryfall ID and card face, so monthly updates process only
  new printings.
- Can produce a small test index with `--query` and an isolated output with
  `--out`.

`.github/workflows/build-index.yml`:

- Builds the full index on builder/workflow changes.
- Can be started manually with either `bulk` or a Scryfall search query.
- Refreshes automatically on the first day of every month.
- Commits generated card data to `main`, which triggers Vercel deployment.

At sign-off, workflow run
[29671250604](https://github.com/eggs-game/snapcaster/actions/runs/29671250604)
was `in_progress`. It is the one-time initial full build and may take several
hours.

### Commander banner feature

The unmerged `feature/commander-banner` branch contains:

- A semi-transparent blurred banner over the top of each occupied video feed.
- The local player sees an input whose placeholder is “Add commander”.
- Suggestions come from Scryfall autocomplete.
- Selecting a suggestion saves it immediately; Enter supports manual/Rule Zero
  choices.
- The chosen card name is synchronized through Supabase signaling and shown
  to all other players.
- Existing players rebroadcast their selection when the roster changes so
  late joiners receive it.
- The video click target remains separate from the banner, so using the input
  cannot accidentally start card recognition.

The latest branch commit at sign-off is `f0c9ddc`. Vercel automatically creates
a Preview deployment for this branch.

### Recommended next steps

1. Check workflow run `29671250604`.
2. If it succeeded, pull the generated `main` commit and verify
   `public/carddata/manifest.json` reports roughly 96,000 printings.
3. Rebase or merge `feature/commander-banner` onto the updated `main`.
4. Run `npm run build`.
5. Push `main`; wait for Vercel production deployment.
6. Test a two-player room for commander synchronization, then test Taunt,
   several Forest printings, and at least one stylized Secret Lair.

If the bulk workflow failed only at its final `git push`, preserve the generated
architecture and rerun the workflow after bringing `main` up to date.
