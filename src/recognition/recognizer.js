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
const CONF_GOOD = 90, CONF_BAD = 170;

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
  console.log("[snapcaster worker] loading OpenCV…");
  cvPromise = new Promise((resolve, reject) => {
    // Point Emscripten at the CDN for its wasm, in case this build fetches it
    // separately rather than embedding it.
    self.Module = { locateFile: (p) => OPENCV_BASE + p };
    try {
      importScripts(OPENCV_BASE + "opencv.js");
    } catch (e) {
      return reject(e);
    }
    const start = Date.now();
    const done = () => {
      cvReady = true;
      cvStatus = "ready";
      console.log("[snapcaster worker] OpenCV ready");
      resolve(self.cv);
    };
    const poll = () => {
      if (self.cv && self.cv.Mat) return done();
      if (Date.now() - start > 90000) return reject(new Error("OpenCV init timeout"));
      setTimeout(poll, 50);
    };
    if (self.cv && typeof self.cv.then === "function") {
      // OpenCV 4.x exposes `cv` as an Emscripten "thenable" that is NOT a real
      // Promise (no .catch). Wrap it so chaining works, and also start polling
      // as a fallback in case the thenable never settles.
      Promise.resolve(self.cv).then((m) => { if (m && m.Mat) self.cv = m; done(); }, reject);
      setTimeout(poll, 2000);
    } else if (self.cv && self.cv.onRuntimeInitialized !== undefined) {
      self.cv.onRuntimeInitialized = done;
      setTimeout(poll, 2000);
    } else {
      poll();
    }
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

function findCardQuad(srcImageData) {
  const cv = self.cv;
  const src = cv.matFromImageData(srcImageData);
  const gray = new cv.Mat(), blur = new cv.Mat(), bin = new cv.Mat();
  const results = [];
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
        if (area > imgArea * 0.05) {
          const peri = cv.arcLength(c, true);
          const approx = new cv.Mat();
          cv.approxPolyDP(c, approx, 0.03 * peri, true);
          if (approx.rows === 4 && cv.isContourConvex(approx)) {
            const pts = [];
            for (let r = 0; r < 4; r++) pts.push({ x: approx.data32S[r * 2], y: approx.data32S[r * 2 + 1] });
            results.push({ pts, area });
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
  if (!results.length) return null;
  results.sort((a, b) => b.area - a.area);
  return orderCorners(results[0].pts);
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

// Center-crop fallback (no OpenCV) at card aspect ratio -> CARD_W x CARD_H.
function centerCropImageData(bmp) {
  const w = bmp.width, h = bmp.height;
  let ch = Math.round(h * 0.9), cw = Math.round((ch * CARD_W) / CARD_H);
  if (cw > w) { cw = Math.round(w * 0.9); ch = Math.round((cw * CARD_H) / CARD_W); }
  const canvas = new OffscreenCanvas(CARD_W, CARD_H);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, CARD_W, CARD_H);
  return ctx.getImageData(0, 0, CARD_W, CARD_H);
}

function bitmapToImageData(bmp) {
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, bmp.width, bmp.height);
}

async function identify(bmp) {
  await loadIndex();
  // Wait for OpenCV so recognition is always outline-corrected. This wait is in
  // the worker — the page stays responsive; the sidebar shows its loading state.
  try { await loadCV(); } catch (e) { console.warn("[snapcaster worker] OpenCV failed; using center-crop", e); }

  let rectified = null, cardFound = false;
  if (cvReady) {
    try {
      const srcImageData = bitmapToImageData(bmp);
      const quad = findCardQuad(srcImageData);
      if (quad) { rectified = rectifyCard(srcImageData, quad); cardFound = true; }
    } catch (e) { rectified = null; }
  }
  if (!rectified) rectified = centerCropImageData(bmp);
  if (bmp.close) bmp.close();

  const gray = toGray(rectified);
  const n = cards.length;
  const dists = new Uint16Array(n).fill(0xffff);
  for (const q of queryVariants(gray)) hammingSearch(q, index, n, dists);

  const top = [];
  for (let i = 0; i < n; i++) {
    if (top.length < 5 || dists[i] < top[top.length - 1].d) {
      top.push({ i, d: dists[i] });
      top.sort((a, b) => a.d - b.d);
      if (top.length > 5) top.pop();
    }
  }
  return { matches: top.map((t) => cardMeta(t.i, t.d)), cardFound, cvStatus };
}

// Kick off loads as soon as the worker spins up.
loadIndex().catch(() => {});
loadCV().catch(() => {});

self.onmessage = async (e) => {
  const { id, type, bmp } = e.data || {};
  if (type === "identify") {
    try {
      const res = await identify(bmp);
      self.postMessage({ id, ...res });
    } catch (err) {
      if (bmp && bmp.close) bmp.close();
      self.postMessage({ id, error: String((err && err.message) || err) });
    }
  }
};
