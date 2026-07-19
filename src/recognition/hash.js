// Perceptual hashing in pure JS — bit-compatible with scripts/build_index.py
// (grayscale -> area resize -> DCT pHash 16x16 + dHash 16x16 -> 64-byte vector)

export const HASH_SIZE = 16;
export const VEC_BYTES = 64; // 32B pHash + 32B dHash
export const CARD_W = 244, CARD_H = 340;

const POPCOUNT = new Uint8Array(256);
for (let i = 0; i < 256; i++) POPCOUNT[i] = (i & 1) + POPCOUNT[i >> 1];

// ---- grayscale from ImageData (matches OpenCV BGR2GRAY weights) ----
export function toGray(imageData) {
  const { data, width, height } = imageData;
  const g = new Float32Array(width * height);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    g[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return { pix: g, w: width, h: height };
}

// ---- box-filter (area) resize, approximates cv2 INTER_AREA on downscale ----
export function areaResize(gray, dw, dh) {
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

// ---- separable orthonormal DCT-II (same scaling as cv2.dct) ----
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
  // rows: T = C * X  (only need first 16 rows at the end, but do full rows for simplicity of second pass)
  const n = 64, k = HASH_SIZE;
  const tmp = new Float32Array(k * n); // first 16 rows of C*X
  for (let r = 0; r < k; r++) {
    for (let c = 0; c < n; c++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += DCT64[r * n + j] * img64[j * n + c];
      tmp[r * n + c] = s;
    }
  }
  const low = new Float32Array(k * k); // (C*X) * C^T, first 16 cols
  for (let r = 0; r < k; r++) {
    for (let c = 0; c < k; c++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += tmp[r * n + j] * DCT64[c * n + j];
      low[r * k + c] = s;
    }
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

export function computeHashes(gray) {
  // pHash
  const small = areaResize(gray, 64, 64);
  const low = dct2_lowfreq(small.pix);
  const med = median(low);
  const pbits = new Uint8Array(HASH_SIZE * HASH_SIZE);
  for (let i = 0; i < low.length; i++) pbits[i] = low[i] > med ? 1 : 0;
  // dHash
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

// ---- contrast stretch for low light (percentile normalize) ----
export function contrastStretch(gray) {
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

export function rotate90(gray) {
  const { pix, w, h } = gray;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      out[x * h + (h - 1 - y)] = pix[y * w + x]; // clockwise
  return { pix: out, w: h, h: w };
}

// All query hash variants: {raw, stretched} x 4 rotations
export function queryVariants(gray) {
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

// Hamming distances of one query vec against packed index (N x 64 bytes)
export function hammingSearch(query, index, nCards, distsOut) {
  for (let i = 0; i < nCards; i++) {
    const off = i * VEC_BYTES;
    let d = 0;
    for (let b = 0; b < VEC_BYTES; b++) d += POPCOUNT[index[off + b] ^ query[b]];
    if (d < distsOut[i]) distsOut[i] = d;
  }
}
