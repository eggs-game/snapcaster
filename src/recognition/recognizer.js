/* eslint-disable no-restricted-globals */
// Classic Web Worker: runs the whole card-recognition pipeline (OpenCV outline
// detection + perspective rectify, then perceptual hashing + Hamming search)
// OFF the main thread, so the ~10 MB OpenCV WASM compile can never freeze the UI.
//
// The hashing code below is inlined from ./hash.js and MUST stay bit-compatible
// with scripts/build_index.py. If you change one, change both.

const OPENCV_BASE = "https://docs.opencv.org/4.9.0/";
const HASH_SIZE = 16;
const VEC_BYTES = 64;
const CARD_W = 244, CARD_H = 340;
// Real webcam captures are much noisier than source images. A correctly
// rectified physical card commonly lands around 170–205, while unrelated
// center crops tend to be 220+. Keep the high-confidence bound strict, but do
// not discard useful first-place matches such as the user's LTC Taunt scan.
const CONF_GOOD = 90, CONF_BAD = 230;

// ---------- perceptual hashing (mirror of hash.js) ----------
const POPCOUNT = new Uint8Array(256);
for (let i = 0; i < 256; i++) POPCOUNT[i] = (i & 1) + POPCOUNT[i >> 1];

function toGray(imageData) {
  const { data, width, height } = imageData;
  const g = new Float32Array(width * height);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    g[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return { pix: g, w: width, h: height };
}

function areaResize(gray, dw, dh) {
  const { pix, w, h } = gray;
  const out = new Float32Array(dw * dh);
  const sx = w / dw, sy = h / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = y * sy, y1 = Math.min(h, (y + 1) * sy);
    for (let x = 0; x < dw; x++) {
      const x0 = x * sx, x1 = Math.min(w, (x + 1) * sx);
      let sum = 0, area = 0;
      for (let yy = Math.floor(y0); yy < y1; yy++) {
        const fy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        for (let xx = Math.floor(x0); xx < x1; xx++) {
          const fx = Math.min(xx + 1, x1) - Math.max(xx, x0);
          sum += pix[yy * w + xx] * fx * fy;
          area += fx * fy;
        }
      }
      out[y * dw + x] = sum / area;
    }
  }
  return { pix: out, w: dw, h: dh };
}

function dctMatrix(n) {
  const m = new Float32Array(n * n);
  for (let k = 0; k < n; k++) {
    const a = k === 0 ? Math.sqrt(1 / n) : Math.sqrt(2 / n);
    for (let j = 0; j < n; j++) m[k * n + j] = a * Math.cos((Math.PI * (2 * j + 1) * k) / (2 * n));
  }
  return m;
}
const DCT64 = dctMatrix(64);

function dct2_lowfreq(img64) {
  const n = 64, k = HASH_SIZE;
  const tmp = new Float32Array(k * n);
  for (let r = 0; r < k; r++)
    for (let c = 0; c < n; c++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += DCT64[r * n + j] * img64[j * n + c];
      tmp[r * n + c] = s;
    }
  const low = new Float32Array(k * k);
  for (let r = 0; r < k; r++)
    for (let c = 0; c < k; c++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += tmp[r * n + j] * DCT64[c * n + j];
      low[r * k + c] = s;
    }
  return low;
}

function median(arr) {
  const a = Float32Array.from(arr).sort();
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function packBits(bits) {
  const out = new Uint8Array(bits.length >> 3);
  for (let i = 0; i < bits.length; i++) if (bits[i]) out[i >> 3] |= 128 >> (i & 7);
  return out;
}

function computeHashes(gray) {
  const small = areaResize(gray, 64, 64);
  const low = dct2_lowfreq(small.pix);
  const med = median(low);
  const pbits = new Uint8Array(HASH_SIZE * HASH_SIZE);
  for (let i = 0; i < low.length; i++) pbits[i] = low[i] > med ? 1 : 0;
  const d = areaResize(gray, HASH_SIZE + 1, HASH_SIZE);
  const dbits = new Uint8Array(HASH_SIZE * HASH_SIZE);
  let bi = 0;
  for (let y = 0; y < HASH_SIZE; y++)
    for (let x = 1; x <= HASH_SIZE; x++)
      dbits[bi++] = d.pix[y * (HASH_SIZE + 1) + x] > d.pix[y * (HASH_SIZE + 1) + x - 1] ? 1 : 0;
  const vec = new Uint8Array(VEC_BYTES);
  vec.set(packBits(pbits), 0);
  vec.set(packBits(dbits), 32);
  return vec;
}

function contrastStretch(gray) {
  const sorted = Float32Array.from(gray.pix).sort();
  const lo = sorted[Math.floor(sorted.length * 0.02)];
  const hi = sorted[Math.floor(sorted.length * 0.98)];
  const range = Math.max(1, hi - lo);
  const out = new Float32Array(gray.pix.length);
  for (let i = 0; i < out.length; i++)
    out[i] = Math.max(0, Math.min(255, ((gray.pix[i] - lo) / range) * 255));
  return { pix: out, w: gray.w, h: gray.h };
}

function rotate90(gray) {
  const { pix, w, h } = gray;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      out[x * h + (h - 1 - y)] = pix[y * w + x];
  return { pix: out, w: h, h: w };
}

function queryVariants(gray) {
  const variants = [];
  for (const base of [gray, contrastStretch(gray)]) {
    let img = base;
    for (let r = 0; r < 4; r++) {
      variants.push(computeHashes(img));
      img = rotate90(img);
    }
  }
  return variants;
}

function hammingSearch(query, index, nCards, distsOut) {
  for (let i = 0; i < nCards; i++) {
    const off = i * VEC_BYTES;
    let d = 0;
    for (let b = 0; b < VEC_BYTES; b++) d += POPCOUNT[index[off + b] ^ query[b]];
    if (d < distsOut[i]) distsOut[i] = d;
  }
}

// ---------- OpenCV loading (in-worker, non-blocking to the main thread) ----------
let cvReady = false;
let cvStatus = "loading"; // "loading" | "ready" | "failed"
let cvPromise = null;

function loadCV() {
  if (cvPromise) return cvPromise;
  console.log("[snapcaster worker] loadCV: start");
  cvPromise = new Promise((resolve, reject) => {
    const start = Date.now();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      cvReady = true;
      cvStatus = "ready";
      console.log(`[snapcaster worker] OpenCV ready in ${Date.now() - start}ms`);
      // Never resolve with `self.cv`. OpenCV's Emscripten module is a
      // self-resolving thenable, so native Promise assimilation would loop
      // forever and leave every identification stuck on "Identifying…".
      resolve();
    };
    // Emscripten reads this config object during importScripts. The wasm is
    // embedded as a base64 data URI in the docs build, so locateFile is only a
    // safety net; onRuntimeInitialized is one of several ready signals we watch.
    self.Module = {
      locateFile: (p) => OPENCV_BASE + p,
      onRuntimeInitialized: () => console.log("[snapcaster worker] onRuntimeInitialized fired"),
    };
    try {
      console.log("[snapcaster worker] importScripts opencv.js…");
      importScripts(OPENCV_BASE + "opencv.js");
      console.log(`[snapcaster worker] importScripts done (typeof cv=${typeof self.cv})`);
    } catch (e) {
      console.error("[snapcaster worker] importScripts failed", e);
      settled = true;
      cvStatus = "failed";
      return reject(e);
    }
    // OpenCV exposes an Emscripten thenable, not a real Promise. Call its
    // callback directly; do not wrap it in Promise.resolve (which recursively
    // assimilates this self-resolving thenable and never completes).
    if (self.cv && typeof self.cv.then === "function") {
      self.cv.then((m) => {
        if (m && m.Mat) self.cv = m;
        if (self.cv && self.cv.Mat) finish();
      });
    }
    // Authoritative signal: poll until the real module (with .Mat) exists,
    // regardless of how this particular build reports readiness.
    let ticks = 0;
    const poll = () => {
      if (self.cv && self.cv.Mat) return finish();
      if (++ticks % 20 === 0) console.log(`[snapcaster worker] waiting for OpenCV… ${Date.now() - start}ms`);
      if (Date.now() - start > 60000) {
        settled = true;
        cvStatus = "failed";
        console.error("[snapcaster worker] OpenCV init timeout (60s)");
        return reject(new Error("OpenCV init timeout"));
      }
      setTimeout(poll, 100);
    };
    poll();
  });
  cvPromise.catch(() => { cvStatus = "failed"; });
  return cvPromise;
}

// ---------- card index ----------
let index = null, cards = null, indexPromise = null;

function loadIndex() {
  if (indexPromise) return indexPromise;
  indexPromise = (async () => {
    const [h, c] = await Promise.all([fetch("/carddata/hashes.bin"), fetch("/carddata/cards.json")]);
    if (!h.ok || !c.ok) throw new Error("Card index not found");
    index = new Uint8Array(await h.arrayBuffer());
    cards = await c.json();
    if (index.length !== cards.length * VEC_BYTES) throw new Error("Card index corrupted");
    return cards.length;
  })();
  return indexPromise;
}

function cardMeta(i, distance) {
  const [name, set, cn, id, face] = cards[i];
  const side = face === 1 ? "back" : "front";
  return {
    name, set, collector_number: cn,
    image: `https://cards.scryfall.io/normal/${side}/${id[0]}/${id[1]}/${id}.jpg`,
    scryfall_uri: `https://scryfall.com/card/${set}/${cn}`,
    distance,
    confidence: Math.max(0, Math.min(1, (CONF_BAD - distance) / (CONF_BAD - CONF_GOOD))),
  };
}

// ---------- OpenCV card outline detection + perspective rectify ----------
function orderCorners(pts) {
  const bySum = [...pts].sort((a, b) => a.x + a.y - (b.x + b.y));
  const byDiff = [...pts].sort((a, b) => a.y - a.x - (b.y - b.x));
  return [bySum[0], byDiff[0], bySum[3], byDiff[3]];
}

function pointInQuad(point, corners) {
  let inside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const a = corners[i], b = corners[j];
    if (((a.y > point.y) !== (b.y > point.y))
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function quadGeometry(pts, imageWidth, imageHeight, area, click) {
  const [tl, tr, br, bl] = orderCorners(pts);
  const corners = [tl, tr, br, bl];
  const width = (Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(br.x - bl.x, br.y - bl.y)) / 2;
  const height = (Math.hypot(bl.x - tl.x, bl.y - tl.y) + Math.hypot(br.x - tr.x, br.y - tr.y)) / 2;
  const aspect = Math.max(width, height) / Math.max(1, Math.min(width, height));
  const cx = pts.reduce((sum, p) => sum + p.x, 0) / 4;
  const cy = pts.reduce((sum, p) => sum + p.y, 0) / 4;
  const centerDistance = Math.hypot(
    (cx - click.x) / imageWidth,
    (cy - click.y) / imageHeight,
  );
  // A Magic card is 1.39:1. Permit perspective distortion but strongly prefer
  // card-like, centered contours because the capture is centered on the click.
  const aspectFit = Math.max(0.15, 1 - Math.abs(aspect - CARD_H / CARD_W));
  const centerFit = Math.max(0.2, 1 - centerDistance * 2);
  const containsClick = pointInQuad(click, corners);
  return { corners, aspect, containsClick, score: area * aspectFit * centerFit };
}

function findCardQuads(srcImageData, click) {
  const cv = self.cv;
  const src = cv.matFromImageData(srcImageData);
  const gray = new cv.Mat(), blur = new cv.Mat(), bin = new cv.Mat();
  const results = [];
  const seen = new Set();
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.bilateralFilter(gray, blur, 7, 50, 50);
    const imgArea = srcImageData.width * srcImageData.height;
    const tryBin = (mat) => {
      const contours = new cv.MatVector(), hier = new cv.Mat();
      cv.findContours(mat, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i);
        const area = cv.contourArea(c);
        if (area > imgArea * 0.01 && area < imgArea * 0.98) {
          const peri = cv.arcLength(c, true);
          const approx = new cv.Mat();
          cv.approxPolyDP(c, approx, 0.03 * peri, true);
          if (approx.rows === 4 && cv.isContourConvex(approx)) {
            const pts = [];
            for (let r = 0; r < 4; r++) pts.push({ x: approx.data32S[r * 2], y: approx.data32S[r * 2 + 1] });
            const geometry = quadGeometry(pts, srcImageData.width, srcImageData.height, area, click);
            if (geometry.aspect >= 1.12 && geometry.aspect <= 2.0) {
              const key = geometry.corners.map((p) => `${Math.round(p.x / 8)},${Math.round(p.y / 8)}`).join("|");
              if (!seen.has(key)) {
                seen.add(key);
                results.push(geometry);
              }
            }
          }
          approx.delete();
        }
        c.delete();
      }
      contours.delete(); hier.delete();
    };
    cv.Canny(blur, bin, 30, 120);
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    cv.dilate(bin, bin, kernel);
    tryBin(bin);
    cv.adaptiveThreshold(blur, bin, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 31, 5);
    const k5 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
    cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, k5);
    tryBin(bin);
    kernel.delete(); k5.delete();
  } finally {
    src.delete(); gray.delete(); blur.delete(); bin.delete();
  }
  const containing = results.filter((result) => result.containsClick);
  const pool = containing.length ? containing : results;
  pool.sort((a, b) => b.score - a.score);
  return pool.slice(0, 3).map((result) => result.corners);
}

function matToImageData(mat) {
  return new ImageData(new Uint8ClampedArray(mat.data), mat.cols, mat.rows);
}

function rectifyCard(srcImageData, corners) {
  const cv = self.cv;
  const [tl, tr, br, bl] = corners;
  const wTop = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const wBot = Math.hypot(br.x - bl.x, br.y - bl.y);
  const hL = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const hR = Math.hypot(br.x - tr.x, br.y - tr.y);
  const landscape = (wTop + wBot) / 2 > (hL + hR) / 2;
  const dw = landscape ? CARD_H : CARD_W, dh = landscape ? CARD_W : CARD_H;

  const src = cv.matFromImageData(srcImageData);
  const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
  const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, dw, 0, dw, dh, 0, dh]);
  const m = cv.getPerspectiveTransform(srcPts, dstPts);
  const out = new cv.Mat();
  cv.warpPerspective(src, out, m, new cv.Size(dw, dh));

  let finalMat = out, rotated = null;
  if (landscape) {
    rotated = new cv.Mat();
    cv.rotate(out, rotated, cv.ROTATE_90_CLOCKWISE);
    finalMat = rotated;
  }
  const id = matToImageData(finalMat);
  src.delete(); srcPts.delete(); dstPts.delete(); m.delete(); out.delete();
  if (rotated) rotated.delete();
  return id;
}

// Click-guided fallback at card aspect ratio -> CARD_W x CARD_H. Trying several
// scales makes recognition useful even when glare, a sleeve, or a hand prevents
// OpenCV from finding a closed four-sided contour.
function centerCropImageData(bmp, scale = 0.9, point = { nx: 0.5, ny: 0.5 }) {
  const w = bmp.width, h = bmp.height;
  let ch = Math.round(h * scale), cw = Math.round((ch * CARD_W) / CARD_H);
  if (cw > w) { cw = Math.round(w * scale); ch = Math.round((cw * CARD_H) / CARD_W); }
  const cx = point.nx * w, cy = point.ny * h;
  const x0 = Math.max(0, Math.min(w - cw, cx - cw / 2));
  const y0 = Math.max(0, Math.min(h - ch, cy - ch / 2));
  const canvas = new OffscreenCanvas(CARD_W, CARD_H);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, x0, y0, cw, ch, 0, 0, CARD_W, CARD_H);
  return ctx.getImageData(0, 0, CARD_W, CARD_H);
}

function bitmapToImageData(bmp) {
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, bmp.width, bmp.height);
}

async function makeTitleImage(cardImage) {
  const source = new OffscreenCanvas(cardImage.width, cardImage.height);
  source.getContext("2d").putImageData(cardImage, 0, 0);
  const canvas = new OffscreenCanvas(1000, 140);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Exclude the mana-cost area on the right; it otherwise becomes OCR noise.
  ctx.drawImage(
    source,
    cardImage.width * 0.04, cardImage.height * 0.025,
    cardImage.width * 0.76, cardImage.height * 0.1,
    10, 10, 980, 120,
  );
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let p = 0; p < pixels.data.length; p += 4) {
    const gray = 0.299 * pixels.data[p] + 0.587 * pixels.data[p + 1] + 0.114 * pixels.data[p + 2];
    pixels.data[p] = pixels.data[p + 1] = pixels.data[p + 2] = gray;
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}

// Resolve when OpenCV becomes ready, or after `ms` — whichever comes first.
// Keeps loading in the background so later scans get the accurate pipeline.
function waitForCV(ms) {
  loadCV().catch(() => {});
  if (cvReady) return Promise.resolve();
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      if (cvReady || cvStatus === "failed" || Date.now() - t0 > ms) return resolve();
      setTimeout(tick, 100);
    };
    tick();
  });
}

async function identify(bmp, point = { nx: 0.5, ny: 0.5 }) {
  await loadIndex();
  // Prefer the accurate OpenCV pipeline, but don't hang the first scan forever
  // if it's still compiling — fall back to center-crop this once; the diagnostic
  // panel reports the real status so the user knows to retry in a moment.
  await waitForCV(15000);

  const candidates = [];
  let cardFound = false;
  const nx = Number(point?.nx), ny = Number(point?.ny);
  const normalizedPoint = {
    nx: Number.isFinite(nx) ? Math.max(0, Math.min(1, nx)) : 0.5,
    ny: Number.isFinite(ny) ? Math.max(0, Math.min(1, ny)) : 0.5,
  };
  const click = { x: normalizedPoint.nx * bmp.width, y: normalizedPoint.ny * bmp.height };
  if (cvReady) {
    try {
      const srcImageData = bitmapToImageData(bmp);
      // If the input already has card-like proportions (for example the debug
      // hook or a tightly framed camera capture), preserve it. OpenCV may detect
      // an inner art/text frame rather than the outer edge.
      const inputAspect = Math.max(bmp.width, bmp.height) / Math.min(bmp.width, bmp.height);
      if (Math.abs(inputAspect - CARD_H / CARD_W) < 0.12) {
        candidates.push({ image: srcImageData, strategy: "full-frame" });
      }
      const quads = findCardQuads(srcImageData, click);
      cardFound = quads.length > 0;
      for (let i = 0; i < quads.length; i++) {
        candidates.push({ image: rectifyCard(srcImageData, quads[i]), strategy: `outline-${i + 1}` });
      }
    } catch (e) {
      console.warn("[snapcaster worker] outline detection failed", e);
    }
  }
  // Always include click-centered crops at several sizes. One often
  // approximates the card border even when no closed contour is available.
  for (const scale of [0.9, 0.75, 0.6, 0.45, 0.35]) {
    candidates.push({
      image: centerCropImageData(bmp, scale, normalizedPoint),
      strategy: `center-${Math.round(scale * 100)}`,
    });
  }
  if (bmp.close) bmp.close();

  const n = cards.length;
  const dists = new Uint16Array(n).fill(0xffff);
  const strategies = new Array(n).fill("none");
  let candidatesTried = 0;
  let bestCandidateImage = null;
  let bestCandidateDistance = 0xffff;
  for (const candidate of candidates) {
    candidatesTried++;
    const candidateDists = new Uint16Array(n).fill(0xffff);
    for (const q of queryVariants(toGray(candidate.image))) hammingSearch(q, index, n, candidateDists);
    let candidateBest = 0xffff;
    for (let i = 0; i < n; i++) {
      if (candidateDists[i] < candidateBest) candidateBest = candidateDists[i];
      if (candidateDists[i] < dists[i]) {
        dists[i] = candidateDists[i];
        strategies[i] = candidate.strategy;
      }
    }
    if (candidateBest < bestCandidateDistance) {
      bestCandidateDistance = candidateBest;
      bestCandidateImage = candidate.image;
    }
    // A distance this low is already a decisive match; avoid spending time on
    // weaker fallback candidates.
    if (candidateBest <= 45) break;
  }

  // Keep enough printing-level candidates to deduplicate by card name below.
  // Every printing still competes independently; the best-matching artwork for
  // a card becomes the result shown to the user.
  const top = [];
  for (let i = 0; i < n; i++) {
    if (top.length < 20 || dists[i] < top[top.length - 1].d) {
      top.push({ i, d: dists[i] });
      top.sort((a, b) => a.d - b.d);
      if (top.length > 20) top.pop();
    }
  }
  const printingMatches = top.map((t) => ({ ...cardMeta(t.i, t.d), strategy: strategies[t.i] }));
  const matches = [];
  const names = new Set();
  for (const match of printingMatches) {
    if (names.has(match.name)) continue;
    names.add(match.name);
    matches.push(match);
    if (matches.length === 15) break;
  }
  const titleImage = bestCandidateImage ? await makeTitleImage(bestCandidateImage) : null;
  return { matches, printingMatches, titleImage, cardFound, cvStatus, candidatesTried };
}

// Kick off loads as soon as the worker spins up.
loadIndex().catch(() => {});
loadCV().catch(() => {});

self.onmessage = async (e) => {
  const { id, type, bmp, point } = e.data || {};
  if (type === "identify") {
    try {
      const res = await identify(bmp, point);
      self.postMessage({ id, ...res });
    } catch (err) {
      if (bmp && bmp.close) bmp.close();
      self.postMessage({ id, error: String((err && err.message) || err) });
    }
  }
};
