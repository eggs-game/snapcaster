/* SNAPTEST — Snapcaster recognition benchmark.
 *
 * A frozen, reproducible accuracy + speed benchmark. Always measures the SAME
 * 1000 cards (snaptest/cards.json, sampled with a fixed seed) under the SAME
 * deterministic degradations (seeded per-card: small, blurry, sideways, upside
 * down, tilted, plus finger occlusion and dice on top — the real conditions of
 * a webcam pointed at a playmat).
 *
 * How to run (on the deployed site, which exposes window.__scIdentifyUrl):
 *   1. Open https://snapcaster.vercel.app/?debug=1 and hard-refresh.
 *   2. Paste this whole file into the DevTools console.
 *   3. fetch('/snaptest/cards.json').then(r=>r.json()).then(c => SNAPTEST.run(c));
 *   4. Watch window.__snap for live progress; the promise resolves with the summary.
 *
 * Scoring: a card is CORRECT when the top match name equals the true name.
 * Because the 1000 cards are sampled from the live index, ground truth is always
 * in-index — every miss is a genuine recognition failure, not a coverage gap.
 */
(function () {
  const FRAME = 640;

  // Deterministic PRNG so every run degrades each card identically.
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function loadImg(url) {
    return new Promise((res, rej) => {
      const i = new Image();
      i.crossOrigin = "anonymous";
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("image load failed"));
      i.src = url;
    });
  }
  function imgUrl(id) {
    return `https://cards.scryfall.io/normal/front/${id[0]}/${id[1]}/${id}.jpg`;
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

  // Deterministic degradation for card `idx`. Returns {url, rotationClass, occ}.
  function degrade(img, idx) {
    const rnd = mulberry32((idx * 2654435761) >>> 0);
    const rotationClass = ["upright", "tilt", "sideways", "upsidedown"][idx % 4];
    const occ = ["none", "fingers", "dice", "fingers-dice"][(idx >> 2) % 4];

    let angle;
    if (rotationClass === "tilt") angle = (rnd() * 2 - 1) * 18;
    else if (rotationClass === "sideways") angle = (rnd() < 0.5 ? 90 : 270) + (rnd() * 2 - 1) * 8;
    else if (rotationClass === "upsidedown") angle = 180 + (rnd() * 2 - 1) * 14;
    else angle = (rnd() * 2 - 1) * 6;

    const scale = 0.28 + rnd() * 0.28;   // card height = 28–56% of frame
    const blur = 0.4 + rnd() * 1.1;      // 0.4–1.5px
    const warm = rnd() < 0.5;

    const c = document.createElement("canvas");
    c.width = FRAME; c.height = FRAME;
    const x = c.getContext("2d");
    x.fillStyle = warm ? "#cdbfa8" : "#c3c7cc"; // skin / neutral wall
    x.fillRect(0, 0, FRAME, FRAME);
    for (let i = 0; i < 60; i++) {
      x.fillStyle = `rgba(${(120 + rnd() * 90) | 0},${(100 + rnd() * 80) | 0},${(90 + rnd() * 70) | 0},0.22)`;
      x.beginPath(); x.arc(rnd() * FRAME, rnd() * FRAME, 10 + rnd() * 40, 0, 7); x.fill();
    }

    const cardH = Math.round(FRAME * scale);
    const cardW = Math.round(cardH * img.width / img.height);
    // degrade v2 (keep in sync with src/snaptest/degrade.js): off-center and
    // edge-cut placements mirror how players actually hold cards.
    const place = (idx >> 4) % 4;
    let cx, cy;
    if (place === 1) {
      cx = FRAME / 2 + (rnd() * 2 - 1) * 50;
      cy = FRAME / 2 - FRAME * (0.14 + rnd() * 0.1);
    } else if (place === 3) {
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
    return { url: c.toDataURL("image/jpeg", 0.72), rotationClass, occ };
  }

  function summarize(results) {
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
      n: done.length, errors: results.length - done.length,
      accuracy: +acc.toFixed(3), avgMs: avg, medianMs: med,
      byRotation: by("rotationClass"), byOcclusion: by("occ"),
    };
  }

  async function run(cards, opts) {
    opts = opts || {};
    const start = opts.start || 0;
    const end = opts.end || cards.length;
    const state = window.__snap = window.__snap || { results: [] };
    state.total = cards.length; state.startedAt = Date.now(); state.running = true;
    if (opts.fresh) { state.results = []; }
    for (let i = start; i < end; i++) {
      const card = cards[i];
      const rec = { i, name: card.name, ok: false, err: null, ms: 0 };
      try {
        const img = await loadImg(imgUrl(card.id));
        const deg = degrade(img, i);
        rec.rotationClass = deg.rotationClass; rec.occ = deg.occ;
        const t0 = performance.now();
        const r = await window.__scIdentifyUrl(deg.url, { nx: 0.5, ny: 0.5 });
        rec.ms = Math.round(performance.now() - t0);
        rec.top = r.matches && r.matches[0] && r.matches[0].name;
        rec.by = r.matches && r.matches[0] && r.matches[0].identified_by;
        rec.ok = rec.top === card.name;
      } catch (e) { rec.err = String((e && e.message) || e); }
      state.results.push(rec);
      state.done = state.results.length;
      state.correct = state.results.filter((x) => x.ok).length;
      state.liveAcc = +(state.correct / state.done).toFixed(3);
      await new Promise((r) => setTimeout(r, 25));
    }
    state.running = false;
    state.summary = summarize(state.results);
    return state.summary;
  }

  window.SNAPTEST = { run, degrade, summarize };
  console.log("[SNAPTEST] loaded. Run: fetch('/snaptest/cards.json').then(r=>r.json()).then(c=>SNAPTEST.run(c))");
})();
