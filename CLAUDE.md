# Snapcaster — agent context

Read **README.md § "Development handoff — July 19, 2026"** first; it is the
authoritative, up-to-date description of the architecture, the recognition
pipeline, verified behavior, and known limits.

Quick facts:

- Production: https://snapcaster.vercel.app — auto-deploys on every push to
  `main` (the only branch). Verify deploys via the commit's GitHub status
  ("Vercel" context) before telling anyone something is live.
- Stack: Vite + React, Supabase Realtime (signaling only), WebRTC 4-player
  mesh, recognition in a Web Worker (OpenCV.js + pHash/dHash + ORB art
  verification) with tesseract.js title OCR on the main thread.
- Card index: `public/carddata/` v2 sharded (110k printings), rebuilt by the
  "Build card index" GitHub Action (monthly + manual). Committed to `main` by
  the workflow itself.
- No local node/npm assumed on dev machines — pushes build on Vercel.
  Verify recognition changes against the live site with
  `window.__scIdentifyUrl(imageUrl)` from the browser console (full pipeline,
  no camera), using degraded/tilted test images to simulate webcam reality.
- Bump the `BUILD` marker in `src/main.jsx` on every recognition change so
  browser-cache confusion is immediately diagnosable.
- Hashing in `src/recognition/recognizer.js` and `hash.js` must stay
  bit-compatible with `scripts/build_index.py` — change both or neither.
