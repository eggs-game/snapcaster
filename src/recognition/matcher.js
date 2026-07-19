// Card identification front-end. The heavy lifting (OpenCV outline detection +
// perspective rectify, perceptual hashing, Hamming search) runs in a Web Worker
// (./recognizer.js) so the ~10 MB OpenCV WASM compile never freezes the UI.
// This module only: (1) loads the index once for the lobby's "N printings" banner,
// and (2) captures crops and relays them to the worker.
import { VEC_BYTES } from "./hash.js";

let cards = null;
let loadPromise = null;

// Lightweight index load, used only for the lobby's readiness banner/count.
export function loadIndex() {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const [hRes, cRes] = await Promise.all([fetch("/carddata/hashes.bin"), fetch("/carddata/cards.json")]);
    if (!hRes.ok || !cRes.ok) throw new Error("Card index not found — run the 'Build card index' GitHub Action, then redeploy.");
    const indexData = new Uint8Array(await hRes.arrayBuffer());
    cards = await cRes.json();
    if (indexData.length !== cards.length * VEC_BYTES) throw new Error("Card index is corrupted — rebuild it.");
    return cards.length;
  })();
  return loadPromise;
}

export function indexSize() { return cards ? cards.length : 0; }

// Warm the worker (and thus OpenCV + the index inside it) ahead of the first
// click, e.g. when a game screen mounts, so recognition is ready sooner.
export function preload() {
  getWorker();
  return loadIndex();
}

// ---------- recognition worker plumbing ----------
let worker = null;
let seq = 0;
const pending = new Map();
const IDENTIFY_TIMEOUT_MS = 30000;

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL("./recognizer.js", import.meta.url));
    worker.onmessage = (e) => {
      const { id, matches, cardFound, cvStatus, candidatesTried, error } = e.data || {};
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      clearTimeout(p.timer);
      if (error) p.reject(new Error(error));
      else p.resolve({
        matches: matches || [],
        card_found: !!cardFound,
        cv_status: cvStatus || "unknown",
        candidates_tried: candidatesTried || 0,
      });
    };
    worker.onerror = (e) => {
      const err = new Error(e.message || "recognition worker crashed");
      for (const [, p] of pending) {
        clearTimeout(p.timer);
        p.reject(err);
      }
      pending.clear();
    };
  }
  return worker;
}

async function dataUrlToBitmap(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  return await createImageBitmap(blob);
}

function runOnWorker(bmp, point = { nx: 0.5, ny: 0.5 }) {
  const w = getWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Card recognition timed out. Please try again."));
    }, IDENTIFY_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    w.postMessage({ type: "identify", id, bmp, point }, [bmp]);
  });
}

export async function identify(imageDataUrl, point) {
  const bmp = await dataUrlToBitmap(imageDataUrl);
  return runOnWorker(bmp, point);
}

// Merge several nearby camera frames. A name must appear in a majority of
// frames before it is allowed into the result list; this removes unstable
// one-frame nearest neighbours caused by glare, autofocus, and motion.
export function combineRecognitionResults(results) {
  const valid = results.filter(Boolean);
  if (!valid.length) return { matches: [], card_found: false, cv_status: "unknown", scan_count: 0 };

  const byName = new Map();
  valid.forEach((result, frameIndex) => {
    (result.matches || []).forEach((match, rank) => {
      let entry = byName.get(match.name);
      if (!entry) {
        entry = { frames: new Set(), rankScore: 0, distanceSum: 0, best: match };
        byName.set(match.name, entry);
      }
      if (entry.frames.has(frameIndex)) return;
      entry.frames.add(frameIndex);
      entry.rankScore += Math.max(1, 5 - rank);
      entry.distanceSum += match.distance;
      if (match.distance < entry.best.distance) entry.best = match;
    });
  });

  const requiredFrames = Math.floor(valid.length / 2) + 1;
  const stable = [...byName.values()]
    .filter((entry) => entry.frames.size >= requiredFrames)
    .map((entry) => {
      const distance = Math.round(entry.distanceSum / entry.frames.size);
      return {
        ...entry.best,
        distance,
        confidence: Math.max(0, Math.min(1, (230 - distance) / 140)),
        consensus: entry.frames.size,
      };
    })
    .sort((a, b) => {
      const ea = byName.get(a.name), eb = byName.get(b.name);
      return eb.frames.size - ea.frames.size
        || eb.rankScore - ea.rankScore
        || a.distance - b.distance;
    })
    .slice(0, 5);

  return {
    matches: stable,
    card_found: valid.filter((result) => result.card_found).length >= requiredFrames,
    cv_status: valid.every((result) => result.cv_status === "ready") ? "ready" : valid[0].cv_status,
    candidates_tried: Math.max(...valid.map((result) => result.candidates_tried || 0)),
    scan_count: valid.length,
  };
}

// Console debug hook: `await window.__scIdentifyUrl("<card image url>")`
// runs a full recognition on a fetched image (no camera needed).
if (typeof window !== "undefined") {
  window.__scIdentifyUrl = async (url, point = { nx: 0.5, ny: 0.5 }) => {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.crossOrigin = "anonymous";
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const bmp = await createImageBitmap(img);
    const r = await runOnWorker(bmp, point);
    console.log("[snapcaster] __scIdentifyUrl top matches:", r.matches.map((m) => `${m.name} (d=${m.distance}, conf=${m.confidence.toFixed(2)})`));
    return r;
  };
}
