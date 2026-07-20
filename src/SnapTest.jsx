import React, { useEffect, useRef, useState } from "react";
import { identify as identifyCard, preload } from "./recognition/matcher.js";
import { degrade, loadImage, scryfallImageUrl, summarize } from "./snaptest/degrade.js";

const SIZES = [50, 200, 1000];

export default function SnapTest() {
  const [cards, setCards] = useState(null);
  const [size, setSize] = useState(200);
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

  const run = async () => {
    if (!cards) return;
    cancelRef.current = false;
    const set = cards.slice(0, size);
    const acc = [];
    let correct = 0, peakHeapMB = 0, keptMissImgs = 0;
    setResults([]); setSummary(null); setProgress({ done: 0, correct: 0 });
    setStatus("running");
    for (let i = 0; i < set.length; i++) {
      if (cancelRef.current) break;
      const card = set[i];
      const rec = { i, name: card.name, id: card.id, ok: false, err: null, ms: 0 };
      let degradedUrl = null;
      try {
        const img = await loadImage(scryfallImageUrl(card.id));
        const deg = degrade(img, i);
        rec.rotationClass = deg.rotationClass;
        rec.occ = deg.occ;
        degradedUrl = deg.url;
        const t0 = performance.now();
        const data = await identifyCard(degradedUrl, { nx: 0.5, ny: 0.5 });
        rec.ms = Math.round(performance.now() - t0);
        const top = data.matches && data.matches[0];
        rec.top = top && top.name;
        rec.by = top && top.identified_by;
        rec.ok = rec.top === card.name;
        // Only KEEP the heavy degraded data-URL (~80KB) for a capped set of
        // misses (for the gallery). Hoarding all 1000 was ~80MB and starved the
        // tab, corrupting later canvas/bitmap ops — the real cause of the
        // long-run accuracy collapse.
        if (!rec.ok && keptMissImgs < 60) { rec.degraded = degradedUrl; rec.topImage = top && top.image; keptMissImgs++; }
      } catch (e) {
        rec.err = String((e && e.message) || e);
      }
      if (rec.ok) correct++;
      acc.push(rec);
      if (performance.memory) peakHeapMB = Math.max(peakHeapMB, Math.round(performance.memory.usedJSHeapSize / 1e6));
      setProgress({ done: acc.length, correct });
      await new Promise((r) => setTimeout(r, 0));
    }
    const sum = summarize(acc);
    // Half-split accuracy directly reveals time/resource degradation.
    const okList = acc.filter((r) => !r.err);
    const half = Math.floor(okList.length / 2);
    const halfAcc = (arr) => (arr.length ? +(arr.filter((r) => r.ok).length / arr.length).toFixed(3) : 0);
    sum.firstHalfAcc = halfAcc(okList.slice(0, half));
    sum.secondHalfAcc = halfAcc(okList.slice(half));
    sum.peakHeapMB = peakHeapMB;
    setResults(acc);
    setSummary(sum);
    setStatus(cancelRef.current ? "idle" : "done");
  };

  const stop = () => { cancelRef.current = true; };

  const copyResults = () => {
    const payload = { build: window.__SNAP_BUILD || "unknown", size, summary, misses: results.filter((r) => !r.ok && !r.err).map((r) => ({ name: r.name, got: r.top, by: r.by, rot: r.rotationClass, occ: r.occ })) };
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
          Frozen benchmark: {cards ? cards.length : "…"} cards, each degraded (small, blurry,
          sideways, upside-down, fingers, dice) deterministically. Ground truth is in-index, so
          every miss is a real recognition failure.
        </p>

        <div style={S.controls}>
          <label style={S.label}>
            Cards:&nbsp;
            <select value={size} onChange={(e) => setSize(Number(e.target.value))} disabled={running} style={S.select}>
              {SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
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
              <b>{progress.done}</b> / {size} scanned
              <span style={S.spacer} />
              live accuracy <b style={{ color: liveAcc >= 0.9 ? "#3aa76d" : liveAcc >= 0.75 ? "#c99a3a" : "#c0504d" }}>
                {(liveAcc * 100).toFixed(1)}%
              </b>
            </div>
            <div style={S.bar}><div style={{ ...S.barFill, width: `${(progress.done / size) * 100}%` }} /></div>
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
            </div>
            <div style={{ ...S.statRow, marginTop: 14 }}>
              <Stat label="1st-half acc" value={`${(summary.firstHalfAcc * 100).toFixed(1)}%`} />
              <Stat label="2nd-half acc" value={`${(summary.secondHalfAcc * 100).toFixed(1)}%`} />
              {summary.peakHeapMB ? <Stat label="Peak memory" value={`${summary.peakHeapMB} MB`} /> : null}
            </div>
            <div style={S.breakRow}>
              <Breakdown title="By rotation" data={summary.byRotation} />
              <Breakdown title="By occlusion" data={summary.byOcclusion} />
            </div>
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
                    <div style={S.missTag}>{m.rotationClass} · {m.occ}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {summary && errors.length > 0 && (
          <div style={S.note}>{errors.length} card(s) errored (usually image load / recognition timeout) and were excluded from accuracy.</div>
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
  note: { marginTop: 16, color: "#9aa0ac", fontSize: 13 },
};
