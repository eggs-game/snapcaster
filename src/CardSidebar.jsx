import React from "react";

const CV_LABEL = {
  ready: "OpenCV ready",
  loading: "OpenCV still loading…",
  failed: "OpenCV failed to load",
  unknown: "OpenCV status unknown",
};

export default function CardSidebar({ current, lookups, onPick }) {
  const top = current?.matches?.[0];
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
          {top && (
            <span className={top.distance <= 90 ? "diag ok" : top.distance <= 142 ? "diag iffy" : "diag bad"}>
              Best distance: {top.distance} (lower = better; ~5 is ideal)
            </span>
          )}
        </div>
      )}
      {current?.loading && <div className="lookup-status">Identifying…</div>}
      {current?.error && <div className="lookup-status error">{current.error}</div>}
      {current?.matches?.length === 0 && <div className="lookup-status">No match found. Try clicking closer to the card center.</div>}
      {top && (
        <div className="card-hit">
          <img src={top.image} alt={top.name} />
          <div className="card-meta">
            <b>{top.name}</b>
            <span>{top.set_name || top.set?.toUpperCase()} · #{top.collector_number}</span>
            {top.confidence !== undefined && (
              <span className={top.confidence > 0.5 ? "conf good" : "conf iffy"}>
                {Math.round(top.confidence * 100)}% match
              </span>
            )}
            {top.scryfall_uri && <a href={top.scryfall_uri} target="_blank" rel="noreferrer">View on Scryfall</a>}
          </div>
        </div>
      )}
      {current?.matches?.length > 1 && (
        <>
          <h4>Not right? Alternatives:</h4>
          <div className="alts">
            {current.matches.slice(1).map((m, i) => (
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
