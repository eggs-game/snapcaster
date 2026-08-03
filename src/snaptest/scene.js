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

import { loadImage, scryfallImageUrl, drawImageOnQuad } from "./degrade.js";
import { cropGeometry } from "../captureGeometry.js";

const CARD_ASPECT = 88 / 63; // MTG card height / width
// One playmat is enough to stress isolation, but not to prove it generalizes: a
// run on a single mat measures that mat. The four Ultra-PRO mats already shipped
// for the landing page carry heavy printed art and a rectangular printed border,
// which is exactly the decoration that competes with a card's own edges.
//
// Every name here must resolve to a file that exists. loadPlaymat swallows a
// failed load and returns null, which silently downgrades that scene to bare
// cloth — the opposite of what a playmat-stress suite is for, and invisible in
// the results.
const PLAYMAT_IMAGES = {
  "magic-con-vegas": "/snaptest/playmats/magic-con-vegas.png",
  "ultra-pro-green": "/home-playmats/green.png",
  "ultra-pro-blue": "/home-playmats/blue.png",
  "ultra-pro-red": "/home-playmats/red.png",
  "ultra-pro-white": "/home-playmats/white.png",
  "ff-cloud": "/snaptest/playmats/ff-cloud.png",
  "commander-series-2": "/snaptest/playmats/commander-series-2.png",
  "mythic-land-black": "/snaptest/playmats/mythic-land-black.png",
  "mythic-land-other": "/snaptest/playmats/mythic-land-other.png",
};
const playmatImageCache = new Map();

// Sleeve colours seen on real tables. The first five are the matte darks this
// started with; the rest were added after looking at 25 real webcam frames, in
// which bright sleeves were roughly as common as dark ones — saturated blue and
// green, and a pale cream that is the hardest case of all, because it blows out
// under glare and takes the card's own border with it.
//
// A palette of only dark sleeves tests one half of the problem. A dark sleeve
// hides the card edge against a dark mat; a bright one hides it against a bright
// mat, and isolation fails differently in each.
// `face` is the border visible around the card, `edge` the darker side seen when
// cards are stacked.
const SLEEVE_TONES = [
  { face: "#14161a", edge: "#0b0d10" },
  { face: "#1b1f26", edge: "#101318" },
  { face: "#232833", edge: "#161a22" },
  { face: "#2a1c2e", edge: "#1a1120" },
  { face: "#122029", edge: "#0b141b" },
  { face: "#2f6fc4", edge: "#1d4680" },   // saturated blue
  { face: "#2f7d4a", edge: "#1c4c2d" },   // green
  { face: "#d8d3b4", edge: "#a29d81" },   // cream / pale
  { face: "#6b4b9a", edge: "#402d5e" },   // purple
  { face: "#8f2f2f", edge: "#591d1d" },   // deep red
];
// A sleeve adds a few millimetres on every side of a 63mm card, so the visible
// rectangle is the sleeve rather than the card. That matters: the index is
// built from bare card scans.
const SLEEVE_MARGIN = 0.045;


// Camera perspective for a card lying on a table. Canvas 2D is affine only, so
// the card is drawn onto an explicit trapezoid (see drawImageOnQuad). A camera
// looking across a table sees the far edge narrower than the near edge, which
// no amount of rotation reproduces.
function cardQuad(cx, cy, w, h, deg, p) {
  const top = w * p.top, bot = w * p.bottom, lean = w * p.lean;
  const local = [
    { x: -top / 2 + lean, y: -h / 2 },
    { x: top / 2 + lean, y: -h / 2 },
    { x: bot / 2, y: h / 2 },
    { x: -bot / 2, y: h / 2 },
  ];
  const a = deg * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
  return local.map((q) => ({ x: cx + q.x * c - q.y * sn, y: cy + q.x * sn + q.y * c }));
}

// Point at (u,v) in card space, 0..1, interpolated across the quad. Clicks must
// follow the same warp as the artwork or they stop landing on the art.
function quadPoint(q, u, v) {
  const tx = q[0].x + (q[1].x - q[0].x) * u, ty = q[0].y + (q[1].y - q[0].y) * u;
  const bx = q[3].x + (q[2].x - q[3].x) * u, by = q[3].y + (q[2].y - q[3].y) * u;
  return { x: tx + (bx - tx) * v, y: ty + (by - ty) * v };
}

function expandQuad(q, m) {
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  return q.map((p) => ({ x: cx + (p.x - cx) * (1 + m), y: cy + (p.y - cy) * (1 + m) }));
}

function fillQuad(x, q, fill) {
  x.fillStyle = fill;
  x.beginPath();
  x.moveTo(q[0].x, q[0].y);
  for (let i = 1; i < 4; i++) x.lineTo(q[i].x, q[i].y);
  x.closePath();
  x.fill();
}

function paintRounded(x, px, py, w, h, r, fill) {
  x.fillStyle = fill;
  x.beginPath();
  x.moveTo(px + r, py);
  x.arcTo(px + w, py, px + w, py + h, r);
  x.arcTo(px + w, py + h, px, py + h, r);
  x.arcTo(px, py + h, px, py, r);
  x.arcTo(px, py, px + w, py, r);
  x.closePath();
  x.fill();
}
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
  // roundedRect takes (left, top, size, radius). This passed size twice, so the
  // corner radius became the die's full side length and every die in every dice
  // suite rendered as a circle — a rounder, smaller occluder than the square
  // face a real die presents when viewed from above.
  roundedRect(x, -die.size / 2, -die.size / 2, die.size, die.size * 0.18);
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

function paintPlaymatBackground(x, W, H, image) {
  // Cover rather than stretch: the supplied 1200×700 playmat stays at its
  // intended proportions while a landscape video frame trims only its sides.
  const scale = Math.max(W / image.width, H / image.height);
  const drawW = image.width * scale;
  const drawH = image.height * scale;
  x.drawImage(image, (W - drawW) / 2, (H - drawH) / 2, drawW, drawH);
}

function loadPlaymat(name) {
  const url = PLAYMAT_IMAGES[name];
  if (!url) return Promise.resolve(null);
  if (!playmatImageCache.has(name)) {
    playmatImageCache.set(name, loadImage(url).catch(() => null));
  }
  return playmatImageCache.get(name);
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

// Blown-out specular glare across the whole frame.
//
// Distinct from the per-card gloss streak, which is clipped to a single card
// and so never crosses onto the mat or a neighbour. A real lamp or window does
// the opposite: one hotspot lands wherever it lands, saturates toward white,
// and takes out whatever is underneath — card edges, art, and table alike.
// That is the case that defeats both edge-based isolation and art
// verification, and nothing here simulated it.
//
// Opt-in via options.glare, because switching it on changes every rendered
// scene and would make accuracy numbers incomparable to every run already
// recorded in snaptest/results.md.
function paintGlare(x, W, H, rnd) {
  const diag = Math.hypot(W, H);
  // One or two tight hotspots. The core reaches near-white, which is what
  // destroys art information rather than merely brightening it.
  //
  // Widened after measuring both sides the same way: across 20 rendered scenes
  // the worst blowout covered 0.1% of pixels, where the real frames reach 11%.
  // The hotspots were too small and stopped short of saturation, so they tinted
  // the art instead of destroying it — and a highlight that does not clip to
  // white is not the case that defeats art verification.
  const spots = rnd() < 0.45 ? 2 : 1;
  for (let i = 0; i < spots; i++) {
    const r = diag * (0.10 + rnd() * 0.20);
    const cx = W * (0.1 + rnd() * 0.8);
    const cy = H * (0.1 + rnd() * 0.8);
    const peak = 0.75 + rnd() * 0.25;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    // A flat saturated core, then falloff. A real specular highlight clips over
    // an area rather than peaking at a single point.
    g.addColorStop(0, `rgba(255,253,246,${peak.toFixed(2)})`);
    g.addColorStop(0.22, `rgba(255,253,246,${(peak * 0.92).toFixed(2)})`);
    g.addColorStop(0.5, `rgba(255,251,238,${(peak * 0.34).toFixed(2)})`);
    g.addColorStop(1, "rgba(255,250,235,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
  }
  // A broad off-axis band: the window-reflection case, low contrast but wide.
  if (rnd() < 0.45) {
    x.save();
    x.translate(W / 2, H / 2);
    x.rotate((-35 + rnd() * 70) * Math.PI / 180);
    const band = x.createLinearGradient(-diag / 2, 0, diag / 2, 0);
    const a = 0.10 + rnd() * 0.16;
    band.addColorStop(0, "rgba(255,255,255,0)");
    band.addColorStop(0.42 + rnd() * 0.16, `rgba(255,252,244,${a.toFixed(2)})`);
    band.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = band;
    x.fillRect(-diag, -diag, diag * 2, diag * 2);
    x.restore();
  }
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
  const playmat = await loadPlaymat(options.playmat);
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
  if (playmat) paintPlaymatBackground(x, frameW, frameH, playmat);
  else paintBackground(x, frameW, frameH, rnd, warm);

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
  const layout = options.layout || ["side-by-side", "side-by-side", "spaced", "side-by-side",
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
  // Scene v2. Defaults on: sleeves, stacks, glare and heavier blur are what a
  // webcam over a real table actually shows, and their absence made every suite
  // easier than production. Pass {realism:false} to reproduce v1 scenes.
  const realism = options.realism !== false;
  const perspective = options.perspective === true;
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

  // Focus falloff. A webcam over a table holds one plane sharp and lets the rest
  // go soft. Per-card random blur, which is what this did before, instead put a
  // sharp card beside a soft one at the same distance from the lens — which
  // cannot happen, and which meant a scan's difficulty did not depend on where
  // on the table the card sat. Opt out with {focusFalloff:false}.
  const focusFalloff = options.focusFalloff !== undefined
    ? options.focusFalloff : realism;
  const focusY = frameH * (0.3 + rnd() * 0.4);
  const focusHalf = frameH * (0.18 + rnd() * 0.16);

  const placed = [];
  for (let i = 0; i < ok.length; i++) {
    const slot = slots[i];
    const cx = slot.sx + (rnd() * 2 - 1) * gapX * jitter;
    const cy = slot.sy + (rnd() * 2 - 1) * gapY * jitter;
    // Tapped permanents really do sit sideways, so a quarter of cards turn 90.
    const tapped = rnd() < 0.25;
    const angle = sceneAngle + (tapped ? 90 : 0) + (rnd() * 2 - 1) * 12;
    const rotationClass = tapped ? "tapped" : sceneAngle === 180 ? "upsidedown" : "upright";

    // Real boards are mostly sleeved, and lands in particular sit in stacks.
    // Both were absent here: every card was a bare rectangle sitting alone, so
    // the two commonest things a camera actually sees were never tested.
    const sleeved = realism ? rnd() < 0.78 : false;
    const stackUnder = realism && rnd() < 0.28 ? 1 + ((rnd() * 3) | 0) : 0;
    const sleeve = SLEEVE_TONES[(rnd() * SLEEVE_TONES.length) | 0];

    // Mild, per-card camera perspective: the far edge of a card reads narrower
    // than the near edge when a webcam looks across a table. Rotation alone
    // cannot produce that, so the card is drawn onto a trapezoid.
    const persp = perspective
      ? { top: 0.88 + rnd() * 0.10, bottom: 1.02 + rnd() * 0.10, lean: (rnd() * 2 - 1) * 0.10 }
      : { top: 1, bottom: 1, lean: 0 };
    const quad = cardQuad(cx, cy, cardW, cardH, angle, persp);

    x.save();
    // Distance from the focal band sets the blur, with a floor so nothing is
    // ever razor sharp — a compressed webcam link never is.
    const defocus = focusFalloff
      ? Math.min(1, Math.abs(cy - focusY) / (focusHalf * 2.2))
      : rnd();
    x.filter = `blur(${((realism ? 1.1 : 0.7) + defocus * (realism ? 2.2 : 1.6)).toFixed(2)}px)`;
    x.shadowColor = "rgba(0,0,0,0.5)";
    x.shadowBlur = cardW * 0.05;
    x.shadowOffsetY = cardW * 0.02;
    // Cards underneath, drawn first and offset so only their sleeve edge shows.
    // The label stays the TOP card: that is the one a player clicks and the one
    // they expect named.
    for (let s2 = stackUnder; s2 > 0; s2--) {
      const off = cardW * 0.035 * s2, dir = (i % 2 ? 1 : -1);
      fillQuad(x, quad.map((q) => ({ x: q.x - off * dir, y: q.y + off })), sleeve.edge);
    }
    if (sleeved) fillQuad(x, expandQuad(quad, SLEEVE_MARGIN), sleeve.face);
    drawImageOnQuad(x, ok[i].im, quad);
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
      rotationClass, layout, sleeved, stacked: stackUnder, quad,
      perspective: perspective ? +(persp.bottom - persp.top).toFixed(3) : 0,
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
  // Own RNG stream, for the same reason dice have one: toggling glare must not
  // move, rotate or relight a single card, or a glare-vs-no-glare A/B would be
  // comparing different tableaux rather than the same one under a lamp.
  if (realism || options.glare) {
    paintGlare(x, frameW, frameH, mulberry32(((sceneIdx + 7) * 2654435761) >>> 0));
  }

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
      const f = p.quad ? quadPoint(p.quad, u, v)
        : toFrame(p.cx, p.cy, (u - 0.5) * cardW, (v - 0.5) * cardH, p.angle);
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
  return { url, px: g.px, py: g.py, sx: g.sx, sy: g.sy, side: g.side };
}

// Scene canvases are ~8MB apiece. Hoarding them is exactly what starved the tab
// and collapsed accuracy in the first 1000-card run, so free each one promptly.
export function releaseScene(canvas) {
  if (canvas) { canvas.width = 0; canvas.height = 0; }
}
