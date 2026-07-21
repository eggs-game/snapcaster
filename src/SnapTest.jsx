import React, { useEffect, useRef, useState } from "react";
import { identify as identifyCard, preload } from "./recognition/matcher.js";
import { degrade, loadImage, scryfallImageUrl, summarize } from "./snaptest/degrade.js";
import { buildScene, cropScene, releaseScene } from "./snaptest/scene.js";

const STAGE_LABEL = {
  "image-load": "image-load",
  "timeout": "timeout (30s)",
  "identify-error": "identify-error",
  "other": "other",
};

const MODES = {
  random200: { label: "Random 200 (new each run)", size: 200 },
  fixed200: { label: "Fixed 200 (regression)", size: 200 },
  fixed1000: { label: "Fixed 1000 (regression)", size: 1000 },
  tableau10: { label: "Tableau 10 scenes (100 cards)", size: 100, scenes: 10, perScene: 10 },
  tableau100: { label: "Tableau 100 scenes (1000 cards)", size: 1000, scenes: 100, perScene: 10 },
};

// Pull every diagnostic the pipeline exposes onto the record. The expensive
// part of a benchmark run is producing the failure, not describing it — a miss
// we can't explain costs another 40-minute run to reproduce.
function captureDiagnostics(rec, data, trueName) {
  const matches = data.matches || [];
  const top = matches[0];
  rec.top = top && top.name;
  rec.by = top && top.identified_by;
  rec.dist = top && top.distance;
  rec.conf = top && typeof top.confidence === "number" ? +top.confidence.toFixed(2) : null;
  rec.top3 = matches.slice(0, 3).map((m) => `${m.name} (d=${m.distance})`);
  // Where the correct card landed in the ranking. This is the single most
  // actionable signal: rank 2-5 means the candidates were right and the
  // ranking/tiebreak is at fault; absent means the crop or hash never
  // surfaced it at all. Those two failures need opposite fixes.
  const idx = matches.findIndex((m) => m.name === trueName);
  rec.trueRank = idx >= 0 ? idx + 1 : null;
  rec.trueDist = idx >= 0 ? matches[idx].distance : null;
  rec.cardFound = data.card_found;
  rec.cv = data.cv_status;
  rec.tried = data.candidates_tried;
  rec.dropped = data.crops_dropped;
  rec.artBest = data.art_best;
  rec.artChecked = data.art_checked;
  rec.ocr = data.ocr_text;
  rec.ocrConf = data.ocr_confidence;
  rec.titleScore = data.title_score;
}

// Accuracy grouped by an arbitrary key, for the summary breakdowns.
function groupAcc(list, keyFn) {
  const g = {};
  for (const r of list) {
    const k = keyFn(r);
    if (k == null) continue;
    (g[k] = g[k] || { n: 0, ok: 0 }).n++;
    if (r.ok) g[k].ok++;
  }
  for (const k in g) g[k].acc = +(g[k].ok / g[k].n).toFixed(3);
  return g;
}

export default function SnapTest() {
  const [cards, setCards] = useState(null);        // frozen benchmark set
  const [indexCards, setIndexCards] = useState(null); // full 110k index (lazy)
  const [mode, setMode] = useState("random200");
  const [status, setStatus] = useState("idle"); // idle | running | done | error
  const [progress, setProgress] = useState({ done: 0, correct: 0 });
  const [results, setResults] = useState([]);
  const [summary, setSummary] = useState(null);
  const [copied, setCopied] = useState(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    preload();
    fetch("/snaptest/cards.json")
      .then((r) => r.json())
      .then(setCards)
      .catch(() => setStatus("error"));
  }, []);

  // Debug hook: render one tableau scene and hand back the frame plus the crop
  // a click on card `card` would produce. Eyeballing these is the only way to
  // know the generator actually resembles a real table shot.
  useEffect(() => {
    window.__snapScene = async (sceneIdx = 0, card = 0) => {
      const rows = await (await fetch("/carddata/cards.json")).json();
      const fronts = rows.filter((r) => r[4] === 0).map((r) => ({ id: r[3], name: r[0] }));
      const group = Array.from({ length: 10 }, () => fronts[(Math.random() * fronts.length) | 0]);
      const scene = await buildScene(group, sceneIdx);
      const frame = scene.canvas.toDataURL("image/jpeg", 0.7);
      const p = scene.placed[card];
      const crop = p ? cropScene(scene.canvas, p.nx, p.ny) : null;
      releaseScene(scene.canvas);
      return { frame, crop: crop && crop.url, placed: scene.placed.map((q) => ({ name: q.card.name, occ: q.occ, rot: q.rotationClass, coverage: q.coverage, click: q.click, nx: q.nx, ny: q.ny })) };
    };
  }, []);

  // The full card index (array rows: [name,set,cn,id,face]); loaded on demand
  // for random sampling. It's the same file the recognizer uses, so it's cached.
  const loadIndexCards = async () => {
    if (indexCards) return indexCards;
    const rows = await (await fetch("/carddata/cards.json")).json();
    const fronts = rows.filter((r) => r[4] === 0).map((r) => ({ id: r[3], name: r[0] }));
    setIndexCards(fronts);
    return fronts;
  };

  // Build the run set: a fresh random sample from the whole index, or a slice
  // of the frozen benchmark for regression comparisons.
  const sampleIndex = async (n) => {
    const pool = await loadIndexCards();
    const picked = [];
    const seen = new Set();
    while (picked.length < n && seen.size < pool.length) {
      const j = (Math.random() * pool.length) | 0;
      if (seen.has(j)) continue;
      seen.add(j);
      picked.push(pool[j]);
    }
    return picked;
  };

  const buildRunSet = async () => {
    if (mode === "random200") return sampleIndex(200);
    if (mode.startsWith("tableau")) return sampleIndex(MODES[mode].size);
    return cards.slice(0, MODES[mode].size);
  };

  // Scenes of many cards at once — the realistic case: a table of cards, all
  // sharing one rotation, overlapping each other, dim and small in frame. The
  // scene is cropped with the production capture geometry, so this exercises
  // the real capture path rather than feeding the recognizer a clean render.
  const runTableau = async (set, acc, ctr) => {
    const { scenes, perScene } = MODES[mode];
    for (let s = 0; s < scenes; s++) {
      if (cancelRef.current) break;
      const group = set.slice(s * perScene, (s + 1) * perScene);
      if (!group.length) break;
      let scene = null;
      try {
        scene = await buildScene(group, s);
      } catch (e) {
        for (const card of group) {
          acc.push({ name: card.name, id: card.id, ok: false, ms: 0, errStage: "image-load", err: String((e && e.message) || e) });
        }
        setProgress({ done: acc.length, correct: ctr.correct });
        continue;
      }
      // Cards whose reference image never loaded are a benchmark artifact.
      for (const card of scene.failed) {
        acc.push({ name: card.name, id: card.id, ok: false, ms: 0, errStage: "image-load", err: "image load failed" });
      }
      for (const p of scene.placed) {
        if (cancelRef.current) break;
        const rec = {
          name: p.card.name, id: p.card.id, ok: false, err: null, errStage: null, ms: 0,
          rotationClass: p.rotationClass, occ: p.occ, scene: s, coverage: p.coverage,
          click: p.click,
        };
        const t0 = performance.now();
        let cropUrl = null;
        try {
          const crop = cropScene(scene.canvas, p.nx, p.ny);
          cropUrl = crop.url;
          let data;
          try {
            data = await identifyCard(cropUrl, { nx: crop.px, ny: crop.py });
          } catch (e) {
            const msg = String((e && e.message) || e);
            rec.errStage = /timed out/i.test(msg) ? "timeout" : "identify-error";
            throw e;
          }
          rec.ms = Math.round(performance.now() - t0);
          rec.stages = data.stage_ms || null;
          captureDiagnostics(rec, data, p.card.name);
          rec.ok = rec.top === p.card.name;
          if (!rec.ok && ctr.miss < 60) {
            rec.degraded = cropUrl;
            rec.topImage = data.matches && data.matches[0] && data.matches[0].image;
            ctr.miss++;
          }
        } catch (e) {
          rec.ms = Math.round(performance.now() - t0);
          rec.err = String((e && e.message) || e);
          if (!rec.errStage) rec.errStage = "other";
          if (cropUrl && ctr.err < 30) { rec.degraded = cropUrl; ctr.err++; }
        }
        if (rec.ok) ctr.correct++;
        acc.push(rec);
        if (performance.memory) ctr.peak = Math.max(ctr.peak, Math.round(performance.memory.usedJSHeapSize / 1e6));
        setProgress({ done: acc.length, correct: ctr.correct });
        await new Promise((r) => setTimeout(r, 0));
      }
      // ~8MB per scene: free it before building the next one.
      releaseScene(scene.canvas);
      scene = null;
    }
  };

  const run = async () => {
    cancelRef.current = false;
    let set;
    try { set = await buildRunSet(); } catch { setStatus("error"); return; }
    if (!set || !set.length) return;
    const acc = [];
    let correct = 0, peakHeapMB = 0, keptMissImgs = 0, keptErrorImgs = 0;
    setResults([]); setSummary(null); setProgress({ done: 0, correct: 0 });
    setStatus("running");
    if (mode.startsWith("tableau")) {
      const ctr = { correct: 0, peak: 0, miss: 0, err: 0 };
      await runTableau(set, acc, ctr);
      peakHeapMB = ctr.peak;
      finalize(acc, peakHeapMB);
      return;
    }
    for (let i = 0; i < set.length; i++) {
      if (cancelRef.current) break;
      const card = set[i];
      const rec = { i, name: card.name, id: card.id, ok: false, err: null, errStage: null, ms: 0 };
      const t0 = performance.now();
      let degradedUrl = null;
      try {
        let img;
        try {
          img = await loadImage(scryfallImageUrl(card.id));
        } catch (e) {
          rec.errStage = "image-load"; // Scryfall fetch/decode failed — not a recognition failure
          throw e;
        }
        const deg = degrade(img, i);
        rec.rotationClass = deg.rotationClass;
        rec.occ = deg.occ;
        degradedUrl = deg.url;
        let data;
        try {
          data = await identifyCard(degradedUrl, { nx: 0.5, ny: 0.5 });
        } catch (e) {
          const msg = String((e && e.message) || e);
          rec.errStage = /timed out/i.test(msg) ? "timeout" : "identify-error";
          throw e;
        }
        rec.ms = Math.round(performance.now() - t0);
        rec.stages = data.stage_ms || null;
        captureDiagnostics(rec, data, card.name);
        rec.ok = rec.top === card.name;
        const top = data.matches && data.matches[0];
        // Only KEEP the heavy degraded data-URL (~80KB) for a capped set of
        // misses (for the gallery). Hoarding all 1000 was ~80MB and starved the
        // tab, corrupting later canvas/bitmap ops — the real cause of the
        // long-run accuracy collapse.
        if (!rec.ok && keptMissImgs < 60) { rec.degraded = degradedUrl; rec.topImage = top && top.image; keptMissImgs++; }
      } catch (e) {
        rec.ms = Math.round(performance.now() - t0);
        rec.err = String((e && e.message) || e);
        if (!rec.errStage) rec.errStage = "other";
        // Keep a capped set of error thumbnails too — seeing exactly what was
        // fed into a timeout is often the fastest way to explain it.
        if (degradedUrl && keptErrorImgs < 30) { rec.degraded = degradedUrl; keptErrorImgs++; }
      }
      if (rec.ok) correct++;
      acc.push(rec);
      if (performance.memory) peakHeapMB = Math.max(peakHeapMB, Math.round(performance.memory.usedJSHeapSize / 1e6));
      setProgress({ done: acc.length, correct });
      await new Promise((r) => setTimeout(r, 0));
    }
    finalize(acc, peakHeapMB);
  };

  const finalize = (acc, peakHeapMB) => {
    const sum = summarize(acc);
    // Half-split accuracy directly reveals time/resource degradation.
    const okList = acc.filter((r) => !r.err);
    const half = Math.floor(okList.length / 2);
    const halfAcc = (arr) => (arr.length ? +(arr.filter((r) => r.ok).length / arr.length).toFixed(3) : 0);
    sum.firstHalfAcc = halfAcc(okList.slice(0, half));
    sum.secondHalfAcc = halfAcc(okList.slice(half));
    sum.peakHeapMB = peakHeapMB;
    // Group errors by stage (image-load / timeout / identify-error / other) so
    // a run-over-run pattern (e.g. "18 timeouts, all >20s") is visible at a
    // glance instead of buried in a flat error count.
    const errList = acc.filter((r) => r.err);
    const byStage = {};
    for (const r of errList) (byStage[r.errStage] = byStage[r.errStage] || []).push(r);
    sum.errorsByStage = Object.fromEntries(
      Object.entries(byStage).map(([k, v]) => [k, v.length]),
    );
    // Mean per-pipeline-stage timing (prep = crops/outline, rank = 110k hash
    // scan, orb = art verification, ocr = tesseract) — points speed work at
    // the actual hotspot rather than guesses.
    const stageKeys = ["prep", "rank", "orb", "ocr", "total"];
    const withStages = okList.filter((r) => r.stages);
    sum.stageAvgMs = {};
    for (const k of stageKeys) {
      const vals = withStages.map((r) => r.stages[k]).filter((v) => typeof v === "number");
      if (vals.length) sum.stageAvgMs[k] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    }

    // A slow tail is invisible in mean/median but is what users actually feel.
    const times = okList.map((r) => r.ms).sort((a, b) => a - b);
    sum.p90Ms = times.length ? times[Math.floor(times.length * 0.9)] : 0;
    sum.maxMs = times.length ? times[times.length - 1] : 0;

    // Which pathway is carrying identifications, and how each one performs.
    // If art-match is 98% but only fires 10% of the time, the work is to fire
    // it more often — not to make it more accurate.
    sum.byPathway = groupAcc(okList, (r) => r.by || "(no match)");

    // Where the correct card ranked on a miss. "absent" vs "rank 2-5" point at
    // completely different fixes: candidate generation vs ranking/tiebreak.
    const missList = okList.filter((r) => !r.ok);
    const rankBucket = { "rank 2": 0, "rank 3-5": 0, "rank 6+": 0, absent: 0 };
    for (const r of missList) {
      if (r.trueRank == null) rankBucket.absent++;
      else if (r.trueRank === 2) rankBucket["rank 2"]++;
      else if (r.trueRank <= 5) rankBucket["rank 3-5"]++;
      else rankBucket["rank 6+"]++;
    }
    sum.missTrueRank = rankBucket;
    // How near the miss was: a wrong answer at d40 is a ranking problem, at
    // d200 the pipeline never had a usable read.
    const missDists = missList.map((r) => r.dist).filter((v) => typeof v === "number");
    sum.missAvgDist = missDists.length
      ? Math.round(missDists.reduce((a, b) => a + b, 0) / missDists.length) : null;

    // Tableau-only: does accuracy fall off as neighbours cover more of the card?
    if (okList.some((r) => typeof r.coverage === "number")) {
      sum.byCoverage = groupAcc(okList, (r) => {
        if (typeof r.coverage !== "number") return null;
        return r.coverage === 0 ? "0 (clear)"
          : r.coverage < 0.15 ? "0-15%"
          : r.coverage < 0.3 ? "15-30%" : "30%+";
      });
    }
    sum.ranAt = new Date().toISOString();
    setResults(acc);
    setSummary(sum);
    setStatus(cancelRef.current ? "idle" : "done");
  };

  const stop = () => { cancelRef.current = true; };

  const copyResults = () => {
    const payload = {
      build: window.__SNAP_BUILD || "unknown",
      mode,
      summary,
      misses: results.filter((r) => !r.ok && !r.err).map((r) => ({
        name: r.name, id: r.id, got: r.top, by: r.by,
        dist: r.dist, conf: r.conf, trueRank: r.trueRank, trueDist: r.trueDist,
        top3: r.top3,
        rot: r.rotationClass, occ: r.occ, ms: r.ms,
        cv: r.cv, tried: r.tried, dropped: r.dropped,
        art: `${r.artBest ?? "-"}/${r.artChecked ?? "-"}`,
        ocr: r.ocr, ocrConf: r.ocrConf, titleScore: r.titleScore,
        stages: r.stages,
        ...(r.scene !== undefined ? { scene: r.scene, coverage: r.coverage, click: r.click } : {}),
      })),
      errors: results.filter((r) => r.err).map((r) => ({
        name: r.name, id: r.id, stage: r.errStage, ms: r.ms, message: r.err,
        rot: r.rotationClass, occ: r.occ,
        ...(r.scene !== undefined ? { scene: r.scene, coverage: r.coverage, click: r.click } : {}),
      })),
    };
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    });
  };

  const misses = results.filter((r) => !r.ok && !r.err);
  const errors = results.filter((r) => r.err);
  const liveAcc = progress.done ? (progress.correct / progress.done) : 0;
  const running = status === "running";

  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <h1 style={S.h1}>SNAPTEST</h1>
        <p style={S.sub}>
          Each card is degraded (small, blurry, sideways, upside-down, fingers, dice) and
          identified; a miss means the top match was the wrong card. <b>Random 200</b> draws a
          fresh sample from the full {indexCards ? indexCards.length.toLocaleString() : "110k"}-card
          index every run — good for discovering new failure cases. <b>Fixed</b> sets always use
          the same cards, for measuring whether a change helped or regressed.
        </p>
        <p style={S.sub}>
          <b>Tableau</b> modes are the realistic case: 10 random cards laid out on a table in one
          1920×1080 landscape frame — the shape a video tile actually is — overlapping each other,
          dim and glare-lit, with a quarter of them turned sideways as tapped permanents and every
          fourth scene inverted for the player sitting opposite. Each card is then clicked in turn,
          at a random point on its artwork rather than dead centre — and never on a spot a
          neighbouring card covers, since naming the card actually under the cursor isn't a miss.
          The frame is cropped with the same geometry the live camera uses, so these runs test the
          real capture path, not a clean render. Expect much lower accuracy here than the
          single-card modes; that gap is the point.
        </p>

        <div style={S.controls}>
          <label style={S.label}>
            Sample:&nbsp;
            <select value={mode} onChange={(e) => setMode(e.target.value)} disabled={running} style={S.select}>
              {Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
          {!running
            ? <button style={S.run} onClick={run} disabled={!cards}>▶ Run</button>
            : <button style={S.stop} onClick={stop}>■ Stop</button>}
          {summary && <button style={S.copy} onClick={copyResults}>{copied ? "Copied ✓" : "Copy results"}</button>}
        </div>

        {(running || progress.done > 0) && (
          <div style={S.progressCard}>
            <div style={S.progressRow}>
              <b>{progress.done}</b> / {MODES[mode].size} scanned
              <span style={S.spacer} />
              live accuracy <b style={{ color: liveAcc >= 0.9 ? "#3aa76d" : liveAcc >= 0.75 ? "#c99a3a" : "#c0504d" }}>
                {(liveAcc * 100).toFixed(1)}%
              </b>
            </div>
            <div style={S.bar}><div style={{ ...S.barFill, width: `${(progress.done / MODES[mode].size) * 100}%` }} /></div>
            {running && <div style={S.hint}>Running in this browser… ~5s/card on a normal machine. Leave the tab focused.</div>}
          </div>
        )}

        {summary && (
          <div style={S.summary}>
            <h2 style={S.h2}>Results</h2>
            <div style={S.statRow}>
              <Stat label="Accuracy" value={`${(summary.accuracy * 100).toFixed(1)}%`} big />
              <Stat label="Scanned" value={summary.n} />
              <Stat label="Errors" value={summary.errors} />
              <Stat label="Avg time" value={`${(summary.avgMs / 1000).toFixed(1)}s`} />
              <Stat label="Median" value={`${(summary.medianMs / 1000).toFixed(1)}s`} />
              <Stat label="p90" value={`${(summary.p90Ms / 1000).toFixed(1)}s`} />
              <Stat label="Slowest" value={`${(summary.maxMs / 1000).toFixed(1)}s`} />
            </div>
            <div style={{ ...S.statRow, marginTop: 14 }}>
              <Stat label="1st-half acc" value={`${(summary.firstHalfAcc * 100).toFixed(1)}%`} />
              <Stat label="2nd-half acc" value={`${(summary.secondHalfAcc * 100).toFixed(1)}%`} />
              {summary.peakHeapMB ? <Stat label="Peak memory" value={`${summary.peakHeapMB} MB`} /> : null}
            </div>
            {summary.stageAvgMs && Object.keys(summary.stageAvgMs).length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={S.breakTitle}>Avg time per stage</div>
                <div style={S.errStageRow}>
                  {Object.entries(summary.stageAvgMs).map(([k, v]) => (
                    <span key={k} style={S.errStagePill}>{k}: <b>{(v / 1000).toFixed(2)}s</b></span>
                  ))}
                </div>
              </div>
            )}
            <div style={S.breakRow}>
              <Breakdown title="By rotation" data={summary.byRotation} />
              <Breakdown title="By occlusion" data={summary.byOcclusion} />
            </div>
            <div style={S.breakRow}>
              <Breakdown title="By pathway (how it was identified)" data={summary.byPathway} />
              {summary.byCoverage && <Breakdown title="By neighbour coverage" data={summary.byCoverage} />}
            </div>
            {misses.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={S.breakTitle}>
                  Where the correct card ranked on a miss
                  {summary.missAvgDist != null && <> · avg top-match distance <b>{summary.missAvgDist}</b></>}
                </div>
                <div style={S.errStageRow}>
                  {Object.entries(summary.missTrueRank || {}).map(([k, n]) => (
                    <span key={k} style={S.errStagePill}>{k}: <b>{n}</b></span>
                  ))}
                </div>
                <p style={S.note}>
                  <b>rank 2</b> / <b>rank 3-5</b> mean the right card was found but ranked below a
                  competitor — a ranking or tiebreak problem. <b>absent</b> means it never surfaced
                  at all, which points at the crop or the hash instead. These need opposite fixes.
                </p>
              </div>
            )}
            {summary.errors > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={S.breakTitle}>Errors by stage</div>
                <div style={S.errStageRow}>
                  {Object.entries(summary.errorsByStage || {}).map(([stage, n]) => (
                    <span key={stage} style={S.errStagePill}>{STAGE_LABEL[stage] || stage}: <b>{n}</b></span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {summary && misses.length > 0 && (
          <div style={S.summary}>
            <h2 style={S.h2}>Misses ({misses.length})</h2>
            <div style={S.gallery}>
              {misses.map((m, k) => (
                <div key={k} style={S.miss}>
                  <div style={S.missImgs}>
                    <img src={m.degraded} alt="" style={S.thumb} title="what we scanned" />
                    {m.topImage && <img src={m.topImage} alt="" style={S.thumb} title={`we said: ${m.top}`} />}
                  </div>
                  <div style={S.missMeta}>
                    <div style={S.missTrue}>{m.name}</div>
                    <div style={S.missGot}>→ {m.top || "(no match)"} <span style={S.missBy}>{m.by || ""}</span></div>
                    <div style={S.missTag}>
                      {m.rotationClass} · {m.occ}
                      {typeof m.dist === "number" && <> · d{m.dist}</>}
                    </div>
                    <div style={S.missTag}>
                      true: {m.trueRank ? `rank ${m.trueRank} (d${m.trueDist})` : "absent"}
                      {typeof m.coverage === "number" && <> · cov {(m.coverage * 100).toFixed(0)}%</>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {summary && errors.length > 0 && (
          <div style={S.summary}>
            <h2 style={S.h2}>Errors ({errors.length}) — excluded from accuracy</h2>
            <p style={S.note}>
              These are not misidentifications — the scan never produced a result. <b>timeout</b> means
              recognition took longer than 30s (a real failure in practice: the user would give up
              waiting); <b>image-load</b> means the Scryfall reference image itself failed to fetch
              (a benchmark artifact, not a recognizer bug); <b>identify-error</b> / <b>other</b> are
              unexpected exceptions worth investigating directly.
            </p>
            <div style={S.gallery}>
              {errors.map((e, k) => (
                <div key={k} style={S.miss}>
                  {e.degraded && <img src={e.degraded} alt="" style={S.thumb} title="what we scanned" />}
                  <div style={S.missMeta}>
                    <div style={S.missTrue}>{e.name}</div>
                    <div style={S.missGot}>{STAGE_LABEL[e.errStage] || e.errStage} · {(e.ms / 1000).toFixed(1)}s</div>
                    <div style={S.missTag}>{e.rotationClass} · {e.occ}</div>
                    <div style={S.errMsg} title={e.err}>{e.err}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, big }) {
  return (
    <div style={S.stat}>
      <div style={{ ...S.statVal, fontSize: big ? 30 : 20 }}>{value}</div>
      <div style={S.statLabel}>{label}</div>
    </div>
  );
}

function Breakdown({ title, data }) {
  return (
    <div style={S.break}>
      <div style={S.breakTitle}>{title}</div>
      {Object.entries(data || {}).map(([k, v]) => (
        <div key={k} style={S.breakLine}>
          <span>{k}</span>
          <span style={{ color: v.acc >= 0.9 ? "#3aa76d" : v.acc >= 0.75 ? "#c99a3a" : "#c0504d" }}>
            {(v.acc * 100).toFixed(0)}% <small style={{ opacity: 0.6 }}>({v.ok}/{v.n})</small>
          </span>
        </div>
      ))}
    </div>
  );
}

const S = {
  page: { minHeight: "100vh", background: "#14161c", color: "#e8e6e1", fontFamily: "Inter, system-ui, sans-serif", padding: "32px 16px" },
  wrap: { maxWidth: 900, margin: "0 auto" },
  h1: { fontSize: 30, letterSpacing: "0.14em", color: "#d4a94e", margin: 0 },
  sub: { color: "#9aa0ac", fontSize: 14, lineHeight: 1.5, marginTop: 8 },
  controls: { display: "flex", gap: 10, alignItems: "center", marginTop: 20, flexWrap: "wrap" },
  label: { color: "#9aa0ac", fontSize: 14 },
  select: { background: "#232936", color: "#e8e6e1", border: "1px solid #333a48", borderRadius: 8, padding: "8px 10px", fontSize: 14 },
  run: { background: "#d4a94e", color: "#1a1408", fontWeight: 700, border: "none", borderRadius: 8, padding: "10px 22px", fontSize: 15, cursor: "pointer" },
  stop: { background: "#c0504d", color: "#fff", fontWeight: 700, border: "none", borderRadius: 8, padding: "10px 22px", fontSize: 15, cursor: "pointer" },
  copy: { background: "#232936", color: "#e8e6e1", border: "1px solid #333a48", borderRadius: 8, padding: "10px 16px", fontSize: 14, cursor: "pointer" },
  progressCard: { marginTop: 20, background: "#1c2029", borderRadius: 12, padding: 16 },
  progressRow: { display: "flex", alignItems: "center", fontSize: 15 },
  spacer: { flex: 1 },
  bar: { height: 8, background: "#232936", borderRadius: 5, marginTop: 10, overflow: "hidden" },
  barFill: { height: "100%", background: "#d4a94e", transition: "width 0.2s" },
  hint: { color: "#9aa0ac", fontSize: 12.5, marginTop: 8 },
  summary: { marginTop: 20, background: "#1c2029", borderRadius: 12, padding: 16 },
  h2: { fontSize: 16, color: "#9aa0ac", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 12px" },
  statRow: { display: "flex", gap: 22, flexWrap: "wrap" },
  stat: { minWidth: 70 },
  statVal: { fontWeight: 700, color: "#e8e6e1" },
  statLabel: { color: "#9aa0ac", fontSize: 12, marginTop: 2 },
  breakRow: { display: "flex", gap: 22, flexWrap: "wrap", marginTop: 16 },
  break: { flex: 1, minWidth: 220 },
  breakTitle: { color: "#9aa0ac", fontSize: 13, marginBottom: 6 },
  breakLine: { display: "flex", justifyContent: "space-between", fontSize: 14, padding: "3px 0", borderBottom: "1px solid #232936" },
  gallery: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 12 },
  miss: { background: "#232936", borderRadius: 10, padding: 10, display: "flex", gap: 10 },
  missImgs: { display: "flex", gap: 4 },
  thumb: { width: 52, borderRadius: 4, objectFit: "cover" },
  missMeta: { minWidth: 0, fontSize: 13 },
  missTrue: { fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  missGot: { color: "#c0504d", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  missBy: { color: "#9aa0ac", fontSize: 11 },
  missTag: { color: "#9aa0ac", fontSize: 11, marginTop: 4 },
  note: { marginTop: 4, marginBottom: 14, color: "#9aa0ac", fontSize: 13, lineHeight: 1.5 },
  errStageRow: { display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 },
  errStagePill: { background: "#232936", borderRadius: 20, padding: "5px 12px", fontSize: 13, color: "#c99a3a" },
  errMsg: { color: "#c0504d", fontSize: 11, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
};
