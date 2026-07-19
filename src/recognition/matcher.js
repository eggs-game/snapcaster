// Card identification front-end. The heavy lifting (OpenCV outline detection +
// perspective rectify, perceptual hashing, Hamming search) runs in a Web Worker
// (./recognizer.js) so the ~10 MB OpenCV WASM compile never freezes the UI.
// This module only: (1) loads the index once for the lobby's "N printings" banner,
// and (2) captures crops and relays them to the worker.
import { VEC_BYTES } from "./hash.js";
import { createWorker, PSM } from "tesseract.js";

let cards = null;
let cardNames = null;
let manifest = null;
let loadPromise = null;

// Lightweight index load, used only for the lobby's readiness banner/count.
export function loadIndex() {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const manifestResponse = await fetch("/carddata/manifest.json");
    if (manifestResponse.ok) {
      manifest = await manifestResponse.json();
      if (manifest.version === 2) {
        const namesResponse = await fetch("/carddata/names.json");
        if (!namesResponse.ok) throw new Error("Card name index is missing.");
        cardNames = await namesResponse.json();
        return manifest.count;
      }
    }
    const [hRes, cRes] = await Promise.all([fetch("/carddata/hashes.bin"), fetch("/carddata/cards.json")]);
    if (!hRes.ok || !cRes.ok) throw new Error("Card index not found — run the 'Build card index' GitHub Action, then redeploy.");
    const indexData = new Uint8Array(await hRes.arrayBuffer());
    cards = await cRes.json();
    cardNames = [...new Set(cards.map((card) => card[0]))];
    if (indexData.length !== cards.length * VEC_BYTES) throw new Error("Card index is corrupted — rebuild it.");
    return cards.length;
  })();
  return loadPromise;
}

export function indexSize() { return manifest?.count || cards?.length || 0; }

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
        id, matches, printingMatches, titleCandidates, queryCandidates, shardedIndex,
        cardFound, cvStatus, candidatesTried, artBest, artChecked, artDecisive, error,
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
        query_candidates: queryCandidates || [],
        sharded_index: !!shardedIndex,
        card_found: !!cardFound,
        cv_status: cvStatus || "unknown",
        candidates_tried: candidatesTried || 0,
        art_best: artBest || null,
        art_checked: artChecked || 0,
        art_decisive: !!artDecisive,
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
  if (observed.length < 4 || !cardNames) return null;
  let best = null;
  for (const name of cardNames) {
    const target = normalizeTitle(name);
    // Joke cards like Unhinged's "_____" normalize to an empty string, and
    // "anything".includes("") is always true — it would perfect-score every
    // read. Tiny names ("Ow", "Fog", "X") also substring-match into unrelated
    // text too easily, so only 4+ char names get the includes shortcut.
    if (!target) continue;
    // 1-3 letter names ("Ow", "Fog", "X") match stray OCR tokens far too
    // easily even through the token-similarity path — require the entire read
    // to be exactly that name.
    if (target.length < 4) {
      if (observed === target && (!best || best.score < 1)) best = { name, score: 1 };
      continue;
    }
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

const shardCache = new Map();
const POPCOUNT = new Uint8Array(256);
for (let i = 0; i < 256; i++) POPCOUNT[i] = (i & 1) + POPCOUNT[i >> 1];

function shardKey(name) {
  const normalized = normalizeTitle(name);
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash & 0xff).toString(16).padStart(2, "0");
}

function decodeHash(value) {
  const binary = atob(value);
  const output = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) output[i] = binary.charCodeAt(i);
  return output;
}

async function loadShard(name) {
  const key = shardKey(name);
  if (!shardCache.has(key)) {
    shardCache.set(key, fetch(`/carddata/shards/${key}.json`).then((response) => {
      if (!response.ok) throw new Error(`Card shard ${key} is missing.`);
      return response.json();
    }));
  }
  return shardCache.get(key);
}

async function matchShardedPrinting(name, result, strategy) {
  const shard = await loadShard(name);
  const rows = shard.filter((row) => row[0] === name);
  if (!rows.length) return null;
  let querySets = (result.query_candidates || []).filter((candidate) => candidate.strategy === strategy);
  if (!querySets.length) querySets = result.query_candidates || [];
  let best = null;
  for (const row of rows) {
    const indexed = decodeHash(row[5]);
    let distance = 0xffff;
    for (const candidate of querySets) {
      for (const query of candidate.vectors || []) {
        let current = 0;
        for (let i = 0; i < VEC_BYTES; i++) current += POPCOUNT[indexed[i] ^ query[i]];
        if (current < distance) distance = current;
      }
    }
    if (!best || distance < best.distance) best = { row, distance };
  }
  const [cardName, set, collectorNumber, id, face] = best.row;
  const side = face === 1 ? "back" : "front";
  return {
    name: cardName,
    set,
    collector_number: collectorNumber,
    image: `https://cards.scryfall.io/normal/${side}/${id[0]}/${id[1]}/${id}.jpg`,
    scryfall_uri: `https://scryfall.com/card/${set}/${collectorNumber}`,
    distance: best.distance,
    confidence: Math.max(0, Math.min(1, (230 - best.distance) / 140)),
    strategy: strategy || "ocr-title",
  };
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

// Real webcam scans of the CORRECT card commonly land at distance 170–205
// (unrelated cards sit around 220+), so never discard the ranked list below
// 210 — show it as ranked guesses and let the player click the right card.
// Distances above that are genuine noise and would only mislead.
const VISUAL_KEEP = 210;

function suppressUnsafeVisualFallback(result) {
  const bestDistance = result.matches?.[0]?.distance ?? Infinity;
  return bestDistance <= VISUAL_KEEP ? result : { ...result, matches: [] };
}

async function applyVisualFallback(result) {
  // The worker now ranks every candidate (outline, center, tilt) against the
  // full printing index, so a populated list is already the best available —
  // the legacy re-search below only samples a subset of candidates.
  if (result.matches?.length) return suppressUnsafeVisualFallback(result);
  if (!result.sharded_index || !result.card_found) return suppressUnsafeVisualFallback(result);
  try {
    const fallback = await runVisualFallback(result.query_candidates);
    const merged = {
      ...result,
      matches: fallback.matches,
      printing_matches: fallback.printing_matches,
    };
    return (merged.matches?.[0]?.distance ?? Infinity) <= VISUAL_KEEP
      ? merged
      : { ...merged, matches: [] };
  } catch (error) {
    return { ...result, matches: [], visual_fallback_error: String(error?.message || error) };
  }
}

// Object URL of the title strip the best OCR read actually saw, shown in the
// sidebar so bad reads are diagnosable at a glance. Previous URL is revoked on
// each new lookup to avoid leaking blobs.
let lastOcrDebugUrl = null;
function ocrDebugUrl(blob) {
  if (lastOcrDebugUrl) { URL.revokeObjectURL(lastOcrDebugUrl); lastOcrDebugUrl = null; }
  if (blob) lastOcrDebugUrl = URL.createObjectURL(blob);
  return lastOcrDebugUrl || "";
}

async function applyTitleOCR(result) {
  if (!result.title_candidates?.length) return applyVisualFallback(result);
  try {
    const worker = await getOCRWorker();
    let bestRead = null;
    const reads = [];
    const runRead = async (image, rotation, strategy, flat) => {
      const { data } = await worker.recognize(image);
      const title = bestIndexedTitle(data.text);
      const read = {
        title,
        text: String(data.text || "").trim(),
        confidence: data.confidence || 0,
        rotation,
        strategy,
        image,
        flat,
      };
      reads.push(read);
      if (!bestRead || (title?.score || 0) > (bestRead.title?.score || 0)
        || ((title?.score || 0) === (bestRead.title?.score || 0) && read.confidence > bestRead.confidence)) {
        bestRead = read;
      }
      return (title?.score || 0) >= 0.96 && read.confidence >= 45;
    };
    // Cards are usually upright in frame, so try every candidate upright (then
    // upside-down for players across the table) before the sideways rotations,
    // instead of burning 4 rotations on one candidate at a time.
    const attempts = [];
    for (const rotation of [0, 2, 1, 3]) {
      for (const candidate of result.title_candidates) {
        if (candidate.images?.[rotation]) {
          attempts.push({
            image: candidate.images[rotation],
            flat: candidate.imagesFlat?.[rotation],
            rotation,
            strategy: candidate.strategy,
          });
        }
      }
    }
    search:
    for (const attempt of attempts.slice(0, 24)) {
      if (await runRead(attempt.image, attempt.rotation, attempt.strategy, attempt.flat)) break search;
    }
    // Glare / low-light retry: if nothing read convincingly, re-run the most
    // promising reads on their illumination-flattened strips.
    if ((bestRead?.title?.score || 0) < 0.82) {
      const promising = [...reads]
        .sort((a, b) => (b.title?.score || 0) - (a.title?.score || 0) || b.confidence - a.confidence)
        .slice(0, 3);
      for (const read of promising) {
        if (!read.flat) continue;
        if (await runRead(read.flat, read.rotation, `${read.strategy}+flat`, null)) break;
      }
    }
    const title = bestRead?.title;
    const enriched = {
      ...result,
      ocr_text: bestRead?.text || "",
      ocr_confidence: bestRead?.confidence || 0,
      ocr_rotation: (bestRead?.rotation || 0) * 90,
      ocr_strategy: bestRead?.strategy || "",
      ocr_image: ocrDebugUrl(bestRead?.image),
      title_score: title?.score || 0,
    };
    if (!title) return applyVisualFallback(enriched);
    const normalized = normalizeTitle(title.name);
    // Acceptance scales with how much evidence the name can carry: garbage
    // reads like "men ow" trivially reach high scores against tiny names
    // ("Ow"), and "at mr a pon" scored 0.75 against "A-Town". Short names must
    // be read near-exactly; only genuinely long names may tolerate the fuzzy
    // camera substitutions ("Gaunt from the Rarnpart").
    const requiredScore = normalized.length >= 12 ? 0.74 : normalized.length >= 8 ? 0.88 : 0.95;
    if (title.score < requiredScore || bestRead.confidence < 25) {
      return applyVisualFallback(enriched);
    }
    const printing = result.sharded_index
      ? await matchShardedPrinting(title.name, result, bestRead.strategy)
      : (result.printing_matches || [])
        .filter((match) => match.name === title.name)
        .sort((a, b) => a.distance - b.distance)[0]
        || cardFromIndex(title.name);
    if (!printing) return applyVisualFallback(enriched);
    return {
      ...enriched,
      matches: [{
        ...printing,
        confidence: Math.max(printing.confidence || 0, title.score),
        identified_by: "ocr-title",
      }],
    };
  } catch (error) {
    return applyVisualFallback({ ...result, ocr_error: String(error?.message || error) });
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

function runVisualFallback(queryCandidates) {
  const w = getWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Visual fallback timed out. Please try again."));
    }, 60000);
    pending.set(id, { resolve, reject, timer });
    w.postMessage({ type: "visual-fallback", id, queryCandidates });
  });
}

export async function identify(imageDataUrl, point) {
  const bmp = await dataUrlToBitmap(imageDataUrl);
  const result = await runOnWorker(bmp, point);
  // A decisive art-keypoint match settles identity — skip the slower OCR pass.
  if (result.art_decisive && result.matches?.[0]?.identified_by === "art-match") return result;
  return applyTitleOCR(result);
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
