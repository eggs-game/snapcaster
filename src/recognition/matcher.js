// Card identification front-end. The heavy lifting (OpenCV outline detection +
// perspective rectify, perceptual hashing, Hamming search) runs in a Web Worker
// (./recognizer.js) so the ~10 MB OpenCV WASM compile never freezes the UI.
// This module only: (1) loads the index once for the lobby's "N printings" banner,
// and (2) captures crops and relays them to the worker.
import { VEC_BYTES } from "./hash.js";
import { evaluateMetadataEvidence, primaryTypes } from "./metadataEvidence.js";
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
      // Any sharded index (v2 and up) serves names from names.json. This said
      // `=== 2`, so a v3 manifest — which is what we ship — fell through to the
      // v1 path below and pulled 15MB (hashes.bin + cards.json) onto the MAIN
      // thread on every load, parsing 8MB of JSON, purely to produce a count
      // and a name list that names.json already holds in 0.67MB.
      if (manifest.version >= 2) {
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

let preloadPromise = null;
let ocrWarmScheduled = false;

function scheduleOCRWarm() {
  if (ocrWarmScheduled) return;
  ocrWarmScheduled = true;
  const run = () => getOCRWorker().catch(() => {});
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 5000 });
  else setTimeout(run, 1000);
}

// Warm the worker's actual recognition core ahead of the first click. This
// waits for OpenCV and the full hash/card/color/art tables, not just the small
// names.json file used by the lobby banner.
export function preload() {
  if (preloadPromise) return preloadPromise;
  const startedAt = performance.now();
  globalThis.__SNAP_RECOGNITION_WARMUP = { status: "warming", startedAt: Date.now() };
  preloadPromise = Promise.all([loadIndex(), runCorePreload()])
    .then(([count, core]) => {
      if (!core.preloaded || !core.indexReady || core.cvStatus !== "ready") {
        throw new Error("Recognition core did not finish warming.");
      }
      const durationMs = Math.round(performance.now() - startedAt);
      globalThis.__SNAP_RECOGNITION_WARMUP = {
        status: "ready",
        startedAt: globalThis.__SNAP_RECOGNITION_WARMUP?.startedAt || Date.now(),
        readyAt: Date.now(),
        durationMs,
        workerMs: core.workerMs,
        cvStatus: core.cvStatus,
        indexReady: core.indexReady,
        count,
      };
      console.log(`[snapcaster] recognition core ready in ${durationMs}ms (worker ${core.workerMs}ms)`);
      scheduleOCRWarm();
      return count;
    })
    .catch((error) => {
      globalThis.__SNAP_RECOGNITION_WARMUP = {
        status: "failed",
        startedAt: globalThis.__SNAP_RECOGNITION_WARMUP?.startedAt || Date.now(),
        failedAt: Date.now(),
        durationMs: Math.round(performance.now() - startedAt),
        error: String(error?.message || error),
      };
      preloadPromise = null;
      throw error;
    });
  return preloadPromise;
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
        id, matches, printingMatches, titleCandidates, metadataStrips, titleCount, queryCandidates,
        shardedIndex, cardFound, cvStatus, candidatesTried, cropsDropped, artBest, artChecked,
        artDecisive, stageMs, wasmHeapMB, preloaded, indexReady, indexCount, workerMs, error,
      } = e.data || {};
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      clearTimeout(p.timer);
      if (error) p.reject(new Error(error));
      else if (p.kind === "preload") p.resolve({
        preloaded: !!preloaded,
        cvStatus: cvStatus || "unknown",
        indexReady: !!indexReady,
        indexCount: Number(indexCount) || 0,
        workerMs: Number(workerMs) || 0,
      });
      else if (p.kind === "title-strips") p.resolve(titleCandidates || []);
      else if (p.kind === "metadata-strips") p.resolve(metadataStrips || null);
      else p.resolve({
        scan_id: id,
        matches: matches || [],
        printing_matches: printingMatches || [],
        title_count: titleCount || 0,
        query_candidates: queryCandidates || [],
        sharded_index: !!shardedIndex,
        card_found: !!cardFound,
        cv_status: cvStatus || "unknown",
        candidates_tried: candidatesTried || 0,
        crops_dropped: cropsDropped || 0,
        art_best: artBest || null,
        art_checked: artChecked || 0,
        art_decisive: !!artDecisive,
        stage_ms: stageMs || {},
        wasm_heap_mb: typeof wasmHeapMB === "number" ? wasmHeapMB : null,
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

// OCR runs in a small pool of tesseract workers so title reads execute in
// parallel waves — the sequential 24-attempt loop was the slow tail on cards
// without a decisive art match. Worker 0 is warmed by preload(); the second
// spins up on first OCR use.
const OCR_POOL_SIZE = 3;
const ocrPool = [];
const TITLE_OCR_PARAMETERS = {
  tessedit_pageseg_mode: PSM.SINGLE_LINE,
  tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '-,",
};

function makeOCRWorker() {
  return createWorker("eng").then(async (worker) => {
    await worker.setParameters(TITLE_OCR_PARAMETERS);
    return worker;
  });
}

// Parameter changes are worker-global. Serialize OCR-bearing scans so the
// metadata readers cannot change PSM/whitelists under a concurrent title read.
let ocrOperation = Promise.resolve();
function withOCRLock(operation) {
  const next = ocrOperation.then(operation, operation);
  ocrOperation = next.catch(() => {});
  return next;
}

function getOCRWorker() {
  if (!ocrPool[0]) ocrPool[0] = makeOCRWorker();
  return ocrPool[0];
}

function getOCRPool() {
  for (let i = 0; i < OCR_POOL_SIZE; i++) {
    if (!ocrPool[i]) ocrPool[i] = makeOCRWorker();
  }
  return Promise.all(ocrPool);
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
      if (observed === target && (!best || best.score < 1)) best = { name, score: 1, len: target.length };
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
    // On equal score prefer the LONGER name: reading "Crashing Wave" makes
    // both "Crash" (substring) and "Crashing Wave" score 1, and the longer
    // name is the one the strip actually shows.
    if (!best || score > best.score || (score === best.score && target.length > best.len)) {
      best = { name, score, len: target.length };
    }
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

function metadataFromRow(row) {
  return {
    mana_cost: row?.[8] || "",
    type_line: row?.[9] || "",
    oracle_text: row?.[10] || "",
  };
}

async function enrichMatchMetadata(match) {
  if ((manifest?.version || 0) < 4 || !match?.name) return match;
  const shard = await loadShard(match.name);
  const row = shard.find((candidate) => (
    candidate[0] === match.name
    && (!match.scryfall_id || candidate[3] === match.scryfall_id)
    && (match.face === undefined || Number(candidate[4]) === Number(match.face))
  )) || shard.find((candidate) => candidate[0] === match.name);
  return row ? { ...match, ...metadataFromRow(row) } : match;
}

async function applyMetadataRanking(result, observation) {
  if ((manifest?.version || 0) < 4 || !result.matches?.length) {
    return { ...result, metadata_observation: observation };
  }
  const evaluated = await Promise.all(result.matches.map(async (match, originalRank) => {
    const enriched = await enrichMatchMetadata(match);
    const evidence = evaluateMetadataEvidence(observation, enriched);
    return {
      ...enriched,
      metadata_score: Number.isFinite(evidence.score) ? evidence.score : null,
      metadata_reasons: evidence.reasons,
      metadata_compatible: evidence.compatible,
      _metadataRank: originalRank,
    };
  }));
  const compatible = evaluated.filter((match) => match.metadata_compatible);
  // If every candidate conflicts, the crop/read is more likely wrong than the
  // entire visual shortlist. Preserve it and expose the conflict for SNAPTEST.
  const pool = compatible.length ? compatible : evaluated;
  pool.sort((a, b) => (b.metadata_score || 0) - (a.metadata_score || 0) || a._metadataRank - b._metadataRank);
  const matches = pool.map(({ _metadataRank, ...match }) => match);
  return {
    ...result,
    matches,
    metadata_observation: observation,
    metadata_vetoed: compatible.length ? evaluated.length - compatible.length : 0,
    metadata_conflict_all: !compatible.length && evaluated.some((match) => !match.metadata_compatible),
  };
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
    scryfall_id: id,
    face,
    ...metadataFromRow(best.row),
    image: `https://cards.scryfall.io/normal/${side}/${id[0]}/${id[1]}/${id}.jpg`,
    scryfall_uri: `https://scryfall.com/card/${set}/${collectorNumber}`,
    distance: best.distance,
    confidence: Math.max(0, Math.min(1, (230 - best.distance) / 140)),
    strategy: strategy || "ocr-title",
  };
}

// Only reachable on a pre-sharded (v1) index; a sharded index resolves the
// printing through matchShardedPrinting instead, so `cards` is never loaded.
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

async function readMetadataObservation(result, bestRead, pool) {
  if (!bestRead) return null;
  const strips = await runMetadataStrips(result.scan_id, bestRead.strategy, bestRead.rotation || 0);
  if (!strips) return null;
  const [manaWorker, typeWorker, rulesWorker] = pool;
  try {
    await Promise.all([
      manaWorker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
        tessedit_char_whitelist: "0123456789X",
      }),
      typeWorker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz —-",
      }),
      rulesWorker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '-,.",
      }),
    ]);
    const [manaResult, typeResult, rulesResult] = await Promise.all([
      manaWorker.recognize(strips.mana),
      typeWorker.recognize(strips.type),
      rulesWorker.recognize(strips.rules),
    ]);
    const manaText = String(manaResult.data.text || "").trim();
    const genericMatch = manaText.match(/\b(\d{1,2})\b/);
    const typeText = String(typeResult.data.text || "").trim();
    const rulesText = String(rulesResult.data.text || "").trim();
    return {
      strategy: strips.strategy,
      rotation: (strips.rotation || 0) * 90,
      mana: {
        text: manaText,
        generic: genericMatch ? Number(genericMatch[1]) : null,
        genericConfidence: genericMatch ? (manaResult.data.confidence || 0) / 100 : 0,
        symbolCount: Number.isInteger(strips.manaSymbols?.count) ? strips.manaSymbols.count : null,
        symbolCountConfidence: strips.manaSymbols?.confidence || 0,
      },
      type: {
        text: typeText,
        confidence: primaryTypes(typeText).length ? (typeResult.data.confidence || 0) / 100 : 0,
      },
      rules: {
        text: rulesText,
        confidence: (rulesResult.data.confidence || 0) / 100,
      },
    };
  } finally {
    await Promise.all(pool.map((ocrWorker) => ocrWorker.setParameters(TITLE_OCR_PARAMETERS)));
  }
}

async function applyTitleOCRUnlocked(result) {
  if (!result.title_count) return applyVisualFallback(result);
  try {
    // Title strips are rendered on demand by the worker (a decisive art match
    // never reaches this point, so the happy path no longer pays for them).
    const titleCandidates = await runTitleStrips(result.scan_id);
    if (!titleCandidates.length) return applyVisualFallback(result);
    const pool = await getOCRPool();
    let bestRead = null;
    const reads = [];
    const evaluateRead = (data, attempt) => {
      const title = bestIndexedTitle(data.text);
      const read = {
        title,
        text: String(data.text || "").trim(),
        confidence: data.confidence || 0,
        rotation: attempt.rotation,
        strategy: attempt.strategy,
        image: attempt.image,
        flat: attempt.flat,
      };
      reads.push(read);
      if (!bestRead || (title?.score || 0) > (bestRead.title?.score || 0)
        || ((title?.score || 0) === (bestRead.title?.score || 0) && read.confidence > bestRead.confidence)) {
        bestRead = read;
      }
      return (title?.score || 0) >= 0.96 && read.confidence >= 45;
    };
    // Reads run in parallel waves across the OCR pool. Waves preserve the
    // early-exit: each wave's results are evaluated in priority order and the
    // search stops as soon as any read is decisive.
    const runWaves = async (list) => {
      for (let w = 0; w < list.length; w += pool.length) {
        const chunk = list.slice(w, w + pool.length);
        const datas = await Promise.all(chunk.map((a, j) => pool[j % pool.length].recognize(a.image)));
        let hit = false;
        for (let k = 0; k < chunk.length; k++) {
          if (evaluateRead(datas[k].data, chunk[k])) hit = true;
        }
        if (hit) return true;
      }
      return false;
    };
    // Cards are usually upright in frame, so try every candidate upright (then
    // upside-down for players across the table) before the sideways rotations,
    // instead of burning 4 rotations on one candidate at a time.
    const attempts = [];
    for (const rotation of [0, 2, 1, 3]) {
      for (const candidate of titleCandidates) {
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
    await runWaves(attempts.slice(0, 24));
    // Full-art and showcase basics can move the name bar to the bottom of the
    // frame. Only pay for these OCR reads when normal title-strip OCR failed.
    if ((bestRead?.title?.score || 0) < 0.82) {
      const bottomAttempts = [];
      for (const rotation of [0, 2, 1, 3]) {
        for (const candidate of titleCandidates.slice(0, 4)) {
          if (candidate.imagesBottom?.[rotation]) {
            bottomAttempts.push({
              image: candidate.imagesBottom[rotation],
              flat: candidate.imagesBottomFlat?.[rotation],
              rotation,
              strategy: `${candidate.strategy}:bottom`,
            });
          }
        }
      }
      await runWaves(bottomAttempts.slice(0, 12));
    }
    // Glare / low-light retry: if nothing read convincingly, re-run the most
    // promising reads on their illumination-flattened strips.
    if ((bestRead?.title?.score || 0) < 0.82) {
      const promising = [...reads]
        .sort((a, b) => (b.title?.score || 0) - (a.title?.score || 0) || b.confidence - a.confidence)
        .slice(0, 3)
        .filter((read) => read.flat)
        .map((read) => ({ image: read.flat, flat: null, rotation: read.rotation, strategy: `${read.strategy}+flat` }));
      await runWaves(promising);
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
    const metadataStarted = performance.now();
    let metadataResult = enriched;
    try {
      const observation = await readMetadataObservation(result, bestRead, pool);
      if (observation) metadataResult = await applyMetadataRanking(enriched, observation);
    } catch (error) {
      metadataResult = { ...enriched, metadata_error: String(error?.message || error) };
    }
    metadataResult.stage_ms = {
      ...(metadataResult.stage_ms || {}),
      metadata: Math.round(performance.now() - metadataStarted),
    };
    if (!title) return applyVisualFallback(metadataResult);
    const normalized = normalizeTitle(title.name);
    // Acceptance scales with how much evidence the name can carry: garbage
    // reads like "men ow" trivially reach high scores against tiny names
    // ("Ow"), and "at mr a pon" scored 0.75 against "A-Town". Short names must
    // be read near-exactly; only genuinely long names may tolerate the fuzzy
    // camera substitutions ("Gaunt from the Rarnpart").
    const requiredScore = normalized.length >= 12 ? 0.74 : normalized.length >= 8 ? 0.88 : 0.95;
    // Short and mid-length names are easy for a garbage OCR read to hit by
    // chance ("Wall", "Rats", and later "Experience" and "Apes of Rath"
    // conjured from noise/reminder text on occluded or rotated cards). For
    // names under 13 chars, only trust the read if the visual pipeline also
    // had that card in contention — when OCR and the artwork disagree, fall
    // back to the visual match instead of confidently showing the wrong card.
    // Long names carry enough evidence on their own.
    const short = normalized.length < 13;
    const corroborated = (metadataResult.matches || []).some((m) => m.name === title.name);
    // A strong keypoint match outranks OCR, whatever the name length. Observed:
    // ORB found "Muraganda Raceway" with 39 inliers and colour 95, and a
    // hallucinated read of "Platinum Angel" replaced it — 14 characters is over
    // the `short` cutoff, so no corroboration was ever required. Long names are
    // not self-evidently trustworthy when read off an illegible title strip.
    const art = metadataResult.art_best;
    const strongArt = !!art && !art.weak && (art.inliers || 0) >= 12;
    if (strongArt && art.name !== title.name) return applyVisualFallback(metadataResult);
    if (title.score < requiredScore || bestRead.confidence < 25 || (short && !corroborated)) {
      return applyVisualFallback(metadataResult);
    }
    const printing = metadataResult.sharded_index
      ? await matchShardedPrinting(title.name, metadataResult, bestRead.strategy)
      : (metadataResult.printing_matches || [])
        .filter((match) => match.name === title.name)
        .sort((a, b) => a.distance - b.distance)[0]
        || cardFromIndex(title.name);
    if (!printing) return applyVisualFallback(metadataResult);
    const printingEvidence = metadataResult.metadata_observation
      ? evaluateMetadataEvidence(metadataResult.metadata_observation, printing)
      : { compatible: true, score: 0, reasons: [] };
    if (!printingEvidence.compatible) return applyVisualFallback(metadataResult);
    return {
      ...metadataResult,
      matches: [{
        ...printing,
        metadata_score: printingEvidence.score,
        metadata_reasons: printingEvidence.reasons,
        confidence: Math.max(printing.confidence || 0, title.score),
        identified_by: "ocr-title",
      }],
    };
  } catch (error) {
    return applyVisualFallback({ ...result, ocr_error: String(error?.message || error) });
  }
}

function applyTitleOCR(result) {
  return withOCRLock(() => applyTitleOCRUnlocked(result));
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

function runCorePreload() {
  const w = getWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Recognition warm-up timed out."));
    }, 180000);
    pending.set(id, { resolve, reject, timer, kind: "preload" });
    w.postMessage({ type: "preload", id });
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

// Ask the worker to render the OCR title strips for scan `scanId` (kept
// in-worker until the next scan). Resolves to the titleCandidates array.
function runTitleStrips(scanId) {
  const w = getWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Title strip rendering timed out."));
    }, 20000);
    pending.set(id, { resolve, reject, timer, kind: "title-strips" });
    w.postMessage({ type: "title-strips", id, scanId });
  });
}

function runMetadataStrips(scanId, strategy, rotation) {
  const w = getWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Metadata strip rendering timed out."));
    }, 20000);
    pending.set(id, { resolve, reject, timer, kind: "metadata-strips" });
    w.postMessage({ type: "metadata-strips", id, scanId, strategy, rotation });
  });
}

// A decisive art-keypoint match settles identity — skip the slower OCR pass
// (which could otherwise override 200 agreeing keypoints with a fuzzy title).
// Likewise, a near-exact hash match (distance <= 90 of 512 bits, the CONF_GOOD
// calibration point) is already certain: correct real-camera scans land 30-70
// and WRONG cards essentially never score this low, so OCR can only slow it
// down or override it with a bad read.
// Distance at which a visual match is exact enough to present as such.
const VISUAL_EXACT_DISTANCE = 90;
// Distance below which OCR is not worth running. Deliberately looser than the
// label above: OCR is only useful when it can CHANGE the answer, and across
// three tableau runs it produced 0, 1 and 1 identifications per ~100 cards
// while costing ~5.3s on every card that reached it — the single biggest
// contributor to a 12s p90 against a 2.5s median. Cards in the 90-150 band are
// not relabelled as exact; they simply stop paying for a read that has never
// rescued them.
const OCR_SKIP_DISTANCE = 150;

async function finishIdentify(result) {
  if (result.art_decisive && result.matches?.[0]?.identified_by === "art-match") return result;
  const best = result.matches?.[0];
  if (best && best.distance <= VISUAL_EXACT_DISTANCE) {
    best.identified_by = best.identified_by || "visual-exact";
    return result;
  }
  // A strong keypoint match already outranks OCR in applyTitleOCR — any read
  // that disagrees is thrown away, and one that agrees changes nothing. So
  // running OCR here can only ever burn time.
  const art = result.art_best;
  if (art && !art.weak && (art.inliers || 0) >= 12) return result;
  if (best && best.distance <= OCR_SKIP_DISTANCE) return result;
  const t0 = performance.now();
  const out = await applyTitleOCR(result);
  out.stage_ms = { ...(result.stage_ms || {}), ...(out.stage_ms || {}), ocr: Math.round(performance.now() - t0) };
  return out;
}

export async function identify(imageDataUrl, point) {
  const t0 = performance.now();
  const bmp = await dataUrlToBitmap(imageDataUrl);
  const out = await finishIdentify(await runOnWorker(bmp, point));
  out.stage_ms = { ...(out.stage_ms || {}), total: Math.round(performance.now() - t0) };
  return out;
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
    const r = await finishIdentify(await runOnWorker(bmp, point));
    console.log("[snapcaster] __scIdentifyUrl top matches:", r.matches.map((m) => `${m.name} (d=${m.distance}, conf=${m.confidence.toFixed(2)})`));
    return r;
  };
}
