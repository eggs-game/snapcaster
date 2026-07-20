import React, { useEffect, useState } from "react";
import {
  ArrowLeft, ArrowUpRight, Link2, Mic, MicOff, PanelLeft, Search,
  Send, Settings, UserPlus, UserRound, Video, VideoOff,
} from "lucide-react";
import { suggestCardNames } from "./cardSearch.js";

// Labels for the ?debug=1 diagnostics panel.
const CV_LABEL = {
  ready: "OpenCV ready",
  loading: "OpenCV still loading…",
  failed: "OpenCV failed to load",
  unknown: "OpenCV status unknown",
};

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
  lifeEvents,
  chatMessages,
  currentUserId,
  onSendChat,
  onPick,
  onClose,
  closing,
  onClosed,
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
  themePreference,
  onThemePreferenceChange,
  videoLayout,
  onVideoLayoutChange,
  onToggleCam,
  onToggleMic,
  onChooseCamera,
  onChooseMic,
  onChooseColor,
  linkCopied,
  visitorLinkCopied,
  onCopyPlayerLink,
  onCopyVisitorLink,
  lobbyName,
  onRenameLobby,
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [highlight, setHighlight] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [lookupTab, setLookupTab] = useState("cards");
  const [editingLobbyName, setEditingLobbyName] = useState(false);
  const [lobbyNameDraft, setLobbyNameDraft] = useState(lobbyName || "Untitled game");
  const [chatDraft, setChatDraft] = useState("");
  // Card-flip between views: rotate to the edge, swap content, rotate back.
  const [shownView, setShownView] = useState(view);
  const [flipPhase, setFlipPhase] = useState(null); // "out" | "in" | null
  // One-shot open slide; cleared after it finishes so flips don't re-trigger it.
  const [entering, setEntering] = useState(true);
  const settings = shownView === "settings";
  const logEntries = [...(lifeEvents || [])].sort((a, b) => (b.at || 0) - (a.at || 0));
  const recentCards = [...(lookups || [])].reverse();

  useEffect(() => {
    if (!editingLobbyName) setLobbyNameDraft(lobbyName || "Untitled game");
  }, [lobbyName, editingLobbyName]);

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
  // A decisive identification (art keypoints, title read, or manual search).
  // Anything else is a ranked guess and must say so.
  const decisive = !!top && ["ocr-title", "art-match", "search"].includes(top.identified_by);
  const debugMode = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).has("debug");

  return (
    <aside
      className={[
        "sidebar",
        settings ? "settings-view" : "",
        !settings && lookupTab === "chat" ? "chat-view" : "",
        entering && !closing ? "slide-in" : "",
        flipPhase ? `flip-${flipPhase}` : "",
        closing ? "slide-out" : "",
      ].filter(Boolean).join(" ")}
      onAnimationEnd={(event) => {
        // Ignore bubbled animationend from children (icons, etc.).
        if (event.target !== event.currentTarget) return;
        const name = event.animationName;
        if (name === "sidebar-slide-in") {
          setEntering(false);
          return;
        }
        if (name === "sidebar-slide-out") {
          onClosed?.();
          return;
        }
        if (name === "sidebar-flip-out" && flipPhase === "out") {
          setShownView(view);
          setFlipPhase("in");
          return;
        }
        if (name === "sidebar-flip-in" && flipPhase === "in") {
          // Pending view changes are picked up by the useEffect above.
          setFlipPhase(null);
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
              <ArrowLeft size={18} />
            </button>
            <span className="logo">Settings</span>
          </>
        ) : (
          <>
            <div className="sidebar-head-actions">
              <button
                className="drawer-toggle"
                onClick={onClose}
                aria-label="Close card lookup"
                title="Close card lookup"
              >
                <PanelLeft size={18} />
              </button>
              {!isVisitor && (
                <ShareMenu
                  linkCopied={linkCopied}
                  visitorLinkCopied={visitorLinkCopied}
                  onCopyPlayerLink={onCopyPlayerLink}
                  onCopyVisitorLink={onCopyVisitorLink}
                />
              )}
              <button
                className="drawer-toggle"
                onClick={() => onViewChange("settings")}
                aria-label="Open settings"
                title="Open settings"
              >
                <Settings size={18} />
              </button>
            </div>
          </>
        )}
      </div>

      {settings ? (
        <div className="sidebar-settings">
          <fieldset className="theme-field">
            <legend className="color-label">Game view</legend>
            <div className="view-options">
              {[
                ["tiles", "Tile"],
                ["follow", "Active"],
                ["hero", "Hero"],
              ].map(([option, label]) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={videoLayout === option}
                  onClick={() => onVideoLayoutChange(option)}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="theme-field">
            <legend className="color-label">Appearance</legend>
            <div className="theme-options">
              {["light", "dark", "system"].map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={themePreference === option}
                  onClick={() => onThemePreferenceChange(option)}
                >
                  {option[0].toUpperCase() + option.slice(1)}
                </button>
              ))}
            </div>
          </fieldset>
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
                {camOn ? <Video size={18} /> : <VideoOff size={18} />}
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
            {micOn ? <Mic size={18} /> : <MicOff size={18} />}
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
          {editingLobbyName && !isVisitor ? (
            <form
              className="sidebar-game-name-edit"
              onSubmit={(event) => {
                event.preventDefault();
                onRenameLobby?.(lobbyNameDraft);
                setEditingLobbyName(false);
              }}
            >
              <input
                value={lobbyNameDraft}
                onChange={(event) => setLobbyNameDraft(event.target.value)}
                onBlur={() => {
                  onRenameLobby?.(lobbyNameDraft || lobbyName || "Untitled game");
                  setEditingLobbyName(false);
                }}
                maxLength={48}
                aria-label="Game name"
                autoFocus
              />
            </form>
          ) : (
            <button
              type="button"
              className={isVisitor ? "sidebar-game-name readonly" : "sidebar-game-name"}
              title={isVisitor ? lobbyName : "Click to rename game"}
              onClick={() => {
                if (!isVisitor) setEditingLobbyName(true);
              }}
            >
              {lobbyName || "Untitled game"}
            </button>
          )}
          <div className="lookup-tabs" role="group" aria-label="Card sidebar view">
            {[
              ["cards", "Cards"],
              ["log", "Log"],
              ["chat", "Chat"],
            ].map(([option, label]) => (
              <button
                key={option}
                type="button"
                aria-pressed={lookupTab === option}
                onClick={() => setLookupTab(option)}
              >
                {label}
              </button>
            ))}
          </div>

          {lookupTab === "cards" ? <>
            <div className="sidebar-search">
            <Search size={18} className="search-icon" aria-hidden="true" />
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
              placeholder="Lookup cards"
              aria-label="Lookup cards"
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
                      <ArrowUpRight size={18} />
                    </a>
                  )}
                </div>
                {!decisive && <span className="match-qualifier">Possible match — not certain</span>}
              </div>
            )}
            {best && !decisive && current?.matches?.length > 1 && (
              <div className="alts" aria-label="Other possible matches">
                {current.matches.slice(top ? 1 : 0, top ? 9 : 8).map((m, i) => (
                  <img key={i} src={m.image} alt={m.name} title={`${m.name} (${m.set})`} onClick={() => onPick(m)} />
                ))}
              </div>
            )}
            <section className="recent-cards" aria-labelledby="recent-cards-title">
              <h3 id="recent-cards-title">Recent</h3>
              {recentCards.length ? (
                <div className="recent-card-list">
                  {recentCards.map((entry, index) => (
                    <button
                      type="button"
                      className="recent-card-row"
                      key={`${entry.at || 0}-${entry.card?.scryfall_id || entry.card?.name || index}-${index}`}
                      onClick={() => onPick(entry.card)}
                    >
                      {entry.card?.image && <img src={entry.card.image} alt="" />}
                      <span className="recent-card-copy">
                        <strong>{entry.card?.name}</strong>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="recent-empty">Looked-up and identified cards will appear here.</p>
              )}
            </section>
            {debugMode && current && !current.loading && (
              <div className="scan-debug">
                <span>{CV_LABEL[current.cvStatus] || CV_LABEL.unknown}</span>
                <span>{current.cardFound ? "Card outline detected" : "No outline — using crops"}</span>
                {current.cameraRes && <span>Camera: {current.cameraRes}</span>}
                {best && (
                  <span>
                    Best: d{best.distance} via {best.strategy || "?"} ({current.candidatesTried || 1} tried)
                  </span>
                )}
                {current.artBest && (
                  <span>
                    Art: {current.artBest.inliers} kp{current.artBest.weak ? " (weak)" : ""}, color {current.artBest.color}% on {current.artBest.name} ({current.artChecked} compared)
                  </span>
                )}
                {current.ocrText && <span>Title read: {current.ocrText}</span>}
                {current.ocrImage && <img className="debug-strip" src={current.ocrImage} alt="OCR strip" />}
                {current.captureImage && (
                  <>
                    <span>Capture sent to recognizer:</span>
                    <img className="debug-capture" src={current.captureImage} alt="Recognition capture" />
                  </>
                )}
              </div>
            )}
          </> : lookupTab === "log" ? (
            <div className="lookup-log">
              {!logEntries.length ? (
                <p className="lookup-status">Life total changes will appear here.</p>
              ) : (
                <ul className="lookups">
                  {logEntries.map((entry) => (
                    <li
                      key={`life-${entry.id}`}
                      className="life-log-entry"
                    >
                      <span className={entry.delta > 0 ? "log-life-change gained" : "log-life-change lost"}>
                        {entry.player} {entry.delta > 0 ? "gained" : "lost"} {Math.abs(entry.delta)} life
                      </span>
                      <span className="log-detail">
                        {entry.previous} → {entry.life} · {new Date(entry.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="chat-panel">
              <div className="chat-messages" aria-live="polite">
                {chatMessages?.length ? chatMessages.map((message) => (
                  <div
                    className={message.from === currentUserId ? "chat-message mine" : "chat-message"}
                    key={message.id}
                  >
                    <div className="chat-message-meta">
                      <strong>{message.from === currentUserId ? "You" : message.name}</strong>
                      <span>{new Date(message.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                    </div>
                    <p>{message.text}</p>
                  </div>
                )) : (
                  <p className="chat-empty">Messages from players and visitors will appear here.</p>
                )}
              </div>
              <form
                className="chat-compose"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!chatDraft.trim()) return;
                  onSendChat?.(chatDraft);
                  setChatDraft("");
                }}
              >
                <textarea
                  value={chatDraft}
                  onChange={(event) => setChatDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder="Message everyone"
                  aria-label="Chat message"
                  maxLength={500}
                  rows={1}
                />
                <button type="submit" aria-label="Send message" disabled={!chatDraft.trim()}>
                  <Send size={17} />
                </button>
              </form>
            </div>
          )}
        </>
      )}
    </aside>
  );
}

function ShareMenu({ linkCopied, visitorLinkCopied, onCopyPlayerLink, onCopyVisitorLink }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="sidebar-share-wrap"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        className="drawer-toggle"
        type="button"
        aria-label="Invite players"
        aria-expanded={open}
        aria-haspopup="menu"
        title={linkCopied || visitorLinkCopied ? "Invite link copied" : "Invite players"}
        onClick={() => setOpen((value) => !value)}
      >
        <UserPlus size={18} />
      </button>
      {open && (
        <div className="share-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => { onCopyPlayerLink?.(); setOpen(false); }}
          >
            <Link2 size={17} />
            <span><b>Player link</b><small>Join with a seat</small></span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { onCopyVisitorLink?.(); setOpen(false); }}
          >
            <UserRound size={17} />
            <span><b>Visitor link</b><small>Voice and card lookup only</small></span>
          </button>
        </div>
      )}
    </div>
  );
}
