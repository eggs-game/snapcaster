// Card identification front-end. The heavy lifting (OpenCV outline detection +
// perspective rectify, perceptual hashing, Hamming search) runs in a Web Worker
// (./recognizer.js) so the ~10 MB OpenCV WASM compile never freezes the UI.
// This module only: (1) loads the index once for the lobby's "N printings" banner,
// and (2) captures crops and relays them to the worker.
import { VEC_BYTES } from "./hash.js";
import { createWorker, PSM } from "tesseract.js";

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
  getOCRWorker().catch(() => {});
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
      const {
        id, matches, printingMatches, titleCandidates,
        cardFound, cvStatus, candidatesTried, error,
      } = e.data || {};
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      clearTimeout(p.timer);
      if (error) p.reject(new Error(error));
      else p.resolve({
        matches: matches || [],
        printing_matches: printingMatches || [],
        title_candidates: titleCandidates || [],
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

let ocrWorkerPromise = null;

function getOCRWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createWorker("eng").then(async (worker) => {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '-,",
      });
      return worker;
    });
  }
  return ocrWorkerPromise;
}

function normalizeTitle(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return prev[b.length];
}

function orderedTokenSimilarity(observed, target) {
  const sourceWords = observed.split(" ").filter(Boolean);
  const targetWords = target.split(" ").filter(Boolean);
  if (!sourceWords.length || !targetWords.length) return 0;
  const previous = new Float32Array(sourceWords.length + 1);
  for (const targetWord of targetWords) {
    const current = new Float32Array(sourceWords.length + 1);
    for (let j = 1; j <= sourceWords.length; j++) {
      const sourceWord = sourceWords[j - 1];
      const wordScore = 1 - editDistance(sourceWord, targetWord)
        / Math.max(sourceWord.length, targetWord.length);
      current[j] = Math.max(current[j - 1], previous[j - 1] + wordScore);
    }
    previous.set(current);
  }
  return previous[sourceWords.length] / targetWords.length;
}

function bestIndexedTitle(text) {
  const observed = normalizeTitle(text);
  if (observed.length < 4 || !cards) return null;
  const uniqueNames = new Set(cards.map((card) => card[0]));
  let best = null;
  for (const name of uniqueNames) {
    const target = normalizeTitle(name);
    let score;
    if (observed.includes(target)) score = 1;
    else {
      const wholeLine = 1 - editDistance(observed, target) / Math.max(observed.length, target.length);
      // OCR can repeat or hallucinate words around mana symbols and foil glare.
      // Match title words in order while allowing unrelated OCR tokens between
      // them: "Gaunt from ... the Rampart" still identifies Taunt correctly.
      score = Math.max(wholeLine, orderedTokenSimilarity(observed, target));
    }
    if (!best || score > best.score) best = { name, score };
  }
  return best;
}

function cardFromIndex(name) {
  const row = cards?.find((card) => card[0] === name);
  if (!row) return null;
  const [cardName, set, collectorNumber, id, face] = row;
  const side = face === 1 ? "back" : "front";
  return {
    name: cardName,
    set,
    collector_number: collectorNumber,
    image: `https://cards.scryfall.io/normal/${side}/${id[0]}/${id[1]}/${id}.jpg`,
    scryfall_uri: `https://scryfall.com/card/${set}/${collectorNumber}`,
    distance: 230,
    confidence: 0,
    strategy: "ocr-title",
  };
}

function suppressUnsafeVisualFallback(result) {
  const bestDistance = result.matches?.[0]?.distance ?? Infinity;
  return result.card_found && bestDistance <= 170 ? result : { ...result, matches: [] };
}

async function applyTitleOCR(result) {
  if (!result.title_candidates?.length) return suppressUnsafeVisualFallback(result);
  try {
    const worker = await getOCRWorker();
    let bestRead = null;
    search:
    for (const candidate of result.title_candidates) {
      for (let rotation = 0; rotation < candidate.images.length; rotation++) {
        const { data } = await worker.recognize(candidate.images[rotation]);
        const title = bestIndexedTitle(data.text);
        const read = {
          title,
          text: String(data.text || "").trim(),
          confidence: data.confidence || 0,
          rotation,
          strategy: candidate.strategy,
        };
        if (!bestRead || (title?.score || 0) > (bestRead.title?.score || 0)
          || ((title?.score || 0) === (bestRead.title?.score || 0) && read.confidence > bestRead.confidence)) {
          bestRead = read;
        }
        if ((title?.score || 0) >= 0.96 && read.confidence >= 45) break search;
      }
    }
    const title = bestRead?.title;
    const enriched = {
      ...result,
      ocr_text: bestRead?.text || "",
      ocr_confidence: bestRead?.confidence || 0,
      ocr_rotation: (bestRead?.rotation || 0) * 90,
      ocr_strategy: bestRead?.strategy || "",
      title_score: title?.score || 0,
    };
    if (!title) return suppressUnsafeVisualFallback(enriched);
    const normalized = normalizeTitle(title.name);
    const isShortSingleWord = !normalized.includes(" ") && normalized.length <= 8;
    // Short names such as Forest are easy accidental OCR matches and therefore
    // require near-exact text. Longer names tolerate camera substitutions such
    // as "Gaunt" or "Rarnpart".
    const requiredScore = isShortSingleWord ? 0.93 : 0.74;
    if (title.score < requiredScore || bestRead.confidence < 25) {
      return suppressUnsafeVisualFallback(enriched);
    }
    const printing = (result.printing_matches || [])
      .filter((match) => match.name === title.name)
      .sort((a, b) => a.distance - b.distance)[0]
      || cardFromIndex(title.name);
    if (!printing) return suppressUnsafeVisualFallback(enriched);
    return {
      ...enriched,
      matches: [{
        ...printing,
        confidence: Math.max(printing.confidence || 0, title.score),
        identified_by: "ocr-title",
      }],
    };
  } catch (error) {
    return suppressUnsafeVisualFallback({ ...result, ocr_error: String(error?.message || error) });
  }
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
  return applyTitleOCR(await runOnWorker(bmp, point));
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
    const r = await applyTitleOCR(await runOnWorker(bmp, point));
    console.log("[snapcaster] __scIdentifyUrl top matches:", r.matches.map((m) => `${m.name} (d=${m.distance}, conf=${m.confidence.toFixed(2)})`));
    return r;
  };
}
