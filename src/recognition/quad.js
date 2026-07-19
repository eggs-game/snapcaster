// Card outline detection + perspective rectification via OpenCV.js (lazy-loaded).
import { CARD_W, CARD_H } from "./hash.js";

const OPENCV_URL = "https://docs.opencv.org/4.9.0/opencv.js";
let cvPromise = null;

export function loadOpenCV() {
  if (cvPromise) return cvPromise;
  cvPromise = new Promise((resolve, reject) => {
    if (window.cv?.Mat) return resolve(window.cv);
    const s = document.createElement("script");
    s.src = OPENCV_URL;
    s.async = true;
    s.onload = () => {
      const check = () => (window.cv?.Mat ? resolve(window.cv) : setTimeout(check, 100));
      if (window.cv?.onRuntimeInitialized !== undefined) {
        window.cv.onRuntimeInitialized = () => resolve(window.cv);
        setTimeout(check, 3000); // fallback poll
      } else check();
    };
    s.onerror = () => reject(new Error("Failed to load OpenCV.js"));
    document.head.appendChild(s);
  });
  return cvPromise;
}

function orderCorners(pts) {
  // pts: [{x,y} x4] -> [tl, tr, br, bl]
  const bySum = [...pts].sort((a, b) => a.x + a.y - (b.x + b.y));
  const byDiff = [...pts].sort((a, b) => a.y - a.x - (b.y - b.x));
  return [bySum[0], byDiff[0], bySum[3], byDiff[3]];
}

// Find largest card-like quadrilateral in canvas; returns corners or null.
export async function findCardQuad(canvas) {
  let cv;
  try { cv = await loadOpenCV(); } catch { return null; }
  const src = cv.imread(canvas);
  const gray = new cv.Mat(), blur = new cv.Mat(), bin = new cv.Mat();
  const results = [];
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.bilateralFilter(gray, blur, 7, 50, 50);

    const tryBin = (mat) => {
      const contours = new cv.MatVector(), hier = new cv.Mat();
      cv.findContours(mat, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      const imgArea = canvas.width * canvas.height;
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

    // Strategy 1: Canny edges
    cv.Canny(blur, bin, 30, 120);
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    cv.dilate(bin, bin, kernel);
    tryBin(bin);
    // Strategy 2: adaptive threshold
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

// Perspective-warp quad -> canonical portrait card canvas (CARD_W x CARD_H).
export async function rectifyCard(canvas, corners) {
  const cv = await loadOpenCV();
  const [tl, tr, br, bl] = corners;
  const wTop = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const wBot = Math.hypot(br.x - bl.x, br.y - bl.y);
  const hL = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const hR = Math.hypot(br.x - tr.x, br.y - tr.y);
  const landscape = (wTop + wBot) / 2 > (hL + hR) / 2;
  const dw = landscape ? CARD_H : CARD_W, dh = landscape ? CARD_W : CARD_H;

  const src = cv.imread(canvas);
  const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
  const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, dw, 0, dw, dh, 0, dh]);
  const m = cv.getPerspectiveTransform(srcPts, dstPts);
  const out = new cv.Mat();
  cv.warpPerspective(src, out, m, new cv.Size(dw, dh));

  const outCanvas = document.createElement("canvas");
  outCanvas.width = dw; outCanvas.height = dh;
  cv.imshow(outCanvas, out);
  src.delete(); srcPts.delete(); dstPts.delete(); m.delete(); out.delete();

  if (!landscape) return outCanvas;
  // rotate landscape (tapped card) to portrait
  const rot = document.createElement("canvas");
  rot.width = CARD_W; rot.height = CARD_H;
  const ctx = rot.getContext("2d");
  ctx.translate(CARD_W, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(outCanvas, 0, 0);
  return rot;
}

// Fallback when no quad found: center crop at card aspect ratio.
export function centerCropCard(canvas) {
  const { width: w, height: h } = canvas;
  let ch = Math.round(h * 0.9), cw = Math.round((ch * CARD_W) / CARD_H);
  if (cw > w) { cw = Math.round(w * 0.9); ch = Math.round((cw * CARD_H) / CARD_W); }
  const out = document.createElement("canvas");
  out.width = CARD_W; out.height = CARD_H;
  out.getContext("2d").drawImage(canvas, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, CARD_W, CARD_H);
  return out;
}
