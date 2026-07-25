import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Cat, ChevronDown, ChevronRight, Copy, Dices, Download, Drum, ExternalLink, Laugh, Link2, MessageCircle, Mic, MicOff,
  PanelLeft, Play, Search, Settings, Sparkles, Swords, ThumbsDown, UserPlus, UserRound, Video, VideoOff, X,
} from "lucide-react";
import { suggestCardNames } from "./cardSearch.js";
import {
  parseChatDraft, selectWhisperRecipient, whisperCommandMatches, whisperRecipientMatches,
} from "./chatCommands.js";
import { getSoundEffect, searchSoundEffects } from "./soundEffects.js";
import { getCounterTextColor, getVideoCounterType, VIDEO_COUNTER_TYPES } from "./videoCounters.js";

// Labels for the ?debug=1 diagnostics panel.
const CV_LABEL = {
  ready: "OpenCV ready",
  loading: "OpenCV still loading…",
  failed: "OpenCV failed to load",
  unknown: "OpenCV status unknown",
};

export function cardFromScryfall(card) {
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

function CardStackIcon({ size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m14.1 3.4 5.8 2.4-3.8 11.2-2.3-1" />
      <rect x="3.5" y="2.5" width="11" height="16" rx="1.5" />
      <path d="M6.3 7.5h5.4M6.3 11h5.4" />
    </svg>
  );
}

export default function CardSidebar({
  current,
  lookups,
  recognitionReports,
  onAddRecognitionReport,
  onUpdateRecognitionReport,
  chatMessages,
  currentUserId,
  chatRecipients,
  onSendChat,
  soundCooldownUntil = 0,
  onPreviewSound,
  onRollDie,
  counterDraft,
  onGenerateVideoCounter,
  onStartVideoCounterDrag,
  onPick,
  onShareCard,
  onClose,
  closing,
  onClosed,
  collapsed = false,
  onOpen,
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
  videoFit,
  onVideoFitChange,
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
  const [hasUnreadChat, setHasUnreadChat] = useState(false);
  const [editingLobbyName, setEditingLobbyName] = useState(false);
  const [lobbyNameDraft, setLobbyNameDraft] = useState(lobbyName || "Untitled game");
  const [chatDraft, setChatDraft] = useState("");
  const [chatWhisperTargetId, setChatWhisperTargetId] = useState("");
  const [chatSuggestionIndex, setChatSuggestionIndex] = useState(0);
  const [chatError, setChatError] = useState("");
  const [selectedSoundId, setSelectedSoundId] = useState("");
  const [soundPickerOpen, setSoundPickerOpen] = useState(false);
  const [soundPickerTab, setSoundPickerTab] = useState("creatures");
  const [soundQuery, setSoundQuery] = useState("");
  const [soundPickerStyle, setSoundPickerStyle] = useState({});
  const [now, setNow] = useState(Date.now());
  const [previewingSoundId, setPreviewingSoundId] = useState("");
  const [wrongReport, setWrongReport] = useState(null);
  const [truthQuery, setTruthQuery] = useState("");
  const [truthSuggestions, setTruthSuggestions] = useState([]);
  const [truthHighlight, setTruthHighlight] = useState(-1);
  const [cardPreview, setCardPreview] = useState(null);
  const soundPickerTriggerRef = useRef(null);
  const soundPickerRef = useRef(null);
  const previewStopRef = useRef(null);
  const lastChatMessageIdRef = useRef(chatMessages?.[chatMessages.length - 1]?.id || "");
  // One-shot open slide; cleared after the panel settles into place.
  const [entering, setEntering] = useState(true);
  const settings = view === "settings";
  const counters = view === "counters";
  const invite = view === "invite";
  const dice = view === "dice";
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
  const selectedSound = getSoundEffect(selectedSoundId);
  const soundResults = searchSoundEffects(soundQuery, soundPickerTab);
  const soundCooldownRemaining = Math.max(0, soundCooldownUntil - now);
  const soundIsCoolingDown = soundCooldownRemaining > 0;
  const soundPickerBlocked = Boolean(whisperTarget || chatDraft.toLowerCase().startsWith("/whisper") || soundIsCoolingDown);
  const soundPickerTooltip = soundIsCoolingDown
    ? `Wait ${Math.floor(Math.ceil(soundCooldownRemaining / 1000) / 60)}:${String(Math.ceil(soundCooldownRemaining / 1000) % 60).padStart(2, "0")}`
    : whisperTarget || chatDraft.toLowerCase().startsWith("/whisper")
      ? "Sound effects are public only"
      : "Add sound effect";

  useEffect(() => {
    const latestId = chatMessages?.[chatMessages.length - 1]?.id || "";
    if (latestId && latestId !== lastChatMessageIdRef.current && lookupTab !== "chat") {
      setHasUnreadChat(true);
    }
    lastChatMessageIdRef.current = latestId;
    if (lookupTab === "chat") setHasUnreadChat(false);
  }, [chatMessages, lookupTab]);

  const openCard = (card) => {
    if (!card) return;
    onPick?.(card);
    setLookupTab("cards");
  };

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
    const result = onSendChat?.({ ...parsed, soundId: selectedSound?.id || "" });
    if (result?.ok === false) {
      setChatError(result.error || "Message could not be sent.");
      return;
    }
    setChatDraft("");
    setChatWhisperTargetId("");
    setSelectedSoundId("");
    setChatSuggestionIndex(0);
    setChatError("");
  };

  const openSoundPicker = () => {
    if (soundPickerBlocked || !soundPickerTriggerRef.current) return;
    const rect = soundPickerTriggerRef.current.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 24);
    setSoundPickerStyle({
      width: `${width}px`,
      left: `${Math.max(12, Math.min(window.innerWidth - width - 12, rect.right - width))}px`,
      bottom: `${Math.max(12, window.innerHeight - rect.top + 8)}px`,
    });
    setSoundPickerOpen(true);
  };

  const previewSound = (soundId) => {
    previewStopRef.current?.();
    setPreviewingSoundId(soundId);
    const stop = onPreviewSound?.(soundId, (error) => {
      setChatError(error?.message || "The preview could not load or play. Check that this tab is not muted.");
    });
    previewStopRef.current = stop || null;
    window.setTimeout(() => setPreviewingSoundId((currentId) => currentId === soundId ? "" : currentId), 3100);
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
    if (!cardPreview) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setCardPreview(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [cardPreview]);

  useEffect(() => {
    if (!soundIsCoolingDown) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [soundIsCoolingDown]);

  useEffect(() => {
    if (!soundPickerOpen) return undefined;
    const closePicker = (event) => {
      if (event.key === "Escape") setSoundPickerOpen(false);
      if (event.type === "pointerdown"
        && !soundPickerRef.current?.contains(event.target)
        && !soundPickerTriggerRef.current?.contains(event.target)) setSoundPickerOpen(false);
    };
    document.addEventListener("keydown", closePicker);
    document.addEventListener("pointerdown", closePicker);
    return () => {
      document.removeEventListener("keydown", closePicker);
      document.removeEventListener("pointerdown", closePicker);
    };
  }, [soundPickerOpen]);

  useEffect(() => () => previewStopRef.current?.(), []);

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
  const gameNameControl = editingLobbyName && !isVisitor ? (
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
  );

  return (
    <>
      <aside
      className={[
        "sidebar",
        settings ? "settings-view" : "",
        counters ? "counters-view" : "",
        invite ? "invite-view" : "",
        dice ? "dice-view" : "",
        collapsed ? "collapsed" : "",
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
      <nav className="sidebar-rail" aria-label="Sidebar navigation">
        <button
          type="button"
          className="drawer-toggle sidebar-mark-toggle"
          onClick={() => {
            if (collapsed) onOpen?.();
          }}
          aria-label={collapsed ? "Open card panel" : "Snapcast"}
          data-tooltip={collapsed ? "Open card panel" : "Snapcast"}
          data-tooltip-pos="left-bottom"
        >
          {collapsed ? <>
            <span className="sidebar-mark collapsed-mark" aria-hidden="true">S</span>
            <ChevronRight className="collapsed-mark-arrow" size={20} />
          </> : <span className="sidebar-mark" aria-hidden="true">S</span>}
        </button>
        <button
          type="button"
          className={!settings && !counters && !invite && !dice ? "drawer-toggle active" : "drawer-toggle"}
          onClick={() => {
            if (collapsed) onOpen?.();
            onViewChange("lookup");
          }}
          aria-label="Open card lookup"
          data-tooltip="Card lookup"
          data-tooltip-pos="left-bottom"
        >
          <CardStackIcon />
        </button>
        {!isVisitor && (
          <button
            className={invite ? "drawer-toggle active" : "drawer-toggle"}
            onClick={() => {
              if (collapsed) onOpen?.();
              onViewChange("invite");
            }}
            aria-label="Invite players"
            data-tooltip="Invite players"
            data-tooltip-pos="left-bottom"
          >
            <UserPlus size={20} />
          </button>
        )}
        {!isVisitor && <>
          <button
            className={counters ? "drawer-toggle active" : "drawer-toggle"}
            onClick={() => {
              if (collapsed) onOpen?.();
              onViewChange("counters");
            }}
            aria-label="Open combat counters"
            data-tooltip="Combat counters"
            data-tooltip-pos="left-bottom"
          >
            <Swords size={20} />
          </button>
          <button
            className={dice ? "drawer-toggle active" : "drawer-toggle"}
            onClick={() => {
              if (collapsed) onOpen?.();
              onViewChange("dice");
            }}
            aria-label="Open dice roller"
            data-tooltip="Dice roller"
            data-tooltip-pos="left-bottom"
          >
            <Dices size={20} />
          </button>
        </>}
        <span className="sidebar-rail-divider" aria-hidden="true" />
        <button
          className={settings ? "drawer-toggle active" : "drawer-toggle"}
          onClick={() => {
            if (collapsed) onOpen?.();
            onViewChange("settings");
          }}
          aria-label="Open settings"
          data-tooltip="Open settings"
          data-tooltip-pos="left-bottom"
        >
          <Settings size={20} />
        </button>
      </nav>

      <div className="sidebar-content" aria-hidden={collapsed}>
      <div className="sidebar-head">
        {(settings || counters || invite || dice) && (
          <span className="logo">{settings ? "Settings" : counters ? "Counters" : invite ? "Invite" : "Dice"}</span>
        )}
        {!settings && !counters && !invite && !dice && gameNameControl}
        <button
          type="button"
          className="drawer-toggle sidebar-header-close"
          onClick={onClose}
          aria-label="Close panel"
          data-tooltip="Close panel"
          data-tooltip-pos="left-bottom"
        >
          <PanelLeft size={20} />
        </button>
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
              <label className="device-field device-field-tight">
                <select
                  aria-label="Camera"
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
              <fieldset className="theme-field" aria-label="Video fit">
                <div className="theme-options two-up">
                  {[
                    ["cover", "Cover"],
                    ["16:9", "16:9"],
                  ].map(([option, label]) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={videoFit === option}
                      onClick={() => onVideoFitChange(option)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>
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
            <select
              aria-label="Microphone"
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
        <DicePanel
          onRoll={onRollDie}
          counterDraft={counterDraft}
          onGenerateVideoCounter={onGenerateVideoCounter}
          counterColor={myColor}
          onStartVideoCounterDrag={onStartVideoCounterDrag}
        />
      ) : (
        <>
          <div className="lookup-tabs" role="group" aria-label="Card sidebar view">
            {[
              ["cards", "Cards"],
              ["chat", "Chat"],
            ].map(([option, label]) => (
              <button
                key={option}
                type="button"
                aria-pressed={lookupTab === option}
                aria-label={option === "chat" && hasUnreadChat ? "Chat, new messages" : label}
                onClick={() => {
                  setLookupTab(option);
                  if (option === "chat") setHasUnreadChat(false);
                }}
              >
                {label}
                {option === "chat" && hasUnreadChat && <span className="chat-unread-dot" aria-hidden="true" />}
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

            {!current && !recentCards.length && (
              <div className="card-empty-state">
                <div className="card-empty-illustration" aria-hidden="true">
                  <div className="card-empty-art"><Sparkles size={28} /></div>
                </div>
                <p>Cards you click on or look up will be displayed here.</p>
              </div>
            )}
            {(current?.loading || searching) && <div className="lookup-status">Identifying…</div>}
            {current?.error && <div className="lookup-status error">{current.error}</div>}
            {current?.matches?.length === 0 && <div className="lookup-status">No match found. Try clicking closer to the card center.</div>}
            {best && !top && <div className="lookup-status">No confident match. Try clicking closer to the card center.</div>}
            {top && (
              <div className="card-hit">
                <button
                  type="button"
                  className="card-hit-image"
                  onClick={() => setCardPreview(top)}
                  aria-label={`Expand ${top.name}`}
                >
                  <img src={top.image} alt={top.name} />
                </button>
                <div className="card-meta">
                  <b>{top.name}</b>
                  <div className="card-actions">
                    {current.captureImage && (
                      <button
                        type="button"
                        className="wrong-card-btn"
                        onClick={beginWrongCardReport}
                        aria-label="Wrong card"
                        data-tooltip="Wrong card"
                        data-tooltip-pos="right-top"
                      >
                        <ThumbsDown size={16} />
                      </button>
                    )}
                    {top.scryfall_uri && (
                      <a
                        className="scryfall-link"
                        href={top.scryfall_uri}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="View on Scryfall"
                        data-tooltip="View on Scryfall"
                        data-tooltip-pos="right-top"
                      >
                        <ExternalLink size={16} />
                      </a>
                    )}
                  </div>
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
            {recentCards.length > 0 && (
              <section className="recent-cards" aria-labelledby="recent-cards-title">
                <h3 id="recent-cards-title">Recent</h3>
                <div className="recent-card-list">
                  {recentCards.map((entry, index) => (
                    <div
                      className="recent-card-row"
                      key={`${entry.at || 0}-${entry.card?.scryfall_id || entry.card?.name || index}-${index}`}
                    >
                      <button type="button" className="recent-card-open" onClick={() => openCard(entry.card)}>
                        {entry.card?.image && <img src={entry.card.image} alt="" />}
                        <span className="recent-card-copy">
                          <strong>{entry.card?.name}</strong>
                        </span>
                      </button>
                      {!isVisitor && (
                        <button
                          type="button"
                          className="recent-card-share"
                          onClick={() => onShareCard?.(entry.card)}
                          aria-label={`Share ${entry.card?.name || "card"}`}
                          data-tooltip="Share card"
                          data-tooltip-pos="left-bottom"
                        >
                          <MessageCircle size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
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
          </> : (
            <div className="chat-panel">
              <div className="chat-messages" aria-live="polite">
                {chatMessages?.length ? chatMessages.map((message) => {
                  const isMine = message.from === currentUserId;
                  const showSenderAvatar = !isMine && !message.kind && !message.whisper;
                  const senderName = message.name || "Player";
                  const senderColorIndex = [...String(message.from || senderName)].reduce((total, character) => total + character.charCodeAt(0), 0) % tileColors.length;
                  return (
                    <div className={`chat-message-row${isMine ? " mine" : ""}`} key={message.id}>
                      {showSenderAvatar && (
                        <span
                          className="chat-avatar"
                          style={{ backgroundColor: tileColors[senderColorIndex] }}
                          aria-label={senderName}
                          data-tooltip={senderName}
                          data-tooltip-pos="right-top"
                        >
                          {senderName.trim().charAt(0).toUpperCase()}
                        </span>
                      )}
                      <div className={`chat-message-wrap${isMine ? " mine" : ""}`}>
                        <div className={`chat-message${isMine ? " mine" : ""}${message.whisper ? " whisper" : ""}`}>
                          {(message.kind || message.whisper) && <div className="chat-message-meta">
                        <strong>
                          {message.kind === "dice"
                            ? isMine ? "You rolled" : `${senderName} rolled`
                            : message.kind === "card"
                            ? isMine ? "You shared" : `${senderName} shared`
                            : message.kind === "life"
                            ? isMine ? "Your life total" : `${senderName}'s life total`
                            : message.kind === "ready"
                            ? "Ready check"
                            : message.whisper
                            ? isMine
                              ? `Whisper to @${message.toName}`
                              : `Whisper from @${senderName}`
                            : senderName}
                        </strong>
                          </div>}
                      {message.kind === "dice" ? (
                        <div className="chat-dice-object">
                          <Dices size={18} aria-hidden="true" />
                          <strong>{formatDiceResult(message.value, message.sides)}</strong>
                          <span>{formatDiceSides(message.sides)}</span>
                        </div>
                      ) : message.kind === "card" ? (
                        <button type="button" className="chat-card-object" onClick={() => message.card && openCard(message.card)}>
                          {message.card?.image && <img src={message.card.image} alt="" />}
                          <span>
                            <strong>{message.card?.name || "Shared card"}</strong>
                            <small>Open card details</small>
                          </span>
                        </button>
                      ) : message.kind === "life" ? (
                        <div className={`chat-life-object ${message.delta >= 0 ? "gained" : "lost"}`}>
                          <strong>{message.delta >= 0 ? "+" : ""}{message.delta} life</strong>
                          <span>{message.previous} → {message.life}</span>
                        </div>
                      ) : message.kind === "ready" ? (
                        <div className={`chat-ready-object ${message.outcome}`}>
                          <strong>{message.outcome === "ready" ? "Everyone is ready" : message.outcome === "not-ready" ? `${message.name} is not ready` : "Ready check timed out"}</strong>
                        </div>
                      ) : (
                        <>
                          {message.soundId && <span className="chat-sound-message"><Drum size={14} /> {getSoundEffect(message.soundId)?.label || "Sound effect"}</span>}
                          {message.text && <p>{message.text}</p>}
                        </>
                      )}
                        </div>
                        <span className="chat-message-timestamp">{new Date(message.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                      </div>
                    </div>
                  );
                }) : (
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
                <div className="chat-compose-main">
                  {selectedSound && (
                    <span className="selected-sound-chip">
                      <Drum size={14} />
                      <span>{selectedSound.label}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${selectedSound.label}`}
                        data-tooltip="Remove sound"
                        onClick={() => setSelectedSoundId("")}
                      >
                        <X size={14} />
                      </button>
                    </span>
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
                </div>
                <button
                  type="button"
                  className="sound-picker-trigger"
                  ref={soundPickerTriggerRef}
                  disabled={soundPickerBlocked}
                  aria-label="Add sound effect"
                  data-tooltip={soundPickerTooltip}
                  data-tooltip-pos="right-top"
                  onClick={openSoundPicker}
                >
                  <Drum size={20} />
                </button>
              </form>
              {soundPickerOpen && createPortal(
                <div className="sound-picker" style={soundPickerStyle} ref={soundPickerRef} role="dialog" aria-label="Choose a sound effect">
                  <div className="sound-picker-head">
                    <div>
                      <strong>Add sound effect</strong>
                      <span>Plays for everyone · 2–3 seconds</span>
                    </div>
                    <button type="button" aria-label="Close sound picker" data-tooltip="Close" onClick={() => setSoundPickerOpen(false)}><X size={16} /></button>
                  </div>
                  <div className="sound-picker-tabs" role="tablist" aria-label="Sound effect category">
                    {[["creatures", "Creatures"], ["emotes", "Emotes"]].map(([tab, label]) => (
                      <button
                        key={tab}
                        type="button"
                        role="tab"
                        aria-selected={soundPickerTab === tab}
                        onClick={() => {
                          setSoundPickerTab(tab);
                          setSoundQuery("");
                        }}
                      >{label}</button>
                    ))}
                  </div>
                  <input
                    className="sound-picker-search"
                    value={soundQuery}
                    onChange={(event) => setSoundQuery(event.target.value)}
                    placeholder={soundPickerTab === "creatures" ? "Search creatures" : "Search emotes"}
                    aria-label={soundPickerTab === "creatures" ? "Search creatures" : "Search emotes"}
                    autoFocus
                  />
                  <div className="sound-picker-list">
                    {soundResults.length ? soundResults.map((sound) => (
                      <div className="sound-picker-item" key={sound.id}>
                        <button type="button" className="sound-picker-select" onClick={() => {
                          setSelectedSoundId(sound.id);
                          setSoundPickerOpen(false);
                          setChatError("");
                        }}>
                          {sound.category === "creatures" ? <Cat size={16} /> : <Laugh size={16} />}
                          <span><strong>{sound.label}</strong></span>
                        </button>
                        <button
                          type="button"
                          className={previewingSoundId === sound.id ? "sound-preview playing" : "sound-preview"}
                          aria-label={`Preview ${sound.label}`}
                          data-tooltip="Preview"
                          data-tooltip-pos="right-top"
                          onClick={() => previewSound(sound.id)}
                        ><Play size={16} /></button>
                      </div>
                    )) : (
                      <p className="sound-picker-empty">
                        No vetted {soundPickerTab === "creatures" ? "creature" : "emote"} matches that search yet.
                      </p>
                    )}
                  </div>
                </div>
              , document.body)}
            </div>
          )}
        </>
      )}
      </div>
      </aside>
      {cardPreview?.image && (
        <div className="card-preview-backdrop" onMouseDown={() => setCardPreview(null)}>
          <div
            className="card-preview-tile"
            role="dialog"
            aria-modal="true"
            aria-label={`Expanded ${cardPreview.name}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <img src={cardPreview.image} alt={cardPreview.name} />
          </div>
        </div>
      )}
    </>
  );
}

function DicePanel({ onRoll, counterDraft, onGenerateVideoCounter, counterColor, onStartVideoCounterDrag }) {
  const [selectedSides, setSelectedSides] = useState(20);
  const diceOptions = Array.from({ length: 18 }, (_, index) => index + 3);
  return (
    <div className="dice-panel">
      <div className="dice-controls">
        <label className="dice-select-field">
          <span className="color-label">Die</span>
          <select
            className="dice-select"
            aria-label="Choose a die to roll"
            value={selectedSides}
            onChange={(event) => setSelectedSides(Number(event.target.value))}
          >
            <option value={2}>Coin</option>
            {diceOptions.map((sides) => <option key={sides} value={sides}>D{sides}</option>)}
          </select>
        </label>
        <button type="button" className="dice-roll-button" onClick={() => onRoll?.(selectedSides)}>
          {selectedSides === 2 ? "Flip coin" : "Roll dice"}
        </button>
      </div>
      <CounterGenerator
        counterDraft={counterDraft}
        onGenerate={onGenerateVideoCounter}
        counterColor={counterColor}
        onStartVideoCounterDrag={onStartVideoCounterDrag}
      />
    </div>
  );
}

function CounterGenerator({ counterDraft, onGenerate, counterColor, onStartVideoCounterDrag }) {
  const [selectedType, setSelectedType] = useState(VIDEO_COUNTER_TYPES[0].id);
  const draftType = getVideoCounterType(counterDraft?.type);
  return (
    <section className="counter-generator">
      <span className="color-label">Generate counter</span>
      <div className="counter-generator-preview">
        {draftType ? (
          <div
            className="counter-sticker counter-sticker-source"
            style={{ background: counterColor, color: getCounterTextColor(counterColor) }}
            onPointerDown={(event) => {
              event.preventDefault();
              onStartVideoCounterDrag?.({
                id: counterDraft.id,
                type: counterDraft.type,
                source: "generator",
              });
            }}
            aria-label={`Drag ${draftType.label} counter onto your video`}
          >
            <span>{draftType.label}</span>
          </div>
        ) : (
          <span>Generate a counter, then drag it onto your video.</span>
        )}
      </div>
      <div className="counter-generator-controls">
        <CounterTypePicker
          value={selectedType}
          onChange={setSelectedType}
        />
        <button type="button" className="dice-roll-button" onClick={() => onGenerate?.(selectedType)}>
          Generate counter
        </button>
      </div>
    </section>
  );
}

function CounterTypePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const pickerRef = useRef(null);
  const selected = getVideoCounterType(value) || VIDEO_COUNTER_TYPES[0];
  const matches = VIDEO_COUNTER_TYPES.filter((counter) => (
    counter.label.toLowerCase().includes(query.trim().toLowerCase())
  ));

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.key === "Escape") setOpen(false);
      if (event.type === "pointerdown" && !pickerRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
    };
  }, [open]);

  return (
    <div className="counter-type-picker" ref={pickerRef}>
      <button
        type="button"
        className="counter-type-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Choose a counter to generate"
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        <span>{selected.label}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="counter-type-menu" role="listbox" aria-label="Choose a counter to generate">
          <label className="counter-type-search">
            <Search size={16} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search counters"
              aria-label="Search counters"
              autoFocus
            />
          </label>
          <div className="counter-type-options">
            {matches.length ? matches.map((counter) => (
              <button
                key={counter.id}
                type="button"
                role="option"
                aria-selected={counter.id === selected.id}
                onClick={() => {
                  onChange(counter.id);
                  setQuery("");
                  setOpen(false);
                }}
              >{counter.label}</button>
            )) : <p>No counters match that search.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export function formatDiceSides(sides) {
  return Number(sides) === 2 ? "Coin" : `d${Number(sides) || 20}`;
}

export function formatDiceResult(value, sides) {
  if (Number(sides) === 2) return Number(value) === 1 ? "Heads" : "Tails";
  return String(value ?? "—");
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
      {editable && <button type="button" onClick={onDecrease} aria-label={`Decrease ${label}`} data-tooltip={`Decrease ${label}`}>−</button>}
      <strong>{value}</strong>
      {editable && <button type="button" onClick={onIncrease} aria-label={`Increase ${label}`} data-tooltip={`Increase ${label}`}>+</button>}
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
