// SNAPTEST tableau scenes — many cards laid out on a table at once, which is
// what players actually point a camera at. The single-card degradations in
// degrade.js put one card alone on an empty field; that is the easy case, and
// it stayed green while real scans failed. A tableau adds the things that
// actually break recognition: neighbouring cards overlapping the target, a
// whole-table rotation, dim warm light, glare, and a card that occupies only a
// fraction of the frame.
//
// A scene is rendered at full camera resolution (default 1920x1080). Video
// tiles are landscape, so that is the frame players are actually captured in —
// the reference photo this is modelled on only looks sideways because it was a
// portrait phone screenshot; rotated upright it is a landscape table of upright
// cards. Cards are therefore upright by default, with individual cards turned
// 90 degrees because tapped permanents genuinely sit sideways on the table.
//
// The harness then crops the frame with the *production* geometry from
// captureGeometry.js, so a tableau run exercises the same capture path the
// live app uses.

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

// Art window in normalized card coordinates, inset from the true art box so a
// click lands solidly on artwork rather than grazing the frame or type line.
const ART = { u0: 0.15, u1: 0.85, v0: 0.14, v1: 0.52 };

// Card-local offset -> frame coordinates, for a card rotated by `deg`.
function toFrame(cx, cy, lx, ly, deg) {
  const a = deg * Math.PI / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return { x: cx + lx * c - ly * s, y: cy + lx * s + ly * c };
}

// Is (px,py) inside this card's rotated rectangle?
function hits(p, px, py, w, h) {
  const a = p.angle * Math.PI / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const dx = px - p.cx, dy = py - p.cy;
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;
  return Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2;
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
export async function buildScene(cards, sceneIdx, frameW = 1920, frameH = 1080) {
  const rnd = mulberry32((sceneIdx * 2246822519) >>> 0);
  const imgs = await Promise.all(
    cards.map((c) => loadImage(scryfallImageUrl(c.id)).then((im) => ({ c, im })).catch(() => ({ c, im: null }))),
  );
  const ok = imgs.filter((r) => r.im);
  const failed = imgs.filter((r) => !r.im).map((r) => r.c);
  if (!ok.length) return { canvas: null, placed: [], failed };

  // In a landscape tile a table of cards reads upright. The exception is the
  // player sitting opposite (or a flipped tile), whose cards arrive rotated
  // 180 — so most scenes are upright and every fourth is inverted.
  const sceneAngle = sceneIdx % 4 === 3 ? 180 : 0;
  const warm = rnd() < 0.6;

  const canvas = document.createElement("canvas");
  canvas.width = frameW; canvas.height = frameH;
  const x = canvas.getContext("2d");
  paintBackground(x, frameW, frameH, rnd, warm);

  // Card size is set against the short frame edge so it stays consistent with
  // the crop, which is 0.55 of that same edge. ~0.2 matches the apparent card
  // size in the reference photo.
  const shortSide = Math.min(frameW, frameH);
  const cardW = shortSide * (0.18 + rnd() * 0.06);
  const cardH = cardW * CARD_ASPECT;

  // Spacing is derived from the card, not by dividing up the frame. How tightly
  // a table is packed varies: often cards are laid out with clear gaps, often
  // they just touch, and sometimes they genuinely overlap. Earlier versions used
  // a gapY below one card height unconditionally, so *every* card overlapped a
  // neighbour — harsher than reality and it made the overlap breakdown useless
  // because there was nothing to compare against.
  const layout = ["spaced", "spaced", "touching", "touching", "overlapping"][sceneIdx % 5];
  const spread = layout === "spaced" ? { x: 1.16 + rnd() * 0.20, y: 1.06 + rnd() * 0.20 }
    : layout === "touching" ? { x: 1.00 + rnd() * 0.15, y: 0.93 + rnd() * 0.12 }
    : { x: 0.95 + rnd() * 0.20, y: 0.70 + rnd() * 0.22 };
  // Spacing is measured against the widest footprint a card can have, which is
  // cardH — a tapped card is rotated 90 degrees and lies on its long edge.
  // Basing it on cardW meant a tapped card (321px) was wider than the "spaced"
  // gap (267-313px), so it overlapped its neighbours and pulled the adjacent
  // upright cards into overlap too. "Spaced" scenes were not spaced, which
  // understated the spaced score and muddled the layout breakdown.
  const footprint = layout === "spaced" ? cardH : cardW;
  const gapX = footprint * spread.x;
  const cols = Math.min(5, Math.max(3, Math.round((frameW * 0.8) / gapX)));
  const rows = Math.ceil(ok.length / cols);
  // A wider footprint means fewer columns and more rows, which can push the
  // top row off-frame — clamp the row pitch so the grid always fits.
  const maxGapY = rows > 1 ? (frameH * 0.94 - cardH) / (rows - 1) : Infinity;
  const gapY = Math.min(cardH * spread.y, maxGapY);
  const originX = (frameW - (cols - 1) * gapX) / 2;
  const originY = (frameH - (rows - 1) * gapY) / 2;

  const placed = [];
  for (let i = 0; i < ok.length; i++) {
    const col = i % cols, row = (i / cols) | 0;
    const cx = originX + col * gapX + (rnd() * 2 - 1) * gapX * 0.1;
    const cy = originY + row * gapY + (rnd() * 2 - 1) * gapY * 0.1;
    // Tapped permanents really do sit sideways, so a quarter of cards turn 90.
    const tapped = rnd() < 0.25;
    const angle = sceneAngle + (tapped ? 90 : 0) + (rnd() * 2 - 1) * 12;
    const rotationClass = tapped ? "tapped" : sceneAngle === 180 ? "upsidedown" : "upright";

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
      x.rotate(angle * Math.PI / 180);
      // Clip to the card first: glare lives on the card surface, it must not
      // spill onto the table. The streak is then rotated within that clip so
      // it runs across the card at its own angle.
      x.beginPath();
      x.rect(-cardW / 2, -cardH / 2, cardW, cardH);
      x.clip();
      x.rotate(20 * Math.PI / 180);
      const r = Math.hypot(cardW, cardH);
      const gg = x.createLinearGradient(-r / 2, -r / 2, r / 2, r / 2);
      gg.addColorStop(0, "rgba(255,255,255,0)");
      gg.addColorStop(0.45 + rnd() * 0.1, `rgba(255,255,250,${(0.18 + rnd() * 0.24).toFixed(2)})`);
      gg.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = gg;
      x.fillRect(-r, -r, r * 2, r * 2);
      x.restore();
    }

    placed.push({
      card: ok[i].c,
      cx, cy, angle,
      box: bbox(cx, cy, cardW, cardH, angle),
      rotationClass, layout,
    });
  }

  paintLighting(x, frameW, frameH, rnd);

  // Occlusion label: a card is "overlapped" when a later-drawn neighbour covers
  // a meaningful slice of it, "edge" when the frame itself cuts it off.
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i];
    let cov = 0;
    for (let j = i + 1; j < placed.length; j++) cov += overlapFrac(p.box, placed[j].box);
    const b = p.box;
    const cut = b.x0 < 0 || b.y0 < 0 || b.x1 > frameW || b.y1 > frameH;
    p.occ = cov > 0.1 ? "overlapped" : cut ? "edge" : "clear";
    p.coverage = +cov.toFixed(3);

    // Click a random point on the artwork rather than the card centre — that
    // is what a player does, and the centre is both unrealistically kind and
    // the least likely spot to be covered. Retry until the point is on art
    // that is actually visible: a point hidden under a later-drawn neighbour
    // would score a "miss" for naming the card genuinely under the cursor.
    let pick = null;
    for (let attempt = 0; attempt < 16; attempt++) {
      const u = ART.u0 + rnd() * (ART.u1 - ART.u0);
      const v = ART.v0 + rnd() * (ART.v1 - ART.v0);
      const f = toFrame(p.cx, p.cy, (u - 0.5) * cardW, (v - 0.5) * cardH, p.angle);
      if (f.x < 0 || f.y < 0 || f.x > frameW || f.y > frameH) continue;
      const covered = placed.slice(i + 1).some((q) => hits(q, f.x, f.y, cardW, cardH));
      if (!pick) pick = { f, u, v, covered };       // fall back to the first in-frame point
      if (!covered) { pick = { f, u, v, covered }; break; }
    }
    // Degenerate case (card almost entirely buried): click its centre.
    if (!pick) pick = { f: { x: p.cx, y: p.cy }, u: 0.5, v: 0.5, covered: true };
    p.nx = pick.f.x / frameW;
    p.ny = pick.f.y / frameH;
    p.click = { u: +pick.u.toFixed(2), v: +pick.v.toFixed(2), covered: pick.covered };
  }

  return { canvas, placed, failed, cardW, cardH };
}

// Exact card-shaped crop of one placed card, counter-rotated so the card fills
// the frame. Not part of the benchmark — this is the control case: if even a
// perfect crop fails to identify, the problem is image quality, not framing.
export function perfectCrop(canvas, p, cardW, cardH, margin = 1.0) {
  const w = Math.round(cardW * margin), h = Math.round(cardH * margin);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d");
  // Map the scene so the card's centre lands at the crop centre and its
  // rotation is undone, then draw the whole scene through that transform.
  x.translate(w / 2, h / 2);
  x.rotate(-p.angle * Math.PI / 180);
  x.translate(-p.cx, -p.cy);
  x.drawImage(canvas, 0, 0);
  const url = c.toDataURL("image/jpeg", 0.9);
  c.width = c.height = 0;
  return url;
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
