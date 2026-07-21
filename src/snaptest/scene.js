// SNAPTEST tableau scenes — many cards laid out on a table at once, which is
// what players actually point a camera at. The single-card degradations in
// degrade.js put one card alone on an empty field; that is the easy case, and
// it stayed green while real scans failed. A tableau adds the things that
// actually break recognition: neighbouring cards overlapping the target, a
// whole-table rotation, dim warm light, glare, and a card that occupies only a
// fraction of the frame.
//
// A scene is rendered at full camera resolution (default 1080x1920, matching
// the portrait phone/webcam frames we see in practice). The harness then crops
// it with the *production* geometry from captureGeometry.js, so a tableau run
// exercises the same capture path the live app uses.

import { loadImage, scryfallImageUrl } from "./degrade.js";
import { cropGeometry } from "../captureGeometry.js";

const CARD_ASPECT = 88 / 63; // MTG card height / width

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Axis-aligned bounding box of a rotated card, used for both grid spacing and
// the overlap estimate that feeds the by-occlusion breakdown.
function bbox(cx, cy, w, h, deg) {
  const a = deg * Math.PI / 180;
  const bw = Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a));
  const bh = Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a));
  return { x0: cx - bw / 2, y0: cy - bh / 2, x1: cx + bw / 2, y1: cy + bh / 2, bw, bh };
}

function overlapFrac(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / (a.bw * a.bh);
}

// Cloth/table background: a warm base, soft wrinkle blobs and a directional
// light falloff. Cheap, but it gives the outline detector the same kind of
// low-contrast, non-uniform field a real bedsheet or playmat does.
function paintBackground(x, W, H, rnd, warm) {
  const base = warm ? [206, 194, 176] : [188, 192, 198];
  x.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  x.fillRect(0, 0, W, H);
  for (let i = 0; i < 110; i++) {
    const shade = (rnd() * 2 - 1) * 26;
    x.fillStyle = `rgba(${(base[0] + shade) | 0},${(base[1] + shade) | 0},${(base[2] + shade) | 0},0.35)`;
    x.save();
    x.translate(rnd() * W, rnd() * H);
    x.rotate(rnd() * Math.PI);
    x.beginPath();
    x.ellipse(0, 0, W * (0.04 + rnd() * 0.22), W * (0.01 + rnd() * 0.05), 0, 0, 7);
    x.fill();
    x.restore();
  }
}

// Dim, uneven room lighting plus a vignette. Applied after the cards so it
// dims them too — real photos are not evenly lit card-by-card.
function paintLighting(x, W, H, rnd) {
  const lx = W * (0.2 + rnd() * 0.6);
  const ly = H * (0.1 + rnd() * 0.5);
  const g = x.createRadialGradient(lx, ly, 0, lx, ly, Math.max(W, H) * 0.85);
  g.addColorStop(0, "rgba(255,240,214,0.20)");
  g.addColorStop(0.55, "rgba(0,0,0,0.05)");
  g.addColorStop(1, "rgba(0,0,0,0.42)");
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
}

/**
 * Compose a tableau of `cards` (index rows with .id/.name) at frame resolution.
 * Layout is deterministic in `sceneIdx` so scenes are reproducible run to run,
 * while the card selection can still be random.
 *
 * Returns { canvas, placed, failed }. `placed` entries carry the normalized
 * click point (nx, ny) at the card's centre — what a player would click.
 * Call releaseScene(canvas) when done; these are ~8MB each.
 */
export async function buildScene(cards, sceneIdx, frameW = 1080, frameH = 1920) {
  const rnd = mulberry32((sceneIdx * 2246822519) >>> 0);
  const imgs = await Promise.all(
    cards.map((c) => loadImage(scryfallImageUrl(c.id)).then((im) => ({ c, im })).catch(() => ({ c, im: null }))),
  );
  const ok = imgs.filter((r) => r.im);
  const failed = imgs.filter((r) => !r.im).map((r) => r.c);
  if (!ok.length) return { canvas: null, placed: [], failed };

  // The whole table shares an orientation, exactly like a photo taken with the
  // phone turned sideways — every card is rotated together, not independently.
  const sceneAngle = [0, 90, 180, 270][sceneIdx % 4];
  const rotationClass = sceneAngle === 0 ? "upright"
    : sceneAngle === 180 ? "upsidedown" : "sideways";
  const warm = rnd() < 0.6;

  const canvas = document.createElement("canvas");
  canvas.width = frameW; canvas.height = frameH;
  const x = canvas.getContext("2d");
  paintBackground(x, frameW, frameH, rnd, warm);

  const cardW = frameW * (0.18 + rnd() * 0.06);
  const cardH = cardW * CARD_ASPECT;
  const probe = bbox(0, 0, cardW, cardH, sceneAngle);
  // Three columns matches the reference photo; drop to two when the cards sit
  // sideways and are too wide to fit three across.
  const cols = probe.bw * 2.7 < frameW ? 3 : 2;
  const rows = Math.ceil(ok.length / cols);
  const cellW = (frameW * 0.94) / cols;
  const cellH = Math.min(probe.bh * 0.94, (frameH * 0.92) / rows);
  const originX = (frameW - cols * cellW) / 2 + cellW / 2;
  const originY = (frameH - rows * cellH) / 2 + cellH / 2;

  const placed = [];
  for (let i = 0; i < ok.length; i++) {
    const col = i % cols, row = (i / cols) | 0;
    const cx = originX + col * cellW + (rnd() * 2 - 1) * cellW * 0.1;
    const cy = originY + row * cellH + (rnd() * 2 - 1) * cellH * 0.1;
    const angle = sceneAngle + (rnd() * 2 - 1) * 15;

    x.save();
    x.translate(cx, cy);
    x.rotate(angle * Math.PI / 180);
    // Slight softness: phone/webcam frames of a table are never tack sharp.
    x.filter = `blur(${(0.7 + rnd() * 1.6).toFixed(2)}px)`;
    x.shadowColor = "rgba(0,0,0,0.5)";
    x.shadowBlur = cardW * 0.05;
    x.shadowOffsetY = cardW * 0.02;
    x.drawImage(ok[i].im, -cardW / 2, -cardH / 2, cardW, cardH);
    x.restore();
    x.filter = "none";
    x.shadowColor = "transparent"; x.shadowBlur = 0; x.shadowOffsetY = 0;

    // Gloss/foil glare on some cards — a broad specular streak that wipes out
    // part of the art, which is what kills art verification in real photos.
    if (rnd() < 0.35) {
      x.save();
      x.translate(cx, cy);
      x.rotate((angle + 20) * Math.PI / 180);
      const gg = x.createLinearGradient(-cardW / 2, -cardH / 2, cardW / 2, cardH / 2);
      gg.addColorStop(0, "rgba(255,255,255,0)");
      gg.addColorStop(0.45 + rnd() * 0.1, `rgba(255,255,250,${(0.18 + rnd() * 0.24).toFixed(2)})`);
      gg.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = gg;
      x.fillRect(-cardW / 2, -cardH / 2, cardW, cardH);
      x.restore();
    }

    placed.push({
      card: ok[i].c,
      cx, cy, angle,
      nx: cx / frameW,
      ny: cy / frameH,
      box: bbox(cx, cy, cardW, cardH, angle),
      rotationClass,
    });
  }

  paintLighting(x, frameW, frameH, rnd);

  // Occlusion label: a card is "overlapped" when a later-drawn neighbour covers
  // a meaningful slice of it, "edge" when the frame itself cuts it off.
  for (let i = 0; i < placed.length; i++) {
    let cov = 0;
    for (let j = i + 1; j < placed.length; j++) cov += overlapFrac(placed[i].box, placed[j].box);
    const b = placed[i].box;
    const cut = b.x0 < 0 || b.y0 < 0 || b.x1 > frameW || b.y1 > frameH;
    placed[i].occ = cov > 0.1 ? "overlapped" : cut ? "edge" : "clear";
    placed[i].coverage = +cov.toFixed(3);
  }

  return { canvas, placed, failed };
}

// Crop a scene the way the live camera path does, returning the in-crop click
// point so downstream crops centre on the card even when the crop was clamped.
export function cropScene(canvas, nx, ny) {
  const g = cropGeometry(canvas.width, canvas.height, nx, ny);
  const c = document.createElement("canvas");
  c.width = g.side; c.height = g.side;
  const x = c.getContext("2d");
  x.fillStyle = "#000";
  x.fillRect(0, 0, g.side, g.side);
  x.drawImage(canvas, g.sx, g.sy, g.side, g.side, 0, 0, g.side, g.side);
  // 0.62 quality approximates a webcam/phone JPEG rather than a clean render.
  const url = c.toDataURL("image/jpeg", 0.62);
  c.width = c.height = 0;
  return { url, px: g.px, py: g.py };
}

// Scene canvases are ~8MB apiece. Hoarding them is exactly what starved the tab
// and collapsed accuracy in the first 1000-card run, so free each one promptly.
export function releaseScene(canvas) {
  if (canvas) { canvas.width = 0; canvas.height = 0; }
}
