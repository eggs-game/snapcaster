/* eslint-disable no-restricted-globals */
// Classic Web Worker: runs the whole card-recognition pipeline (OpenCV outline
// detection + perspective rectify, then perceptual hashing + Hamming search)
// OFF the main thread, so the ~10 MB OpenCV WASM compile can never freeze the UI.
//
// The hashing code below is inlined from ./hash.js and MUST stay bit-compatible
// with scripts/build_index.py. If you change one, change both.

// Self-hosted. Cross-origin importScripts to docs.opencv.org fails in real
// browsers regardless of CSP — verified directly: a same-origin importScripts
// of our own JS executes (it throws "window is not defined" inside a worker,
// which proves it loaded), while the identical call to docs.opencv.org fails
// to load in ~100ms. Losing OpenCV silently costs contour detection AND ORB
// art verification, so this must not depend on a third-party origin.
const OPENCV_BASE = new URL("/vendor/opencv/4.9.0/", self.location.origin).href;
// CSP-cache-bust marker. A worker enforces the CSP delivered with ITS OWN
// response, and Vercel serves content-hashed assets as immutable — so a CSP
// change alone does not reach an already-cached worker. Its hash must change
// too. Bump this when a header change has to take effect in the worker.
const CSP_EPOCH = 5;
void CSP_EPOCH;

// OpenCV init competes with loading ~19MB of index in this same worker, so on
// a slow machine or a throttled tab the old 60s ceiling could expire before
// the runtime finished compiling.
const CV_INIT_TIMEOUT_MS = 180000;
const HASH_SIZE = 16;
const VEC_BYTES = 64;
const CARD_W = 244, CARD_H = 340;
// Candidate cards are kept at up to this width (2.5x hash size) so title OCR
// works on the pixels the camera actually captured instead of a 244px
// thumbnail. Hashing areaResizes to 64x64 regardless, so it is unaffected.
const OCR_MAX_W = 610;
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

// Mean absolute gradient — a cheap "is there anything here?" measure. Empty
// wall/skin/playmat lands near 1-4; even a small, blurry card carries frame
// borders, text and art edges and lands well above 10.
const BACKGROUND_DETAIL_MIN = 6;

function detailScore(gray) {
  const { pix, w, h } = gray;
  let sum = 0, count = 0;
  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const i = y * w + x;
      sum += Math.abs(pix[i] - pix[i + 1]) + Math.abs(pix[i] - pix[i + w]);
      count++;
    }
  }
  return count ? sum / count : 0;
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
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.max(0, Math.min(255, ((gray.pix[i] - lo) / range) * 255));
  }
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
  for (let base of [gray, contrastStretch(gray)]) {
    let img = base;
    for (let r = 0; r < 4; r++) {
      variants.push(computeHashes(img));
      img = rotate90(img);
    }
  }
  return variants;
}

// Art region of an upright card — MUST mirror ART_X0..ART_Y1 in
// scripts/build_index.py.
const ART_X0 = 0.08, ART_X1 = 0.92, ART_Y0 = 0.10, ART_Y1 = 0.56;
// Where a click on the artwork sits as a fraction of card height — the centre
// of the art window above. Used to anchor crops on an art click.
const ART_CLICK_V = (ART_Y0 + ART_Y1) / 2;

function cropGray(gray, x0f, x1f, y0f, y1f) {
  const { pix, w, h } = gray;
  const x0 = Math.floor(w * x0f), x1 = Math.floor(w * x1f);
  const y0 = Math.floor(h * y0f), y1 = Math.floor(h * y1f);
  const cw = x1 - x0, ch = y1 - y0;
  const out = new Float32Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) out[y * cw + x] = pix[(y + y0) * w + (x + x0)];
  }
  return { pix: out, w: cw, h: ch };
}

// 32-byte pHash of the art region. Default window (yShift=0) MUST mirror
// compute_art_hash in build_index.py. Non-zero yShift is query-only: when a
// photo has already cut off the title bar, the visible art sits higher in the
// frame than a full Scryfall scan, so the default window samples the text box
// instead of the illustration. Sliding the window up realigns it.
function artPHash(gray, yShift = 0) {
  const span = ART_Y1 - ART_Y0;
  let y0 = ART_Y0 + yShift;
  let y1 = y0 + span;
  if (y0 < 0) { y0 = 0; y1 = span; }
  if (y1 > 1) { y1 = 1; y0 = 1 - span; }
  const art = cropGray(gray, ART_X0, ART_X1, y0, y1);
  const small = areaResize(art, 64, 64);
  const low = dct2_lowfreq(small.pix);
  const med = median(low);
  const bits = new Uint8Array(HASH_SIZE * HASH_SIZE);
  for (let i = 0; i < low.length; i++) bits[i] = low[i] > med ? 1 : 0;
  return packBits(bits);
}

// Query-only vertical offsets for artPHash. Negative = window slides toward
// the top of the crop (title already cut off). Index entries stay at yShift=0.
const ART_Y_SHIFTS = [0, -0.05, -0.10, -0.16, -0.22];

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
      if (Date.now() - start > CV_INIT_TIMEOUT_MS) {
        settled = true;
        cvStatus = "failed";
        console.error(`[snapcaster worker] OpenCV init timeout (${CV_INIT_TIMEOUT_MS}ms)`);
        return reject(new Error("OpenCV init timeout"));
      }
      setTimeout(poll, 100);
    };
    poll();
  });
  cvPromise.catch(() => {
    cvStatus = "failed";
    // Do NOT memoize the failure. cvPromise was cached forever, so a single
    // slow or blocked start permanently downgraded every later scan in the
    // session to blind crops with no contour detection and no ORB — the user
    // would have to reload to get recognition back. Clearing it lets the next
    // scan try again.
    cvPromise = null;
  });
  return cvPromise;
}

// ---------- card index ----------
let index = null, cards = null, manifest = null, shardedIndex = false, indexPromise = null;
let colorIndex = null, artIndex = null; // v3 companion tables
const COLOR_BYTES = 13, ART_BYTES = 32;

function loadIndex() {
  if (indexPromise) return indexPromise;
  indexPromise = (async () => {
    const manifestResponse = await fetch("/carddata/manifest.json");
    if (manifestResponse.ok) {
      manifest = await manifestResponse.json();
      if (manifest.version >= 2) {
        shardedIndex = true;
        return manifest.count;
      }
    }
    const [h, c] = await Promise.all([fetch("/carddata/hashes.bin"), fetch("/carddata/cards.json")]);
    if (!h.ok || !c.ok) throw new Error("Card index not found");
    index = new Uint8Array(await h.arrayBuffer());
    cards = await c.json();
    if (index.length !== cards.length * VEC_BYTES) throw new Error("Card index corrupted");
    return cards.length;
  })();
  return indexPromise;
}

async function loadGlobalIndex() {
  if (index && cards) return cards.length;
  const [hashResponse, cardsResponse] = await Promise.all([
    fetch("/carddata/hashes.bin"),
    fetch("/carddata/cards.json"),
  ]);
  if (!hashResponse.ok || !cardsResponse.ok) throw new Error("Global fallback index not found");
  index = new Uint8Array(await hashResponse.arrayBuffer());
  cards = await cardsResponse.json();
  if (index.length !== cards.length * VEC_BYTES) throw new Error("Global fallback index corrupted");
  // v3 companion tables: per-printing color histograms + art-region hashes.
  // Optional — a v2 deployment simply proceeds grayscale-only.
  if ((manifest?.version || 0) >= 3) {
    try {
      const [colorResp, artResp] = await Promise.all([
        fetch("/carddata/colors.bin"),
        fetch("/carddata/arthashes.bin"),
      ]);
      if (colorResp.ok) {
        const table = new Uint8Array(await colorResp.arrayBuffer());
        if (table.length === cards.length * COLOR_BYTES) colorIndex = table;
      }
      if (artResp.ok) {
        const table = new Uint8Array(await artResp.arrayBuffer());
        if (table.length === cards.length * ART_BYTES) artIndex = table;
      }
      console.log(`[snapcaster worker] v3 tables: color=${!!colorIndex} art=${!!artIndex}`);
    } catch (e) { /* grayscale-only */ }
  }
  return cards.length;
}

function cardMeta(i, distance) {
  const [name, set, cn, id, face] = cards[i];
  const side = face === 1 ? "back" : "front";
  return {
    name, set, collector_number: cn,
    scryfall_id: id, face,
    image: `https://cards.scryfall.io/normal/${side}/${id[0]}/${id[1]}/${id}.jpg`,
    scryfall_uri: `https://scryfall.com/card/${set}/${cn}`,
    distance,
    confidence: Math.max(0, Math.min(1, (CONF_BAD - distance) / (CONF_BAD - CONF_GOOD))),
  };
}

// ---------- OpenCV card outline detection + perspective rectify ----------
function orderCorners(pts) {
  const cx = pts.reduce((sum, p) => sum + p.x, 0) / pts.length;
  const cy = pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
  // Cyclic angle ordering remains valid for diamonds and strongly foreshortened
  // trapezoids; sum/difference corner heuristics can duplicate or swap corners.
  const ordered = [...pts].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );
  const start = ordered.reduce((best, p, i) => (
    p.y < ordered[best].y || (p.y === ordered[best].y && p.x < ordered[best].x) ? i : best
  ), 0);
  return [...ordered.slice(start), ...ordered.slice(0, start)];
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
  const sides = corners.map((p, i) => {
    const next = corners[(i + 1) % corners.length];
    return Math.hypot(next.x - p.x, next.y - p.y);
  });
  const width = (sides[0] + sides[2]) / 2;
  const height = (sides[1] + sides[3]) / 2;
  const aspect = Math.max(width, height) / Math.max(1, Math.min(width, height));
  const minEdge = Math.min(...sides);
  const oppositeBalance = (Math.min(sides[0], sides[2]) / Math.max(sides[0], sides[2]))
    * (Math.min(sides[1], sides[3]) / Math.max(sides[1], sides[3]));
  const quadArea = Math.abs(corners.reduce((sum, p, i) => {
    const next = corners[(i + 1) % corners.length];
    return sum + p.x * next.y - next.x * p.y;
  }, 0) / 2);
  const cx = pts.reduce((sum, p) => sum + p.x, 0) / 4;
  const cy = pts.reduce((sum, p) => sum + p.y, 0) / 4;
  const centerDistance = Math.hypot(
    (cx - click.x) / imageWidth,
    (cy - click.y) / imageHeight,
  );
  // A Magic card is 1.39:1. Permit perspective distortion but strongly prefer
  // card-like, centered contours because the capture is centered on the click.
  const aspectFit = Math.max(0.12, 1 - Math.abs(aspect - CARD_H / CARD_W) * 0.55);
  const centerFit = Math.max(0.2, 1 - centerDistance * 2);
  const containsClick = pointInQuad(click, corners);
  const valid = minEdge >= Math.min(imageWidth, imageHeight) * 0.018
    && quadArea >= imageWidth * imageHeight * 0.003
    && oppositeBalance >= 0.08;
  return {
    corners, aspect, containsClick, valid,
    // sqrt(area), not area: scoring linearly in area let a merged blob of two
    // side-by-side cards beat the single correct card. Such a pair has aspect
    // ~1.43 against a card's 1.397, so aspectFit cannot tell them apart, and at
    // twice the area it always won. Scoring by linear size instead of area
    // roughly halves that advantage.
    score: Math.sqrt(area) * aspectFit * centerFit * Math.max(0.25, oppositeBalance),
  };
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
      // RETR_LIST keeps inner card/frame borders even when the outer edge
      // visually merges with a hand, hair, sleeve, or playmat.
      cv.findContours(mat, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i);
        const area = cv.contourArea(c);
        if (area > imgArea * 0.004 && area < imgArea * 0.98) {
          const addPoints = (pts) => {
            const geometry = quadGeometry(pts, srcImageData.width, srcImageData.height, area, click);
            if (geometry.valid && geometry.aspect >= 1.0 && geometry.aspect <= 3.4) {
              const key = geometry.corners.map((p) => `${Math.round(p.x / 8)},${Math.round(p.y / 8)}`).join("|");
              if (!seen.has(key)) {
                seen.add(key);
                results.push(geometry);
              }
            }
          };
          const hull = new cv.Mat();
          cv.convexHull(c, hull);
          for (const shape of [c, hull]) {
            const peri = cv.arcLength(shape, true);
            for (const epsilon of [0.02, 0.04, 0.06]) {
              const approx = new cv.Mat();
              cv.approxPolyDP(shape, approx, epsilon * peri, true);
              if (approx.rows === 4 && cv.isContourConvex(approx)) {
                const pts = [];
                for (let r = 0; r < 4; r++) {
                  pts.push({ x: approx.data32S[r * 2], y: approx.data32S[r * 2 + 1] });
                }
                addPoints(pts);
              }
              approx.delete();
            }
          }
          // A noisy or partially occluded card may never approximate to exactly
          // four vertices. Its minimum-area rectangle is still a useful card
          // candidate, especially because the user clicked inside it.
          const rect = cv.minAreaRect(hull);
          if (rect?.size?.width > 0 && rect?.size?.height > 0) {
            const angle = rect.angle * Math.PI / 180;
            const ux = { x: Math.cos(angle) * rect.size.width / 2, y: Math.sin(angle) * rect.size.width / 2 };
            const vx = { x: -Math.sin(angle) * rect.size.height / 2, y: Math.cos(angle) * rect.size.height / 2 };
            addPoints([
              { x: rect.center.x - ux.x - vx.x, y: rect.center.y - ux.y - vx.y },
              { x: rect.center.x + ux.x - vx.x, y: rect.center.y + ux.y - vx.y },
              { x: rect.center.x + ux.x + vx.x, y: rect.center.y + ux.y + vx.y },
              { x: rect.center.x - ux.x + vx.x, y: rect.center.y - ux.y + vx.y },
            ]);
          }
          hull.delete();
        }
        c.delete();
      }
      contours.delete(); hier.delete();
    };
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    for (const [low, high] of [[15, 60], [30, 120], [60, 180]]) {
      cv.Canny(blur, bin, low, high);
      cv.dilate(bin, bin, kernel);
      tryBin(bin);
    }
    cv.adaptiveThreshold(blur, bin, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 31, 5);
    const k5 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
    cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, k5);
    tryBin(bin);
    cv.threshold(blur, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    tryBin(bin);
    cv.bitwise_not(bin, bin);
    tryBin(bin);
    // Low-contrast rescue: a white-bordered card against a light wall has
    // almost no luminance edge, but the colorful art/frame pops in the
    // saturation channel even then.
    // Every Mat here is released in a finally. These were freed at the end of
    // the try, under a catch that swallows the error — so any throw leaked
    // four objects into a heap the garbage collector cannot touch, silently.
    let rgb = null, hsv = null, channels = null, sat = null;
    try {
      rgb = new cv.Mat(); hsv = new cv.Mat(); channels = new cv.MatVector();
      cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
      cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
      cv.split(hsv, channels);
      sat = channels.get(1);
      cv.threshold(sat, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, k5);
      tryBin(bin);
    } catch (e) { /* saturation pass is best-effort */ } finally {
      if (sat) sat.delete();
      if (channels) channels.delete();
      if (hsv) hsv.delete();
      if (rgb) rgb.delete();
    }
    kernel.delete(); k5.delete();
  } finally {
    src.delete(); gray.delete(); blur.delete(); bin.delete();
  }
  const containing = results.filter((result) => result.containsClick);
  const pool = containing.length ? containing : results;
  pool.sort((a, b) => b.score - a.score);
  // Perspective can create several strong inner-frame and minimum-rectangle
  // candidates. Keep enough alternatives for title OCR to identify the true
  // outer card rather than committing to the first geometric guess.
  return pool.slice(0, 8).map((result) => result.corners);
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
  // Rectify near the card's native resolution in the source frame (capped),
  // not the 244px hash thumbnail — title OCR needs every captured pixel.
  const nativeW = landscape ? Math.max(hL, hR) : Math.max(wTop, wBot);
  const scale = Math.max(1, Math.min(OCR_MAX_W, Math.round(nativeW)) / CARD_W);
  const outW = Math.round(CARD_W * scale), outH = Math.round(CARD_H * scale);
  const dw = landscape ? outH : outW, dh = landscape ? outW : outH;

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
  // Keep native resolution (capped) rather than the 244px hash thumbnail so
  // the title stays legible for OCR.
  const outScale = Math.max(1, Math.min(OCR_MAX_W, cw) / CARD_W);
  const ow = Math.round(CARD_W * outScale), oh = Math.round(CARD_H * outScale);
  const canvas = new OffscreenCanvas(ow, oh);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, x0, y0, cw, ch, 0, 0, ow, oh);
  return ctx.getImageData(0, 0, ow, oh);
}

// Card-shaped crop whose *anchor* — not centre — sits on the clicked point.
// centerCropImageData assumes the click is the middle of the card, but players
// click what they are looking at: the artwork, which spans roughly 0.10-0.56 of
// the card's height and centres near 0.33. A crop centred on an art click sits
// too high, so the card is vertically misframed and its hash lands far from the
// index entry (built from a properly framed scan). anchorV is where the click
// should land inside the crop, as a fraction of crop height.
function anchoredCropImageData(bmp, scale, point, anchorV, anchorH = 0.5, landscape = false) {
  const w = bmp.width, h = bmp.height;
  // A tapped permanent lies sideways, so the region to cut is landscape. Every
  // other crop here is portrait card-shaped, which cannot frame a tapped card:
  // containing a 321x230 sideways card needs a 321x448 portrait crop, and the
  // 218px of slack fills with neighbours. Tapped cards scored 42% against 73%
  // upright for exactly this reason.
  const aw = landscape ? CARD_H : CARD_W;
  const ah = landscape ? CARD_W : CARD_H;
  let ch = Math.round(h * scale), cw = Math.round((ch * aw) / ah);
  if (cw > w) { cw = Math.round(w * scale); ch = Math.round((cw * ah) / aw); }
  const cx = point.nx * w, cy = point.ny * h;
  const x0 = Math.max(0, Math.min(w - cw, cx - cw * anchorH));
  const y0 = Math.max(0, Math.min(h - ch, cy - ch * anchorV));
  const outScale = Math.max(1, Math.min(OCR_MAX_W, cw) / aw);
  const ow = Math.round(aw * outScale), oh = Math.round(ah * outScale);
  const canvas = new OffscreenCanvas(ow, oh);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, x0, y0, cw, ch, 0, 0, ow, oh);
  return ctx.getImageData(0, 0, ow, oh);
}

function bitmapToImageData(bmp) {
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, bmp.width, bmp.height);
}

// Click-centered crop counter-rotated by angleDeg. Tilted cards on busy
// backgrounds often produce no clean contour quad, and plain hash matching
// only tolerates a few degrees plus exact 90° steps — counter-rotating the
// crop hands the matcher an upright card anyway.
function tiltCropImageData(bmp, angleDeg, scale, point) {
  const w = bmp.width, h = bmp.height;
  let ch = Math.round(h * scale), cw = Math.round((ch * CARD_W) / CARD_H);
  if (cw > w) { cw = Math.round(w * scale); ch = Math.round((cw * CARD_H) / CARD_W); }
  const outScale = Math.max(1, Math.min(OCR_MAX_W, cw) / CARD_W);
  const ow = Math.round(CARD_W * outScale), oh = Math.round(CARD_H * outScale);
  const cx = Math.max(cw / 2, Math.min(w - cw / 2, point.nx * w));
  const cy = Math.max(ch / 2, Math.min(h - ch / 2, point.ny * h));
  const canvas = new OffscreenCanvas(ow, oh);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, ow, oh);
  ctx.translate(ow / 2, oh / 2);
  ctx.rotate((-angleDeg * Math.PI) / 180);
  ctx.drawImage(bmp, cx - cw / 2, cy - ch / 2, cw, ch, -ow / 2, -oh / 2, ow, oh);
  return ctx.getImageData(0, 0, ow, oh);
}

async function makeTitleImage(cardImage, turns = 0, mode = "plain", placement = "top") {
  const source = new OffscreenCanvas(cardImage.width, cardImage.height);
  source.getContext("2d").putImageData(cardImage, 0, 0);
  let oriented = source;
  if (turns) {
    const sideways = turns % 2 === 1;
    oriented = new OffscreenCanvas(
      sideways ? cardImage.height : cardImage.width,
      sideways ? cardImage.width : cardImage.height,
    );
    const rotate = oriented.getContext("2d");
    if (turns === 1) {
      rotate.translate(oriented.width, 0);
      rotate.rotate(Math.PI / 2);
    } else if (turns === 2) {
      rotate.translate(oriented.width, oriented.height);
      rotate.rotate(Math.PI);
    } else {
      rotate.translate(0, oriented.height);
      rotate.rotate(-Math.PI / 2);
    }
    rotate.drawImage(source, 0, 0);
  }
  const canvas = new OffscreenCanvas(1000, 140);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Most cards put their name at the top. Showcase/full-art basics (including
  // SNC metropolis lands) can put it in a narrow bar near the bottom instead.
  // Exclude the right-side mana/symbol area in either treatment.
  const titleY = placement === "bottom" ? 0.82 : 0.025;
  const titleH = placement === "bottom" ? 0.115 : 0.1;
  ctx.drawImage(
    oriented,
    oriented.width * 0.04, oriented.height * titleY,
    oriented.width * 0.76, oriented.height * titleH,
    10, 10, 980, 120,
  );
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const grays = new Float32Array(pixels.data.length / 4);
  for (let p = 0, i = 0; p < pixels.data.length; p += 4, i++) {
    grays[i] = 0.299 * pixels.data[p] + 0.587 * pixels.data[p + 1] + 0.114 * pixels.data[p + 2];
  }
  if (mode === "flat") {
    // Glare / uneven lighting rescue: estimate the low-frequency illumination
    // field (heavy downscale + smooth upscale) and divide it out, so a bright
    // streak across half the title no longer swallows the letters, then
    // percentile-stretch what remains.
    for (let i = 0; i < grays.length; i++) pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = grays[i];
    ctx.putImageData(pixels, 0, 0);
    const small = new OffscreenCanvas(50, 8);
    small.getContext("2d").drawImage(canvas, 0, 0, 50, 8);
    const field = new OffscreenCanvas(canvas.width, canvas.height);
    const fieldCtx = field.getContext("2d");
    fieldCtx.imageSmoothingEnabled = true;
    fieldCtx.imageSmoothingQuality = "high";
    fieldCtx.drawImage(small, 0, 0, canvas.width, canvas.height);
    const illum = fieldCtx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < grays.length; i++) {
      grays[i] = Math.min(255, (grays[i] / Math.max(25, illum[i * 4])) * 150);
    }
    const sorted = Float32Array.from(grays).sort();
    const lo = sorted[Math.floor(sorted.length * 0.02)];
    const hi = sorted[Math.floor(sorted.length * 0.98)];
    const range = Math.max(1, hi - lo);
    for (let i = 0; i < grays.length; i++) {
      grays[i] = Math.max(0, Math.min(255, ((grays[i] - lo) / range) * 255));
    }
  }
  for (let p = 0, i = 0; p < pixels.data.length; p += 4, i++) {
    pixels.data[p] = pixels.data[p + 1] = pixels.data[p + 2] = grays[i];
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

  // Per-stage wall-clock timing, surfaced through SNAPTEST/?debug=1 so speed
  // work is guided by measurements instead of guesses.
  const stage = { t: performance.now(), ms: {} };
  const mark = (key) => {
    const now = performance.now();
    stage.ms[key] = Math.round((stage.ms[key] || 0) + (now - stage.t));
    stage.t = now;
  };

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
  // The small scales matter for hand-held and playmat cards: a card ~1/8 of
  // the frame needs a tight crop or the hash/color see mostly background.
  for (const scale of [0.9, 0.75, 0.6, 0.45, 0.35, 0.27, 0.2]) {
    candidates.push({
      image: centerCropImageData(bmp, scale, normalizedPoint),
      strategy: `center-${Math.round(scale * 100)}`,
    });
  }
  // Counter-rotated crops rescue tilted cards (hand-held at ~20°, or lying at
  // ~20-40° on the playmat) when no contour quad isolated it. 90° steps are
  // already covered by the hash rotations, so ±20/±40 fills the gaps between.
  for (const [angle, scale] of [[20, 0.6], [-20, 0.6], [20, 0.35], [-20, 0.35], [40, 0.6], [-40, 0.6]]) {
    candidates.push({
      image: tiltCropImageData(bmp, angle, scale, normalizedPoint),
      strategy: `tilt${angle}@${Math.round(scale * 100)}`,
    });
  }
  // Clicks frequently land below or beside the card (debug captures show the
  // card pushed to the top of a centered crop, framed by forehead/hand). Offset
  // crops re-center on where the card actually is — the up-bias is strongest
  // since a card held to the forehead sits above the natural click.
  for (const [dx, dy] of [[0, -0.11], [0, -0.06], [-0.08, -0.04], [0.08, -0.04], [0, 0.07]]) {
    const p = { nx: normalizedPoint.nx + dx, ny: normalizedPoint.ny + dy };
    candidates.push({ image: centerCropImageData(bmp, 0.4, p), strategy: `off${Math.round(dx * 100)},${Math.round(dy * 100)}` });
  }
  // Deep up-offsets: a card held to the forehead sits 15-30% of the frame
  // above the click, beyond the reach of the mild offsets above. Real scans
  // regressed on exactly this while every crop stayed centered on the click.
  candidates.push({ image: centerCropImageData(bmp, 0.45, { nx: normalizedPoint.nx, ny: normalizedPoint.ny - 0.18 }), strategy: "off0,-18" });
  candidates.push({ image: centerCropImageData(bmp, 0.5, { nx: normalizedPoint.nx, ny: normalizedPoint.ny - 0.26 }), strategy: "off0,-26" });
  // Art-anchored crops: put the click a third of the way down the crop, where
  // the artwork actually is. Every crop above centres the card on the click, so
  // when a player clicks the art (the natural target) the card is framed too
  // high and no candidate matches the index framing. Several scales because we
  // cannot know how much of the frame the card occupies.
  for (const scale of [0.8, 0.65, 0.5, 0.38, 0.28]) {
    candidates.push({
      image: anchoredCropImageData(bmp, scale, normalizedPoint, ART_CLICK_V),
      strategy: `art-${Math.round(scale * 100)}`,
    });
  }
  // The player opposite (or a flipped tile) sends cards rotated 180, which puts
  // the artwork in the LOWER third of the card as it appears in frame. The
  // anchors above then frame such a card wrongly, and because they are seeds
  // they crowded out the generic crops that used to catch it — upside-down
  // accuracy fell from 58% to 33% when they landed. Mirror the anchor.
  for (const scale of [0.65, 0.5, 0.38]) {
    candidates.push({
      image: anchoredCropImageData(bmp, scale, normalizedPoint, 1 - ART_CLICK_V),
      strategy: `artf-${Math.round(scale * 100)}`,
    });
  }
  // Title-anchored: some players click the name bar instead of the art.
  for (const scale of [0.65, 0.45]) {
    candidates.push({
      image: anchoredCropImageData(bmp, scale, normalizedPoint, 0.08),
      strategy: `title-${Math.round(scale * 100)}`,
    });
  }
  // Tapped (sideways) cards need a landscape cut. The art sits a third along
  // the card's long axis, which is now horizontal — and which end depends on
  // whether the card was turned clockwise or anticlockwise, so probe both.
  for (const scale of [0.5, 0.38]) {
    for (const [side, anchorH] of [["l", 1 / 3], ["r", 2 / 3]]) {
      candidates.push({
        image: anchoredCropImageData(bmp, scale, normalizedPoint, 0.5, anchorH, true),
        strategy: `tap-${Math.round(scale * 100)}${side}`,
      });
    }
  }
  if (bmp.close) bmp.close();

  // Rank every candidate against the full printing index. The sharded (v2)
  // format ships hashes.bin too — without this load the initial ranking ran
  // against nothing and recognition depended entirely on OCR.
  if (shardedIndex && !index) {
    try { await loadGlobalIndex(); } catch (e) { console.warn("[snapcaster worker] global index unavailable", e); }
  }
  const n = cards?.length || 0;
  const dists = new Uint16Array(n).fill(0xffff);
  const useV3 = n > 0 && (colorIndex || artIndex);
  // Global art-hash-only ranking over card-shaped candidates. When occlusion
  // or color cast poisons the gray ranking, the art region alone can still
  // shortlist the right card for ORB verification.
  const artGlobal = useV3 && artIndex ? new Uint16Array(n).fill(0xffff) : null;
  const artGlobalStrategies = new Set([
    "full-frame", "outline-1", "outline-2", "outline-3", "outline-4", "outline-5",
    "center-45", "center-35", "center-27",
    "tilt20@35", "tilt-20@35", "off0,-11", "off0,-6", "off-8,-4", "off8,-4", "off0,7",
    "off0,-18", "off0,-26",
    // Art-anchored crops frame the card the way the index does, so their art
    // region lands where compute_art_hash expects it — these are the best
    // possible inputs to art-hash scoring, not an afterthought.
    "art-80", "art-65", "art-50", "art-38", "art-28", "title-65", "title-45",
    "tap-50l", "tap-50r", "tap-38l", "tap-38r",
    "artf-65", "artf-50", "artf-38",
  ]);
  // Combined gray+art+color ranking score (v3). Gray distances stay in `dists`
  // for the calibrated display/keep gates.
  const rank = useV3 ? new Float64Array(n).fill(Infinity) : null;
  const strategies = new Array(n).fill("none");
  const queryCandidates = [];
  let candidatesTried = 0;
  let bestCandidateImage = null;
  let bestCandidateStrategy = "";
  let bestCandidateDistance = 0xffff;
  // Prepare every candidate's hashes (cheap). The expensive full-index scans
  // below are limited to a few diverse SEED crops; scoring all ~27 crops
  // against 110k cards (8 hash variants each) was the dominant per-scan cost.
  const preparedAll = candidates.map((candidate) => {
    // White-balance the crop so a warm/cool room cast doesn't bias the
    // grayscale hash or the color signature toward mis-tinted cards.
    const wbImage = whiteBalance(candidate.image);
    const gray = toGray(wbImage);
    const variants = queryVariants(gray);
    return { candidate, wbImage, gray, variants, detail: detailScore(gray) };
  });
  // Drop crops that contain no card — just wall, skin, or playmat. A
  // featureless crop hashes closest to a FEATURELESS INDEX ENTRY, which is why
  // "Blank Card", "Double-Faced Substitute Card" and "Find the Assassin
  // (cont'd)" accounted for a quarter of all misses once degrade v2 started
  // placing cards off-center and edge-cut. Even a small, blurry card carries
  // frame borders and text, so it clears this bar comfortably; empty
  // background does not.
  //
  // The bar is RELATIVE to the sharpest crop in this frame, not absolute. A
  // dim, vignetted table photo has low gradient energy everywhere, so a fixed
  // threshold discarded almost every crop: benchmark runs showed cases with 34
  // of 35 crops dropped and a single candidate left to identify from. Scoring
  // one arbitrary survivor is worse than scoring a few soft ones. A hard floor
  // of MIN_KEEP guarantees the pipeline always has a real choice.
  const sortedByDetail = [...preparedAll].sort((a, b) => b.detail - a.detail);
  const bestDetail = sortedByDetail[0]?.detail || 0;
  const detailBar = Math.min(BACKGROUND_DETAIL_MIN, bestDetail * 0.4);
  const MIN_KEEP = Math.min(12, preparedAll.length);
  const floorSet = new Set(sortedByDetail.slice(0, MIN_KEEP));
  // Filter preparedAll (not the sorted copy) so candidate order is preserved.
  const prepared = preparedAll.filter((p) => p.detail >= detailBar || floorSet.has(p));
  // The visual fallback searches these too, so it must not see background
  // crops either — same blank-card trap, different code path.
  for (const p of prepared) {
    queryCandidates.push({ strategy: p.candidate.strategy, vectors: p.variants });
  }
  if (prepared.length) {
    bestCandidateImage = prepared[0].candidate.image;
    bestCandidateStrategy = prepared[0].candidate.strategy;
  }
  mark("prep");

  // Default: 4 rotations × default art window. With shifts: also try several
  // upward art windows on the upright orientation. Arcane-medium photos (and
  // real handheld captures that clip the name bar) need those shifts or the
  // art hash never approaches the index and the correct card stays absent.
  const artVecsFor = (gray, { shifts = false } = {}) => {
    if (!(useV3 && artIndex)) return null;
    const v = [];
    let img = gray;
    for (let r = 0; r < 4; r++) {
      if (r === 0 && shifts) {
        for (const s of ART_Y_SHIFTS) v.push(artPHash(img, s));
      } else {
        v.push(artPHash(img));
      }
      img = rotate90(img);
    }
    return v;
  };
  const combineScore = (grayDist, idx, artVecs, colorSig) => {
    let score = grayDist;
    if (artVecs) {
      let artDist = 0xffff;
      const off = idx * ART_BYTES;
      for (const av of artVecs) {
        let d = 0;
        for (let b = 0; b < ART_BYTES; b++) d += POPCOUNT[artIndex[off + b] ^ av[b]];
        if (d < artDist) artDist = d;
      }
      score += artDist * 1.8; // 256-bit art hash weighted near the 512-bit gray hash
    }
    if (colorSig) {
      let sim = 0;
      const off = idx * COLOR_BYTES;
      for (let b = 0; b < COLOR_BYTES; b++) sim += Math.min(colorSig[b], colorIndex[off + b] / 255);
      score += (1 - Math.min(1, sim)) * 150; // color clash pushes a printing far down
    }
    return score;
  };

  // Coarse-to-fine: diverse, well-isolated seed crops get the full 110k scan
  // and define a shortlist (every card any seed brought into contention); the
  // remaining ~20 crops only refine that shortlist. A decisive seed (gray
  // distance <= 60) short-circuits everything.
  // off0,-11 is a mandatory seed: real players hold the card above where they
  // click (forehead hold, card near the frame edge), so the up-shifted crop is
  // often the ONLY candidate that frames the card at all.
  // art-* are mandatory seeds for the same reason: a click on the artwork is
  // the common case, and only the art-anchored crops frame the card correctly
  // for it. A non-seed crop can only refine the shortlist the seeds built, so
  // if no seed frames the card the right answer can never enter contention —
  // which is exactly the "correct card absent from every match" signature.
  // Seed the first FIVE outline rectifications, not two. A correctly rectified
  // card measures d85-151 against the index (verified by cropping a card
  // perfectly out of a benchmark scene), so it wins on distance the moment it
  // is scored — it does not need to be the top-ranked quad, it only needs to be
  // a seed at all. Among many overlapping cards the right quad routinely lands
  // 3rd or 4th, which previously meant it only ever refined a shortlist it was
  // never in, and the correct card was absent from every match.
  const SEED_PRIORITY = ["full-frame", "outline-1", "outline-2", "outline-3",
    "art-50", "art-65", "artf-50", "artf-65", "tap-50l", "tap-50r",
    "center-45", "off0,-11", "outline-4", "art-38", "artf-38", "center-27",
    "off0,-18", "tilt20@60", "tilt-20@60"];
  const seedIdx = new Set();
  for (const s of SEED_PRIORITY) {
    const i = prepared.findIndex((p, pi) => !seedIdx.has(pi) && p.candidate.strategy === s);
    if (i >= 0) seedIdx.add(i);
    // Each seed is a full 110k scan. Twelve seeds ran ~4x slower per card in a
    // spot check with no measured accuracy gain, so the budget stays at 8;
    // outline-3 and the two art-anchored crops are the additions worth paying
    // for. Widening this again needs evidence, not intuition.
    if (seedIdx.size >= 10) break;
  }
  for (let i = 0; i < prepared.length && seedIdx.size < 5; i++) seedIdx.add(i);

  // Full-index scoring of one seed crop; updates dists/rank/artGlobal and the
  // best-candidate tracking. Returns the crop's best gray distance.
  const scoreFull = (p) => {
    candidatesTried++;
    const candidateDists = new Uint16Array(n).fill(0xffff);
    for (const q of p.variants) hammingSearch(q, index, n, candidateDists);
    let candidateBest = 0xffff;
    for (let i = 0; i < n; i++) {
      if (candidateDists[i] < candidateBest) candidateBest = candidateDists[i];
      if (candidateDists[i] < dists[i]) {
        dists[i] = candidateDists[i];
        if (!useV3) strategies[i] = p.candidate.strategy;
      }
    }
    if (useV3) {
      // Rescore this candidate's ~1000 gray-closest printings with art+color.
      // This pool doubles as the fine-pass shortlist, so a wider pool directly
      // widens recall for cards whose best crop is NOT a seed (a heavily
      // occluded card can sit below every seed's top 400 yet still be found by
      // the right non-seed crop). The extra scoring cost is negligible.
      const counts = new Uint32Array(513);
      for (let i = 0; i < n; i++) counts[candidateDists[i] <= 512 ? candidateDists[i] : 512]++;
      let cutoff = 0, cumulative = 0;
      while (cutoff < 512 && cumulative + counts[cutoff] < 1000) { cumulative += counts[cutoff]; cutoff++; }
      const artVecs = artVecsFor(p.gray, { shifts: artGlobalStrategies.has(p.candidate.strategy) });
      if (artVecs && artGlobal && artGlobalStrategies.has(p.candidate.strategy)) {
        for (let i = 0; i < n; i++) {
          const off = i * ART_BYTES;
          for (const av of artVecs) {
            let d = 0;
            for (let b = 0; b < ART_BYTES; b++) d += POPCOUNT[artIndex[off + b] ^ av[b]];
            if (d < artGlobal[i]) artGlobal[i] = d;
          }
        }
      }
      const colorSig = colorIndex ? colorSignature(p.wbImage) : null;
      for (let i = 0; i < n; i++) {
        if (candidateDists[i] > cutoff) continue;
        const score = combineScore(candidateDists[i], i, artVecs, colorSig);
        if (score < rank[i]) { rank[i] = score; strategies[i] = p.candidate.strategy; }
      }
    }
    if (candidateBest < bestCandidateDistance) {
      bestCandidateDistance = candidateBest;
      bestCandidateImage = p.candidate.image;
      bestCandidateStrategy = p.candidate.strategy;
    }
    return candidateBest;
  };

  if (n) {
    let decisive = false;
    for (const i of seedIdx) {
      if (scoreFull(prepared[i]) <= 60) { decisive = true; break; }
    }
    if (!decisive) {
      // Shortlist = every printing a seed brought into contention (finite
      // combined rank under v3, or the gray-closest 4000 under v2).
      let shortlist;
      if (useV3) {
        shortlist = [];
        for (let i = 0; i < n; i++) if (rank[i] < Infinity) shortlist.push(i);
      } else {
        shortlist = Array.from({ length: n }, (_, i) => i)
          .sort((a, b) => dists[a] - dists[b]).slice(0, 4000);
      }
      for (let pi = 0; pi < prepared.length; pi++) {
        if (seedIdx.has(pi)) continue;
        const p = prepared[pi];
        candidatesTried++;
        const artVecs = artVecsFor(p.gray, { shifts: artGlobalStrategies.has(p.candidate.strategy) });
        const colorSig = (useV3 && colorIndex) ? colorSignature(p.wbImage) : null;
        let candidateBest = 0xffff;
        for (const idx of shortlist) {
          let d = 0xffff;
          const off = idx * VEC_BYTES;
          for (const q of p.variants) {
            let dd = 0;
            for (let b = 0; b < VEC_BYTES; b++) dd += POPCOUNT[index[off + b] ^ q[b]];
            if (dd < d) d = dd;
          }
          if (d < candidateBest) candidateBest = d;
          if (d < dists[idx]) { dists[idx] = d; if (!useV3) strategies[idx] = p.candidate.strategy; }
          if (useV3) {
            const score = combineScore(d, idx, artVecs, colorSig);
            if (score < rank[idx]) { rank[idx] = score; strategies[idx] = p.candidate.strategy; }
          }
        }
        if (candidateBest < bestCandidateDistance) {
          bestCandidateDistance = candidateBest;
          bestCandidateImage = p.candidate.image;
          bestCandidateStrategy = p.candidate.strategy;
        }
        if (candidateBest <= 60) break;
      }
    }
    // Escalation: if even the best crop still looks like garbage (no seed or
    // shortlist-refined crop got anywhere near a match), fall back to full
    // 110k scans of the remaining crops — real captures of off-center or
    // edge-cut cards are exactly the case where a non-seed crop is the only
    // one framing the card, and its true match may sit outside every seed's
    // contention pool. The slow path only runs when the fast path has already
    // failed, so ordinary scans keep their speed.
    if (bestCandidateDistance > 165) {
      for (let pi = 0; pi < prepared.length; pi++) {
        if (seedIdx.has(pi)) continue;
        if (scoreFull(prepared[pi]) <= 60) break;
      }
    }
  }
  mark("rank");
  const rankArr = rank || dists;

  // Keep a deep printing-level pool. Basic lands and heavily reprinted cards
  // can have hundreds of distinct treatments (Mountain currently has 800+),
  // so collapsing by name before art verification discards the exact artwork.
  // Selection uses the combined gray+art+color rank when v3 tables are loaded;
  // reported distance stays the calibrated gray hash distance.
  const top = [];
  for (let i = 0; i < n; i++) {
    if (top.length < 72 || rankArr[i] < top[top.length - 1].r) {
      top.push({ i, r: rankArr[i] });
      top.sort((a, b) => a.r - b.r);
      if (top.length > 72) top.pop();
    }
  }
  const printingMatches = top
    .filter((t) => Number.isFinite(t.r))
    .map((t) => ({ ...cardMeta(t.i, dists[t.i]), strategy: strategies[t.i] }));
  const matches = [];
  const names = new Set();
  for (const match of printingMatches) {
    if (names.has(match.name)) continue;
    names.add(match.name);
    matches.push(match);
    if (matches.length === 24) break;
  }
  // Build a printing-level ORB shortlist: 24 combined-rank printings plus up
  // to 20 pure-art printings (44 total). Art-global rescue is how top-cropped
  // photos (name bar already gone, art still visible) enter ORB after gray
  // hashing is poisoned — give it enough slots. Deliberately do not
  // deduplicate by name here; different Mountain artworks must each get a
  // chance to match geometrically.
  const verificationCandidates = [];
  const verificationIds = new Set();
  const addVerification = (match) => {
    const key = `${match.scryfall_id}:${match.face || 0}`;
    if (verificationIds.has(key) || verificationCandidates.length >= 44) return;
    verificationIds.add(key);
    verificationCandidates.push(match);
  };
  for (const match of printingMatches.slice(0, 24)) addVerification(match);

  // Union in the best pure-art-hash printings the combined ranking missed, so
  // ORB can rescue artwork whose gray/color rank was poisoned by blur,
  // occlusion, color cast, a loose crop, or a title bar already cut off.
  if (artGlobal) {
    const artTop = [];
    for (let i = 0; i < n; i++) {
      if (artTop.length < 20 || artGlobal[i] < artTop[artTop.length - 1].d) {
        artTop.push({ i, d: artGlobal[i] });
        artTop.sort((a, b) => a.d - b.d);
        if (artTop.length > 20) artTop.pop();
      }
    }
    for (const t of artTop) {
      if (t.d === 0xffff) continue;
      const meta = cardMeta(t.i, dists[t.i]);
      addVerification({ ...meta, strategy: "art-global" });
      if (names.has(meta.name)) continue;
      names.add(meta.name);
      matches.push({ ...meta, strategy: "art-global" });
      if (matches.length >= 44) break;
    }
  }
  // v2/grayscale fallback, or duplicate art candidates, may leave spare ORB
  // slots. Fill them from the deeper combined pool without name deduplication.
  for (const match of printingMatches.slice(24)) addVerification(match);
  // Stage C: verify the top hash guesses against the real card images by
  // matching art keypoints. A decisive art match settles identity outright.
  let matchesOut = matches;
  let artBest = null, artChecked = 0, artDecisive = false;
  if (cvReady && verificationCandidates.length && bestCandidateImage) {
    try {
      // Feed ORB a DIVERSE crop set. Outline rectifications exclude the
      // skin/hair background, but on real camera scans the outline detector
      // regularly latches onto hair/hand edges instead of the card — trimming
      // to outline-only queries left ORB with two bad crops and 0-2 inliers on
      // every real scan. Always keep a center and an offset crop as backup;
      // they cost one extra keypoint pass and are the difference between an
      // art match and a shrug.
      // art-*/title-* are card-framed crops too, so they carry a usable border
      // ring for the frame-agreement check.
      const cardShaped = bestCandidateStrategy === "full-frame"
        || bestCandidateStrategy.startsWith("outline-")
        || bestCandidateStrategy.startsWith("art-")
        || bestCandidateStrategy.startsWith("artf-")
        || bestCandidateStrategy.startsWith("title-")
        || bestCandidateStrategy.startsWith("tap-");
      // Sourced from `prepared` (background crops already removed) so ORB is
      // never handed an empty wall/skin crop to match against.
      const kept = prepared.map((p) => p.candidate);
      const queryImages = [
        bestCandidateImage,
        ...kept.filter((c) => c.strategy.startsWith("outline-")).slice(0, 2).map((c) => c.image),
        // The art-anchored crop centres the artwork, which is exactly what ORB
        // matches on — it is the strongest keypoint query we can offer.
        kept.find((c) => c.strategy === "art-50")?.image,
        kept.find((c) => c.strategy === "art-65")?.image,
        kept.find((c) => c.strategy === "off0,-11")?.image,
        kept.find((c) => c.strategy === "center-45")?.image,
      ].filter((img, i, arr) => img && arr.indexOf(img) === i).slice(0, 5);
      const verified = await verifyTopMatches(verificationCandidates, queryImages, cardShaped);
      // Keep the result UI compact after printing-level verification. The best
      // verified treatment wins for each name, and a decisive exact artwork
      // remains first.
      const verifiedNames = new Set();
      matchesOut = verified.matches.filter((match) => {
        if (verifiedNames.has(match.name)) return false;
        verifiedNames.add(match.name);
        return true;
      }).slice(0, 36);
      artBest = verified.artBest;
      artChecked = verified.artChecked;
      artDecisive = verified.artDecisive;
    } catch (e) {
      console.warn("[snapcaster worker] art verification failed", e);
    }
  }
  mark("orb");

  // Title strips are now generated LAZILY (see the "title-strips" message):
  // a decisive art match skips OCR entirely, and eagerly rendering ~100 strip
  // PNGs cost ~1s on every scan whether or not OCR ever ran. The candidate
  // images are kept in-worker (titleSource) until the next scan replaces them.
  const preferredTitleCandidates = candidates
    .filter((candidate) => candidate.strategy === "full-frame" || candidate.strategy.startsWith("outline-"))
    .slice(0, 8);
  if (bestCandidateImage && !preferredTitleCandidates.some((candidate) => candidate.image === bestCandidateImage)) {
    preferredTitleCandidates.push({
      image: bestCandidateImage,
      strategy: bestCandidateStrategy || strategies[top[0]?.i] || "visual-best",
    });
  }
  return {
    matches: matchesOut, printingMatches, queryCandidates,
    titleSource: preferredTitleCandidates,
    titleCount: preferredTitleCandidates.length,
    cardFound, cvStatus, candidatesTried, shardedIndex,
    cropsDropped: preparedAll.length - prepared.length,
    artBest, artChecked, artDecisive, stageMs: stage.ms,
    // OpenCV's WASM heap is invisible to performance.memory, which is why a
    // 1000-card run reported 52MB of JS heap while the tab held 1.5GB.
    wasmHeapMB: self.cv && self.cv.HEAPU8 ? Math.round(self.cv.HEAPU8.length / 1e6) : null,
  };
}

// Render the OCR title strips for the most recent scan on demand. Kept out of
// identify() so the happy path (decisive art match) never pays for them.
async function makeTitleStrips(titleSource) {
  return Promise.all(titleSource.map(async (candidate, index) => ({
    strategy: candidate.strategy,
    images: await Promise.all([0, 1, 2, 3].map((turns) => makeTitleImage(candidate.image, turns, "plain"))),
    // Illumination-flattened variants, used by the main thread as a retry when
    // the plain reads score poorly (glare, dim rooms, hotspot lighting).
    imagesFlat: await Promise.all([0, 1, 2, 3].map((turns) => makeTitleImage(candidate.image, turns, "flat"))),
    // Alternate/full-art treatments sometimes move the name bar to the bottom.
    // These are tried only when ordinary top-title OCR is weak.
    imagesBottom: index < 4
      ? await Promise.all([0, 1, 2, 3].map((turns) => makeTitleImage(candidate.image, turns, "plain", "bottom")))
      : [],
    imagesBottomFlat: index < 4
      ? await Promise.all([0, 1, 2, 3].map((turns) => makeTitleImage(candidate.image, turns, "flat", "bottom")))
      : [],
  })));
}

// ---------- Stage C: reference verification via ORB art keypoints ----------
// "Compare the art to the other art": fetch the real Scryfall images for the
// top hash guesses and geometrically match keypoints between the query crop
// and each reference. Rotation/scale/perspective-invariant and far more
// decisive than hash distance — a correct card typically produces 20-80
// agreeing keypoints, a wrong one under 10.
const refCache = new Map(); // "id/face" -> Promise<ImageData|null>

function fetchReference(id, face) {
  const key = `${id}/${face}`;
  if (!refCache.has(key)) {
    if (refCache.size > 400) refCache.delete(refCache.keys().next().value);
    refCache.set(key, (async () => {
      const side = face === 1 ? "back" : "front";
      const resp = await fetch(`https://cards.scryfall.io/small/${side}/${id[0]}/${id[1]}/${id}.jpg`);
      if (!resp.ok) throw new Error("ref fetch failed");
      const bmp = await createImageBitmap(await resp.blob());
      const canvas = new OffscreenCanvas(CARD_W, CARD_H);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bmp, 0, 0, CARD_W, CARD_H);
      if (bmp.close) bmp.close();
      return ctx.getImageData(0, 0, CARD_W, CARD_H);
    })().catch(() => null));
  }
  return refCache.get(key);
}

function orbFeatures(imageData, nfeatures) {
  const cv = self.cv;
  const src = cv.matFromImageData(imageData);
  const gray = new cv.Mat();
  const mask = new cv.Mat();
  const kp = new cv.KeyPointVector();
  const desc = new cv.Mat();
  const orb = new cv.ORB(nfeatures);
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    orb.detectAndCompute(gray, mask, kp, desc);
  } finally {
    src.delete(); gray.delete(); mask.delete(); orb.delete();
  }
  return { kp, desc };
}

function orbScore(query, ref) {
  const cv = self.cv;
  if (!query.desc.rows || !ref.desc.rows) return 0;
  const bf = new cv.BFMatcher(cv.NORM_HAMMING, false);
  const knn = new cv.DMatchVectorVector();
  let inliers = 0;
  try {
    bf.knnMatch(query.desc, ref.desc, knn, 2);
    const qPts = [], rPts = [];
    for (let i = 0; i < knn.size(); i++) {
      // knn.get(i) hands back an OWNED DMatchVector, not a view — every one of
      // these must be released. This is the leak that doubled the WASM heap
      // (134MB -> 268MB) across a 100-card run: it runs once per match pair,
      // per reference (24 of them), per query image, on every single scan, and
      // OpenCV's heap is never reclaimed by the JS garbage collector.
      const pair = knn.get(i);
      try {
        if (pair.size() >= 2) {
          const m = pair.get(0), n = pair.get(1);
          if (m.distance < 0.75 * n.distance) {
            const qp = query.kp.get(m.queryIdx).pt, rp = ref.kp.get(m.trainIdx).pt;
            qPts.push(qp.x, qp.y); rPts.push(rp.x, rp.y);
          }
        }
      } finally {
        if (pair && pair.delete) pair.delete();
      }
    }
    const good = qPts.length / 2;
    if (good >= 8 && typeof cv.findHomography === "function") {
      // These MUST be freed on the throw path too. OpenCV Mats live in a fixed
      // WASM heap that no JS garbage collector can reclaim, so a leak here is
      // permanent for the life of the worker: the heap fills, every later
      // cv call fails silently, and art verification quietly reports 0
      // keypoints for the rest of the session.
      let qm = null, rm = null, hmask = null, H = null;
      try {
        qm = cv.matFromArray(good, 1, cv.CV_32FC2, qPts);
        rm = cv.matFromArray(good, 1, cv.CV_32FC2, rPts);
        hmask = new cv.Mat();
        H = cv.findHomography(qm, rm, cv.RANSAC, 5, hmask);
        for (let i = 0; i < hmask.rows; i++) inliers += hmask.data[i];
      } finally {
        if (qm) qm.delete();
        if (rm) rm.delete();
        if (hmask) hmask.delete();
        if (H) H.delete();
      }
    } else {
      inliers = good;
    }
  } finally {
    bf.delete(); knn.delete();
  }
  return inliers;
}

// Gray-world white balance. The index is built from neutral Scryfall scans,
// but a real room (warm lamps, sunset, screen glow) casts the whole capture —
// which is why dark cards kept matching sepia/fiery cards. Neutralizing the
// query before color and hash comparison removes that systematic bias.
// Returns a new ImageData; never mutates the input.
function whiteBalance(imageData) {
  const { data, width, height } = imageData;
  let sr = 0, sg = 0, sb = 0, count = 0;
  for (let i = 0; i < data.length; i += 16) { // sample every 4th pixel
    sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; count++;
  }
  const mr = sr / count, mg = sg / count, mb = sb / count;
  const gray = (mr + mg + mb) / 3;
  // Clamp channel gains so a nearly single-color scene can't blow up.
  const gr = Math.max(0.5, Math.min(2, gray / Math.max(1, mr)));
  const gg = Math.max(0.5, Math.min(2, gray / Math.max(1, mg)));
  const gb = Math.max(0.5, Math.min(2, gray / Math.max(1, mb)));
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    out[i] = data[i] * gr;
    out[i + 1] = data[i + 1] * gg;
    out[i + 2] = data[i + 2] * gb;
    out[i + 3] = data[i + 3];
  }
  return new ImageData(out, width, height);
}

// Saturation-weighted hue histogram (12 buckets + 1 neutral) over the card
// area. The single most human clue: a blue card must never lose to a red one.
function colorSignature(imageData) {
  const { data, width, height } = imageData;
  const hist = new Float32Array(13);
  const x0 = Math.floor(width * 0.1), x1 = Math.ceil(width * 0.9);
  const y0 = Math.floor(height * 0.08), y1 = Math.ceil(height * 0.92);
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * width + x) * 4;
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const s = max ? (max - min) / max : 0;
      if (s < 0.18 || max < 0.12) { hist[12] += 0.5; continue; }
      let h;
      if (max === r) h = ((g - b) / (max - min) + 6) % 6;
      else if (max === g) h = (b - r) / (max - min) + 2;
      else h = (r - g) / (max - min) + 4;
      hist[Math.min(11, Math.floor(h * 2))] += s;
    }
  }
  let sum = 0;
  for (const v of hist) sum += v;
  if (sum) for (let i = 0; i < hist.length; i++) hist[i] /= sum;
  return hist;
}

function colorSimilarity(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.min(a[i], b[i]);
  return s;
}

// Hue histogram of the card's outer border ring (outer 7% band). The frame
// color is Magic's strongest identity signal: a white-bordered card must not
// be answered with a red one. Only meaningful when the image IS a card
// (outline-rectified or full-frame), not a loose background crop.
function ringSignature(imageData) {
  const { data, width, height } = imageData;
  const bx = Math.max(2, Math.round(width * 0.07));
  const by = Math.max(2, Math.round(height * 0.07));
  const hist = new Float32Array(13);
  const add = (x, y) => {
    const i = (y * width + x) * 4;
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const s = max ? (max - min) / max : 0;
    if (s < 0.18 || max < 0.12) { hist[12] += 0.5; return; }
    let h;
    if (max === r) h = ((g - b) / (max - min) + 6) % 6;
    else if (max === g) h = (b - r) / (max - min) + 2;
    else h = (r - g) / (max - min) + 4;
    hist[Math.min(11, Math.floor(h * 2))] += s;
  };
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      if (x < bx || x >= width - bx || y < by || y >= height - by) add(x, y);
    }
  }
  let sum = 0;
  for (const v of hist) sum += v;
  if (sum) for (let i = 0; i < hist.length; i++) hist[i] /= sum;
  return hist;
}

async function verifyTopMatches(matches, queryImages, queryIsCardShaped) {
  // Caller builds `matches` as combined-rank printings plus pure-art-hash
  // printings. Honor that full list (up to 44) — an older slice(0, 24) here
  // silently dropped every art-global rescue candidate before ORB saw them.
  const shortlist = matches.slice(0, 44);
  const refs = await Promise.all(shortlist.map((m) => fetchReference(m.scryfall_id, m.face || 0)));
  const queryFeats = queryImages.map((img) => orbFeatures(img, 500));
  // References are neutral Scryfall scans, so neutralize the query's room cast
  // before comparing color and frame-ring hue.
  const wbQuery = whiteBalance(queryImages[0]);
  const querySig = colorSignature(wbQuery);
  const queryRing = queryIsCardShaped ? ringSignature(wbQuery) : null;
  try {
    let lead = 0, second = 0;
    for (let i = 0; i < shortlist.length; i++) {
      if (!refs[i]) { shortlist[i].art_inliers = 0; shortlist[i].color_sim = 0; continue; }
      const rf = orbFeatures(refs[i], 300);
      let inliers = 0;
      try {
        for (const qf of queryFeats) inliers = Math.max(inliers, orbScore(qf, rf));
        shortlist[i].art_inliers = inliers;
      } finally {
        rf.kp.delete(); rf.desc.delete();
      }
      shortlist[i].color_sim = colorSimilarity(querySig, colorSignature(refs[i]));
      if (queryRing) shortlist[i].ring_sim = colorSimilarity(queryRing, ringSignature(refs[i]));
      if (inliers > lead) { second = lead; lead = inliers; }
      else if (inliers > second) second = inliers;
      // Early stop: after the top-ranked references, an overwhelming keypoint
      // leader can't be displaced by lower-ranked cards — skip the rest.
      if (i >= 9 && lead >= 28 && lead >= 2 * (second + 1)) break;
    }
  } finally {
    for (const qf of queryFeats) { qf.kp.delete(); qf.desc.delete(); }
  }
  const maxInliers = Math.max(...shortlist.map((m) => m.art_inliers || 0), 0);
  // Coarse color agreement bands: same color identity, plausible, or clashing.
  const colorBand = (m) => ((m.color_sim || 0) >= 0.45 ? 2 : (m.color_sim || 0) >= 0.22 ? 1 : 0);
  // Border-frame agreement: 1 = frames plausibly match, 0 = frame clash
  // (e.g. white-bordered query vs red-frame reference). Neutral (1) when the
  // query wasn't card-shaped and no ring was computed.
  const ringBand = (m) => (m.ring_sim === undefined ? 1 : m.ring_sim >= 0.3 ? 1 : 0);
  // A candidate only earns trust over a rival hash by clearing all three of:
  // enough inliers, plausible color, and a real margin over the best rival
  // CARD (not just the next row — see the note above `decisive` below).
  // Shared by the demote-safety-net and the final art-match gate so a lead
  // that fails one gate can't sneak past the other.
  const isDecisiveLead = (m, rival) => (m?.art_inliers || 0) >= 16
    && (m?.color_sim || 0) >= 0.22
    && (m.art_inliers || 0) >= 1.5 * ((rival?.art_inliers || 0) + 1);
  let ranked;
  if (maxInliers >= 12) {
    // Keypoints carry real signal — rank by them, color as tiebreak, and let a
    // color clash veto a thin keypoint lead.
    ranked = [...shortlist].sort((a, b) => (b.art_inliers || 0) - (a.art_inliers || 0)
      || (b.color_sim || 0) - (a.color_sim || 0) || a.distance - b.distance);
    if (ranked.length > 1 && colorBand(ranked[0]) === 0 && colorBand(ranked[1]) > 0
      && (ranked[0].art_inliers || 0) < 1.5 * (ranked[1].art_inliers || 0)) {
      [ranked[0], ranked[1]] = [ranked[1], ranked[0]];
    }
    // A keypoint lead that is not decisive must not override a decisively
    // better hash. Observed: 13 inliers promoted "Riku and Riku" at d198 over
    // the correct "Sowing Mycospawn" at d133 — a 65-point distance gap losing
    // to a count barely above the noise floor. Confident art matches are
    // untouched by this.
    //
    // This used to gate on raw inlier count (< 16) rather than the full
    // decisive test, which is narrower than the rule it was meant to encode:
    // a lead can clear 16 inliers and still fail on color or margin-vs-rival,
    // and such a lead slipped through untouched. Arcane-set benchmark: Barrin,
    // Tolarian Archmage matched "Cancel" at exactly 16 inliers (color 0.89,
    // margin insufficient — not decisive) and stayed ranked #1 over a rival at
    // d189 vs its own d217. Same shape hit Underworld Cerberus, Garruk,
    // Blackmail and others. Gate on the same three conditions the final
    // art-match check uses, not a subset of them.
    const leadRival = ranked.find((m) => m.name !== ranked[0]?.name);
    if (!isDecisiveLead(ranked[0], leadRival)) {
      const closest = ranked.reduce((a, b) => (b.distance < a.distance ? b : a), ranked[0]);
      if (closest !== ranked[0] && closest.distance + 50 <= ranked[0].distance) {
        ranked = [closest, ...ranked.filter((m) => m !== closest)];
      }
    }
  } else {
    // Keypoints are noise at this capture quality (e.g. 6 matches everywhere).
    // Do NOT reorder by them — rank by frame agreement, then color agreement,
    // then hash distance, so a red-framed reference can never surface for a
    // white-bordered card.
    ranked = [...shortlist].sort((a, b) => ringBand(b) - ringBand(a)
      || colorBand(b) - colorBand(a) || a.distance - b.distance);
  }
  const best = ranked[0];
  // The margin must be measured against the best rival CARD, not merely the
  // next row. The shortlist deliberately keeps several printings of the same
  // name so competing artworks each get a chance, so for a card with many
  // printings the runner-up is usually the same card again — two printings of
  // Generous Gift both scored ~79 inliers, the 1.5x test failed against each
  // other, and a certain identification was presented as "possible match, not
  // certain". Being unsure WHICH PRINTING is not being unsure which card.
  const rival = ranked.find((m) => m.name !== best?.name);
  const decisive = isDecisiveLead(best, rival);
  if (decisive) {
    best.identified_by = "art-match";
    best.confidence = Math.max(best.confidence || 0, Math.min(1, best.art_inliers / 40));
  }
  return {
    matches: [...ranked, ...matches.slice(24)],
    artBest: best ? {
      name: best.name,
      inliers: best.art_inliers || 0,
      color: Math.round((best.color_sim || 0) * 100),
      weak: maxInliers < 12,
    } : null,
    artChecked: shortlist.length,
    artDecisive: decisive,
  };
}

async function visualFallback(queryCandidates) {
  const n = await loadGlobalIndex();
  const dists = new Uint16Array(n).fill(0xffff);
  const strategies = new Array(n).fill("none");
  // Search outline rectifications AND the click-centered crops. When outline
  // detection latches onto a wrong quad (sleeve edge, playmat art), the
  // click-centered crops are the only candidates that contain the real card.
  const outlineCandidates = (queryCandidates || [])
    .filter((candidate) => candidate.strategy === "full-frame" || candidate.strategy.startsWith("outline-"))
    .slice(0, 2);
  const centerCandidates = (queryCandidates || [])
    .filter((candidate) => candidate.strategy.startsWith("center-"))
    .slice(0, 3);
  let preferred = [...outlineCandidates, ...centerCandidates];
  if (!preferred.length) preferred = (queryCandidates || []).slice(0, 1);
  for (const candidate of preferred) {
    const candidateDists = new Uint16Array(n).fill(0xffff);
    for (const vector of candidate.vectors || []) {
      hammingSearch(new Uint8Array(vector), index, n, candidateDists);
    }
    for (let i = 0; i < n; i++) {
      if (candidateDists[i] < dists[i]) {
        dists[i] = candidateDists[i];
        strategies[i] = candidate.strategy;
      }
    }
  }
  const top = [];
  for (let i = 0; i < n; i++) {
    if (top.length < 20 || dists[i] < top[top.length - 1].d) {
      top.push({ i, d: dists[i] });
      top.sort((a, b) => a.d - b.d);
      if (top.length > 20) top.pop();
    }
  }
  const printingMatches = top.map((entry) => ({
    ...cardMeta(entry.i, entry.d),
    strategy: strategies[entry.i],
  }));
  const matches = [];
  const names = new Set();
  for (const match of printingMatches) {
    if (names.has(match.name)) continue;
    names.add(match.name);
    matches.push(match);
    if (matches.length === 15) break;
  }
  return { matches, printingMatches };
}

// Kick off loads as soon as the worker spins up — including the full hash
// index (7MB) that the per-click candidate ranking runs against.
loadIndex().then(() => { if (shardedIndex) loadGlobalIndex().catch(() => {}); }).catch(() => {});
loadCV().catch(() => {});

// Candidate images for the latest scan, retained so title strips can be
// rendered on demand. Only the newest scan is kept (bounded memory).
let lastTitleSource = { scanId: null, candidates: [] };

self.onmessage = async (e) => {
  const { id, type, bmp, point, queryCandidates, scanId } = e.data || {};
  if (type === "identify") {
    try {
      const res = await identify(bmp, point);
      lastTitleSource = { scanId: id, candidates: res.titleSource || [] };
      delete res.titleSource; // ImageData payloads stay in-worker
      self.postMessage({ id, ...res });
    } catch (err) {
      if (bmp && bmp.close) bmp.close();
      self.postMessage({ id, error: String((err && err.message) || err) });
    }
  } else if (type === "title-strips") {
    try {
      const source = lastTitleSource.scanId === scanId ? lastTitleSource.candidates : [];
      self.postMessage({ id, titleCandidates: await makeTitleStrips(source) });
    } catch (err) {
      self.postMessage({ id, error: String((err && err.message) || err) });
    }
  } else if (type === "visual-fallback") {
    try {
      self.postMessage({ id, ...(await visualFallback(queryCandidates)) });
    } catch (err) {
      self.postMessage({ id, error: String((err && err.message) || err) });
    }
  }
};
