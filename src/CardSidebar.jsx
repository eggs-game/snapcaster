import React, { useEffect, useState } from "react";
import {
  ArrowLeft, ArrowUpRight, Copy, Dices, Download, Link2, Mic, MicOff, PanelLeft, Search,
  Send, Settings, Swords, ThumbsDown, UserPlus, UserRound, Video, VideoOff,
} from "lucide-react";
import { suggestCardNames } from "./cardSearch.js";
import {
  parseChatDraft, selectWhisperRecipient, whisperCommandMatches, whisperRecipientMatches,
} from "./chatCommands.js";

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

function reportUuid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export default function CardSidebar({
  current,
  lookups,
  lifeEvents,
  diceRolls,
  readyEvents,
  recognitionReports,
  onAddRecognitionReport,
  onUpdateRecognitionReport,
  chatMessages,
  currentUserId,
  chatRecipients,
  onSendChat,
  onRollDie,
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
  counterPlayers,
  onChangePoison,
  onChangeCommanderDamage,
  onToggleCam,
  onToggleMic,
  onChooseCamera,
  onChooseMic,
  onChooseColor,
  linkCopied,
  visitorLinkCopied,
  gameCodeCopied,
  gameCode,
  playerLink,
  visitorLink,
  onCopyPlayerLink,
  onCopyVisitorLink,
  onCopyGameCode,
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
  const [chatWhisperTargetId, setChatWhisperTargetId] = useState("");
  const [chatSuggestionIndex, setChatSuggestionIndex] = useState(0);
  const [chatError, setChatError] = useState("");
  const [wrongReport, setWrongReport] = useState(null);
  const [truthQuery, setTruthQuery] = useState("");
  const [truthSuggestions, setTruthSuggestions] = useState([]);
  const [truthHighlight, setTruthHighlight] = useState(-1);
  // One-shot open slide; cleared after the panel settles into place.
  const [entering, setEntering] = useState(true);
  const settings = view === "settings";
  const counters = view === "counters";
  const invite = view === "invite";
  const dice = view === "dice";
  const logEntries = [
    ...(lifeEvents || []).map((entry) => ({ ...entry, type: "life" })),
    ...(diceRolls || []).map((entry) => ({ ...entry, type: "dice" })),
    ...(readyEvents || []).map((entry) => ({ ...entry, type: "ready" })),
  ].sort((a, b) => (b.at || 0) - (a.at || 0));
  const recentCards = [...(lookups || [])].reverse();
  const safeChatRecipients = chatRecipients || [];
  const chatCommandSuggestions = whisperCommandMatches(chatDraft);
  const chatRecipientSuggestions = chatWhisperTargetId
    ? []
    : whisperRecipientMatches(chatDraft, safeChatRecipients);
  const chatSuggestions = [
    ...chatCommandSuggestions.map((command) => ({ type: "command", id: command, label: command })),
    ...chatRecipientSuggestions.map((recipient) => ({
      type: "recipient", id: recipient.id, label: recipient.name, recipient,
    })),
  ];
  const whisperTarget = safeChatRecipients.find((recipient) => recipient.id === chatWhisperTargetId);

  const chooseChatSuggestion = (suggestion) => {
    if (!suggestion) return;
    if (suggestion.type === "command") {
      setChatDraft("/whisper @");
      setChatWhisperTargetId("");
    } else {
      setChatDraft(selectWhisperRecipient(suggestion.recipient));
      setChatWhisperTargetId(suggestion.recipient.id);
    }
    setChatSuggestionIndex(0);
    setChatError("");
  };

  const submitChat = () => {
    const parsed = parseChatDraft(chatDraft, safeChatRecipients, chatWhisperTargetId);
    if (parsed.error) {
      setChatError(parsed.error);
      return;
    }
    const result = onSendChat?.(parsed);
    if (result?.ok === false) {
      setChatError(result.error || "Message could not be sent.");
      return;
    }
    setChatDraft("");
    setChatWhisperTargetId("");
    setChatSuggestionIndex(0);
    setChatError("");
  };

  useEffect(() => {
    const q = truthQuery.trim();
    if (q.length < 2) {
      setTruthSuggestions([]);
      setTruthHighlight(-1);
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setTruthSuggestions(await suggestCardNames(q, controller.signal));
        setTruthHighlight(-1);
      } catch (error) {
        if (error.name !== "AbortError") setTruthSuggestions([]);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [truthQuery]);

  useEffect(() => {
    if (!editingLobbyName) setLobbyNameDraft(lobbyName || "Untitled game");
  }, [lobbyName, editingLobbyName]);

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

  const beginWrongCardReport = async () => {
    if (!current?.captureImage) return;
    const predicted = current.matches?.[0] || null;
    const report = {
      id: reportUuid(),
      editToken: reportUuid(),
      createdAt: Date.now(),
      truth: null,
      captureImage: current.captureImage,
      predictedCard: predicted,
      predictedImage: predicted?.image || "",
      matches: (current.matches || []).slice(0, 24),
      recognizer: {
        cardFound: current.cardFound,
        cvStatus: current.cvStatus,
        candidatesTried: current.candidatesTried,
        cropsDropped: current.cropsDropped,
        artBest: current.artBest,
        artChecked: current.artChecked,
        ocrText: current.ocrText,
        ocrConfidence: current.ocrConfidence,
        ocrRotation: current.ocrRotation,
        titleScore: current.titleScore,
        metadataObservation: current.metadataObservation,
        metadataVetoed: current.metadataVetoed,
        metadataConflictAll: current.metadataConflictAll,
        metadataError: current.metadataError,
      },
      captureContext: current.captureContext || null,
      cameraRes: current.cameraRes || "",
      ocrImage: current.ocrImage || "",
    };
    setWrongReport({ ...report, syncStatus: "saving" });
    const saved = await onAddRecognitionReport?.(report);
    setWrongReport({ ...report, syncStatus: saved === false ? "error" : "saved" });
  };

  const labelWrongCard = async (name) => {
    const cardName = String(name || "").trim();
    if (!wrongReport || !cardName) return;
    try {
      const response = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cardName)}`);
      if (!response.ok) throw new Error("Card not found");
      const card = cardFromScryfall(await response.json());
      const truth = { ...card, recordedName: card.name };
      const saved = await onUpdateRecognitionReport?.(wrongReport.id, truth);
      if (saved === false) throw new Error("Could not save the label to Supabase");
      const next = { ...wrongReport, truth, labeledAt: Date.now() };
      setWrongReport(next);
      setTruthQuery("");
      setTruthSuggestions([]);
    } catch (error) {
      setTruthSuggestions([]);
      setTruthQuery(String(error.message || error));
    }
  };

  const downloadRecognitionReports = () => {
    const payload = JSON.stringify({
      format: "snapcast-recognition-reports/v1",
      exportedAt: new Date().toISOString(),
      // The edit token is intentionally never exported: it is the capability
      // used by this browser to attach a later true-card label.
      reports: (recognitionReports || []).map(({ editToken, ...report }) => report),
    }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `snapcast-recognition-reports-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const decisive = !!top && ["ocr-title", "art-match", "search", "visual-exact"].includes(top.identified_by);
  const debugMode = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).has("debug");

  return (
    <aside
      className={[
        "sidebar",
        settings ? "settings-view" : "",
        counters ? "counters-view" : "",
        invite ? "invite-view" : "",
        dice ? "dice-view" : "",
        !settings && lookupTab === "chat" ? "chat-view" : "",
        entering && !closing ? "slide-in" : "",
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
      }}
    >
      <div className="sidebar-head">
        {settings || counters || invite || dice ? (
          <>
            <button
              className="drawer-toggle"
              onClick={() => onViewChange("lookup")}
              aria-label="Back to card lookup"
              title="Back to card lookup"
            >
              <ArrowLeft size={18} />
            </button>
            <span className="logo">{settings ? "Settings" : counters ? "Counters" : invite ? "Invite" : "Dice"}</span>
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
                <button
                  className="drawer-toggle"
                  onClick={() => onViewChange("invite")}
                  aria-label="Invite players"
                  title="Invite players"
                >
                  <UserPlus size={18} />
                </button>
              )}
              <button
                className="drawer-toggle"
                onClick={() => onViewChange("counters")}
                aria-label="Open combat counters"
                title="Combat counters"
              >
                <Swords size={18} />
              </button>
              <button
                className="drawer-toggle"
                onClick={() => onViewChange("dice")}
                aria-label="Open dice roller"
                title="Dice roller"
              >
                <Dices size={18} />
              </button>
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
      ) : counters ? (
        <CounterPanel
          players={counterPlayers || []}
          onChangePoison={onChangePoison}
          onChangeCommanderDamage={onChangeCommanderDamage}
        />
      ) : invite ? (
        <InvitePanel
          gameCode={gameCode}
          playerLink={playerLink}
          visitorLink={visitorLink}
          gameCodeCopied={gameCodeCopied}
          linkCopied={linkCopied}
          visitorLinkCopied={visitorLinkCopied}
          onCopyGameCode={onCopyGameCode}
          onCopyPlayerLink={onCopyPlayerLink}
          onCopyVisitorLink={onCopyVisitorLink}
        />
      ) : dice ? (
        <DicePanel lastRoll={diceRolls?.[diceRolls.length - 1]} onRoll={onRollDie} />
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
                  {current.captureImage && (
                    <button
                      type="button"
                      className="wrong-card-btn"
                      onClick={beginWrongCardReport}
                      aria-label="Wrong card"
                      title="Wrong card"
                    >
                      <ThumbsDown size={17} />
                    </button>
                  )}
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
            {wrongReport && (
              <section className="wrong-card-report" aria-label="Wrong card report">
                <div className="wrong-card-report-head">
                  <strong>Wrong card report</strong>
                  <span>{wrongReport.syncStatus === "saving" ? "Saving…" : wrongReport.syncStatus === "error" ? "Save failed" : wrongReport.truth ? "Labeled" : "Needs card label"}</span>
                </div>
                <div className="wrong-card-evidence">
                  {wrongReport.captureImage && <img src={wrongReport.captureImage} alt="Clicked card capture" title="Clicked card capture" />}
                  {wrongReport.predictedImage && <img src={wrongReport.predictedImage} alt="Predicted card" title={`Predicted: ${wrongReport.predictedCard?.name || "Unknown"}`} />}
                  {wrongReport.truth?.image && <img src={wrongReport.truth.image} alt="Recorded true card" title={`True card: ${wrongReport.truth.name}`} />}
                </div>
                {wrongReport.syncStatus === "saving" && <p className="wrong-card-sync-note">Saving evidence to Supabase…</p>}
                {wrongReport.syncStatus === "error" && <p className="wrong-card-sync-note error">{wrongReport.syncError || "Could not save to Supabase. Download the report to keep it."}</p>}
                {!wrongReport.truth && wrongReport.syncStatus !== "saving" && (
                  <div className="truth-card-field">
                    <input
                      value={truthQuery}
                      onChange={(event) => setTruthQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowDown" && truthSuggestions.length) {
                          event.preventDefault();
                          setTruthHighlight((i) => (i + 1) % truthSuggestions.length);
                        } else if (event.key === "ArrowUp" && truthSuggestions.length) {
                          event.preventDefault();
                          setTruthHighlight((i) => (i <= 0 ? truthSuggestions.length - 1 : i - 1));
                        } else if (event.key === "Enter") {
                          event.preventDefault();
                          labelWrongCard(truthHighlight >= 0 ? truthSuggestions[truthHighlight] : truthQuery);
                        }
                      }}
                      placeholder="What card was it?"
                      aria-label="Record true card"
                      autoComplete="off"
                    />
                    {truthSuggestions.length > 0 && (
                      <ul className="truth-card-suggest">
                        {truthSuggestions.map((name, index) => (
                          <li
                            key={name}
                            className={index === truthHighlight ? "active" : ""}
                            onMouseDown={(event) => { event.preventDefault(); labelWrongCard(name); }}
                          >{name}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                <div className="wrong-card-report-actions">
                  <span>{recognitionReports?.filter((entry) => entry.syncStatus === "saved").length || 0} saved</span>
                  {!!recognitionReports?.length && (
                    <button type="button" onClick={downloadRecognitionReports}><Download size={15} /> Download reports</button>
                  )}
                </div>
              </section>
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
                    Best: d{best.distance} via {best.strategy || "?"} ({current.candidatesTried || 1} tried{current.cropsDropped ? `, ${current.cropsDropped} empty dropped` : ""})
                  </span>
                )}
                {current.artBest && (
                  <span>
                    Art: {current.artBest.inliers} kp{current.artBest.weak ? " (weak)" : ""}, color {current.artBest.color}% on {current.artBest.name} ({current.artChecked} compared)
                  </span>
                )}
                {current.ocrText && <span>Title read: {current.ocrText}</span>}
                {current.metadataObservation && (
                  <span>
                    Metadata: mana {current.metadataObservation.mana?.text || "—"}
                    {Number.isInteger(current.metadataObservation.mana?.symbolCount)
                      ? ` (${current.metadataObservation.mana.symbolCount} symbols)` : ""}
                    {`, type ${current.metadataObservation.type?.text || "—"}`}
                    {current.metadataVetoed ? `; ${current.metadataVetoed} candidates vetoed` : ""}
                    {current.metadataConflictAll ? "; all conflicts ignored" : ""}
                  </span>
                )}
                {current.metadataObservation?.rules?.text && (
                  <span>Rules read: {current.metadataObservation.rules.text}</span>
                )}
                {current.metadataError && <span>Metadata error: {current.metadataError}</span>}
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
                <p className="lookup-status">Life changes, dice rolls, and ready checks will appear here.</p>
              ) : (
                <ul className="lookups">
                  {logEntries.map((entry) => (
                    <li
                      key={`${entry.type}-${entry.id}`}
                      className={entry.type === "dice" ? "dice-log-entry" : entry.type === "ready" ? "ready-log-entry" : "life-log-entry"}
                    >
                      {entry.type === "dice" ? (
                        <>
                          <span className="log-dice-roll">{entry.name} rolled a {entry.value}</span>
                          <span className="log-detail">
                            d{entry.sides || 20} · {new Date(entry.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                          </span>
                        </>
                      ) : entry.type === "ready" ? (
                        <>
                          <span className={entry.outcome === "ready" ? "log-ready-check ready" : "log-ready-check not-ready"}>
                            {entry.outcome === "ready" ? "Everyone is ready" : `${entry.player} is not ready`}
                          </span>
                          <span className="log-detail">
                            {new Date(entry.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className={entry.delta > 0 ? "log-life-change gained" : "log-life-change lost"}>
                            {entry.player} {entry.delta > 0 ? "gained" : "lost"} {Math.abs(entry.delta)} life
                          </span>
                          <span className="log-detail">
                            {entry.previous} → {entry.life} · {new Date(entry.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                          </span>
                        </>
                      )}
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
                    className={`chat-message${message.from === currentUserId ? " mine" : ""}${message.whisper ? " whisper" : ""}`}
                    key={message.id}
                  >
                    <div className="chat-message-meta">
                      <strong>
                        {message.whisper
                          ? message.from === currentUserId
                            ? `Whisper to @${message.toName}`
                            : `Whisper from @${message.name}`
                          : message.from === currentUserId ? "You" : message.name}
                      </strong>
                      <span>{new Date(message.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                    </div>
                    <p>{message.text}</p>
                  </div>
                )) : (
                  <p className="chat-empty">Messages from players and visitors will appear here.</p>
                )}
              </div>
              {chatError && <p className="chat-compose-error" id="chat-compose-error" role="alert">{chatError}</p>}
              <form
                className="chat-compose"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitChat();
                }}
              >
                {chatSuggestions.length > 0 && (
                  <div className="chat-suggestions" role="listbox" aria-label={chatCommandSuggestions.length ? "Chat commands" : "Whisper recipients"}>
                    {chatSuggestions.map((suggestion, index) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected={index === chatSuggestionIndex}
                        className={index === chatSuggestionIndex ? "selected" : ""}
                        key={`${suggestion.type}-${suggestion.id}`}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => chooseChatSuggestion(suggestion)}
                      >
                        <strong>{suggestion.type === "recipient" ? `@${suggestion.label}` : suggestion.label}</strong>
                        <span>
                          {suggestion.type === "recipient"
                            ? `${suggestion.recipient.role}${safeChatRecipients.filter((person) => person.name.toLocaleLowerCase() === suggestion.recipient.name.toLocaleLowerCase()).length > 1 ? ` · ${suggestion.recipient.id.slice(-4)}` : ""}`
                            : "Private message"}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  value={chatDraft}
                  onChange={(event) => {
                    const next = event.target.value;
                    setChatDraft(next);
                    setChatError("");
                    setChatSuggestionIndex(0);
                    if (whisperTarget && !next.toLocaleLowerCase().startsWith(`/whisper @${whisperTarget.name}`.toLocaleLowerCase())) {
                      setChatWhisperTargetId("");
                    }
                  }}
                  onKeyDown={(event) => {
                    if (chatSuggestions.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                      event.preventDefault();
                      const direction = event.key === "ArrowDown" ? 1 : -1;
                      setChatSuggestionIndex((index) => (index + direction + chatSuggestions.length) % chatSuggestions.length);
                      return;
                    }
                    if (chatSuggestions.length && (event.key === "Tab" || event.key === "Enter")) {
                      event.preventDefault();
                      chooseChatSuggestion(chatSuggestions[chatSuggestionIndex] || chatSuggestions[0]);
                      return;
                    }
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder={whisperTarget ? `Whisper to @${whisperTarget.name}` : chatDraft.toLowerCase().startsWith("/whisper") ? "Choose @person, then write a message" : "Message everyone"}
                  aria-label="Chat message"
                  aria-describedby={chatError ? "chat-compose-error" : undefined}
                  maxLength={640}
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

function DicePanel({ lastRoll, onRoll }) {
  const [selectedSides, setSelectedSides] = useState(lastRoll?.sides || 20);
  const diceOptions = Array.from({ length: 19 }, (_, index) => index + 2);
  return (
    <div className="dice-panel">
      <p>Choose a die to roll. Results are shared with everyone and added to Log.</p>
      <div className="dice-result" key={lastRoll?.id || "empty"}>
        <Dices size={28} />
        <strong>{lastRoll?.value || "—"}</strong>
        <span>{lastRoll ? `d${lastRoll.sides || 20} · ${lastRoll.name} · ${new Date(lastRoll.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "No rolls yet"}</span>
      </div>
      <div className="dice-option-grid" aria-label="Choose a die to roll">
        {diceOptions.map((sides) => (
          <button
            type="button"
            className={selectedSides === sides ? "dice-option selected" : "dice-option"}
            key={sides}
            onClick={() => {
              setSelectedSides(sides);
              onRoll?.(sides);
            }}
            aria-label={`Roll d${sides}`}
          >
            <DieOutline sides={sides} />
            <span>d{sides}</span>
          </button>
        ))}
        <span className="dice-option-spacer" aria-hidden="true" />
        <span className="dice-option-spacer" aria-hidden="true" />
      </div>
    </div>
  );
}

function DieOutline({ sides }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };
  if (sides === 2) {
    return <svg className="die-outline" viewBox="0 0 48 48" aria-hidden="true"><ellipse {...common} cx="24" cy="24" rx="17" ry="15" /><path {...common} d="M7 22v5c0 8 7.6 14 17 14s17-6 17-14v-5" /></svg>;
  }
  if (sides === 4) {
    return <svg className="die-outline" viewBox="0 0 48 48" aria-hidden="true"><path {...common} d="M24 5 43 40H5L24 5Z M24 5v23M5 40l19-12 19 12" /></svg>;
  }
  if (sides === 6) {
    return <svg className="die-outline" viewBox="0 0 48 48" aria-hidden="true"><path {...common} d="m24 5 17 10v20L24 44 7 34V14L24 5Z M7 14l17 10 17-9M24 24v20" /></svg>;
  }
  if (sides === 8) {
    return <svg className="die-outline" viewBox="0 0 48 48" aria-hidden="true"><path {...common} d="m24 4 18 20-18 20L6 24 24 4Z M6 24h36M24 4 14 24l10 20M24 4l10 20-10 20" /></svg>;
  }
  if (sides === 10) {
    return <svg className="die-outline" viewBox="0 0 48 48" aria-hidden="true"><path {...common} d="m24 4 16 12 3 17-19 11L5 33l3-17L24 4Z M24 4v21M8 16l16 9 16-9M5 33l19-8 19 8M24 25v19" /></svg>;
  }
  if (sides === 12) {
    return <svg className="die-outline" viewBox="0 0 48 48" aria-hidden="true"><path {...common} d="m15 5 18 1 11 14-5 18-16 6L7 35 5 17 15 5Z M17 15l14-1 8 11-5 12-14 2-10-9 2-11 5-4Z M15 5l2 10M33 6l-2 8M44 20l-5 5M39 38l-5-1M23 44l-3-5M7 35l3-5M5 17l7 2" /></svg>;
  }
  if (sides === 20) {
    return (
      <svg className="die-outline" viewBox="0 0 48 48" aria-hidden="true">
        <path {...common} strokeWidth="2" d="M24 3 43 15v20L24 45 5 35V15L24 3Z" />
        <path {...common} strokeWidth="2" d="M24 3 14 18h20L24 3ZM5 15l9 3M43 15l-9 3M14 18l10 18 10-18M5 35l19 1 19-1M24 36v9" />
      </svg>
    );
  }

  // Less-common die sizes use a faceted trapezohedral construction. The belt
  // gains facets with the die size while staying legible at icon scale.
  const facetCount = Math.max(3, Math.min(8, Math.ceil(sides / 3)));
  const belt = Array.from({ length: facetCount }, (_, index) => {
    const angle = Math.PI + (index * Math.PI * 2) / facetCount;
    return {
      x: 24 + Math.cos(angle) * 19,
      y: 24 + Math.sin(angle) * 8,
    };
  });
  const beltPoints = belt.map((point) => `${point.x},${point.y}`).join(" ");
  const facets = belt.flatMap((point, index) => {
    const next = belt[(index + 1) % belt.length];
    return [
      <line key={`top-${index}`} {...common} x1="24" y1="4" x2={point.x} y2={point.y} />,
      <line key={`bottom-${index}`} {...common} x1="24" y1="44" x2={next.x} y2={next.y} />,
    ];
  });
  return (
    <svg className="die-outline" viewBox="0 0 48 48" aria-hidden="true">
      <polygon {...common} points={beltPoints} />
      {facets}
      <path {...common} d="M24 4 43 24 24 44 5 24 24 4Z" />
    </svg>
  );
}

function CounterPanel({ players, onChangePoison, onChangeCommanderDamage }) {
  if (!players.length) {
    return <p className="counter-empty">Player counters will appear when someone joins the game.</p>;
  }

  return (
    <div className="counter-panel">
      {players.map((player) => {
        const opponents = players.filter((opponent) => opponent.id !== player.id);
        return (
          <section className="counter-player" key={player.id}>
            <div className="counter-player-head">
              <h3>{player.isMe ? "Your counters" : player.name}</h3>
              {!player.isMe && <span>Read only</span>}
            </div>
            <div className="counter-row">
              <span className="counter-label">
                <strong>Poison</strong>
                <small>10 loses the game</small>
              </span>
              <CounterStepper
                value={player.poison}
                lethal={player.poison >= 10}
                editable={player.isMe}
                label={`${player.name} poison counters`}
                onDecrease={() => onChangePoison?.(-1)}
                onIncrease={() => onChangePoison?.(1)}
              />
            </div>
            <div className="commander-damage-list">
              <span className="counter-subheading">Commander damage received</span>
              {opponents.length ? opponents.map((opponent) => {
                const value = player.commanderDamage?.[opponent.id] || 0;
                const label = opponent.commander || `${opponent.name}'s commander`;
                return (
                  <div className="counter-row commander-damage-row" key={opponent.id}>
                    <span className="counter-label">
                      <strong>{label}</strong>
                      {opponent.commander && <small>{opponent.name}</small>}
                    </span>
                    <CounterStepper
                      value={value}
                      lethal={value >= 21}
                      editable={player.isMe}
                      label={`${label} damage to ${player.name}`}
                      onDecrease={() => onChangeCommanderDamage?.(opponent.id, -1)}
                      onIncrease={() => onChangeCommanderDamage?.(opponent.id, 1)}
                    />
                  </div>
                );
              }) : (
                <p className="counter-note">Other commanders will appear here.</p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function CounterStepper({ value, lethal, editable, label, onDecrease, onIncrease }) {
  return (
    <div className={lethal ? "counter-stepper lethal" : "counter-stepper"} aria-label={label}>
      {editable && <button type="button" onClick={onDecrease} aria-label={`Decrease ${label}`}>−</button>}
      <strong>{value}</strong>
      {editable && <button type="button" onClick={onIncrease} aria-label={`Increase ${label}`}>+</button>}
    </div>
  );
}

function InvitePanel({
  gameCode,
  playerLink,
  visitorLink,
  gameCodeCopied,
  linkCopied,
  visitorLinkCopied,
  onCopyGameCode,
  onCopyPlayerLink,
  onCopyVisitorLink,
}) {
  return (
    <div className="invite-panel">
      <p className="invite-intro">Share the game code or send a direct link.</p>
      <InviteField
        label="Game code"
        detail="Enter from the Snapcast home page"
        value={gameCode}
        copied={gameCodeCopied}
        onCopy={onCopyGameCode}
        code
      />
      <InviteField
        icon={<Link2 size={16} />}
        label="Player link"
        detail="Join with a seat, camera, and microphone"
        value={playerLink}
        copied={linkCopied}
        onCopy={onCopyPlayerLink}
      />
      <InviteField
        icon={<UserRound size={16} />}
        label="Visitor link"
        detail="Listen, speak, chat, and look up cards"
        value={visitorLink}
        copied={visitorLinkCopied}
        onCopy={onCopyVisitorLink}
      />
    </div>
  );
}

function InviteField({ icon, label, detail, value, copied, onCopy, code = false }) {
  return (
    <section className="invite-field">
      <div className="invite-field-head">
        <span>{icon}{label}</span>
        <small>{detail}</small>
      </div>
      <div className="invite-value-row">
        <input className={code ? "invite-value code-value" : "invite-value"} value={value || ""} readOnly aria-label={label} />
        <button type="button" onClick={onCopy} aria-label={`Copy ${label.toLowerCase()}`}>
          <Copy size={16} />
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
    </section>
  );
}
