import React, { useEffect, useState } from "react";
import {
  ArrowLeft, ArrowUpRight, Mic, MicOff, PanelLeftClose, Search, Settings, Video, VideoOff,
} from "lucide-react";
import { suggestCardNames } from "./cardSearch.js";

function cardFromScryfall(card) {
  const face = card.card_faces?.[0];
  return {
    name: card.name,
    set: card.set,
    set_name: card.set_name,
    collector_number: card.collector_number,
    scryfall_id: card.id,
    face: 0,
    image: face?.image_uris?.normal || card.image_uris?.normal || "",
    scryfall_uri: card.scryfall_uri,
    confidence: 1,
    identified_by: "search",
    distance: 0,
  };
}

export default function CardSidebar({
  current,
  lookups,
  onPick,
  onClose,
  onSearch,
  view,
  onViewChange,
  isVisitor,
  camOn,
  micOn,
  cameras,
  mics,
  videoDeviceId,
  audioDeviceId,
  deviceError,
  myColor,
  tileColors,
  onToggleCam,
  onToggleMic,
  onChooseCamera,
  onChooseMic,
  onChooseColor,
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [highlight, setHighlight] = useState(-1);
  const [searching, setSearching] = useState(false);
  // Card-flip between views: rotate to the edge, swap content, rotate back.
  const [shownView, setShownView] = useState(view);
  const [flipPhase, setFlipPhase] = useState(null); // "out" | "in" | null
  const settings = shownView === "settings";

  useEffect(() => {
    if (view !== shownView && !flipPhase) setFlipPhase("out");
  }, [view, shownView, flipPhase]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setHighlight(-1);
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setSuggestions(await suggestCardNames(q, controller.signal));
        setHighlight(-1);
      } catch (error) {
        if (error.name !== "AbortError") setSuggestions([]);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const lookupName = async (name) => {
    const cardName = name.trim();
    if (!cardName) return;
    setSearching(true);
    setSuggestions([]);
    setQuery(cardName);
    try {
      const response = await fetch(
        `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cardName)}`,
      );
      if (!response.ok) throw new Error("Card not found");
      const card = cardFromScryfall(await response.json());
      onSearch?.(card);
      setQuery("");
    } catch (error) {
      onSearch?.({ error: String(error.message || error) });
    } finally {
      setSearching(false);
    }
  };

  const best = current?.matches?.[0];
  // Do not present a forced nearest neighbour as an identification. Real camera
  // scans can score around 190 even when the correct printing is ranked first,
  // so show those as a clearly labeled possible match.
  const top = best && (
    best.identified_by === "ocr-title"
    || best.identified_by === "art-match"
    || best.identified_by === "search"
    || best.distance <= 195
  ) ? best : null;

  return (
    <aside
      className={[
        "sidebar",
        settings ? "settings-view" : "",
        flipPhase ? `flip-${flipPhase}` : "",
      ].filter(Boolean).join(" ")}
      onAnimationEnd={() => {
        if (flipPhase === "out") {
          setShownView(view);
          setFlipPhase("in");
        } else if (flipPhase === "in") {
          setFlipPhase(view !== shownView ? "out" : null);
        }
      }}
    >
      <div className="sidebar-head">
        {settings ? (
          <>
            <button
              className="drawer-toggle"
              onClick={() => onViewChange("lookup")}
              aria-label="Back to card lookup"
              title="Back to card lookup"
            >
              <ArrowLeft size={20} />
            </button>
            <span className="logo">Settings</span>
            <button
              className="drawer-toggle"
              onClick={onClose}
              aria-label="Close sidebar"
              title="Close sidebar"
            >
              <PanelLeftClose size={20} />
            </button>
          </>
        ) : (
          <>
            <span className="logo">Snapcaster</span>
            <div className="sidebar-head-actions">
              <button
                className="drawer-toggle"
                onClick={() => onViewChange("settings")}
                aria-label="Open settings"
                title="Open settings"
              >
                <Settings size={20} />
              </button>
              <button
                className="drawer-toggle"
                onClick={onClose}
                aria-label="Close card lookup"
                title="Close card lookup"
              >
                <PanelLeftClose size={20} />
              </button>
            </div>
          </>
        )}
      </div>

      {settings ? (
        <div className="sidebar-settings">
          {isVisitor && (
            <p className="visitor-note">
              You joined as a visitor. You can listen, speak, and look up cards.
            </p>
          )}
          {!isVisitor && (
            <>
              <h3 className="drawer-section">Video</h3>
              <button
                className={camOn ? "control-row" : "control-row off"}
                onClick={onToggleCam}
              >
                {camOn ? <Video size={20} /> : <VideoOff size={20} />}
                <span>{camOn ? "Camera on" : "Camera off"}</span>
              </button>
              <label className="device-field">
                <span className="color-label">Camera</span>
                <select
                  value={videoDeviceId}
                  onChange={(e) => onChooseCamera(e.target.value)}
                  disabled={!cameras.length}
                >
                  {!cameras.length && <option value="">No cameras found</option>}
                  {cameras.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `Camera ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          <h3 className="drawer-section">Microphone</h3>
          <button
            className={micOn ? "control-row" : "control-row off"}
            onClick={onToggleMic}
          >
            {micOn ? <Mic size={20} /> : <MicOff size={20} />}
            <span>{micOn ? "Mic on" : "Mic muted"}</span>
          </button>
          <label className="device-field">
            <span className="color-label">Microphone</span>
            <select
              value={audioDeviceId}
              onChange={(e) => onChooseMic(e.target.value)}
              disabled={!mics.length}
            >
              {!mics.length && <option value="">No microphones found</option>}
              {mics.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Microphone ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
          {deviceError && <p className="device-error">{deviceError}</p>}

          {!isVisitor && (
            <div className="color-picker">
              <span className="color-label">Your color</span>
              <div className="color-swatches">
                {tileColors.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={myColor === color ? "color-swatch selected" : "color-swatch"}
                    style={{ background: color }}
                    aria-label={`Choose color ${color}`}
                    title="Choose seat color"
                    onClick={() => onChooseColor(color)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="sidebar-search">
            <Search size={16} className="search-icon" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setSuggestions([]);
                  return;
                }
                if (event.key === "ArrowDown" && suggestions.length) {
                  event.preventDefault();
                  setHighlight((i) => (i + 1) % suggestions.length);
                  return;
                }
                if (event.key === "ArrowUp" && suggestions.length) {
                  event.preventDefault();
                  setHighlight((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
                  return;
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  lookupName(highlight >= 0 ? suggestions[highlight] : query);
                }
              }}
              placeholder="Search for a card"
              aria-label="Search for a card"
              autoComplete="off"
              disabled={searching}
            />
            {suggestions.length > 0 && (
              <ul className="sidebar-suggest">
                {suggestions.map((name, i) => (
                  <li
                    key={name}
                    className={i === highlight ? "active" : ""}
                    onMouseEnter={() => setHighlight(i)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      lookupName(name);
                    }}
                  >
                    {name}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {(current?.loading || searching) && <div className="lookup-status">Identifying…</div>}
          {current?.error && <div className="lookup-status error">{current.error}</div>}
          {current?.matches?.length === 0 && <div className="lookup-status">No match found. Try clicking closer to the card center.</div>}
          {best && !top && <div className="lookup-status">No confident match. Try clicking closer to the card center.</div>}
          {top && (
            <div className="card-hit">
              <img src={top.image} alt={top.name} />
              <div className="card-meta">
                <b>{top.name}</b>
                {top.scryfall_uri && (
                  <a
                    className="scryfall-link"
                    href={top.scryfall_uri}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="View on Scryfall"
                    title="View on Scryfall"
                  >
                    <ArrowUpRight size={16} />
                  </a>
                )}
              </div>
            </div>
          )}
          <ul className="lookups">
            {[...(lookups || [])].reverse().map((l, i) => (
              <li key={i} onClick={() => onPick(l.card)}>
                <b>{l.card?.name}</b> <span className="by">by {l.by}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
