# Snapcast — agent context

Start with the docs; they are the authoritative description of this project.

| Doc | Covers |
| --- | --- |
| [docs/why.md](docs/why.md) | Why the app exists, what "working" means, non-goals |
| [docs/architecture.md](docs/architecture.md) | Stack, file layout, card index, multiplayer, security |
| [docs/recognition.md](docs/recognition.md) | The identification pipeline, stage by stage |
| [docs/testing.md](docs/testing.md) | SNAPTEST — how to verify a change |
| [docs/design-system.md](docs/design-system.md) | Shared UI tokens and patterns — colors, spacing, radii, tiny buttons |
| [snaptest/results.md](snaptest/results.md) | Benchmark history with per-run analysis |

## Working agreements

- **Production:** <https://snapcast.app> (Vercel-hosted at
  `snapcaster.vercel.app`), auto-deploys on every push to `main` (the only
  branch). Confirm a deploy via the commit's GitHub status before telling
  anyone something is live.
- **No local node/npm** is assumed on dev machines — pushes build on Vercel.
  Verify recognition changes against the live site with
  `window.__scIdentifyUrl(imageUrl, {nx, ny})` from the browser console, which
  runs the full pipeline without a camera.
- **Bump the `BUILD` marker** in `src/main.jsx` on every recognition change so
  stale-cache confusion is immediately diagnosable.
- **Hashing is a cross-language contract.** `scripts/build_index.py`,
  `src/recognition/hash.js` and the duplicated copy inside
  `src/recognition/recognizer.js` must all agree bit-for-bit. CI enforces this
  via `test_hash_compat.py` and `check_hash_duplication.py`. Change all sides
  or none.
- **A crop must be a seed to introduce an answer.** Non-seed crops only refine
  the shortlist the seeds built, so adding a candidate crop without adding it
  to `SEED_PRIORITY` usually does nothing.
- **Keep `docs/design-system.md` in sync.** Any change to a shared UI token,
  size, color role, or reusable pattern (icon-button sizing, radius scale,
  modal shell, etc.) updates that doc in the same change. It documents intent
  (why a value is what it is), not just the current CSS, so it stays useful
  even as the stylesheet moves — a stale design doc is worse than none.

## Hard-won lessons

These cost real debugging time; do not relearn them.

- **Two runs of 100 differ by ~2 cards from noise alone.** Do not ship a fix on
  a 2-card movement, and do not build a story around one. This has already
  produced two changes that did nothing.
- **Verify, don't assume.** The most valuable findings here came from control
  experiments — cropping a card perfectly out of a scene to prove framing was
  the whole problem, and injecting a deliberate change to prove a CI check
  actually fails.
- **Check the benchmark before blaming the recogniser.** A 1st-half/2nd-half
  accuracy gap means the harness is degrading. A 1.5GB tab once reported 52MB
  of JS heap, because OpenCV's WASM heap is invisible to `performance.memory`.
- **A benchmark that cannot reproduce the failure cannot verify the fix.**
  SNAPTEST reported 97% on single centred cards while real scans were failing.
- **Fixing one rotation can break another.** Landscape crops took tapped cards
  from 42% to 97% and simultaneously regressed upside-down from 58% to 33%,
  because the new seeds displaced others. Check `byRotation` after any crop
  change.
