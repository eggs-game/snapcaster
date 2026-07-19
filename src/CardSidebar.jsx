import React from "react";

const CV_LABEL = {
  ready: "OpenCV ready",
  loading: "OpenCV still loading…",
  failed: "OpenCV failed to load",
  unknown: "OpenCV status unknown",
};

export default function CardSidebar({ current, lookups, onPick }) {
  const best = current?.matches?.[0];
  // Do not present a forced nearest neighbour as an identification. Real camera
  // scans can score around 190 even when the correct printing is ranked first,
  // so show those as a clearly labeled possible match.
  const top = best && (best.identified_by === "ocr-title" || best.identified_by === "art-match" || best.distance <= 195) ? best : null;
  const showDiag = current && !current.loading && current.cvStatus !== undefined;
  return (
    <aside className="sidebar">
      <h3>Card lookup</h3>
      {showDiag && (
        <div className="scan-diag">
          <span className={current.cvStatus === "ready" ? "diag ok" : "diag bad"}>
            {CV_LABEL[current.cvStatus] || CV_LABEL.unknown}
          </span>
          <span className={current.cardFound ? "diag ok" : "diag bad"}>
            {current.cardFound ? "Card outline detected" : "No outline — using center crop"}
          </span>
          {current.ocrText && (
            <span className={best?.identified_by === "ocr-title" ? "diag ok" : "diag iffy"}>
              Title read: {current.ocrText}{current.ocrRotation ? ` (${current.ocrRotation}°)` : ""}
            </span>
          )}
          {current.ocrError && <span className="diag bad">Title OCR unavailable</span>}
          {current.ocrImage && (
            <img className="ocr-strip" src={current.ocrImage} alt="What the title reader saw"
                 title="What the title reader saw" />
          )}
          {best && (
            <span className={best.distance <= 90 ? "diag ok" : best.distance <= 215 ? "diag iffy" : "diag bad"}>
              Best distance: {best.distance} via {best.strategy || "unknown"} ({current.candidatesTried || 1} tried)
            </span>
          )}
          {current.artChecked > 0 && current.artBest && (
            <span className={current.artBest.inliers >= 16 ? "diag ok" : current.artBest.inliers >= 8 ? "diag iffy" : "diag bad"}>
              Art check: {current.artBest.inliers} keypoints agree on {current.artBest.name} ({current.artChecked} compared)
            </span>
          )}
        </div>
      )}
      {current?.loading && <div className="lookup-status">Identifying…</div>}
      {current?.error && <div className="lookup-status error">{current.error}</div>}
      {current?.matches?.length === 0 && <div className="lookup-status">No match found. Try clicking closer to the card center.</div>}
      {best && !top && <div className="lookup-status">Not certain — best guesses below. Click the right card to select it.</div>}
      {top && (
        <div className="card-hit">
          <img src={top.image} alt={top.name} />
          <div className="card-meta">
            <b>{top.name}</b>
            <span>{top.set_name || top.set?.toUpperCase()} · #{top.collector_number}</span>
            {top.confidence !== undefined && (
              <span className={top.confidence > 0.5 ? "conf good" : "conf iffy"}>
                {top.identified_by === "art-match"
                  ? `Art match · ${top.art_inliers} keypoints`
                  : top.identified_by === "ocr-title"
                    ? `Title match · ${Math.round((current.titleScore || 0) * 100)}%`
                    : top.confidence > 0.5 ? `${Math.round(top.confidence * 100)}% match` : "Possible match"}
              </span>
            )}
            {top.scryfall_uri && <a href={top.scryfall_uri} target="_blank" rel="noreferrer">View on Scryfall</a>}
          </div>
        </div>
      )}
      {(top ? current?.matches?.length > 1 : !!best) && (
        <>
          <h4>{top ? "Not right? Alternatives:" : "Best guesses:"}</h4>
          <div className="alts">
            {(top ? current.matches.slice(1) : current.matches).slice(0, 12).map((m, i) => (
              <img key={i} src={m.image} alt={m.name} title={`${m.name} (${m.set})`} onClick={() => onPick(m)} />
            ))}
          </div>
        </>
      )}
      {!current && <div className="lookup-status">Click a card on any video feed to look it up.</div>}

      <h3>Recent lookups</h3>
      <ul className="lookups">
        {[...(lookups || [])].reverse().map((l, i) => (
          <li key={i} onClick={() => onPick(l.card)}>
            <b>{l.card?.name}</b> <span className="by">by {l.by}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
