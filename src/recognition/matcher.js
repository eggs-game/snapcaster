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

function runOnWorker(bmp) {
  const w = getWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Card recognition timed out. Please try again."));
    }, IDENTIFY_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    w.postMessage({ type: "identify", id, bmp }, [bmp]);
  });
}

export async function identify(imageDataUrl) {
  const bmp = await dataUrlToBitmap(imageDataUrl);
  return runOnWorker(bmp);
}

// Console debug hook: `await window.__scIdentifyUrl("<card image url>")`
// runs a full recognition on a fetched image (no camera needed).
if (typeof window !== "undefined") {
  window.__scIdentifyUrl = async (url) => {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.crossOrigin = "anonymous";
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const bmp = await createImageBitmap(img);
    const r = await runOnWorker(bmp);
    console.log("[snapcaster] __scIdentifyUrl top matches:", r.matches.map((m) => `${m.name} (d=${m.distance}, conf=${m.confidence.toFixed(2)})`));
    return r;
  };
}
