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
const DICE = [
  { name: "white", fill: "#f4f1e8", pip: "#20242b" },
  { name: "black", fill: "#20242b", pip: "#f5f3ed" },
  { name: "blue", fill: "#2774c8", pip: "#f5f3ed" },
  { name: "red", fill: "#c83b3b", pip: "#f5f3ed" },
  { name: "pink", fill: "#df5aa5", pip: "#fff7fb" },
];

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

function roundedRect(x, left, top, size, radius) {
  x.beginPath();
  x.moveTo(left + radius, top);
  x.arcTo(left + size, top, left + size, top + size, radius);
  x.arcTo(left + size, top + size, left, top + size, radius);
  x.arcTo(left, top + size, left, top, radius);
  x.arcTo(left, top, left + size, top, radius);
  x.closePath();
}

const PIPS = {
  1: [[0, 0]],
  2: [[-0.25, -0.25], [0.25, 0.25]],
  3: [[-0.25, -0.25], [0, 0], [0.25, 0.25]],
  4: [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]],
  5: [[-0.25, -0.25], [0.25, -0.25], [0, 0], [-0.25, 0.25], [0.25, 0.25]],
  6: [[-0.25, -0.28], [0.25, -0.28], [-0.25, 0], [0.25, 0], [-0.25, 0.28], [0.25, 0.28]],
};

function paintDie(x, card, die) {
  x.save();
  x.translate(card.cx, card.cy);
  x.rotate(card.angle * Math.PI / 180);
  x.translate(die.x, die.y);
  x.shadowColor = "rgba(0,0,0,0.55)";
  x.shadowBlur = die.size * 0.18;
  x.shadowOffsetY = die.size * 0.1;
  x.fillStyle = die.fill;
  roundedRect(x, -die.size / 2, -die.size / 2, die.size, die.size, die.size * 0.18);
  x.fill();
  x.shadowColor = "transparent";
  x.fillStyle = die.pip;
  for (const [px, py] of PIPS[die.face]) {
    x.beginPath();
    x.arc(px * die.size, py * die.size, die.size * 0.075, 0, Math.PI * 2);
    x.fill();
  }
  x.restore();
}

function hitsDie(p, px, py) {
  if (!p.die) return false;
  const a = p.angle * Math.PI / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const dx = px - p.cx, dy = py - p.cy;
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;
  return Math.abs(lx - p.die.x) <= p.die.size / 2
    && Math.abs(ly - p.die.y) <= p.die.size / 2;
}

// Fraction of card `p` hidden by any later-drawn card, measured by sampling the
// card's own surface. The previous version intersected axis-aligned bounding
// boxes, which for cards tilted up to 12 degrees reported 15-20% coverage
// between cards that never actually touched — overstating how crowded a scene
// was and muddying every accuracy-vs-coverage breakdown.
function surfaceStats(p, later, w, h, frameW, frameH) {
  const COLS = 11, ROWS = 15;
  let covered = 0, clipped = 0, total = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const lx = ((c + 0.5) / COLS - 0.5) * w;
      const ly = ((r + 0.5) / ROWS - 0.5) * h;
      const f = toFrame(p.cx, p.cy, lx, ly, p.angle);
      total++;
      if (f.x < 0 || f.y < 0 || f.x > frameW || f.y > frameH) { clipped++; continue; }
      for (const q of later) {
        if (hits(q, f.x, f.y, w, h)) { covered++; break; }
      }
    }
  }
  return total
    ? { covered: covered / total, clipped: clipped / total }
    : { covered: 0, clipped: 0 };
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
export async function buildScene(cards, sceneIdx, frameW = 1920, frameH = 1080, options = {}) {
  const rnd = mulberry32((sceneIdx * 2246822519) >>> 0);
  // Keep dice randomness independent so toggling the dice mode does not move,
  // rotate or relight the cards. That makes a normal-vs-dice A/B meaningful.
  const diceRnd = mulberry32(((sceneIdx + 1) * 3266489917) >>> 0);
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

  // How tightly a table is packed varies: often cards are laid out with clear
  // gaps, often they just touch, sometimes they genuinely overlap.
  // Real tables: about 90% of cards do not overlap anything at all. The common
  // case is cards side by side with a little space between them; clearly spread
  // out is less common, and significant overlap is rare — so it is 1 scene in
  // 10 and mild. Pitch is expressed as a multiple of the card's worst-case
  // on-screen extent, so >1 always means a visible gap and <1 means real
  // overlap, independent of card size or tilt.
  const layout = ["side-by-side", "side-by-side", "spaced", "side-by-side",
    "side-by-side", "spaced", "side-by-side", "spaced", "side-by-side",
    "overlapping"][sceneIdx % 10];
  const PITCH = {
    spaced: { min: 1.18, max: 1.30 },
    "side-by-side": { min: 1.05, max: 1.14 },
    overlapping: { min: 0.86, max: 0.96 },
  }[layout];
  const factorX = PITCH.min + rnd() * (PITCH.max - PITCH.min);
  const factorY = PITCH.min + rnd() * (PITCH.max - PITCH.min);

  // Worst-case on-screen extent of a card. Cards tilt up to 12 degrees and may
  // be tapped (turned 90), and both cases reduce to the same expression. Pitch
  // must be measured against THIS, not cardW: the occlusion metric compares
  // rotated rectangles, and a tilted card spans ~1.57x its width, not 1.40x.
  const TILT = 12 * Math.PI / 180;
  const extentPerW = Math.sin(TILT) + CARD_ASPECT * Math.cos(TILT);

  // Jitter is budgeted for up front — it shifts neighbours toward each other by
  // up to 2x its fraction of the gap, enough on its own to close a small gap.
  const jitter = layout === "overlapping" ? 0.06 : 0.02;
  // Four across, three deep — the shape a real table photo takes (see the
  // reference shot). Five across spread the cards wider and thinner than a
  // camera actually sees them.
  const colTarget = Math.min(4, ok.length);

  // Card size falls out of the spacing, which is physically right: ten cards
  // spread over more table means the camera covers more area and each card
  // lands smaller in frame. Ten cards at full size simply cannot be spaced out
  // within one 1920x1080 frame, so a fixed size would silently force overlap.
  // Almost every card should be fully in frame — a camera aimed at a table
  // normally captures all of it. Roughly one scene in ten is framed tight
  // enough to cut the outer row, which works out at about 5% of cards.
  const tightFrame = sceneIdx % 10 === 6;
  let cardW = shortSide * (0.18 + rnd() * 0.06);
  // Size against 0.96 of the frame while the fit check below uses 0.98, so the
  // column count can never be tipped down by a marginal rounding. Losing a
  // column adds a row, and the extra row squeezes the row pitch under one card
  // extent — reintroducing overlap in a layout that promises none.
  // Non-overlapping layouts pitch against `extent` (the worst-case tilted or
  // tapped footprint) so the guarantee holds for every card. The overlapping
  // layout must pitch against the ACTUAL card size instead: extent is 1.574x
  // cardW, so even a 0.86 factor of it still clears a typical upright card and
  // produced 2% coverage where real overlap was intended.
  const perW = layout === "overlapping" ? factorX : factorX * extentPerW;
  cardW = Math.min(cardW, (frameW * 0.96) / ((colTarget - 1) * perW + extentPerW));
  // Vertical fit. Three rows of non-overlapping cards only fit inside 1080px
  // if each card is ~0.24-0.28 of frame height rather than 0.30 — which is
  // physically right, since a camera that captures the whole table sees each
  // card smaller. Without this the row pitch got clamped below one card height
  // and the no-overlap guarantee broke silently.
  if (!tightFrame) {
    const rowsGuess = Math.ceil(ok.length / colTarget);
    if (rowsGuess > 1) {
      const baseYPerW = layout === "overlapping" ? CARD_ASPECT : extentPerW;
      const vFactor = layout === "overlapping"
        ? factorY : Math.max(1 / (1 - 2 * jitter), factorY);
      cardW = Math.min(cardW,
        (frameH * 0.98) / ((rowsGuess - 1) * vFactor * baseYPerW + extentPerW));
    }
  }
  const cardH = cardW * CARD_ASPECT;
  const extent = cardW * extentPerW;
  const baseX = layout === "overlapping" ? cardW : extent;
  const baseY = layout === "overlapping" ? cardH : extent;

  // Non-overlapping layouts get a floor that keeps them clear even after jitter.
  const minGap = layout === "overlapping" ? 0 : extent / (1 - 2 * jitter);
  const gapX = Math.max(minGap, factorX * baseX);
  let cols = colTarget;
  while (cols > 3 && (cols - 1) * gapX + extent > frameW * 0.98) cols--;
  const rows = Math.ceil(ok.length / cols);
  // The grid is ALLOWED to overflow vertically so the outer rows are clipped by
  // the frame, exactly as the bottom row is in the reference photo: a camera
  // rarely covers the whole table. Previously every card was guaranteed fully
  // in frame, so a partially visible card — a certainty in real use — was never
  // tested. Overflow is capped so no card loses more than ~35% of its height.
  const maxOverflow = tightFrame ? 0.6 * cardH : 0;
  const maxGapY = rows > 1
    ? (frameH * (tightFrame ? 1 : 0.98) + maxOverflow - extent) / (rows - 1)
    : Infinity;
  // The no-overlap floor is never capped by the fit limit: in a tight-framed
  // scene the grid is meant to overflow and clip, not to squeeze its rows into
  // each other. Capping the floor let tight scenes overlap vertically.
  const gapY = Math.max(minGap, Math.min(factorY * baseY, maxGapY));
  // Spread the cards evenly over the rows and centre each row on its own.
  // Filling rows to `cols` and letting the last take the remainder produced a
  // 4+4+2 layout with a conspicuous empty corner; real tables sit more like
  // 4+3+3, each row roughly centred.
  const perRow = [];
  for (let r = 0, left = ok.length; r < rows; r++) {
    const take = Math.ceil(left / (rows - r));
    perRow.push(take);
    left -= take;
  }
  // Push the overflow mostly onto ONE edge. A camera frames a table from one
  // side, so the near row runs off the bottom or the far row off the top —
  // it does not clip both equally. Centring the grid clipped every outer row
  // and put half the run in the edge bucket.
  const overflow = Math.max(0, (rows - 1) * gapY + extent - frameH);
  const originY = (frameH - (rows - 1) * gapY) / 2
    + (rnd() < 0.5 ? -1 : 1) * 0.3 * overflow;
  const slots = [];
  for (let r = 0; r < rows; r++) {
    const originX = (frameW - (perRow[r] - 1) * gapX) / 2;
    for (let c = 0; c < perRow[r]; c++) {
      slots.push({ sx: originX + c * gapX, sy: originY + r * gapY });
    }
  }

  const placed = [];
  for (let i = 0; i < ok.length; i++) {
    const slot = slots[i];
    const cx = slot.sx + (rnd() * 2 - 1) * gapX * jitter;
    const cy = slot.sy + (rnd() * 2 - 1) * gapY * jitter;
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

    const placedCard = {
      card: ok[i].c,
      cx, cy, angle,
      box: bbox(cx, cy, cardW, cardH, angle),
      rotationClass, layout,
    };

    if (options.dice) {
      // Two of each requested colour per ten-card scene. Position and face are
      // deterministic in sceneIdx, while the sampled card printing stays fresh.
      const color = DICE[(sceneIdx * 10 + i) % DICE.length];
      placedCard.die = {
        color: color.name,
        fill: color.fill,
        pip: color.pip,
        face: 1 + ((diceRnd() * 6) | 0),
        size: cardW * (0.20 + diceRnd() * 0.05),
        x: (diceRnd() * 2 - 1) * cardW * 0.28,
        y: (diceRnd() * 2 - 1) * cardH * 0.28,
      };
      paintDie(x, placedCard, placedCard.die);
    }

    placed.push(placedCard);
  }

  paintLighting(x, frameW, frameH, rnd);

  // Occlusion label: a card is "overlapped" when a later-drawn neighbour covers
  // a meaningful slice of it, "edge" when the frame itself cuts it off.
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i];
    const st = surfaceStats(p, placed.slice(i + 1), cardW, cardH, frameW, frameH);
    // "edge" now means a MEANINGFUL slice of the card is off-frame. It used to
    // fire on any bounding-box contact with the frame, so a card missing a few
    // pixels was pooled with one missing a third, and half the run landed in
    // the bucket.
    p.occ = st.covered > 0.1 ? "overlapped" : st.clipped > 0.05 ? "edge" : "clear";
    p.coverage = +st.covered.toFixed(3);
    p.clipped = +st.clipped.toFixed(3);
    p.diceColor = p.die?.color || null;
    p.diceFace = p.die?.face || null;
    p.diceCoverage = p.die
      ? +((p.die.size * p.die.size) / (cardW * cardH)).toFixed(3) : 0;

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
      const covered = hitsDie(p, f.x, f.y)
        || placed.slice(i + 1).some((q) => hits(q, f.x, f.y, cardW, cardH));
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
