// SNAPTEST degradations — the single source of truth for how the benchmark
// distorts each card. Deterministic (seeded per index) so every run of the
// same 1000 cards is identical and comparable over time. Mirrors the console
// runner in public/snaptest/runner.js; keep them in sync.

const FRAME = 640;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function scryfallImageUrl(id) {
  return `https://cards.scryfall.io/normal/front/${id[0]}/${id[1]}/${id}.jpg`;
}

export function placementForIndex(idx) {
  return ["mild-centered-a", "above-click", "mild-centered-b", "top-edge-clipped"][(idx >> 4) % 4];
}

export function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("image load failed"));
    img.src = url;
  });
}

// Deterministic degradation for card `idx`. Returns { url, rotationClass, occ }.
export function degrade(img, idx) {
  const rnd = mulberry32((idx * 2654435761) >>> 0);
  const rotationClass = ["upright", "tilt", "sideways", "upsidedown"][idx % 4];
  const occ = ["none", "fingers", "dice", "fingers-dice"][(idx >> 2) % 4];

  let angle;
  if (rotationClass === "tilt") angle = (rnd() * 2 - 1) * 18;
  else if (rotationClass === "sideways") angle = (rnd() < 0.5 ? 90 : 270) + (rnd() * 2 - 1) * 8;
  else if (rotationClass === "upsidedown") angle = 180 + (rnd() * 2 - 1) * 14;
  else angle = (rnd() * 2 - 1) * 6;

  const scale = 0.28 + rnd() * 0.28;
  const blur = 0.4 + rnd() * 1.1;
  const warm = rnd() < 0.5;

  const c = document.createElement("canvas");
  c.width = FRAME; c.height = FRAME;
  const x = c.getContext("2d");
  x.fillStyle = warm ? "#cdbfa8" : "#c3c7cc";
  x.fillRect(0, 0, FRAME, FRAME);
  for (let i = 0; i < 60; i++) {
    x.fillStyle = `rgba(${(120 + rnd() * 90) | 0},${(100 + rnd() * 80) | 0},${(90 + rnd() * 70) | 0},0.22)`;
    x.beginPath(); x.arc(rnd() * FRAME, rnd() * FRAME, 10 + rnd() * 40, 0, 7); x.fill();
  }

  const cardH = Math.round(FRAME * scale);
  const cardW = Math.round(cardH * img.width / img.height);
  // degrade v2: real players click below the card (forehead hold) or near a
  // frame edge, so the card center regularly deviates far from the click
  // point (the identify click is always frame center) and can even be
  // partially cut off. Half the cards keep the mild v1 placement; the rest
  // exercise the off-center and edge-cut cases that v1 missed — production
  // regressed on exactly these while v1 SNAPTEST stayed green.
  const placementClass = placementForIndex(idx);
  let cx, cy;
  if (placementClass === "above-click") {
    // Card well above the click point.
    cx = FRAME / 2 + (rnd() * 2 - 1) * 50;
    cy = FRAME / 2 - FRAME * (0.14 + rnd() * 0.1);
  } else if (placementClass === "top-edge-clipped") {
    // Near the top edge — partially cut off.
    cx = FRAME / 2 + (rnd() * 2 - 1) * 90;
    cy = cardH * (0.3 + rnd() * 0.15);
  } else {
    cx = FRAME / 2 + (rnd() * 2 - 1) * 40;
    cy = FRAME / 2 + (rnd() * 2 - 1) * 40;
  }
  x.save();
  x.translate(cx, cy);
  x.rotate(angle * Math.PI / 180);
  x.filter = `blur(${blur}px)`;
  x.drawImage(img, -cardW / 2, -cardH / 2, cardW, cardH);
  x.restore();
  x.filter = "none";

  if (occ.indexOf("fingers") >= 0) {
    x.fillStyle = warm ? "#c9a184" : "#c7a68c";
    for (let f = 0; f < 3; f++) {
      x.beginPath();
      x.ellipse(cx - cardW * 0.3 + f * cardW * 0.28, cy + cardH * 0.42, cardW * 0.09, cardH * 0.13, 0, 0, 7);
      x.fill();
    }
  }
  if (occ.indexOf("dice") >= 0) {
    const nd = 1 + ((rnd() * 2) | 0);
    for (let d = 0; d < nd; d++) {
      const s = cardH * 0.16;
      const dx = cx + (rnd() * 2 - 1) * cardW * 0.3;
      const dy = cy + (rnd() * 2 - 1) * cardH * 0.3;
      x.save(); x.translate(dx, dy); x.rotate((rnd() * 2 - 1) * 0.5);
      const col = ["#c0392b", "#2c3e50", "#27ae60", "#e67e22", "#ecf0f1", "#8e44ad"][(rnd() * 6) | 0];
      x.fillStyle = col; roundRect(x, -s / 2, -s / 2, s, s, s * 0.18); x.fill();
      x.fillStyle = col === "#ecf0f1" ? "#333" : "#fff";
      const pips = 1 + ((rnd() * 6) | 0);
      const layout = {
        1: [[0, 0]], 2: [[-.25, -.25], [.25, .25]], 3: [[-.25, -.25], [0, 0], [.25, .25]],
        4: [[-.25, -.25], [.25, -.25], [-.25, .25], [.25, .25]],
        5: [[-.25, -.25], [.25, -.25], [0, 0], [-.25, .25], [.25, .25]],
        6: [[-.25, -.28], [.25, -.28], [-.25, 0], [.25, 0], [-.25, .28], [.25, .28]],
      }[pips];
      for (const [px, py] of layout) { x.beginPath(); x.arc(px * s, py * s, s * 0.08, 0, 7); x.fill(); }
      x.restore();
    }
  }
  return { url: c.toDataURL("image/jpeg", 0.72), rotationClass, occ, placementClass };
}

const PERSPECTIVE_PRESETS = [
  { name: "near-left", top: 0.82, bottom: 1.08, lean: -0.10, roll: -5 },
  { name: "near-right", top: 0.84, bottom: 1.10, lean: 0.12, roll: 5 },
  { name: "far-left", top: 1.04, bottom: 0.84, lean: -0.14, roll: -7 },
  { name: "far-right", top: 1.06, bottom: 0.86, lean: 0.15, roll: 7 },
];

function affineForTriangle(src, dst) {
  const [s0, s1, s2] = src;
  const [d0, d1, d2] = dst;
  const sx1 = s1.x - s0.x, sy1 = s1.y - s0.y;
  const sx2 = s2.x - s0.x, sy2 = s2.y - s0.y;
  const dx1 = d1.x - d0.x, dy1 = d1.y - d0.y;
  const dx2 = d2.x - d0.x, dy2 = d2.y - d0.y;
  const det = sx1 * sy2 - sx2 * sy1;
  const a = (dx1 * sy2 - dx2 * sy1) / det;
  const c = (-dx1 * sx2 + dx2 * sx1) / det;
  const b = (dy1 * sy2 - dy2 * sy1) / det;
  const d = (-dy1 * sx2 + dy2 * sx1) / det;
  return { a, b, c, d, e: d0.x - a * s0.x - c * s0.y, f: d0.y - b * s0.x - d * s0.y };
}

// Canvas 2D has affine transforms but no projective transform. Four clipped
// triangles are enough for a card: each maps one corner and the card centre,
// avoiding the obvious diagonal seam a two-triangle split can produce.
function drawImageOnQuad(x, img, quad) {
  const sw = img.width, sh = img.height;
  const srcCenter = { x: sw / 2, y: sh / 2 };
  const dstCenter = {
    x: (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4,
    y: (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4,
  };
  for (let i = 0; i < 4; i++) {
    const next = (i + 1) % 4;
    const transform = affineForTriangle(
      [srcCenter, { x: i === 1 || i === 2 ? sw : 0, y: i >= 2 ? sh : 0 }, { x: next === 1 || next === 2 ? sw : 0, y: next >= 2 ? sh : 0 }],
      [dstCenter, quad[i], quad[next]],
    );
    x.save();
    x.beginPath();
    x.moveTo(dstCenter.x, dstCenter.y);
    x.lineTo(quad[i].x, quad[i].y);
    x.lineTo(quad[next].x, quad[next].y);
    x.closePath();
    x.clip();
    x.setTransform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
    x.drawImage(img, 0, 0);
    x.restore();
  }
}

function rotatePoint(point, cx, cy, deg) {
  const a = deg * Math.PI / 180;
  const dx = point.x - cx, dy = point.y - cy;
  return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) };
}

function paintPerspectiveBackground(x, rnd, warm) {
  const base = warm ? [207, 198, 183] : [191, 195, 200];
  x.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  x.fillRect(0, 0, FRAME, FRAME);
  for (let i = 0; i < 70; i++) {
    const shade = (rnd() * 2 - 1) * 24;
    x.fillStyle = `rgba(${(base[0] + shade) | 0},${(base[1] + shade) | 0},${(base[2] + shade) | 0},0.24)`;
    x.save();
    x.translate(rnd() * FRAME, rnd() * FRAME);
    x.rotate(rnd() * Math.PI);
    x.beginPath();
    x.ellipse(0, 0, FRAME * (0.06 + rnd() * 0.18), FRAME * (0.01 + rnd() * 0.04), 0, 0, 7);
    x.fill();
    x.restore();
  }
}

function addPerspectiveLighting(x, rnd, warm) {
  const g = x.createRadialGradient(FRAME * (0.2 + rnd() * 0.6), FRAME * (0.12 + rnd() * 0.5), 0, FRAME / 2, FRAME / 2, FRAME * 0.85);
  g.addColorStop(0, warm ? "rgba(255,242,220,0.18)" : "rgba(255,255,255,0.12)");
  g.addColorStop(0.62, "rgba(0,0,0,0.06)");
  g.addColorStop(1, "rgba(0,0,0,0.34)");
  x.fillStyle = g;
  x.fillRect(0, 0, FRAME, FRAME);
}

// A single-card camera-perspective set. The card remains planar, but its four
// corners are mapped to a trapezoid so the image resembles a phone looking at
// a card on a table rather than a straight-on Scryfall scan.
export function perspectiveDegrade(img, idx) {
  const rnd = mulberry32(((idx + 1) * 2246822519) >>> 0);
  const preset = PERSPECTIVE_PRESETS[idx % PERSPECTIVE_PRESETS.length];
  const warm = rnd() < 0.65;
  const c = document.createElement("canvas");
  c.width = FRAME; c.height = FRAME;
  const x = c.getContext("2d");
  paintPerspectiveBackground(x, rnd, warm);

  const cardH = Math.round(FRAME * (0.44 + rnd() * 0.14));
  const cardW = Math.round(cardH * img.width / img.height);
  const cx = FRAME / 2 + (rnd() * 2 - 1) * 42;
  const cy = FRAME / 2 + (rnd() * 2 - 1) * 34;
  const topW = cardW * preset.top;
  const bottomW = cardW * preset.bottom;
  const topY = cy - cardH / 2;
  const bottomY = cy + cardH / 2;
  const lean = cardW * preset.lean;
  let quad = [
    { x: cx - topW / 2 + lean, y: topY },
    { x: cx + topW / 2 + lean, y: topY },
    { x: cx + bottomW / 2 + lean, y: bottomY },
    { x: cx - bottomW / 2 + lean, y: bottomY },
  ].map((p) => rotatePoint(p, cx + lean, cy, preset.roll + (rnd() * 2 - 1) * 3));

  // A soft shadow is painted from the same projected corners, keeping the
  // card grounded on the cloth instead of looking like a floating overlay.
  x.save();
  x.filter = `blur(${(cardW * 0.035).toFixed(1)}px)`;
  x.fillStyle = "rgba(0,0,0,0.34)";
  x.beginPath();
  x.moveTo(quad[0].x + 5, quad[0].y + 8);
  for (const p of quad.slice(1)) x.lineTo(p.x + 5, p.y + 8);
  x.closePath();
  x.fill();
  x.restore();

  x.save();
  x.filter = `blur(${(0.45 + rnd() * 1.25).toFixed(2)}px)`;
  drawImageOnQuad(x, img, quad);
  x.restore();

  if (rnd() < 0.55) {
    x.save();
    x.beginPath();
    x.moveTo(quad[0].x, quad[0].y);
    for (const p of quad.slice(1)) x.lineTo(p.x, p.y);
    x.closePath();
    x.clip();
    const glare = x.createLinearGradient(0, 0, FRAME, FRAME);
    glare.addColorStop(0.25, "rgba(255,255,255,0)");
    glare.addColorStop(0.5, `rgba(255,255,250,${(0.14 + rnd() * 0.20).toFixed(2)})`);
    glare.addColorStop(0.75, "rgba(255,255,255,0)");
    x.fillStyle = glare;
    x.fillRect(0, 0, FRAME, FRAME);
    x.restore();
  }

  addPerspectiveLighting(x, rnd, warm);
  const url = c.toDataURL("image/jpeg", 0.72);
  c.width = c.height = 0;
  return {
    url,
    rotationClass: "perspective",
    perspectiveClass: preset.name,
    occ: "none",
    click: { nx: +((quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4 / FRAME).toFixed(4), ny: +((quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4 / FRAME).toFixed(4) },
  };
}

export function summarize(results) {
  const done = results.filter((r) => !r.err);
  const acc = done.length ? done.filter((r) => r.ok).length / done.length : 0;
  const times = done.map((r) => r.ms).sort((a, b) => a - b);
  const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
  const med = times.length ? times[times.length >> 1] : 0;
  const by = (key) => {
    const g = {};
    for (const r of done) {
      const k = r[key] || "?";
      (g[k] = g[k] || { n: 0, ok: 0 }).n++;
      if (r.ok) g[k].ok++;
    }
    for (const k in g) g[k].acc = +(g[k].ok / g[k].n).toFixed(3);
    return g;
  };
  return {
    n: done.length,
    errors: results.length - done.length,
    accuracy: +acc.toFixed(3),
    avgMs: avg,
    medianMs: med,
    byRotation: by("rotationClass"),
    byOcclusion: by("occ"),
  };
}
