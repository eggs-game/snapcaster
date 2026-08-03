import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Cat, Check, ChessQueen, ChevronDown, ChevronLeft, ChevronRight, Copy, Dices, Drum, ExternalLink, Hourglass, Laugh, MessageCircle, MessagesSquare, Mic, MicOff,
  LogOut, PanelLeft, Play, RefreshCw, Search, Settings, Shuffle, Sparkles, Square, Swords, ThumbsDown, UserMinus, UserPlus, UsersRound, Video, VideoOff, X,
} from "lucide-react";
import { fetchCardByName, suggestCardNames } from "./cardSearch.js";
import {
  parseChatDraft, selectWhisperRecipient, whisperCommandMatches, whisperRecipientMatches,
} from "./chatCommands.js";
import { getSoundEffect, searchSoundEffects } from "./soundEffects.js";
import { getCounterTextColor, getVideoCounterType, VIDEO_COUNTER_TYPES } from "./videoCounters.js";
import { OUTGOING_VIDEO_QUALITY_OPTIONS } from "./videoQuality.js";
import AppDropdown from "./AppDropdown.jsx";
import { useConfirmDialog } from "./ConfirmDialog.jsx";

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

function CardStackIcon({ size = 20, className }) {
  return (
    <svg
      className={className}
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
      <path d="m15.1 2.8 6.1 2.6-4.1 12.1-2.7-1.1" />
      <rect x="3.5" y="2.5" width="11" height="16" rx="1.5" />
      <path d="M6.3 7.5h5.4M6.3 11h5.4" />
    </svg>
  );
}

function CardPlaceholder({ identifying = false, failed = false, onFix }) {
  return (
    <div
      className={`card-empty-state${failed ? " failed" : ""}`}
      role={identifying || failed ? "status" : undefined}
      aria-live={identifying || failed ? "polite" : undefined}
    >
      <div className="card-empty-illustration" aria-hidden="true">
        <div className="card-empty-art">
          {failed ? <Search size={28} /> : <Sparkles size={28} />}
        </div>
      </div>
      <p>
        {identifying
          ? "Identifying…"
          : failed ? "Image lookup failed" : "Cards you click on or look up will be displayed here."}
      </p>
      {failed && onFix && (
        <button type="button" className="card-empty-fix" onClick={onFix}>
          Help me fix it
        </button>
      )}
    </div>
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
  chatParticipants,
  chatNameColors = {},
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
  chatNotificationsEnabled,
  onChatNotificationsChange,
  turnNotificationsEnabled,
  onTurnNotificationsChange,
  gameClockVisible = true,
  onGameClockVisibilityChange,
  videoLayout,
  onVideoLayoutChange,
  outgoingVideoQuality,
  onOutgoingVideoQualityChange,
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
  onLeave,
  isCreator = false,
  managementParticipants = [],
  managementStatus = "lobby",
  gameStartedAt = "",
  managementFriends = [],
  onStartGame,
  onShufflePositions,
  onStartReadyCheck,
  isReadyCheckActive = false,
  onManageMember,
  onEndGame,
  onRestartGame,
  onInviteFriend,
  onCancelInvitation,
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
  const [soundPickerTab, setSoundPickerTab] = useState("emotes");
  const [soundQuery, setSoundQuery] = useState("");
  const [soundPickerStyle, setSoundPickerStyle] = useState({});
  const [now, setNow] = useState(Date.now());
  const [previewingSoundId, setPreviewingSoundId] = useState("");
  const [wrongReport, setWrongReport] = useState(null);
  const [truthQuery, setTruthQuery] = useState("");
  const [truthSuggestions, setTruthSuggestions] = useState([]);
  const [truthHighlight, setTruthHighlight] = useState(-1);
  const safeChatParticipants = Array.isArray(chatParticipants) ? chatParticipants : [];
  const [labelingWrongReport, setLabelingWrongReport] = useState(false);
  const [cardPreview, setCardPreview] = useState(null);
  const soundPickerTriggerRef = useRef(null);
  const soundPickerRef = useRef(null);
  const previewStopRef = useRef(null);
  const chatMessagesRef = useRef(null);
  const lastChatMessageIdRef = useRef(chatMessages?.[chatMessages.length - 1]?.id || "");
  // One-shot open slide; cleared after the panel settles into place.
  const [entering, setEntering] = useState(true);
  const settings = view === "settings";
  const counters = view === "counters";
  const invite = view === "invite";
  const dice = view === "dice";
  const management = view === "management";
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
  const gameClockRunning = managementStatus === "live" && Boolean(gameStartedAt) && gameClockVisible;
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

  const scrollChatToLatest = () => {
    const messages = chatMessagesRef.current;
    if (messages) messages.scrollTop = messages.scrollHeight;
  };

  useEffect(() => {
    if (lookupTab !== "chat") return undefined;
    const frame = requestAnimationFrame(scrollChatToLatest);
    return () => cancelAnimationFrame(frame);
  }, [lookupTab]);

  // A video-card click opens the outer lookup view before recognition starts.
  // Follow that loading state into the Cards tab so the panel cannot remain
  // visibly parked on Chat while the requested card is being identified.
  useEffect(() => {
    if (view === "lookup" && current?.loading) setLookupTab("cards");
  }, [current?.loading, view]);

  // Keep a message the local player just sent in view without pulling someone
  // reading older room activity away from their place for incoming messages.
  useEffect(() => {
    if (lookupTab !== "chat") return undefined;
    const latest = chatMessages?.[chatMessages.length - 1];
    if (!latest || latest.from !== currentUserId || latest.kind) return undefined;
    const frame = requestAnimationFrame(scrollChatToLatest);
    return () => cancelAnimationFrame(frame);
  }, [chatMessages, currentUserId, lookupTab]);

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
    // A selected public sound is a complete chat action on its own. Only
    // parse the text when there is text to interpret (especially /whisper).
    const parsed = selectedSound && !chatDraft.trim()
      ? { kind: "public", text: "" }
      : parseChatDraft(chatDraft, safeChatRecipients, chatWhisperTargetId);
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
    if (!soundIsCoolingDown && !gameClockRunning) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [gameClockRunning, soundIsCoolingDown]);

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
      const result = await fetchCardByName(cardName);
      if (!result) throw new Error("Card not found");
      const card = cardFromScryfall(result);
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
    if (!wrongReport || !cardName || labelingWrongReport) return;
    setLabelingWrongReport(true);
    try {
      const result = await fetchCardByName(cardName);
      if (!result) throw new Error("Card not found");
      const card = cardFromScryfall(result);
      const truth = { ...card, recordedName: card.name };
      const saved = await onUpdateRecognitionReport?.(wrongReport.id, truth);
      if (saved === false) throw new Error("Could not save the label to Supabase");
      setWrongReport(null);
      setTruthQuery("");
      setTruthSuggestions([]);
    } catch (error) {
      setTruthSuggestions([]);
      setTruthQuery(String(error.message || error));
    } finally {
      setLabelingWrongReport(false);
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
  const decisive = !!top && ["ocr-title", "art-match", "search", "visual-exact"].includes(top.identified_by);
  const identifying = Boolean(current?.loading || searching);
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
      aria-label={isVisitor ? `Game name: ${lobbyName}` : `Rename ${lobbyName || "game"}`}
      data-tooltip={isVisitor ? lobbyName : "Rename game"}
      data-tooltip-pos="left-bottom"
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
        management ? "management-view" : "",
        collapsed ? "collapsed" : "",
        !settings && !management && lookupTab === "chat" ? "chat-view" : "",
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
          className="drawer-toggle panel-toggle"
          onClick={() => {
            if (collapsed) onOpen?.();
            else onClose?.();
          }}
          aria-label={collapsed ? "Open panel" : "Close panel"}
          data-tooltip={collapsed ? "Open panel" : "Close panel"}
          data-tooltip-pos="right"
        >
          {collapsed ? <>
            <PanelLeft className="collapsed-panel-icon" size={20} />
            <ChevronRight className="collapsed-panel-arrow" size={20} />
          </> : <>
            <PanelLeft className="expanded-panel-icon" size={20} />
            <ChevronLeft className="expanded-panel-arrow" size={20} />
          </>}
        </button>
        <button
          type="button"
          className={!settings && !counters && !invite && !dice && !management && lookupTab === "cards" ? "drawer-toggle active" : "drawer-toggle"}
          onClick={() => {
            if (collapsed) onOpen?.();
            onViewChange("lookup");
            setLookupTab("cards");
          }}
          aria-label="Open card lookup"
          data-tooltip="Card lookup"
          data-tooltip-pos="right"
        >
          <CardStackIcon />
        </button>
        <button
          type="button"
          className={!settings && !counters && !invite && !dice && !management && lookupTab === "chat" ? "drawer-toggle sidebar-chat-toggle active" : "drawer-toggle sidebar-chat-toggle"}
          onClick={() => {
            if (collapsed) onOpen?.();
            onViewChange("lookup");
            setLookupTab("chat");
            setHasUnreadChat(false);
            requestAnimationFrame(scrollChatToLatest);
          }}
          aria-label={hasUnreadChat ? "Open chat, new messages" : "Open chat"}
          data-tooltip="Chat"
          data-tooltip-pos="right"
        >
          <MessagesSquare size={20} />
          {hasUnreadChat && <span className="chat-unread-dot" aria-hidden="true" />}
        </button>
        <button
          className={counters ? "drawer-toggle active" : "drawer-toggle"}
          onClick={() => {
            if (collapsed) onOpen?.();
            onViewChange("counters");
          }}
          aria-label="Open Commander damage"
          data-tooltip="Commander damage"
          data-tooltip-pos="right"
        >
          <Swords size={20} />
        </button>
        {!isVisitor && (
          <button
            className={dice ? "drawer-toggle active" : "drawer-toggle"}
            onClick={() => {
              if (collapsed) onOpen?.();
              onViewChange("dice");
            }}
            aria-label="Open dice roller"
            data-tooltip="Dice roller"
            data-tooltip-pos="right"
          >
            <Dices size={20} />
          </button>
        )}
        <span className="sidebar-rail-divider" aria-hidden="true" />
        {!isVisitor && (
          <button
            className={invite ? "drawer-toggle active" : "drawer-toggle"}
            onClick={() => {
              if (collapsed) onOpen?.();
              onViewChange("invite");
            }}
            aria-label="Invite players"
            data-tooltip="Invite players"
            data-tooltip-pos="right"
          >
            <UserPlus size={20} />
          </button>
        )}
        <button
          className={settings ? "drawer-toggle active" : "drawer-toggle"}
          onClick={() => {
            if (collapsed) onOpen?.();
            onViewChange("settings");
          }}
          aria-label="Open settings"
          data-tooltip="Open settings"
          data-tooltip-pos="right"
        >
          <Settings size={20} />
        </button>
        {isCreator && (
          <>
            <span className="sidebar-rail-divider management-divider" aria-hidden="true" />
            <button
              className={management ? "drawer-toggle active" : "drawer-toggle"}
              onClick={() => {
                if (collapsed) onOpen?.();
                onViewChange("management");
              }}
              aria-label="Open game management"
              data-tooltip="Game management"
              data-tooltip-pos="right"
            >
              <ChessQueen size={20} />
            </button>
          </>
        )}
        {gameClockRunning && (
          <div
            className="rail-game-clock"
            role="timer"
            aria-label={`Game time ${formatElapsedGameTime(gameStartedAt, now)}`}
            data-tooltip={`Game time · ${formatElapsedGameTime(gameStartedAt, now)}`}
            data-tooltip-pos="right-top"
          >
            <time>{formatRailGameTime(gameStartedAt, now)}</time>
          </div>
        )}
      </nav>

      <div className="sidebar-content" aria-hidden={collapsed}>
      <div className="sidebar-head">
        {(settings || counters || invite || dice || management) && (
          <span className="logo">{settings ? "Settings" : counters ? "Commander damage" : invite ? "Invite" : dice ? "Dice & counters" : "Game management"}</span>
        )}
        {!settings && !counters && !invite && !dice && !management && (lookupTab === "chat" ? (
          <>
            <span className="logo">Chat</span>
            <div className="chat-presence">
              <button
                type="button"
                className="chat-presence-trigger"
                aria-label={`${safeChatParticipants.length} ${safeChatParticipants.length === 1 ? "person" : "people"} in chat`}
                aria-describedby="chat-presence-list"
              >
                <UsersRound size={16} aria-hidden="true" />
                <span>{safeChatParticipants.length}</span>
              </button>
              <div className="chat-presence-popover" id="chat-presence-list" role="tooltip">
                <strong>In chat</strong>
                <ul>
                  {safeChatParticipants.map((participant) => (
                    <li key={participant.id}>
                      <span>{participant.name || (participant.role === "visitor" ? "Visitor" : "Player")}</span>
                      <small>
                        {participant.id === currentUserId
                          ? "You"
                          : participant.role === "visitor" ? "Visitor" : "Player"}
                      </small>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        ) : gameNameControl)}
      </div>

      {management ? (
        <GameManagementPanel
          participants={managementParticipants}
          currentUserId={currentUserId}
          status={managementStatus}
          onStart={onStartGame}
          onShufflePositions={onShufflePositions}
          onStartReadyCheck={onStartReadyCheck}
          isReadyCheckActive={isReadyCheckActive}
          onManageMember={onManageMember}
          onEnd={onEndGame}
          onRestart={onRestartGame}
        />
      ) : settings ? (
        <div className="sidebar-settings">
          <fieldset className="theme-field settings-major-section settings-general">
            <legend className="settings-section-title">General</legend>
            <div className="settings-general-stack">
              <div className="settings-inline-select">
                <span>Game view</span>
                <AppDropdown
                  label="Game view"
                  value={videoLayout}
                  onChange={onVideoLayoutChange}
                  variant="text"
                  options={[
                    { value: "tiles", label: "Tile" },
                    { value: "follow", label: "Active" },
                    { value: "hero", label: "Hero" },
                  ]}
                />
              </div>
              <div className="settings-choice-stack">
                <SettingsSwitch
                  label="Game clock"
                  checked={gameClockVisible}
                  onChange={onGameClockVisibilityChange}
                />
                <SettingsSwitch
                  label="Chat notifications"
                  checked={chatNotificationsEnabled}
                  onChange={onChatNotificationsChange}
                />
                <SettingsSwitch
                  label="Turn notifications"
                  checked={turnNotificationsEnabled}
                  onChange={onTurnNotificationsChange}
                />
              </div>
            </div>
          </fieldset>
          <fieldset className="theme-field settings-major-section">
            <legend className="settings-section-title">Display</legend>
            <div className="settings-display-stack">
              <div className="settings-preference-field">
                <SettingsChoiceGroup
                  label="Appearance"
                  value={themePreference}
                  onChange={onThemePreferenceChange}
                  options={[
                    { value: "light", label: "Light" },
                    { value: "dark", label: "Dark" },
                    { value: "system", label: "System" },
                  ]}
                />
              </div>
              {!isVisitor && (
                <div className="color-picker">
                  <div className="color-swatches">
                    {tileColors.map((color, index) => (
                      <button
                        key={color}
                        type="button"
                        className={myColor === color ? "color-swatch selected" : "color-swatch"}
                        style={{ background: color }}
                        aria-label={`Choose color ${color}`}
                        data-tooltip="Choose tile color"
                        data-tooltip-pos={index < Math.ceil(tileColors.length / 2) ? "left-top" : "right-top"}
                        onClick={() => onChooseColor(color)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </fieldset>
          {isVisitor && (
            <p className="visitor-note">
              You joined as a visitor. You can listen, speak, and look up cards.
            </p>
          )}
          {!isVisitor && (
            <section className="settings-major-section">
              <h3 className="drawer-section settings-section-title">Video</h3>
              <button
                className={camOn ? "control-row" : "control-row off"}
                onClick={onToggleCam}
              >
                {camOn ? <Video size={18} /> : <VideoOff size={18} />}
                <span>{camOn ? "Camera on" : "Camera off"}</span>
              </button>
              <div className="device-field device-field-tight">
                <AppDropdown
                  label="Camera"
                  value={videoDeviceId}
                  onChange={onChooseCamera}
                  disabled={!cameras.length}
                  emptyLabel="No cameras found"
                  options={cameras.map((device, index) => ({
                    value: device.deviceId,
                    label: device.label || `Camera ${index + 1}`,
                  }))}
                />
              </div>
              <div className="theme-field theme-field-tight">
                <SettingsChoiceGroup
                  label="Outgoing video quality"
                  value={outgoingVideoQuality}
                  onChange={onOutgoingVideoQualityChange}
                  options={OUTGOING_VIDEO_QUALITY_OPTIONS}
                />
                <p className="setting-help">
                  Caps the video sent to everyone. Lower quality uses less upload and processing.
                </p>
              </div>
            </section>
          )}

          <section className="settings-major-section">
            <h3 className="drawer-section settings-section-title">Microphone</h3>
            <button
              className={micOn ? "control-row" : "control-row off"}
              onClick={onToggleMic}
            >
              {micOn ? <Mic size={18} /> : <MicOff size={18} />}
              <span>{micOn ? "Mic on" : "Mic muted"}</span>
            </button>
            <div className="device-field">
              <AppDropdown
                label="Microphone"
                value={audioDeviceId}
                onChange={onChooseMic}
                disabled={!mics.length}
                emptyLabel="No microphones found"
                placement="top"
                options={mics.map((device, index) => ({
                  value: device.deviceId,
                  label: device.label || `Microphone ${index + 1}`,
                }))}
              />
            </div>
            {deviceError && <p className="device-error">{deviceError}</p>}
          </section>

          <button type="button" className="leave-game-button" onClick={onLeave}>
            <LogOut size={16} />
            <span>Leave game</span>
          </button>
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
          showFriends={isCreator}
          friends={managementFriends}
          onInviteFriend={onInviteFriend}
          onCancelInvitation={onCancelInvitation}
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

            {!identifying && !current && !recentCards.length && <CardPlaceholder />}
            {identifying && <CardPlaceholder identifying />}
            {!identifying && current?.error && <div className="lookup-status error">{current.error}</div>}
            {!identifying && current?.matches?.length === 0 && (
              <CardPlaceholder failed onFix={current.captureImage ? beginWrongCardReport : undefined} />
            )}
            {!identifying && top && decisive && (
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
                    {!isVisitor && (
                      <button
                        type="button"
                        className="card-share-btn"
                        onClick={() => onShareCard?.(top)}
                        aria-label={`Share ${top.name} to chat`}
                        data-tooltip="Share to chat"
                        data-tooltip-pos="right-top"
                      >
                        <MessagesSquare size={16} />
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
              </div>
            )}
            {!identifying && best && !decisive && (
              <CardPlaceholder failed onFix={current.captureImage ? beginWrongCardReport : undefined} />
            )}
            {wrongReport && (
              <section className="wrong-card-report" aria-label="Wrong card report">
                <div className="wrong-card-report-head">
                  <strong>Wrong card report</strong>
                </div>
                <div className="wrong-card-evidence">
                  {wrongReport.captureImage && <img src={wrongReport.captureImage} alt="Clicked card capture" title="Clicked card capture" />}
                  {wrongReport.predictedImage && <img src={wrongReport.predictedImage} alt="Predicted card" title={`Predicted: ${wrongReport.predictedCard?.name || "Unknown"}`} />}
                  {wrongReport.truth?.image && <img src={wrongReport.truth.image} alt="Recorded true card" title={`True card: ${wrongReport.truth.name}`} />}
                </div>
                {!wrongReport.truth && wrongReport.syncStatus !== "saving" && (
                  <div className="truth-card-field">
                    <Search size={16} className="truth-card-search-icon" aria-hidden="true" />
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
                      placeholder="Search for the correct card"
                      aria-label="Search for the correct card"
                      autoComplete="off"
                    />
                    {truthSuggestions.length > 0 && (
                      <ul className="truth-card-suggest">
                        {truthSuggestions.map((name, index) => (
                          <li
                            key={name}
                            className={index === truthHighlight ? "active" : ""}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              setTruthQuery(name);
                              setTruthSuggestions([]);
                              setTruthHighlight(-1);
                            }}
                          >{name}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                <div className="wrong-card-report-actions">
                  <button
                    className="wrong-card-report-submit"
                    type="button"
                    onClick={() => labelWrongCard(truthHighlight >= 0 ? truthSuggestions[truthHighlight] : truthQuery)}
                    disabled={!truthQuery.trim() || wrongReport.syncStatus === "saving" || labelingWrongReport}
                  >
                    {labelingWrongReport ? "Submitting…" : "Submit report"}
                  </button>
                </div>
              </section>
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
                          data-tooltip-pos="right-top"
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
                {current.scanTiming && (
                  <span>
                    Timing: {current.scanTiming.totalMs}ms total
                    {` · ${current.scanTiming.captureMs}ms capture`}
                    {` · ${current.scanTiming.recognitionMs}ms recognition`}
                    {current.scanTiming.hintHit ? " · recent-card fast path" : ""}
                    {current.scanTiming.isolationCandidates
                      ? ` · ${current.scanTiming.isolationCandidates} isolation proposals`
                      : ""}
                  </span>
                )}
                {current.scanTiming?.stages && Object.keys(current.scanTiming.stages).length > 0 && (
                  <span>
                    Stages: {Object.entries(current.scanTiming.stages)
                      .map(([name, ms]) => `${name} ${ms}ms`).join(" · ")}
                  </span>
                )}
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
              <div className="chat-messages" ref={chatMessagesRef} aria-live="polite">
                {chatMessages?.length ? chatMessages.map((message) => {
                  const isMine = message.from === currentUserId;
                  const senderName = message.name || "Player";
                  const senderColorIndex = [...String(message.from || senderName)].reduce((total, character) => total + character.charCodeAt(0), 0) % tileColors.length;
                  const sender = safeChatRecipients.find((recipient) => recipient.id === message.from);
                  const senderIsVisitor = sender?.role === "visitor" || message.role === "visitor";
                  const senderColor = senderIsVisitor ? "var(--text-secondary)" : (chatNameColors[message.from] || tileColors[senderColorIndex]);
                  const timestamp = new Date(message.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
                  const headerName = message.whisper
                    ? (isMine ? `Whisper to @${message.toName}` : `Whisper from @${senderName}`)
                    : senderName;
                  return (
                    <div className={`chat-message-row${isMine ? " mine" : ""}`} key={message.id}>
                      <div className={`chat-message-wrap${isMine ? " mine" : ""}`}>
                        {!message.system && <div className="chat-message-header">
                          {sender?.profileId ? (
                            <a
                              href={`/profile?id=${encodeURIComponent(sender.profileId)}`}
                              style={{ color: message.whisper ? "var(--whisper-text)" : senderColor }}
                            >
                              {headerName}
                            </a>
                          ) : (
                            <strong style={{ color: message.whisper ? "var(--whisper-text)" : senderColor }}>{headerName}</strong>
                          )}
                          <span className="chat-message-timestamp">{timestamp}</span>
                        </div>}
                        <div className={`chat-message${isMine ? " mine" : ""}${message.whisper ? " whisper" : ""}${message.kind ? ` object ${message.kind}` : ""}${message.soundId ? " sound" : ""}${message.system ? " system" : ""}`}>
                      {message.kind === "dice" ? (
                        <div className="chat-dice-object">
                          <strong>Rolled {message.value}</strong>
                          <Dices size={16} aria-hidden="true" />
                          <span className="chat-dice-sides">d{message.sides}</span>
                        </div>
                      ) : message.kind === "card" ? (
                        <button type="button" className="chat-card-object" onClick={() => message.card && openCard(message.card)}>
                          {message.card?.image && <img src={message.card.image} alt="" />}
                          <span>
                            <strong>{message.card?.name || "Shared card"}</strong>
                          </span>
                          <ChevronRight size={16} aria-hidden="true" />
                        </button>
                      ) : message.kind === "life" || message.kind === "commander-damage" ? (
                        <div className={`chat-life-object ${message.delta >= 0 ? "gained" : "lost"}${message.kind === "commander-damage" ? " commander-damage" : ""}`}>
                          {message.kind === "commander-damage" ? <>
                            <div className="chat-commander-damage-copy">
                              <strong>{Math.abs(message.delta)} Commander damage</strong>
                              <span>{message.commanderName || "Commander"}</span>
                            </div>
                            <div className="chat-commander-damage-totals">
                              <span>{message.previous} → {message.life}</span>
                              <span>{message.previousCommanderDamage ?? 0} → {message.commanderDamage ?? Math.abs(message.delta)}</span>
                            </div>
                          </> : <>
                            <strong>{message.delta >= 0 ? `Gained +${message.delta} life` : `Lost -${Math.abs(message.delta)} life`}</strong>
                            <span>{message.previous} → {message.life}</span>
                          </>}
                        </div>
                      ) : message.kind === "ready" ? (
                        <div className={`chat-ready-object ${message.outcome}`}>
                          {message.outcome === "ready" && <Check className="chat-ready-icon ready" size={16} aria-hidden="true" />}
                          {message.outcome === "not-ready" && <X className="chat-ready-icon not-ready" size={16} aria-hidden="true" />}
                          {message.outcome === "timeout" && <Hourglass className="chat-ready-icon timeout" size={16} aria-hidden="true" />}
                          <strong>{message.outcome === "ready" ? "Everyone is ready" : message.outcome === "not-ready" ? "Not ready" : "Ready check timed out"}</strong>
                        </div>
                      ) : (
                        <>
                          {message.soundId && <div className="chat-sound-message">
                            <span><Drum size={16} /> {getSoundEffect(message.soundId)?.label || "Sound effect"}</span>
                            <button
                              type="button"
                              className={previewingSoundId === message.soundId ? "chat-sound-play playing" : "chat-sound-play"}
                              onClick={() => previewSound(message.soundId)}
                              aria-label={`Play ${getSoundEffect(message.soundId)?.label || "sound effect"} locally`}
                              data-tooltip="Play"
                              data-tooltip-pos="right-top"
                            >
                              <Play size={16} aria-hidden="true" />
                            </button>
                          </div>}
                          {message.text && <p>{message.text}</p>}
                        </>
                      )}
                        </div>
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
                        data-tooltip-pos="right-top"
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
                    <button type="button" aria-label="Close sound picker" data-tooltip="Close" data-tooltip-pos="right-bottom" onClick={() => setSoundPickerOpen(false)}><X size={16} /></button>
                  </div>
                  <div className="sound-picker-tabs" role="tablist" aria-label="Sound effect category">
                    {[["emotes", "Emotes"], ["creatures", "Creatures"]].map(([tab, label]) => (
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
                    {soundResults.length ? soundResults.map((sound, index) => (
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
                          data-tooltip-pos={index < 2 ? "right-bottom" : "right-top"}
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

export function formatElapsedGameTime(startedAt, now = Date.now()) {
  const startedAtMs = new Date(startedAt).getTime();
  const elapsedSeconds = Number.isFinite(startedAtMs)
    ? Math.max(0, Math.floor((now - startedAtMs) / 1000))
    : 0;
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatRailGameTime(startedAt, now = Date.now()) {
  const startedAtMs = new Date(startedAt).getTime();
  const elapsedSeconds = Number.isFinite(startedAtMs)
    ? Math.max(0, Math.floor((now - startedAtMs) / 1000))
    : 0;
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}`
    : `${minutes}:${String(elapsedSeconds % 60).padStart(2, "0")}`;
}

function SettingsChoiceGroup({ label, value, options, onChange }) {
  return (
    <div
      className="settings-choice-group"
      role="group"
      aria-label={label}
      style={{ "--settings-choice-count": options.length }}
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange?.(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function SettingsSwitch({ label, checked, onChange }) {
  return (
    <div className="settings-switch-row">
      <span>{label}</span>
      <button
        className="settings-switch"
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        onClick={() => onChange?.(!checked)}
      >
        <i className="settings-switch-track" aria-hidden="true"><i /></i>
      </button>
    </div>
  );
}

function DicePanel({ onRoll, counterDraft, onGenerateVideoCounter, counterColor, onStartVideoCounterDrag }) {
  const [selectedSides, setSelectedSides] = useState(20);
  const diceOptions = Array.from({ length: 18 }, (_, index) => index + 3);
  return (
    <div className="dice-panel">
      <div className="dice-controls">
        <div className="dice-select-field">
          <span className="color-label">Die</span>
          <AppDropdown
            label="Choose a die to roll"
            value={selectedSides}
            onChange={(nextValue) => setSelectedSides(Number(nextValue))}
            options={[
              { value: 2, label: "Coin" },
              ...diceOptions.map((sides) => ({ value: sides, label: `D${sides}` })),
            ]}
          />
        </div>
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

function GameManagementPanel({
  participants,
  currentUserId,
  status,
  onStart,
  onShufflePositions,
  onStartReadyCheck,
  isReadyCheckActive,
  onManageMember,
  onEnd,
  onRestart,
}) {
  const confirmAction = useConfirmDialog();
  const safeParticipants = Array.isArray(participants) ? participants : [];
  const players = safeParticipants.filter((participant) => participant.role !== "visitor");
  const eligiblePlayers = players.filter((participant) => participant.membershipId && !participant.eliminated);
  const winnerOptions = eligiblePlayers.length
    ? eligiblePlayers
    : players.filter((participant) => participant.membershipId);
  const winnerMembershipIds = winnerOptions.map((player) => player.membershipId).join("|");
  const [mode, setMode] = useState("manage");
  const [resultKind, setResultKind] = useState("winner");
  const [winnerId, setWinnerId] = useState(winnerOptions[0]?.membershipId || "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!winnerOptions.some((player) => player.membershipId === winnerId)) {
      setWinnerId(winnerOptions[0]?.membershipId || "");
    }
  }, [winnerId, winnerMembershipIds]);

  const run = async (label, action) => {
    setError("");
    setBusy(label);
    try {
      await action?.();
    } catch (actionError) {
      setError(String(actionError?.message || "That action could not be completed."));
    } finally {
      setBusy("");
    }
  };

  const manageParticipant = async (participant, action) => {
    const verb = action === "remove" ? "Remove" : action === "mute" ? "Mute" : "Unmute";
    if (!(await confirmAction({
      title: `${verb} ${participant.name || "this participant"}?`,
      description: action === "remove"
        ? "They will be removed from this game."
        : `Their audio will be ${action === "mute" ? "muted" : "unmuted"} for everyone in the room.`,
      confirmLabel: `${verb} ${participant.role === "visitor" ? "visitor" : "player"}`,
      tone: action === "remove" ? "danger" : "primary",
    }))) return;
    run(`${action}-${participant.id}`, () => onManageMember?.(participant, action));
  };

  if (mode === "end") {
    return (
      <div className="game-management-panel">
        <button className="game-management-back" type="button" onClick={() => setMode("manage")}>Back to game controls</button>
        <div className="game-management-end-panel">
          <div className="game-management-field">
            <span>Result</span>
            <AppDropdown
              label="Result"
              value={resultKind}
              onChange={setResultKind}
              options={[
                { value: "winner", label: "Choose a winner" },
                { value: "draw", label: "Draw" },
                { value: "unresolved", label: "End unresolved" },
              ]}
            />
          </div>
          {resultKind === "winner" && (
            <div className="game-management-field">
              <span>Winner</span>
              <AppDropdown
                label="Winner"
                value={winnerId}
                onChange={setWinnerId}
                options={winnerOptions.map((player) => ({
                  value: player.membershipId,
                  label: player.name || "Player",
                }))}
              />
            </div>
          )}
          <p className="game-management-note">Players get a 24-hour correction window before a submitted result becomes final.</p>
          {error && <p className="modal-error" role="alert">{error}</p>}
          <button
            className="game-management-primary"
            type="button"
            disabled={Boolean(busy) || (resultKind === "winner" && !winnerId)}
            onClick={() => run("end", async () => {
              await onEnd?.({ resultKind, winnerMembershipId: winnerId });
              setMode("manage");
            })}
          >
            <Square size={16} /> {busy === "end" ? "Ending…" : "Confirm end game"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="game-management-panel">
      <div className="game-management-primary-actions">
        {status === "lobby" && (
          <>
            <button className="game-management-primary" type="button" disabled={Boolean(busy)} onClick={() => run("start", onStart)}>
              <Play size={16} /> {busy === "start" ? "Starting…" : "Start game"}
            </button>
            <button type="button" disabled={Boolean(busy)} onClick={() => run("shuffle", onShufflePositions)}>
              <Shuffle size={16} /> {busy === "shuffle" ? "Shuffling…" : "Shuffle positions"}
            </button>
            <button
              type="button"
              disabled={Boolean(busy) || isReadyCheckActive}
              onClick={() => run("ready", onStartReadyCheck)}
            >
              <Check size={16} /> {isReadyCheckActive ? "Ready check active" : busy === "ready" ? "Starting…" : "Ready check"}
            </button>
          </>
        )}
        {status === "live" && (
          <button type="button" disabled={Boolean(busy)} onClick={() => setMode("end")}>
            <Square size={16} /> End game
          </button>
        )}
        <button type="button" disabled={Boolean(busy)} onClick={() => run("restart", onRestart)}>
          <RefreshCw size={16} /> {busy === "restart" ? "Restarting…" : "Restart table"}
        </button>
      </div>
      {error && <p className="modal-error" role="alert">{error}</p>}
      <div className="game-management-list">
        {safeParticipants.map((participant) => {
          const isVisitorParticipant = participant.role === "visitor";
          const displayName = participant.name || (isVisitorParticipant ? "Visitor" : "Player");
          const commanderName = participant.commander
            ? `${participant.commander}${participant.commanderPartner ? ` / ${participant.commanderPartner}` : ""}`
            : "No commander selected";
          return (
            <section className="game-management-tile" key={participant.id}>
              <div className="game-management-person">
                <span
                  className="game-management-avatar"
                  style={{ "--participant-color": participant.color }}
                  aria-hidden="true"
                >
                  {displayName.trim().charAt(0).toUpperCase() || "?"}
                </span>
                <div className="game-management-identity">
                  <strong>{displayName}</strong>
                  <span>
                    {isVisitorParticipant
                      ? participant.id === currentUserId ? "You · Visitor" : "Visitor"
                      : commanderName}
                  </span>
                </div>
                {participant.reconnecting && <span className="game-management-status">Reconnecting</span>}
              </div>
              {!participant.isMe && participant.membershipId && (
                <div className="game-management-member-actions">
                  {isVisitorParticipant && (
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => manageParticipant(participant, participant.roomMuted ? "unmute" : "mute")}
                    >
                      {participant.roomMuted ? <Mic size={16} /> : <MicOff size={16} />}
                      {participant.roomMuted ? "Unmute visitor" : "Mute visitor"}
                    </button>
                  )}
                  <button
                    className="danger"
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => manageParticipant(participant, "remove")}
                  >
                    <UserMinus size={16} /> Remove
                  </button>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
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
        const attackingCommanders = opponents.flatMap((opponent) => {
          const commanders = [{
            damageKey: opponent.id,
            label: opponent.commander || `${opponent.name}'s commander`,
          }];
          // Commander damage is assigned to each creature commander, not to
          // the player. Backgrounds are legal partners but are noncreature
          // enchantments, so they cannot deal commander damage.
          if (opponent.commanderPartner && /\bCreature\b/i.test(opponent.commanderPartnerType || "")) {
            commanders.push({
              damageKey: `p:${opponent.id}`,
              label: opponent.commanderPartner,
            });
          }
          return commanders;
        });
        return (
          <section className="counter-player" key={player.id}>
            <div className="counter-player-head">
              <h3><span className="counter-player-color" style={{ backgroundColor: player.color }} aria-hidden="true" />{player.isMe ? "Me" : player.name}</h3>
              <span className="counter-subheading">Commander damage received</span>
            </div>
            <div className="commander-damage-list">
              {attackingCommanders.length ? attackingCommanders.map((commander) => {
                const value = player.commanderDamage?.[commander.damageKey] || 0;
                const { label } = commander;
                return (
                  <div className="counter-row commander-damage-row" key={commander.damageKey}>
                    <span className="counter-label">
                      <strong>{label}</strong>
                    </span>
                    <CounterStepper
                      value={value}
                      lethal={value >= 21}
                      editable={player.isMe}
                      label={`${label} damage to ${player.name}`}
                      onDecrease={() => onChangeCommanderDamage?.(commander.damageKey, -1)}
                      onIncrease={() => onChangeCommanderDamage?.(commander.damageKey, 1)}
                    />
                  </div>
                );
              }) : (
                <p className="counter-note">Other commanders will appear here.</p>
              )}
            </div>
            <div className="counter-row poison-row">
              <span className="counter-label">
                <strong>Poison</strong>
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
          </section>
        );
      })}
    </div>
  );
}

function CounterStepper({ value, lethal, editable, label, onDecrease, onIncrease }) {
  const zero = Number(value) === 0;
  if (!editable) {
    return <strong className={`counter-readout${lethal ? " lethal" : ""}${zero ? " zero" : ""}`} aria-label={label}>{value}</strong>;
  }
  return (
    <div className={`counter-stepper${lethal ? " lethal" : ""}${zero ? " zero" : ""}`} aria-label={label}>
      {editable && <button type="button" onClick={onDecrease} aria-label={`Decrease ${label}`} data-tooltip={`Decrease ${label}`} data-tooltip-pos="right-top">−</button>}
      <strong>{value}</strong>
      {editable && <button type="button" onClick={onIncrease} aria-label={`Increase ${label}`} data-tooltip={`Increase ${label}`} data-tooltip-pos="right-top">+</button>}
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
  showFriends,
  friends,
  onInviteFriend,
  onCancelInvitation,
}) {
  const [sentInvitations, setSentInvitations] = useState([]);
  const [inviteBusy, setInviteBusy] = useState("");
  const [inviteError, setInviteError] = useState("");
  const friendList = [...friends].sort((left, right) => {
    const leftOnline = left.status === "offline" ? 0 : 1;
    const rightOnline = right.status === "offline" ? 0 : 1;
    return rightOnline - leftOnline || String(left.display_name || "").localeCompare(String(right.display_name || ""));
  });

  const runInviteAction = async (label, action) => {
    setInviteError("");
    setInviteBusy(label);
    try {
      await action();
    } catch (actionError) {
      setInviteError(String(actionError?.message || "That invitation could not be completed."));
    } finally {
      setInviteBusy("");
    }
  };

  return (
    <div className="invite-panel">
      <section className="invite-links">
        <h3 className="sidebar-section-title">Share links</h3>
        <div className="invite-link-list">
          <InviteField
            label="Game code"
            value={gameCode}
            copied={gameCodeCopied}
            onCopy={onCopyGameCode}
            code
          />
          <InviteField
            label="Player link"
            value={playerLink}
            copied={linkCopied}
            onCopy={onCopyPlayerLink}
          />
          <InviteField
            label="Visitor link"
            value={visitorLink}
            copied={visitorLinkCopied}
            onCopy={onCopyVisitorLink}
          />
        </div>
      </section>
      {showFriends && (
        <section className="invite-friends">
          <div className="invite-section-head">
            <h3 className="sidebar-section-title">Friends</h3>
            <small>Invite someone directly to this game</small>
          </div>
          {friendList.length ? (
            <ul className="invite-friend-list">
              {friendList.map((friend) => {
                const invitation = sentInvitations.find((item) => item.profileId === friend.id);
                const online = friend.status === "online" || friend.status === "in_game";
                const statusLabel = friend.status === "in_game" ? "In game" : online ? "Online" : "Offline";
                const busyLabel = invitation ? `cancel-invite-${invitation.id}` : `invite-${friend.id}`;
                return (
                  <li className="invite-friend-row" key={friend.id}>
                    <span className="invite-friend-identity">
                      <strong className="invite-friend-name">
                        <i className={online ? "online" : "offline"} aria-hidden="true" />
                        <span>{friend.display_name || "Friend"}</span>
                      </strong>
                      <span className={online ? "online" : "offline"}>
                        {statusLabel}
                      </span>
                      {invitation && <small>Invite sent</small>}
                    </span>
                    <button
                      type="button"
                      className={`${invitation ? "invited" : ""}${!online ? " offline" : ""}`.trim()}
                      disabled={Boolean(inviteBusy) || !online}
                      data-tooltip={!online ? "Friend is offline" : undefined}
                      data-tooltip-pos="left-top"
                      onClick={() => runInviteAction(busyLabel, async () => {
                        if (invitation) {
                          await onCancelInvitation?.(invitation.id);
                          setSentInvitations((invitations) => invitations.filter((item) => item.id !== invitation.id));
                          return;
                        }
                        const invitationId = await onInviteFriend?.(friend.id);
                        setSentInvitations((invitations) => [...invitations, {
                          id: invitationId,
                          profileId: friend.id,
                          name: friend.display_name || "Friend",
                        }]);
                      })}
                    >
                      {inviteBusy === busyLabel ? (invitation ? "Cancelling…" : "Sending…") : invitation ? "Cancel" : "Invite"}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : <p className="invite-friends-empty">Your friends will appear here.</p>}
          {inviteError && <p className="modal-error" role="alert">{inviteError}</p>}
        </section>
      )}
    </div>
  );
}

function InviteField({ label, value, copied, onCopy, code = false }) {
  return (
    <section className="invite-field">
      <div className="invite-field-head">
        <span>{label}</span>
      </div>
      <div className="invite-value-row">
        <input className={code ? "invite-value code-value" : "invite-value"} value={value || ""} readOnly aria-label={label} />
        <button type="button" onClick={onCopy} aria-label={`Copy ${label.toLowerCase()}`}>
          {!code && <Copy size={16} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
    </section>
  );
}
