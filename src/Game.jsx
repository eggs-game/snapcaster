import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  Check, Crown, Dices, FlipVertical2, Mic, MicOff, Minus, MoreVertical, PanelLeft, Plus, Shuffle, SkipForward,
  Swords, UserRound, Video, VideoOff, X,
} from "lucide-react";
import { GameConnection, captureLocalFrame, clickToNormalized } from "./webrtc.js";
import LocalMockGameConnection from "./LocalMockGameConnection.js";
import { labelRecognitionReport, saveRecognitionReport, saveRecognitionTiming } from "./signaling.js";
import {
  fetchCardByName,
  getCommanderPairing,
  suggestCardNames,
  suggestCommanderPartners,
} from "./cardSearch.js";
import {
  identify as identifyCard,
  preload as preloadRecognition,
  preloadOCR,
} from "./recognition/matcher.js";
import {
  isReusableRecognitionMatch,
  nearbyRecognitionHints,
  normalizeRecognitionHint,
  rememberRecognitionHint,
} from "./recognitionHints.js";
import CardSidebar, { cardFromScryfall, formatDiceResult, formatDiceSides } from "./CardSidebar.jsx";
import { getSoundEffect, playChatNotification, playSoundEffect, playTurnNotification } from "./soundEffects.js";
import { getCounterTextColor, getVideoCounterType, normalizeVideoCounter } from "./videoCounters.js";
import {
  DEFAULT_OUTGOING_VIDEO_QUALITY,
  normalizeOutgoingVideoQuality,
  RECEIVER_VIDEO_QUALITY_VALUES,
  resolveAdaptiveReceiverQuality,
} from "./videoQuality.js";

function shallowNonFunctionPropsEqual(previous, next) {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of keys) {
    if (typeof previous[key] === "function" && typeof next[key] === "function") continue;
    if (!Object.is(previous[key], next[key])) return false;
  }
  return true;
}

const StableCardSidebar = React.memo(CardSidebar, shallowNonFunctionPropsEqual);

import GameManagement from "./GameManagement.jsx";
import ReviewPrompt from "./ReviewPrompt.jsx";
import { getSocialDashboard } from "./account.js";
import {
  cancelGameInvitation,
  endDurableGame,
  claimGameOwnership,
  getGameMembershipStates,
  leaveGameRoom,
  manageGameMember,
  recordGameElimination,
  recordGameTurn,
  restartDurableGame,
  startDurableGame,
  touchGameMembership,
  validateGameCommanderSelection,
  inviteFriendToGame,
} from "./gameRooms.js";

const SOUND_COOLDOWN_MS = 120000;
const CHAT_SHOWCASE_CARD = {
  name: "Sol Ring",
  scryfall_id: "e07f656c-97b5-4147-821a-edbb49f34e19",
  image: "https://cards.scryfall.io/normal/front/e/0/e07f656c-97b5-4147-821a-edbb49f34e19.jpg",
};
const PREVIEW_COMMANDER_NAMES = {
  "preview-maya": "Atraxa, Praetors’ Voice",
  "preview-drew": "The Ur-Dragon",
  "preview-sam": "Muldrotha, the Gravetide",
};

function makeChatShowcase(myId, myName) {
  const now = Date.now();
  const at = (minutesAgo) => now - minutesAgo * 60_000;
  return [
    { id: "showcase-1", from: "showcase-drew", name: "Drew", role: "visitor", text: "I kept a risky seven. Let’s see if it pays off.", at: at(13) },
    { id: "showcase-2", from: myId, name: myName, text: "Good luck — I’m ready when you are.", at: at(12) },
    { id: "showcase-3", from: "showcase-maya", name: "Maya", text: "That opening hand looks great.", soundId: "cartoon-laugh", at: at(11) },
    { id: "showcase-4", kind: "dice", from: "showcase-drew", name: "Drew", role: "visitor", value: 18, sides: 20, at: at(10) },
    { id: "showcase-5", kind: "card", from: "showcase-maya", name: "Maya", card: CHAT_SHOWCASE_CARD, at: at(9) },
    { id: "showcase-6", kind: "card", from: myId, name: myName, card: CHAT_SHOWCASE_CARD, at: at(8) },
    { id: "showcase-7", kind: "life", from: "showcase-drew", name: "Drew", role: "visitor", previous: 40, life: 37, delta: -3, at: at(7) },
    { id: "showcase-8", kind: "life", from: myId, name: myName, previous: 37, life: 42, delta: 5, at: at(6) },
    { id: "showcase-9", kind: "ready", system: true, outcome: "ready", at: at(5) },
    { id: "showcase-10", kind: "ready", from: "showcase-drew", name: "Drew", role: "visitor", outcome: "not-ready", at: at(4) },
    { id: "showcase-11", kind: "ready", system: true, outcome: "timeout", at: at(3) },
    { id: "showcase-12", from: "showcase-maya", name: "Maya", text: "I need a quick rules check before we move on.", whisper: true, at: at(2) },
    { id: "showcase-13", from: myId, name: myName, text: "Sure, what’s up?", whisper: true, to: "showcase-maya", toName: "Maya", at: at(1) },
    { id: "showcase-14", kind: "dice", from: myId, name: myName, value: 4, sides: 6, at: at(0) },
    { id: "showcase-15", from: "showcase-drew", name: "Drew", role: "visitor", soundId: "applause", at: at(0) },
  ];
}

export default function Game({ session, account, onLeave, themePreference, onThemePreferenceChange }) {
  const isVisitor = session.role === "visitor";
  const isLocalMock = Boolean(session.mockGame);
  const connRef = useRef(null);
  const rosterRef = useRef([]);
  const verifiedMembershipStatesRef = useRef(null);
  const realtimeEpochRef = useRef(session.realtimeEpoch || "");
  const livesRef = useRef({ ...(session.mockGame?.lives || {}) });
  const commanderDamageRef = useRef({ ...(session.mockGame?.commanderDamage || {}) });
  const eliminationsRef = useRef({ ...(session.mockGame?.eliminations || {}) });
  const chatIdRef = useRef(0);
  const pendingLifeChatsRef = useRef(new Map());
  const readyCheckRef = useRef(null);
  const diceOverlayTimerRef = useRef(null);
  const recentSoundBySenderRef = useRef({});
  const myIdRef = useRef(null);
  const recognitionHintsRef = useRef([]);
  const activeRecognitionRef = useRef(null);
  const latestRecognitionRequestRef = useRef(0);
  const captureObjectUrlsRef = useRef([]);
  const requestedVideoQualityRef = useRef(new Map());
  const chatNotificationsEnabledRef = useRef(true);
  const turnNotificationsEnabledRef = useRef(true);
  const membershipRefreshAtRef = useRef(0);
  const activePlayerIdRef = useRef("");
  const gameStatusRef = useRef(session.roomStatus || "lobby");
  const chatShowcaseSeededRef = useRef(false);
  const chatShowcaseEnabled = import.meta.env.DEV;
  const [myId, setMyId] = useState(null);
  const [roster, setRoster] = useState([]);
  const [lives, setLives] = useState(() => ({ ...(session.mockGame?.lives || {}) })); // id -> life
  const [commanders, setCommanders] = useState(() => ({ ...(session.mockGame?.commanders || {}) })); // id -> card name
  const [commanderPartners, setCommanderPartners] = useState(() => ({ ...(session.mockGame?.commanderPartners || {}) })); // id -> paired commander name
  const [commanderPartnerTypes, setCommanderPartnerTypes] = useState(() => ({ ...(session.mockGame?.commanderPartnerTypes || {}) })); // id -> partner type line
  const [colors, setColors] = useState(() => ({ ...(session.mockGame?.colors || {}) })); // id -> hex color
  const [mutedPlayers, setMutedPlayers] = useState({}); // id -> bool
  const [cameraEnabledByPlayer, setCameraEnabledByPlayer] = useState({}); // id -> bool
  const [reconnectingPlayers, setReconnectingPlayers] = useState({}); // id -> bool
  const [streams, setStreams] = useState({});
  const [videoQualityByPlayer, setVideoQualityByPlayer] = useState({});
  const [localStream, setLocalStream] = useState(null);
  const [lobbyName, setLobbyName] = useState(() => session.lobbyName || "");
  const [error, setError] = useState(null);
  const [micOn, setMicOn] = useState(!session.startMuted);
  const [camOn, setCamOn] = useState(true);
  const [lookups, setLookups] = useState([]);
  const [chatMessages, setChatMessages] = useState(() => [...(session.mockGame?.chat || [])]);
  const [diceOverlay, setDiceOverlay] = useState(null);
  const [counterDraft, setCounterDraft] = useState(null);
  const [videoCounters, setVideoCounters] = useState({});
  const [flippedVideos, setFlippedVideos] = useState({});
  const [videoCounterDragPreview, setVideoCounterDragPreview] = useState(null);
  const [counterPointerDrag, setCounterPointerDrag] = useState(null);
  const [readyCheck, setReadyCheck] = useState(null);
  const [gridOrder, setGridOrder] = useState([]);
  const [recognitionReports, setRecognitionReports] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("snapcast-recognition-reports") || "[]");
      return Array.isArray(saved) ? saved.slice(-100) : [];
    } catch { return []; }
  });
  const [activePlayerId, setActivePlayerId] = useState(session.mockGame?.activePlayerId || "");
  const [poisonCounters, setPoisonCounters] = useState(() => ({ ...(session.mockGame?.poison || {}) }));
  const [commanderDamage, setCommanderDamage] = useState(() => ({ ...(session.mockGame?.commanderDamage || {}) }));
  const [eliminations, setEliminations] = useState(() => ({ ...(session.mockGame?.eliminations || {}) }));
  const [videoLayout, setVideoLayout] = useState(() => {
    try {
      const saved = localStorage.getItem("snapcast-video-layout");
      return ["tiles", "follow", "hero"].includes(saved) ? saved : "tiles";
    } catch {
      return "tiles";
    }
  });
  const [videoFit, setVideoFit] = useState(() => {
    try {
      const saved = localStorage.getItem("snapcast-video-fit");
      return ["cover", "16:9"].includes(saved) ? saved : "cover";
    } catch {
      return "cover";
    }
  });
  const [outgoingVideoQuality, setOutgoingVideoQuality] = useState(() => {
    try {
      return normalizeOutgoingVideoQuality(localStorage.getItem("snapcast-outgoing-video-quality"));
    } catch {
      return DEFAULT_OUTGOING_VIDEO_QUALITY;
    }
  });
  const [heroPlayerId, setHeroPlayerId] = useState("");
  const [current, setCurrent] = useState(null);
  const [flash, setFlash] = useState(null);
  const [scanNotice, setScanNotice] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarClosing, setSidebarClosing] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [edgeTabY, setEdgeTabY] = useState(null);
  const [sidebarView, setSidebarView] = useState("lookup"); // lookup | settings | counters | invite | dice | management
  const [linkCopied, setLinkCopied] = useState(false);
  const [visitorLinkCopied, setVisitorLinkCopied] = useState(false);
  const [gameCodeCopied, setGameCodeCopied] = useState(false);
  const [cameras, setCameras] = useState([]);
  const [mics, setMics] = useState([]);
  const [videoDeviceId, setVideoDeviceId] = useState("");
  const [audioDeviceId, setAudioDeviceId] = useState("");
  const [deviceError, setDeviceError] = useState("");
  const [soundCooldownUntil, setSoundCooldownUntil] = useState(0);
  const [chatNotificationsEnabled, setChatNotificationsEnabled] = useState(() => {
    try {
      return localStorage.getItem("snapcast-chat-notifications") !== "muted";
    } catch {
      return true;
    }
  });
  const [turnNotificationsEnabled, setTurnNotificationsEnabled] = useState(() => {
    try {
      return localStorage.getItem("snapcast-turn-notifications") !== "muted";
    } catch {
      return true;
    }
  });
  const [gameStatus, setGameStatus] = useState(session.roomStatus || "lobby");
  const [durableSessionId, setDurableSessionId] = useState(session.gameSessionId || "");
  const [gameManagementOpen, setGameManagementOpen] = useState(false);
  const [roomMutedMemberships, setRoomMutedMemberships] = useState({});
  const [gameFriends, setGameFriends] = useState([]);
  const [isGameOwner, setIsGameOwner] = useState(Boolean(session.creator));
  const [activeOwnerToken, setActiveOwnerToken] = useState(session.ownerToken || "");
  const [reviewSessionId, setReviewSessionId] = useState("");
  const [leaveAfterReview, setLeaveAfterReview] = useState(false);
  const [membershipRefreshNonce, setMembershipRefreshNonce] = useState(0);

  const resetTableState = () => {
    const playerIds = rosterRef.current.filter((member) => member.role !== "visitor").map((member) => member.id);
    const resetLives = Object.fromEntries(playerIds.map((id) => [id, 40]));
    setLives(resetLives);
    livesRef.current = resetLives;
    setPoisonCounters({});
    setCommanderDamage({});
    commanderDamageRef.current = {};
    setEliminations({});
    eliminationsRef.current = {};
    setCommanders({});
    setCommanderPartners({});
    setCommanderPartnerTypes({});
    setActivePlayerId(playerIds[0] || "");
    activePlayerIdRef.current = playerIds[0] || "";
    setDurableSessionId("");
    setGameStatus("lobby");
    gameStatusRef.current = "lobby";
    connRef.current?.setLife(40);
    connRef.current?.setPoison(0);
    connRef.current?.setCommander("");
    connRef.current?.setCommanderPartner("");
    connRef.current?.setElimination("");
  };

  useEffect(() => {
    if (!gameManagementOpen || !account) return;
    getSocialDashboard()
      .then((dashboard) => setGameFriends(dashboard.friends || []))
      .catch(() => setGameFriends([]));
  }, [account, gameManagementOpen]);

  useEffect(() => {
    if (isLocalMock || !session.membershipId || !session.participantToken) return undefined;
    const touch = () => {
      touchGameMembership({
        membershipId: session.membershipId,
        participantToken: session.participantToken,
      }).then((membership) => {
        if (!membership.active) {
          setError("The game owner removed you from this room.");
          return null;
        }
        if (membership.room_status) {
          const previousStatus = gameStatusRef.current;
          if (membership.room_status === "lobby" && gameStatusRef.current !== "lobby") resetTableState();
          if (
            membership.room_status === "finished"
            && previousStatus !== "finished"
            && account
            && !isVisitor
            && membership.game_session_id
          ) {
            setReviewSessionId(membership.game_session_id);
          }
          gameStatusRef.current = membership.room_status;
          setGameStatus(membership.room_status);
        }
        if (membership.realtime_epoch) {
          realtimeEpochRef.current = membership.realtime_epoch;
          connRef.current?.rotateRealtimeEpoch(membership.realtime_epoch).catch(() => {});
        }
        if (membership.game_session_id) setDurableSessionId(membership.game_session_id);
        if (membership.owner_membership_id === session.membershipId) {
          setIsGameOwner(true);
          setActiveOwnerToken((token) => token || session.participantToken);
        } else if (membership.owner_stale && !isVisitor) {
          claimGameOwnership({
            gameId: session.gameId,
            membershipId: session.membershipId,
            participantToken: session.participantToken,
          }).then((claimed) => {
            if (claimed) {
              setIsGameOwner(true);
              setActiveOwnerToken(session.participantToken);
            }
          }).catch(() => {});
        }
        if (isVisitor && membership.room_muted) {
          for (const track of connRef.current?.localStream?.getAudioTracks?.() || []) track.enabled = false;
          setMicOn(false);
        }
        if (Array.isArray(membership.memberships)) return membership.memberships;
        return getGameMembershipStates({
          gameId: session.gameId,
          membershipId: session.membershipId,
          participantToken: session.participantToken,
        });
      }).then((states) => {
        if (!states) return;
        const activeMemberships = new Set(states.map((state) => state.membership_id));
        const mutedMemberships = new Set(states.filter((state) => state.room_muted).map((state) => state.membership_id));
        verifiedMembershipStatesRef.current = states;
        connRef.current?.setMembershipStates(states);
        const byMembership = new Map(states.map((state) => [state.membership_id, state]));
        setCommanders((values) => {
          const next = { ...values };
          for (const member of rosterRef.current) {
            const state = byMembership.get(member.membershipId);
            if (state) next[member.id] = state.commander_name || "";
          }
          return next;
        });
        setCommanderPartners((values) => {
          const next = { ...values };
          for (const member of rosterRef.current) {
            const state = byMembership.get(member.membershipId);
            if (state) next[member.id] = state.partner_commander_name || "";
          }
          return next;
        });
        setCommanderPartnerTypes((values) => {
          const next = { ...values };
          for (const member of rosterRef.current) {
            const state = byMembership.get(member.membershipId);
            if (state) next[member.id] = state.partner_commander_type_line || "";
          }
          return next;
        });
        setRoster((members) => members.filter((member) => !member.membershipId || activeMemberships.has(member.membershipId)));
        setMutedPlayers((values) => {
          const next = { ...values };
          for (const member of rosterRef.current) {
            if (member.role === "visitor" && member.membershipId) {
              next[member.id] = mutedMemberships.has(member.membershipId);
            }
          }
          return next;
        });
      }).catch(() => {});
    };
    touch();
    const timer = window.setInterval(touch, 15000);
    return () => window.clearInterval(timer);
  }, [account, isLocalMock, isVisitor, session.membershipId, session.participantToken, membershipRefreshNonce]);

  useEffect(() => {
    chatNotificationsEnabledRef.current = chatNotificationsEnabled;
  }, [chatNotificationsEnabled]);

  useEffect(() => {
    turnNotificationsEnabledRef.current = turnNotificationsEnabled;
  }, [turnNotificationsEnabled]);

  const chooseChatNotifications = useCallback((enabled) => {
    const next = Boolean(enabled);
    chatNotificationsEnabledRef.current = next;
    setChatNotificationsEnabled(next);
    try {
      localStorage.setItem("snapcast-chat-notifications", next ? "enabled" : "muted");
    } catch { /* preference still applies for this session */ }
  }, []);

  const chooseTurnNotifications = useCallback((enabled) => {
    const next = Boolean(enabled);
    turnNotificationsEnabledRef.current = next;
    setTurnNotificationsEnabled(next);
    try {
      localStorage.setItem("snapcast-turn-notifications", next ? "enabled" : "muted");
    } catch { /* preference still applies for this session */ }
  }, []);

  const notifyIncomingChat = useCallback(() => {
    if (chatNotificationsEnabledRef.current) playChatNotification();
  }, []);

  const updateActivePlayer = useCallback((id) => {
    const nextId = String(id || "");
    const previousId = activePlayerIdRef.current;
    activePlayerIdRef.current = nextId;
    setActivePlayerId(nextId);
    if (previousId && previousId !== nextId && nextId === myIdRef.current && turnNotificationsEnabledRef.current) {
      playTurnNotification();
    }
  }, []);

  // Temporary local styling gallery. It never runs in production or sends any
  // of the fixture messages to a room.
  useEffect(() => {
    if (!chatShowcaseEnabled || !myId || chatShowcaseSeededRef.current) return;
    chatShowcaseSeededRef.current = true;
    setChatMessages(makeChatShowcase(myId, session.name));
  }, [chatShowcaseEnabled, myId, session.name]);

  const showDiceOverlay = useCallback((roll) => {
    window.clearTimeout(diceOverlayTimerRef.current);
    setDiceOverlay(roll);
    diceOverlayTimerRef.current = window.setTimeout(() => setDiceOverlay(null), 3000);
  }, []);

  // Life totals still synchronize on every click, but the room gets one
  // readable net change after the player pauses instead of a message per step.
  const queueLifeChat = useCallback((id, name, previous, life, kind = "life", notify = false, commanderDetails = null) => {
    const pending = pendingLifeChatsRef.current.get(id);
    const next = pending
      ? {
        ...pending,
        name: name || pending.name,
        life,
        kind: kind || pending.kind,
        notify: notify || pending.notify,
        commanderName: commanderDetails?.name || pending.commanderName,
        previousCommanderDamage: pending.previousCommanderDamage ?? commanderDetails?.previous,
        commanderDamage: commanderDetails?.value ?? pending.commanderDamage,
      }
      : {
        id,
        name: name || "Player",
        previous,
        life,
        kind,
        notify,
        commanderName: commanderDetails?.name || "",
        previousCommanderDamage: commanderDetails?.previous,
        commanderDamage: commanderDetails?.value,
        timer: null,
      };
    window.clearTimeout(next.timer);
    next.timer = window.setTimeout(() => {
      pendingLifeChatsRef.current.delete(id);
      const delta = next.life - next.previous;
      if (!delta) return;
      const at = Date.now();
      if (next.notify) notifyIncomingChat();
      setChatMessages((messages) => [...messages.slice(-99), {
        id: `life-${id}-${at}-${++chatIdRef.current}`,
        kind: next.kind,
        from: id,
        name: next.name,
        previous: next.previous,
        life: next.life,
        delta,
        commanderName: next.commanderName,
        previousCommanderDamage: next.previousCommanderDamage,
        commanderDamage: next.commanderDamage,
        at,
      }]);
    }, 2000);
    pendingLifeChatsRef.current.set(id, next);
  }, [notifyIncomingChat]);

  const markPendingCommanderDamageChat = useCallback((id, details = {}) => {
    const pending = pendingLifeChatsRef.current.get(id);
    if (pending && pending.life < pending.previous) {
      pending.kind = "commander-damage";
      pending.commanderName = details.name || pending.commanderName;
      pending.previousCommanderDamage = pending.previousCommanderDamage ?? details.previous;
      pending.commanderDamage = details.value ?? pending.commanderDamage;
    }
  }, []);

  const acceptIncomingSound = (senderId, soundId) => {
    const sound = getSoundEffect(soundId);
    if (!sound) return "";
    const now = Date.now();
    const lastSoundAt = recentSoundBySenderRef.current[senderId] || 0;
    // The receiver also applies the two-minute rule. This prevents a modified
    // sender from making a room noisy even before a server-side limiter exists.
    if (now - lastSoundAt < SOUND_COOLDOWN_MS) return "";
    recentSoundBySenderRef.current[senderId] = now;
    playSoundEffect(sound, 1);
    return sound.id;
  };

  useEffect(() => {
    // Spin up the recognition worker now so OpenCV compiles in the background
    // (off the main thread) while the player sets up their camera and cards.
    preloadRecognition();
    const handlers = {
      onRoster: (nextRoster) => {
        rosterRef.current = nextRoster;
        setRoster(nextRoster);
      },
      onRemoteStream: (id, stream) => setStreams((s) => ({ ...s, [id]: stream })),
      onPeerReconnecting: (id, reconnecting) => setReconnectingPlayers((values) => ({
        ...values,
        [id]: reconnecting,
      })),
      onPeerLeft: (id) => {
        setStreams((s) => { const c = { ...s }; delete c[id]; return c; });
        setVideoCounters((counters) => { const next = { ...counters }; delete next[id]; return next; });
        setCameraEnabledByPlayer((values) => { const next = { ...values }; delete next[id]; return next; });
        setMutedPlayers((values) => { const next = { ...values }; delete next[id]; return next; });
        setReconnectingPlayers((values) => { const next = { ...values }; delete next[id]; return next; });
      },
      onRestoredState: (state) => {
        const id = state.id;
        if (!id) return;
        if (state.life != null) {
          livesRef.current = { ...livesRef.current, [id]: state.life };
          setLives((values) => ({ ...values, [id]: state.life }));
        }
        if (state.commander != null) setCommanders((values) => ({ ...values, [id]: state.commander }));
        if (state.commanderPartner != null) setCommanderPartners((values) => ({ ...values, [id]: state.commanderPartner }));
        if (state.commanderPartnerType != null) setCommanderPartnerTypes((values) => ({ ...values, [id]: state.commanderPartnerType }));
        if (state.color) setColors((values) => ({ ...values, [id]: state.color }));
        setMutedPlayers((values) => ({ ...values, [id]: !!state.muted }));
        setCameraEnabledByPlayer((values) => ({ ...values, [id]: state.cameraEnabled !== false }));
        setMicOn(!state.muted);
        if (!isVisitor) setCamOn(state.cameraEnabled !== false);
        if (state.poison != null) setPoisonCounters((values) => ({ ...values, [id]: state.poison }));
        if (state.commanderDamage) {
          commanderDamageRef.current = { ...commanderDamageRef.current, [id]: state.commanderDamage };
          setCommanderDamage((values) => ({ ...values, [id]: state.commanderDamage }));
        }
        if (state.videoCounters) setVideoCounters((values) => ({ ...values, [id]: state.videoCounters }));
      },
      onLife: (id, life) => {
        const previous = livesRef.current[id];
        livesRef.current = { ...livesRef.current, [id]: life };
        setLives((values) => ({ ...values, [id]: life }));
        if (previous == null || previous === life) return;
        const player = rosterRef.current.find((member) => member.id === id);
        queueLifeChat(id, player?.name, previous, life, "life", id !== myIdRef.current);
      },
      onLobbyName: setLobbyName,
      onCommander: (id, commander) => setCommanders((values) => ({ ...values, [id]: commander })),
      onCommanderPartner: (id, partner, typeLine) => {
        setCommanderPartners((values) => ({ ...values, [id]: partner }));
        setCommanderPartnerTypes((values) => ({ ...values, [id]: typeLine }));
      },
      onColor: (id, color) => setColors((values) => ({ ...values, [id]: color })),
      onMuted: (id, muted) => setMutedPlayers((values) => ({ ...values, [id]: muted })),
      onCameraEnabled: (id, enabled) => setCameraEnabledByPlayer((values) => ({ ...values, [id]: enabled })),
      onCardIdentified: (msg) => {
        const at = Number(msg.at) || Date.now();
        if (msg.from !== myIdRef.current) notifyIncomingChat();
        setLookups((lookedUp) => [...lookedUp.slice(-11), { by: msg.byName, card: msg.card, at }]);
        setChatMessages((messages) => [...messages.slice(-99), {
          id: `remote-card-${msg.from || msg.byName}-${at}-${++chatIdRef.current}`,
          kind: "card",
          from: msg.from || "",
          name: msg.byName || "Player",
          card: msg.card,
          at,
        }]);
      },
      onRecognitionHint: (hint) => {
        recognitionHintsRef.current = rememberRecognitionHint(recognitionHintsRef.current, hint);
      },
      onChat: (message) => {
        const soundId = acceptIncomingSound(message.from, message.soundId);
        if (!soundId && message.from !== myIdRef.current) notifyIncomingChat();
        setChatMessages((messages) => [...messages.slice(-99), {
          ...message,
          soundId,
          id: `remote-${message.from}-${message.at}-${++chatIdRef.current}`,
        }]);
      },
      onActivePlayer: updateActivePlayer,
      onPoison: (id, value) => setPoisonCounters((values) => ({ ...values, [id]: value })),
      onCommanderDamage: (victimId, attackerId, value, commanderName) => {
        const previous = commanderDamageRef.current[victimId]?.[attackerId] || 0;
        commanderDamageRef.current = {
          ...commanderDamageRef.current,
          [victimId]: { ...(commanderDamageRef.current[victimId] || {}), [attackerId]: value },
        };
        markPendingCommanderDamageChat(victimId, { name: commanderName, previous, value });
        setCommanderDamage((values) => ({
          ...values,
          [victimId]: { ...(values[victimId] || {}), [attackerId]: value },
        }));
      },
      onElimination: (id, reason) => {
        if ((eliminationsRef.current[id] || "") === reason) return;
        const next = { ...eliminationsRef.current };
        if (reason) next[id] = reason;
        else delete next[id];
        eliminationsRef.current = next;
        setEliminations(next);
        const player = rosterRef.current.find((member) => member.id === id);
        setChatMessages((messages) => [...messages.slice(-99), {
          id: `elimination-${id}-${Date.now()}-${++chatIdRef.current}`,
          kind: "elimination",
          system: true,
          text: reason
            ? `${player?.name || "A player"} is out (${reason.replace("_", " ")}).`
            : `${player?.name || "A player"} returned to the game.`,
          at: Date.now(),
        }]);
      },
      onMembershipRefresh: () => {
        const now = Date.now();
        if (now - membershipRefreshAtRef.current < 5000) return;
        membershipRefreshAtRef.current = now;
        setMembershipRefreshNonce((value) => value + 1);
      },
      onDiceRoll: (roll) => {
        const entry = {
          ...roll,
          kind: "dice",
          id: `remote-dice-${roll.from}-${roll.at}-${++chatIdRef.current}`,
        };
        if (roll.from !== myIdRef.current) notifyIncomingChat();
        setChatMessages((messages) => [...messages.slice(-99), entry]);
        showDiceOverlay(entry);
      },
      onVideoCounter: (ownerId, counter) => setVideoCounters((counters) => {
        const ownerCounters = counters[ownerId] || [];
        const existingIndex = ownerCounters.findIndex((item) => item.id === counter.id);
        const nextOwnerCounters = existingIndex < 0
          ? [...ownerCounters, counter]
          : ownerCounters.map((item, index) => index === existingIndex ? counter : item);
        return { ...counters, [ownerId]: nextOwnerCounters.slice(-24) };
      }),
      onVideoCounterRemove: (ownerId, counterId) => setVideoCounters((counters) => ({
        ...counters,
        [ownerId]: (counters[ownerId] || []).filter((counter) => counter.id !== counterId),
      })),
      onGridOrder: (order) => setGridOrder(order),
      onReadyCheckStart: (check) => {
        const next = { ...check, responses: {} };
        readyCheckRef.current = next;
        setReadyCheck(next);
      },
      onReadyCheckResponse: ({ checkId, playerId, ready }) => {
        setReadyCheck((currentCheck) => {
          if (!currentCheck || currentCheck.checkId !== checkId) return currentCheck;
          const next = {
            ...currentCheck,
            responses: { ...currentCheck.responses, [playerId]: ready },
          };
          readyCheckRef.current = next;
          return next;
        });
      },
      onReadyCheckEnd: ({ checkId, outcome, by }) => finishReadyCheck(outcome, false, by, checkId),
      // Somebody pulled a still from this player's camera to identify a card.
      // Silent capture is not acceptable: the person being photographed has to
      // see it happen, even though the request itself is legitimate.
      onCaptured: (peerId, byName) => setScanNotice({
        id: `${peerId}-${Date.now()}`,
        by: byName,
      }),
      onError: setError,
    };
    const conn = isLocalMock
      ? new LocalMockGameConnection(handlers, session.mockGame)
      : new GameConnection(handlers);
    connRef.current = conn;
    if (verifiedMembershipStatesRef.current) conn.setMembershipStates(verifiedMembershipStatesRef.current);
    (async () => {
      try {
        const stream = await conn.initMedia({
          audioOnly: isVisitor,
          videoDeviceId: session.videoDeviceId,
          audioDeviceId: session.audioDeviceId,
          startMuted: !!session.startMuted,
          outgoingVideoQuality,
        });
        setLocalStream(stream);
        setMicOn(!conn.muted);
        setVideoDeviceId(conn.videoDeviceId);
        setAudioDeviceId(conn.audioDeviceId);
        const devices = await conn.listDevices();
        if (!isVisitor) setCameras(devices.cameras);
        setMics(devices.mics);
        const id = await conn.join(
          session.code,
          session.name,
          isVisitor ? "visitor" : "player",
          {
            participantId: session.participantId,
            joinedAt: session.joinedAt,
            membershipId: session.membershipId,
            profileId: session.profileId,
            realtimeEpoch: realtimeEpochRef.current,
          },
        );
        myIdRef.current = id;
        setMyId(id);
        if (!isVisitor && session.videoFlipped) {
          setFlippedVideos((values) => ({ ...values, [id]: true }));
        }
        setMutedPlayers((values) => ({ ...values, [id]: conn.muted }));
        if (!isVisitor && session.lobbyName) {
          conn.setLobbyName(session.lobbyName);
          setLobbyName(session.lobbyName);
        }
      } catch (e) {
        setError(String(e.message || e));
      }
    })();
    const onDeviceChange = async () => {
      try {
        const devices = await conn.listDevices();
        if (!isVisitor) setCameras(devices.cameras);
        setMics(devices.mics);
      } catch { /* ignore */ }
    };
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
      window.clearTimeout(diceOverlayTimerRef.current);
      pendingLifeChatsRef.current.forEach((entry) => window.clearTimeout(entry.timer));
      pendingLifeChatsRef.current.clear();
      myIdRef.current = null;
      conn.close();
    };
  }, [isVisitor, markPendingCommanderDamageChat, notifyIncomingChat, queueLifeChat, session.audioDeviceId, session.code, session.joinedAt, session.name, session.participantId, session.startMuted, session.videoDeviceId, session.videoFlipped, updateActivePlayer]);

  // A readiness prompt is deliberately ephemeral. The timer is local so a
  // lost broadcast cannot leave a stale prompt on one player's screen.
  useEffect(() => {
    if (!readyCheck) return undefined;
    const delay = Math.max(0, readyCheck.expiresAt - Date.now());
    const timer = setTimeout(() => finishReadyCheck("timeout", true), delay);
    return () => clearTimeout(timer);
  }, [readyCheck]);

  // Any player can veto immediately; the prompt closes when every seated
  // player has answered Ready. Visitors are audio-only and are not part of
  // the ready quorum.
  useEffect(() => {
    if (!readyCheck) return;
    const playerIds = roster.filter((member) => member.role !== "visitor").map((member) => member.id);
    const responses = readyCheck.responses || {};
    const veto = playerIds.find((id) => responses[id] === false);
    if (veto) finishReadyCheck("not-ready", true, veto);
    else if (playerIds.length && playerIds.every((id) => responses[id] === true)) finishReadyCheck("ready", true);
  }, [readyCheck, roster]);

  // The capture notice is transient — it marks the moment, it is not a log.
  useEffect(() => {
    if (!scanNotice) return undefined;
    const t = setTimeout(() => setScanNotice(null), 2600);
    return () => clearTimeout(t);
  }, [scanNotice]);

  useEffect(() => () => {
    for (const url of captureObjectUrlsRef.current) URL.revokeObjectURL(url);
    captureObjectUrlsRef.current = [];
  }, []);

  useEffect(() => {
    if (!myId) return undefined;
    const timer = setTimeout(() => preloadOCR(), 5000);
    return () => clearTimeout(timer);
  }, [myId]);

  // The first seated player establishes the opening turn. If the active
  // player leaves, the first remaining seat establishes the replacement.
  useEffect(() => {
    if (isVisitor || !myId) return;
    const playerIds = roster.filter((member) => member.role !== "visitor").map((member) => member.id);
    if (!playerIds.length) return;
    if ((!activePlayerId || !playerIds.includes(activePlayerId)) && playerIds[0] === myId) {
      activePlayerIdRef.current = playerIds[0];
      setActivePlayerId(playerIds[0]);
      connRef.current?.setActivePlayer(playerIds[0]);
    }
  }, [activePlayerId, isVisitor, myId, roster]);

  const shareCard = useCallback((card) => {
    if (isVisitor || !card?.name) return;
    const at = Date.now();
    setChatMessages((messages) => [...messages.slice(-99), {
      id: `local-card-${myId}-${at}-${++chatIdRef.current}`,
      kind: "card",
      from: myId,
      name: session.name,
      card,
      at,
    }]);
    connRef.current?.announceCard(card, session.name, at);
  }, [isVisitor, myId, session.name]);

  const openCardPanel = useCallback(() => {
    setSidebarView("lookup");
    setSidebarCollapsed(false);
    setSidebarOpen(true);
  }, []);

  const persistRecognitionTiming = useCallback((timing, subjectId) => {
    // This upload is deliberately detached from the lookup result. Telemetry
    // must never make a player wait longer for a card or turn a successful
    // local recognition into a visible Supabase error.
    void saveRecognitionTiming({
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      roomCode: session.code,
      observerId: myId,
      subjectId,
      role: session.role,
      build: globalThis.__SNAP_BUILD || "",
      outgoingVideoQuality,
      visibilityState: typeof document === "undefined" ? "" : document.visibilityState,
      browserOnline: typeof navigator === "undefined" ? true : navigator.onLine !== false,
      ...timing,
    }).catch(() => {
      // Timing telemetry is diagnostic-only and may be unavailable when the
      // browser is offline or before its database migration has been applied.
    });
  }, [myId, outgoingVideoQuality, session.code, session.role]);

  // Flipped tiles pass reflected coordinates for capture while the click flash
  // stays where the player actually clicked.
  const identify = useCallback(async (tileId, videoEl, clientX, clientY, flipped = false) => {
    const conn = connRef.current;
    const pt = clickToNormalized(videoEl, clientX, clientY, flipped);
    if (!pt) return;
    const rect = videoEl.getBoundingClientRect();
    setFlash({ tileId, x: clientX - rect.left, y: clientY - rect.top });
    setTimeout(() => setFlash(null), 600);
    openCardPanel();
    const active = activeRecognitionRef.current;
    if (active && active.tileId === tileId) {
      const dx = active.nx - pt.nx;
      const dy = active.ny - pt.ny;
      // A second click on the same spot while its lookup is already running is
      // almost always impatience, not a request for another full worker job.
      if (dx * dx + dy * dy < 0.0016) return;
    }
    const requestId = ++latestRecognitionRequestRef.current;
    activeRecognitionRef.current = { requestId, tileId, nx: pt.nx, ny: pt.ny };
    const scanStartedAt = performance.now();
    let captureStartedAt = 0;
    let recognitionStartedAt = 0;
    let captureMs = 0;
    let captureChars = 0;
    let phase = "capture";
    setCurrent({ loading: true });
    try {
      // Captures are native-resolution crops around the clicked point (both
      // local and remote). The crop is clamped to stay inside the camera frame,
      // so the click is at the crop center only when it was far enough from an
      // edge — cap.px/py reports where it actually landed.
      captureStartedAt = performance.now();
      const cap = tileId === myId
        ? await captureLocalFrame(conn.localStream, pt.nx, pt.ny)
        : await conn.requestRemoteCapture(tileId, pt.nx, pt.ny);
      if (String(cap.url || "").startsWith("blob:")) {
        captureObjectUrlsRef.current.push(cap.url);
        while (captureObjectUrlsRef.current.length > 32) {
          URL.revokeObjectURL(captureObjectUrlsRef.current.shift());
        }
      }
      captureMs = Math.round(performance.now() - captureStartedAt);
      captureChars = Number(cap.bytes) || String(cap.url || "").length;
      phase = "recognition";
      recognitionStartedAt = performance.now();
      const hints = nearbyRecognitionHints(
        recognitionHintsRef.current,
        tileId,
        pt.nx,
        pt.ny,
      );
      const data = await identifyCard(cap.blob || cap.url, {
        nx: cap.px ?? 0.5,
        ny: cap.py ?? 0.5,
      }, {
        hints,
      });
      const recognitionMs = Math.round(performance.now() - recognitionStartedAt);
      const timing = {
        at: Date.now(),
        remote: tileId !== myId,
        captureMs,
        recognitionMs,
        totalMs: Math.round(performance.now() - scanStartedAt),
        stages: data.stage_ms || {},
        candidatesTried: data.candidates_tried || 0,
        isolationCandidates: data.isolation_candidates || 0,
        hintHit: !!data.hint_hit,
      };
      globalThis.__SNAP_RECOGNITION_TIMINGS = [
        ...(globalThis.__SNAP_RECOGNITION_TIMINGS || []).slice(-49),
        timing,
      ];
      persistRecognitionTiming({
        ...timing,
        outcome: data.matches?.length ? "matched" : "no-match",
        captureChars,
      }, tileId);
      const top = data.matches?.[0];
      if (isReusableRecognitionMatch(top)) {
        const hint = normalizeRecognitionHint({
          ownerId: tileId,
          nx: pt.nx,
          ny: pt.ny,
          at: Date.now(),
          card: top,
        });
        if (hint) {
          recognitionHintsRef.current = rememberRecognitionHint(recognitionHintsRef.current, hint);
          conn.announceRecognitionHint(hint);
        }
      }
      // A newer click supersedes this result. Keep its timing and reusable
      // hint, but never let an older queued scan replace the card the player
      // most recently asked for.
      if (requestId !== latestRecognitionRequestRef.current) return;
      setCurrent({
        matches: data.matches || [],
        cardFound: data.card_found,
        cvStatus: data.cv_status,
        candidatesTried: data.candidates_tried,
        cropsDropped: data.crops_dropped,
        ocrText: data.ocr_text,
        ocrConfidence: data.ocr_confidence,
        ocrRotation: data.ocr_rotation,
        ocrImage: data.ocr_image,
        artBest: data.art_best,
        artChecked: data.art_checked,
        titleScore: data.title_score,
        ocrError: data.ocr_error,
        metadataObservation: data.metadata_observation,
        metadataVetoed: data.metadata_vetoed,
        metadataConflictAll: data.metadata_conflict_all,
        metadataError: data.metadata_error,
        scanTiming: timing,
        captureImage: cap.url,
        captureContext: {
          tileId,
          tileName: rosterRef.current.find((member) => member.id === tileId)?.name || (tileId === myId ? session.name : "Player"),
          remote: tileId !== myId,
          click: { nx: pt.nx, ny: pt.ny },
          cropClick: { nx: cap.px ?? 0.5, ny: cap.py ?? 0.5 },
        },
        cameraRes: (() => {
          const s = conn.localStream?.getVideoTracks?.()[0]?.getSettings?.();
          return s?.width ? `${s.width}×${s.height}` : "";
        })(),
      });
      if (top && (top.identified_by === "ocr-title" || top.distance <= 170)) {
        // Recognition is a local inspection action. Cards enter Chat only
        // through the explicit Share card control in the Cards panel.
        setLookups((l) => [...l.slice(-11), { by: session.name, card: top, at: Date.now() }]);
      }
    } catch (e) {
      if (e?.code === "RECOGNITION_SUPERSEDED") return;
      const now = performance.now();
      if (phase === "capture" && captureStartedAt) {
        captureMs = Math.round(now - captureStartedAt);
      }
      const recognitionMs = phase === "recognition" && recognitionStartedAt
        ? Math.round(now - recognitionStartedAt)
        : 0;
      const message = String(e.message || e);
      const outcome = phase === "capture"
        ? (message === "Capture timed out" ? "capture-timeout" : "capture-error")
        : (message.startsWith("Card recognition timed out")
          ? "recognition-timeout"
          : "recognition-error");
      const timing = {
        at: Date.now(),
        remote: tileId !== myId,
        captureMs,
        recognitionMs,
        totalMs: Math.round(now - scanStartedAt),
        error: message,
      };
      globalThis.__SNAP_RECOGNITION_TIMINGS = [
        ...(globalThis.__SNAP_RECOGNITION_TIMINGS || []).slice(-49),
        timing,
      ];
      persistRecognitionTiming({
        ...timing,
        error: undefined,
        outcome,
        captureChars,
      }, tileId);
      if (requestId === latestRecognitionRequestRef.current) setCurrent({ error: message });
    } finally {
      if (activeRecognitionRef.current?.requestId === requestId) {
        activeRecognitionRef.current = null;
      }
    }
  }, [myId, openCardPanel, persistRecognitionTiming, session.name]);

  // Clicking an opponent's commander name does a plain text lookup (same
  // Scryfall path as the sidebar search box) rather than the visual capture
  // pipeline, so it works without needing to click their video.
  const lookupCommanderName = useCallback(async (name) => {
    const cardName = String(name || "").trim();
    if (!cardName) return;
    openCardPanel();
    setCurrent({ loading: true });
    try {
      const result = await fetchCardByName(cardName);
      if (!result) throw new Error("Card not found");
      const card = cardFromScryfall(result);
      setCurrent({ matches: [card] });
      setLookups((l) => [...l.slice(-11), { by: session.name, card, at: Date.now() }]);
    } catch (e) {
      setCurrent({ error: String(e.message || e) });
    }
  }, [openCardPanel, session.name]);

  const openCounters = () => {
    setSidebarView("counters");
    setSidebarOpen(true);
  };

  const changeLife = (delta) => {
    if (isVisitor) return;
    const previous = livesRef.current[myId] ?? lives[myId] ?? 40;
    const life = Math.max(0, previous + delta);
    if (life === previous) return;
    livesRef.current = { ...livesRef.current, [myId]: life };
    setLives((l) => ({ ...l, [myId]: life }));
    queueLifeChat(myId, session.name, previous, life);
    connRef.current.setLife(life);
  };

  const sendChat = (value) => {
    const payload = typeof value === "string" ? { text: value } : (value || {});
    const text = String(payload.text || "").trim().slice(0, 500);
    const soundId = getSoundEffect(payload.soundId)?.id || "";
    if (!text && !soundId) return { ok: false, error: "Write a message or choose a sound." };
    if (!myId) return { ok: false, error: "Chat is still connecting." };
    const at = Date.now();
    if (payload.kind === "whisper") {
      if (soundId) return { ok: false, error: "Sound effects are shared with everyone, not sent as whispers." };
      const target = rosterRef.current.find((member) => member.id === payload.targetId && member.id !== myId);
      if (!target) return { ok: false, error: "That person is no longer in the game." };
      if (!connRef.current?.sendWhisper(target.id, text, at)) {
        return { ok: false, error: `Private connection to @${target.name} is not ready yet.` };
      }
      setChatMessages((messages) => [...messages.slice(-99), {
        id: `local-${myId}-${at}-${++chatIdRef.current}`,
        from: myId,
        name: session.name,
        text,
        at,
        whisper: true,
        to: target.id,
        toName: target.name,
      }]);
      return { ok: true };
    }
    if (soundId && at < soundCooldownUntil) {
      const seconds = Math.ceil((soundCooldownUntil - at) / 1000);
      return { ok: false, error: `Wait ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} before sending another sound.` };
    }
    if (soundId) {
      recentSoundBySenderRef.current[myId] = at;
      setSoundCooldownUntil(at + SOUND_COOLDOWN_MS);
      playSoundEffect(soundId, 1);
    }
    setChatMessages((messages) => [...messages.slice(-99), {
      id: `local-${myId}-${at}-${++chatIdRef.current}`,
      from: myId,
      name: session.name,
      text,
      soundId,
      at,
    }]);
    connRef.current?.sendChat(text, at, soundId);
    return { ok: true };
  };

  const rollDie = (requestedSides) => {
    if (isVisitor || !myId) return;
    const sides = Math.max(2, Math.min(20, Number(requestedSides) || 20));
    const value = Math.floor(Math.random() * sides) + 1;
    const at = Date.now();
    const entry = {
      id: `local-dice-${myId}-${at}-${++chatIdRef.current}`,
      kind: "dice",
      from: myId,
      name: session.name,
      value,
      sides,
      at,
    };
    setChatMessages((messages) => [...messages.slice(-99), entry]);
    showDiceOverlay(entry);
    connRef.current?.sendDiceRoll(value, sides, at);
  };

  const generateVideoCounter = (typeId) => {
    const type = getVideoCounterType(typeId);
    if (!type || !myId || isVisitor) return;
    setCounterDraft({
      id: crypto.randomUUID?.() || `counter-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: type.id,
    });
  };

  const upsertOwnVideoCounter = (counter) => {
    const safeCounter = normalizeVideoCounter(counter);
    if (!safeCounter || !myId || isVisitor) return;
    setVideoCounters((counters) => {
      const mine = counters[myId] || [];
      const exists = mine.some((item) => item.id === safeCounter.id);
      return {
        ...counters,
        [myId]: (exists
          ? mine.map((item) => item.id === safeCounter.id ? safeCounter : item)
          : [...mine, safeCounter]).slice(-24),
      };
    });
    connRef.current?.setVideoCounter(safeCounter);
  };

  const placeOwnVideoCounter = (draggedCounter, x, y) => {
    const type = getVideoCounterType(draggedCounter?.type);
    if (!type || !draggedCounter?.id) return;
    const existing = (videoCounters[myId] || []).find((counter) => counter.id === draggedCounter.id);
    upsertOwnVideoCounter({
      id: draggedCounter.id,
      type: type.id,
      x,
      y,
      value: existing?.value ?? (type.adjustable ? 1 : 0),
      zeroSince: existing?.zeroSince || 0,
    });
    if (draggedCounter.source === "generator") setCounterDraft(null);
  };

  const previewOwnVideoCounter = (draggedCounter, x, y) => {
    const type = getVideoCounterType(draggedCounter?.type);
    if (!type) return;
    setVideoCounterDragPreview({ type: type.id, x, y });
  };

  useEffect(() => {
    if (!counterPointerDrag) return undefined;
    const dropPointAt = (event) => {
      const target = document.querySelector('[data-counter-drop-target="true"]');
      const rect = target?.getBoundingClientRect();
      if (!rect || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return null;
      return {
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.height,
      };
    };
    const move = (event) => {
      const point = dropPointAt(event);
      if (point) previewOwnVideoCounter(counterPointerDrag, point.x, point.y);
      else setVideoCounterDragPreview(null);
    };
    const finish = (event) => {
      const point = dropPointAt(event);
      if (point) placeOwnVideoCounter(counterPointerDrag, point.x, point.y);
      setCounterPointerDrag(null);
      setVideoCounterDragPreview(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [counterPointerDrag]);

  const changeOwnVideoCounter = (counterId, delta) => {
    const counter = (videoCounters[myId] || []).find((item) => item.id === counterId);
    const type = getVideoCounterType(counter?.type);
    if (!counter || !type?.adjustable) return;
    const value = Math.max(0, Math.min(99, counter.value + delta));
    upsertOwnVideoCounter({
      ...counter,
      value,
      zeroSince: value === 0 ? Date.now() : 0,
    });
  };

  const removeOwnVideoCounter = (counterId) => {
    if (!myId) return;
    setVideoCounters((counters) => ({
      ...counters,
      [myId]: (counters[myId] || []).filter((counter) => counter.id !== counterId),
    }));
    connRef.current?.removeVideoCounter(counterId);
  };

  useEffect(() => {
    if (!myId) return undefined;
    const zeroCounters = (videoCounters[myId] || []).filter((counter) => (
      getVideoCounterType(counter.type)?.adjustable && counter.value === 0 && counter.zeroSince
    ));
    if (!zeroCounters.length) return undefined;
    const nextExpiry = Math.min(...zeroCounters.map((counter) => counter.zeroSince + 10000));
    const timer = window.setTimeout(() => {
      const now = Date.now();
      const expiredIds = new Set(zeroCounters
        .filter((counter) => counter.zeroSince + 10000 <= now)
        .map((counter) => counter.id));
      if (!expiredIds.size) return;
      setVideoCounters((counters) => ({
        ...counters,
        [myId]: (counters[myId] || []).filter((counter) => !expiredIds.has(counter.id)),
      }));
      expiredIds.forEach((counterId) => connRef.current?.removeVideoCounter(counterId));
    }, Math.max(0, nextExpiry - Date.now()));
    return () => window.clearTimeout(timer);
  }, [myId, videoCounters]);

  const passTurn = useCallback(() => {
    if (isVisitor) return;
    const playerIds = roster.filter((member) => member.role !== "visitor").map((member) => member.id);
    if (!playerIds.length) return;
    const currentId = activePlayerId || playerIds[0];
    if (currentId !== myId) return;
    const currentIndex = Math.max(0, playerIds.indexOf(currentId));
    let nextId = "";
    for (let offset = 1; offset <= playerIds.length; offset++) {
      const candidateId = playerIds[(currentIndex + offset) % playerIds.length];
      const candidateLife = livesRef.current[candidateId] ?? 40;
      if (candidateLife > 0 && !eliminationsRef.current[candidateId]) {
        nextId = candidateId;
        break;
      }
    }
    if (!nextId) return;
    const nextMembershipId = roster.find((member) => member.id === nextId)?.membershipId;
    if (durableSessionId && nextMembershipId) {
      recordGameTurn({
        sessionId: durableSessionId,
        membershipId: session.membershipId,
        participantToken: session.participantToken,
        nextMembershipId,
      }).catch((turnError) => {
        setError(String(turnError?.message || "This turn timing could not be recorded."));
      });
    }
    activePlayerIdRef.current = nextId;
    setActivePlayerId(nextId);
    connRef.current?.setActivePlayer(nextId);
  }, [activePlayerId, durableSessionId, isVisitor, myId, roster, session.membershipId, session.participantToken]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.code !== "Space" && event.key !== " ") || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement
        && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) return;
      const playerIds = roster.filter((member) => member.role !== "visitor").map((member) => member.id);
      const currentId = activePlayerId || playerIds[0];
      if (isVisitor || !myId || currentId !== myId) return;
      event.preventDefault();
      passTurn();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [activePlayerId, isVisitor, myId, passTurn, roster]);

  const chooseLobbyName = (next) => {
    if (isVisitor) return;
    const name = next.trim().slice(0, 48);
    if (!name) return;
    setLobbyName(name);
    connRef.current?.setLobbyName(name);
  };

  const chooseCommander = async (commander, partner = "") => {
    if (isVisitor) return;
    try {
      const selection = await validateGameCommanderSelection({
        membershipId: session.membershipId,
        participantToken: session.participantToken,
        commanderName: commander,
        partnerName: partner || null,
      });
      const commanderName = selection.commander.name;
      const partnerName = selection.partner?.name || "";
      const partnerTypeLine = selection.partner?.typeLine || "";
      setCommanders((values) => ({ ...values, [myId]: commanderName }));
      setCommanderPartners((values) => ({ ...values, [myId]: partnerName }));
      setCommanderPartnerTypes((values) => ({ ...values, [myId]: partnerTypeLine }));
      connRef.current?.setCommander(commanderName);
      connRef.current?.setCommanderPartner(partnerName, partnerTypeLine);
      connRef.current?.requestMembershipRefresh();
    } catch (selectionError) {
      setError(String(selectionError?.message || "Commander selection could not be validated."));
    }
  };

  const chooseCommanderPartner = async (partner) => {
    if (isVisitor) return;
    const name = String(partner || "").trim();
    if (!name) return;
    try {
      const selection = await validateGameCommanderSelection({
        membershipId: session.membershipId,
        participantToken: session.participantToken,
        commanderName: commanders[myId] || "",
        partnerName: name,
      });
      const commanderName = selection.commander.name;
      const partnerName = selection.partner?.name || "";
      const typeLine = selection.partner?.typeLine || "";
      setCommanders((values) => ({ ...values, [myId]: commanderName }));
      setCommanderPartners((values) => ({ ...values, [myId]: partnerName }));
      setCommanderPartnerTypes((values) => ({ ...values, [myId]: typeLine }));
      connRef.current?.setCommander(commanderName);
      connRef.current?.setCommanderPartner(partnerName, typeLine);
      connRef.current?.requestMembershipRefresh();
    } catch (selectionError) {
      setError(String(selectionError?.message || "Commander partner could not be validated."));
    }
  };

  const chooseColor = (color) => {
    if (isVisitor) return;
    setColors((values) => ({ ...values, [myId]: color }));
    connRef.current?.setColor(color);
  };

  const chooseVideoLayout = (layout) => {
    const next = ["tiles", "follow", "hero"].includes(layout) ? layout : "tiles";
    setVideoLayout(next);
    try { localStorage.setItem("snapcast-video-layout", next); } catch { /* preference remains in memory */ }
  };

  const chooseVideoFit = (fit) => {
    const next = ["cover", "16:9"].includes(fit) ? fit : "cover";
    setVideoFit(next);
    try { localStorage.setItem("snapcast-video-fit", next); } catch { /* preference remains in memory */ }
  };

  const saveRecognitionReports = (next) => {
    setRecognitionReports(next);
    // The durable copies are in Supabase Storage. Keep only the small report
    // index and its edit token locally, not a second large camera-image cache.
    try {
      const localIndex = next.slice(-100).map(({ captureImage, ocrImage, ...entry }) => entry);
      localStorage.setItem("snapcast-recognition-reports", JSON.stringify(localIndex));
    } catch { /* Supabase save still works for this session */ }
  };

  const addRecognitionReport = async (report) => {
    if (!report?.id) return false;
    const pending = { ...report, syncStatus: "saving" };
    saveRecognitionReports([...recognitionReports.filter((entry) => entry.id !== report.id), pending]);
    try {
      const stored = await saveRecognitionReport({
        ...report,
        roomCode: session.code,
        reporterId: myId,
        reporterName: session.name,
      });
      setRecognitionReports((reports) => {
        const next = reports.map((entry) => entry.id === report.id
          ? { ...entry, ...stored, syncStatus: "saved" }
          : entry);
        try {
          const localIndex = next.slice(-100).map(({ captureImage, ocrImage, ...entry }) => entry);
          localStorage.setItem("snapcast-recognition-reports", JSON.stringify(localIndex));
        } catch { /* report remains in memory */ }
        return next;
      });
      return true;
    } catch (error) {
      setRecognitionReports((reports) => reports.map((entry) => entry.id === report.id
        ? { ...entry, syncStatus: "error", syncError: String(error.message || error) }
        : entry));
      return false;
    }
  };

  const updateRecognitionReport = async (id, truth) => {
    const report = recognitionReports.find((entry) => entry.id === id);
    if (!report?.editToken) return false;
    try {
      await labelRecognitionReport(id, report.editToken, truth);
      saveRecognitionReports(recognitionReports.map((entry) => entry.id === id
        ? { ...entry, truth, labeledAt: Date.now(), syncStatus: "saved" }
        : entry));
      return true;
    } catch (error) {
      saveRecognitionReports(recognitionReports.map((entry) => entry.id === id
        ? { ...entry, syncStatus: "error", syncError: String(error.message || error) }
        : entry));
      return false;
    }
  };

  const finishReadyCheck = useCallback((outcome, announce = true, byId = myId, checkId = readyCheckRef.current?.checkId) => {
    const currentCheck = readyCheckRef.current;
    if (!currentCheck || !checkId || currentCheck.checkId !== checkId) return;
    readyCheckRef.current = null;
    setReadyCheck(null);
    const at = Date.now();
    const player = rosterRef.current.find((member) => member.id === byId);
    if (!announce && byId !== myIdRef.current) notifyIncomingChat();
    setChatMessages((messages) => [...messages.slice(-99), {
      id: `ready-${checkId}-${at}-${++chatIdRef.current}`,
      kind: "ready",
      from: outcome === "ready" || outcome === "timeout" ? "" : (byId || ""),
      name: outcome === "ready" || outcome === "timeout" ? "" : (player?.name || "Player"),
      system: outcome === "ready" || outcome === "timeout",
      outcome,
      at,
    }]);
    if (announce) connRef.current?.endReadyCheck(checkId, outcome);
  }, [myId, notifyIncomingChat, session.name]);

  const randomizeGrid = useCallback(() => {
    if (!isGameOwner || !myId) return;
    const ids = rosterRef.current.filter((member) => member.role !== "visitor").map((member) => member.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    setGridOrder(ids);
    connRef.current?.setGridOrder(ids);
  }, [isGameOwner, myId]);

  const startReadyCheck = useCallback(() => {
    if (!isGameOwner || !myId || readyCheckRef.current) return;
    const playerIds = rosterRef.current.filter((member) => member.role !== "visitor");
    if (!playerIds.length) return;
    const check = {
      checkId: `${myId}-${Date.now()}`,
      expiresAt: Date.now() + 10000,
      responses: {},
    };
    readyCheckRef.current = check;
    setReadyCheck(check);
    connRef.current?.startReadyCheck(check.checkId, check.expiresAt);
  }, [isGameOwner, myId]);

  const respondReady = useCallback((ready) => {
    const currentCheck = readyCheckRef.current;
    if (!currentCheck || !myId) return;
    const next = {
      ...currentCheck,
      responses: { ...currentCheck.responses, [myId]: !!ready },
    };
    readyCheckRef.current = next;
    setReadyCheck(next);
    connRef.current?.respondReady(currentCheck.checkId, ready);
  }, [myId]);

  const changePoison = (delta) => {
    if (isVisitor || !myId) return;
    const value = Math.max(0, Math.min(99, (poisonCounters[myId] || 0) + delta));
    setPoisonCounters((values) => ({ ...values, [myId]: value }));
    connRef.current?.setPoison(value);
  };

  const changeCommanderDamage = (attackerId, delta) => {
    if (isVisitor || !myId || !attackerId || attackerId === myId) return;
    const previousDamage = commanderDamage[myId]?.[attackerId] || 0;
    const value = Math.max(0, Math.min(99, previousDamage + delta));
    const appliedDamage = value - previousDamage;
    if (!appliedDamage) return;
    commanderDamageRef.current = {
      ...commanderDamageRef.current,
      [myId]: { ...(commanderDamageRef.current[myId] || {}), [attackerId]: value },
    };
    setCommanderDamage((values) => ({
      ...values,
      [myId]: { ...(values[myId] || {}), [attackerId]: value },
    }));
    // Commander damage is damage received: adding it lowers life, while
    // correcting it downward restores the corresponding life total.
    const previousLife = livesRef.current[myId] ?? lives[myId] ?? 40;
    const life = Math.max(0, previousLife - appliedDamage);
    livesRef.current = { ...livesRef.current, [myId]: life };
    setLives((values) => ({ ...values, [myId]: life }));
    const isPartner = attackerId.startsWith("p:");
    const attackerPlayerId = isPartner ? attackerId.slice(2) : attackerId;
    const commanderName = (isPartner ? commanderPartners[attackerPlayerId] : commanders[attackerPlayerId])
      || PREVIEW_COMMANDER_NAMES[attackerPlayerId]
      || "Commander";
    queueLifeChat(
      myId,
      session.name,
      previousLife,
      life,
      appliedDamage > 0 ? "commander-damage" : "life",
      false,
      { name: commanderName, previous: previousDamage, value },
    );
    connRef.current?.setLife(life);
    connRef.current?.setCommanderDamage(attackerId, value, commanderName);
  };

  const toggleMic = () => {
    const next = !micOn;
    connRef.current.toggleTrack("audio", next);
    setMicOn(next);
    setMutedPlayers((values) => ({ ...values, [myId]: !next }));
    connRef.current?.setMuted(!next);
  };

  const toggleCam = () => {
    if (isVisitor) return;
    const next = !camOn;
    connRef.current.toggleTrack("video", next);
    setCamOn(next);
    setCameraEnabledByPlayer((values) => ({ ...values, [myId]: next }));
    connRef.current?.setCameraEnabled(next);
  };

  const chooseCamera = async (deviceId) => {
    if (!deviceId || deviceId === videoDeviceId) return;
    setDeviceError("");
    try {
      await connRef.current.switchDevice("video", deviceId);
      setVideoDeviceId(deviceId);
      // Nudge React so the local <video> rebinds if the stream identity changed.
      setLocalStream(connRef.current.localStream);
    } catch (e) {
      setDeviceError(String(e.message || e));
    }
  };

  const chooseMic = async (deviceId) => {
    if (!deviceId || deviceId === audioDeviceId) return;
    setDeviceError("");
    try {
      await connRef.current.switchDevice("audio", deviceId);
      setAudioDeviceId(deviceId);
    } catch (e) {
      setDeviceError(String(e.message || e));
    }
  };

  const chooseVideoQuality = useCallback((playerId, quality) => {
    if (!playerId || !RECEIVER_VIDEO_QUALITY_VALUES.includes(quality)) return;
    setVideoQualityByPlayer((values) => ({ ...values, [playerId]: quality }));
  }, []);

  const chooseOutgoingVideoQuality = useCallback(async (quality) => {
    const next = normalizeOutgoingVideoQuality(quality);
    setOutgoingVideoQuality(next);
    try {
      localStorage.setItem("snapcast-outgoing-video-quality", next);
    } catch { /* preference still applies for this session */ }
    setDeviceError("");
    try {
      await connRef.current?.setOutgoingVideoQuality(next);
    } catch (qualityError) {
      setDeviceError(String(qualityError?.message || qualityError));
    }
  }, []);

  const makeJoinLink = (visitor = false) => {
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("code", session.code);
    if (visitor) url.searchParams.set("visitor", "1");
    return url.toString();
  };

  const copyText = async (value) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const input = document.createElement("input");
      input.value = value;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
  };

  const copyJoinLink = async (visitor = false) => {
    await copyText(makeJoinLink(visitor));
    const setter = visitor ? setVisitorLinkCopied : setLinkCopied;
    setter(true);
    setTimeout(() => setter(false), 1600);
  };

  const copyGameCode = async () => {
    await copyText(session.code);
    setGameCodeCopied(true);
    setTimeout(() => setGameCodeCopied(false), 1600);
  };

  const leaveExplicitly = async () => {
    try {
      await connRef.current?.leaveIntentionally?.();
      if (!isLocalMock) {
        await leaveGameRoom({
          membershipId: session.membershipId,
          participantToken: session.participantToken,
        });
      }
      connRef.current?.requestMembershipRefresh();
    } catch {
      // Leaving the local media room must remain available if persistence is
      // temporarily unavailable. The stale membership expires from discovery.
    }
    connRef.current?.close();
    if (!isLocalMock && account && durableSessionId) {
      setLeaveAfterReview(true);
      setReviewSessionId(durableSessionId);
    } else {
      onLeave();
    }
  };

  const startManagedGame = async () => {
    if (isLocalMock) {
      setDurableSessionId(`mock-session-${session.code}`);
      setGameStatus("live");
      gameStatusRef.current = "live";
      return;
    }
    const result = await startDurableGame({ gameId: session.gameId, ownerToken: activeOwnerToken });
    setDurableSessionId(result.session_id);
    setGameStatus("live");
    gameStatusRef.current = "live";
  };

  const durableCommanderDamage = (victimId) => Object.fromEntries(
    Object.entries(commanderDamage[victimId] || {}).flatMap(([attackerId, value]) => {
      const attackerMembershipId = roster.find((member) => member.id === attackerId)?.membershipId;
      return attackerMembershipId ? [[attackerMembershipId, value]] : [];
    }),
  );

  const persistMyElimination = (reason) => {
    if (isLocalMock || !durableSessionId || !session.membershipId || !myId) return;
    recordGameElimination({
      sessionId: durableSessionId,
      membershipId: session.membershipId,
      participantToken: session.participantToken,
      reason,
      finalLife: lives[myId] ?? 40,
      finalPoison: poisonCounters[myId] ?? 0,
      finalCommanderDamage: durableCommanderDamage(myId),
    }).catch((eliminationError) => {
      setError(String(eliminationError?.message || "Your elimination details could not be recorded."));
    });
  };

  const manageMember = async (participant, action) => {
    if (!participant.membershipId) throw new Error("That participant is still connecting.");
    if (isLocalMock) {
      if (action === "remove") {
        setRoster((members) => members.filter((member) => member.membershipId !== participant.membershipId));
      } else {
        setRoomMutedMemberships((values) => ({
          ...values,
          [participant.membershipId]: action === "mute",
        }));
      }
      return;
    }
    await manageGameMember({
      gameId: session.gameId,
      ownerToken: activeOwnerToken,
      membershipId: participant.membershipId,
      action,
    });
    if (action === "remove") {
      setRoster((members) => members.filter((member) => member.membershipId !== participant.membershipId));
      connRef.current?.requestMembershipRefresh();
      const membership = await touchGameMembership({
        membershipId: session.membershipId,
        participantToken: session.participantToken,
      });
      if (membership.realtime_epoch) {
        realtimeEpochRef.current = membership.realtime_epoch;
        await connRef.current?.rotateRealtimeEpoch(membership.realtime_epoch);
      }
    } else {
      setRoomMutedMemberships((values) => ({
        ...values,
        [participant.membershipId]: action === "mute",
      }));
    }
  };

  const endManagedGame = async ({ resultKind, winnerMembershipId }) => {
    const playerSnapshot = roster
      .filter((member) => member.role !== "visitor" && member.membershipId)
      .map((member) => ({
        membership_id: member.membershipId,
        result: resultKind === "winner" && member.membershipId !== winnerMembershipId
          ? (eliminations[member.id] === "concede" ? "conceded" : "loss")
          : "unknown",
        loss_reason: eliminations[member.id] || null,
        life: lives[member.id] ?? 40,
        poison: poisonCounters[member.id] ?? 0,
        commander_damage: durableCommanderDamage(member.id),
      }));
    if (!isLocalMock) {
      await endDurableGame({
        gameId: session.gameId,
        ownerToken: activeOwnerToken,
        resultKind,
        winnerMembershipId,
        finalSnapshot: { players: playerSnapshot },
      });
    }
    setGameStatus("finished");
    gameStatusRef.current = "finished";
    setGameManagementOpen(false);
    if (!isLocalMock && account && durableSessionId) setReviewSessionId(durableSessionId);
  };

  const restartManagedGame = async () => {
    if (!window.confirm("Restart the table? Current game state will be preserved as unresolved if it has started.")) return;
    if (!isLocalMock) await restartDurableGame({ gameId: session.gameId, ownerToken: activeOwnerToken });
    resetTableState();
    setGameManagementOpen(false);
  };

  const players = roster.filter((p) => p.role !== "visitor").slice(0, 6);
  const visitors = roster.filter((p) => p.role === "visitor").map((visitor) => ({
    ...visitor,
    roomMuted: Boolean(roomMutedMemberships[visitor.membershipId]),
  }));
  const resolvedActivePlayerId = activePlayerId || players[0]?.id || "";

  useEffect(() => {
    const remotePlayers = roster.filter((member) => (
      member.role !== "visitor" && member.id !== myId
    ));
    const playerIds = roster.filter((member) => member.role !== "visitor").map((member) => member.id);
    const activeId = activePlayerId || playerIds[0] || "";
    const heroId = playerIds.includes(heroPlayerId) ? heroPlayerId : activeId;
    const applyQuality = () => {
      const liveIds = new Set(remotePlayers.map((player) => player.id));
      for (const id of requestedVideoQualityRef.current.keys()) {
        if (!liveIds.has(id)) requestedVideoQualityRef.current.delete(id);
      }
      for (const player of remotePlayers) {
        const preferred = videoQualityByPlayer[player.id] || "auto";
        const isPrimary = videoLayout === "tiles"
          || (videoLayout === "follow" ? player.id === activeId : player.id === heroId);
        const quality = resolveAdaptiveReceiverQuality({
          preferred,
          layout: videoLayout,
          isPrimary,
          hidden: document.hidden,
        });
        const stream = streams[player.id] || null;
        const previous = requestedVideoQualityRef.current.get(player.id);
        if (previous?.quality === quality && previous?.stream === stream) continue;
        if (connRef.current?.requestVideoQuality(player.id, quality)) {
          requestedVideoQualityRef.current.set(player.id, { quality, stream });
        }
      }
    };
    applyQuality();
    document.addEventListener("visibilitychange", applyQuality);
    return () => document.removeEventListener("visibilitychange", applyQuality);
  }, [activePlayerId, heroPlayerId, myId, roster, streams, videoLayout, videoQualityByPlayer]);

  const sidebarChatRecipients = useMemo(
    () => roster.filter((member) => member.id !== myId),
    [myId, roster],
  );
  const counterPlayers = useMemo(() => [...players]
    .sort((a, b) => Number(b.id === myId) - Number(a.id === myId))
    .map((player, index) => ({
      ...player,
      isMe: player.id === myId,
      color: colors[player.id] || TILE_COLORS[index % TILE_COLORS.length],
      commander: commanders[player.id] || "",
      commanderPartner: commanderPartners[player.id] || "",
      commanderPartnerType: commanderPartnerTypes[player.id] || "",
      poison: poisonCounters[player.id] || 0,
      commanderDamage: commanderDamage[player.id] || {},
    })), [
    colors,
    commanderDamage,
    commanderPartnerTypes,
    commanderPartners,
    commanders,
    myId,
    poisonCounters,
    roster,
  ]);
  const counterPreviewPlayers = useMemo(() => (
    import.meta.env.DEV && counterPlayers.length === 1
      ? [
        {
          ...counterPlayers[0],
          commanderDamage: {
            "preview-maya": 6,
            "p:preview-maya": 4,
            "preview-drew": 12,
            "preview-sam": 0,
            ...counterPlayers[0].commanderDamage,
          },
        },
        { id: "preview-maya", name: "Maya", color: TILE_COLORS[1], commander: "Atraxa, Praetors’ Voice", commanderPartner: "Tymna the Weaver", commanderPartnerType: "Legendary Creature — Human Cleric", poison: 0, commanderDamage: {}, isMe: false },
        { id: "preview-drew", name: "Drew", color: TILE_COLORS[2], commander: "The Ur-Dragon", commanderPartner: "Feywild Visitor", commanderPartnerType: "Legendary Enchantment — Background", poison: 2, commanderDamage: {}, isMe: false },
        { id: "preview-sam", name: "Sam", color: TILE_COLORS[3], commander: "Muldrotha, the Gravetide", poison: 0, commanderDamage: {}, isMe: false },
      ]
      : counterPlayers
  ), [counterPlayers]);
  const sidebarChatNameColors = useMemo(
    () => Object.fromEntries(counterPlayers.map((player) => [player.id, player.color])),
    [counterPlayers],
  );

  const orderedPlayers = [...players].sort((a, b) => {
    const ai = gridOrder.indexOf(a.id);
    const bi = gridOrder.indexOf(b.id);
    if (ai < 0 && bi < 0) return a.joinedAt - b.joinedAt;
    if (ai < 0) return 1;
    if (bi < 0) return -1;
    return ai - bi;
  });
  const tiles = orderedPlayers.map((p, i) => ({
    ...p,
    life: lives[p.id] ?? 40,
      commander: commanders[p.id] || "",
      commanderPartner: commanderPartners[p.id] || "",
    color: colors[p.id] || TILE_COLORS[i % TILE_COLORS.length],
    muted: !!mutedPlayers[p.id],
    stream: p.id === myId ? localStream : streams[p.id],
    isMe: p.id === myId,
    activeTurn: p.id === resolvedActivePlayerId,
    reconnecting: !!reconnectingPlayers[p.id],
  }));
  const displayedSeatLimit = Math.max(2, Math.min(6, Number(session.seatLimit) || 4));
  while (tiles.length < displayedSeatLimit) tiles.push({ id: `empty-${tiles.length}`, empty: true });
  const resolvedHeroPlayerId = tiles.some((tile) => !tile.empty && tile.id === heroPlayerId)
    ? heroPlayerId
    : resolvedActivePlayerId;
  const heroTile = tiles.find((tile) => tile.id === resolvedHeroPlayerId) || tiles[0];
  const visibleTiles = videoLayout === "follow"
    ? [tiles.find((tile) => tile.id === resolvedActivePlayerId) || tiles[0]]
    : videoLayout === "hero"
      ? [heroTile, ...tiles.filter((tile) => tile.id !== heroTile.id)]
      : tiles;
  const myColor = colors[myId] || TILE_COLORS[Math.max(0, players.findIndex((p) => p.id === myId))] || TILE_COLORS[0];
  const managementParticipants = roster.map((participant, index) => ({
    ...participant,
    isMe: participant.id === myId,
    color: participant.role === "visitor"
      ? "#a5a7ad"
      : colors[participant.id] || TILE_COLORS[index % TILE_COLORS.length],
    commander: commanders[participant.id] || "",
    commanderPartner: commanderPartners[participant.id] || "",
    muted: !!mutedPlayers[participant.id],
    cameraOn: participant.role !== "visitor" && cameraEnabledByPlayer[participant.id] !== false,
    reconnecting: !!reconnectingPlayers[participant.id],
  }));

  if (error) {
    return (
      <div className="lobby">
        <h2>Something went wrong</h2>
        <p className="error">{error}</p>
        <button onClick={leaveExplicitly}>Back to lobby</button>
      </div>
    );
  }

  return (
    <div className="game">
      {visitors
        .filter((visitor) => visitor.id !== myId && streams[visitor.id])
        .map((visitor) => (
          <RemoteAudio key={visitor.id} stream={streams[visitor.id]} muted={mutedPlayers[visitor.id]} />
        ))}
      {videoLayout === "follow" && players
        .filter((player) => player.id !== resolvedActivePlayerId && player.id !== myId && streams[player.id])
        .map((player) => (
          <RemoteAudio key={`follow-audio-${player.id}`} stream={streams[player.id]} />
        ))}

      <div className="main">
        <StableCardSidebar
            current={current}
            lookups={lookups}
            recognitionReports={recognitionReports}
            onAddRecognitionReport={addRecognitionReport}
            onUpdateRecognitionReport={updateRecognitionReport}
            chatMessages={chatMessages}
            currentUserId={myId}
            chatRecipients={sidebarChatRecipients}
            chatParticipants={roster}
            chatNameColors={sidebarChatNameColors}
            onSendChat={sendChat}
            soundCooldownUntil={soundCooldownUntil}
            onPreviewSound={(soundId, onError) => {
              return playSoundEffect(soundId, 1, onError);
            }}
            onRollDie={rollDie}
            counterDraft={counterDraft}
            onGenerateVideoCounter={generateVideoCounter}
            onStartVideoCounterDrag={setCounterPointerDrag}
            onPick={(m) => setCurrent({
              // A card chosen from chat is an explicit user selection, not a
              // recognizer guess, so it should always render in the Cards tab.
              matches: [{ ...m, identified_by: m.identified_by || "search", distance: m.distance ?? 0 }],
            })}
            onShareCard={shareCard}
            onSearch={(cardOrError) => {
              if (cardOrError.error) {
                setCurrent({ error: cardOrError.error });
                return;
              }
              setCurrent({ matches: [cardOrError] });
              setLookups((l) => [...l.slice(-11), { by: session.name, card: cardOrError, at: Date.now() }]);
            }}
            onClose={() => setSidebarClosing(true)}
            closing={sidebarClosing}
            onClosed={() => {
              setSidebarClosing(false);
              setSidebarCollapsed(true);
            }}
            collapsed={sidebarCollapsed}
            onOpen={() => {
              setSidebarCollapsed(false);
              setSidebarOpen(true);
            }}
            view={sidebarView}
            onViewChange={setSidebarView}
            isVisitor={isVisitor}
            camOn={camOn}
            micOn={micOn}
            cameras={cameras}
            mics={mics}
            videoDeviceId={videoDeviceId}
            audioDeviceId={audioDeviceId}
            deviceError={deviceError}
            myColor={myColor}
            tileColors={TILE_COLORS}
            themePreference={themePreference}
            onThemePreferenceChange={onThemePreferenceChange}
            chatNotificationsEnabled={chatNotificationsEnabled}
            onChatNotificationsChange={chooseChatNotifications}
            turnNotificationsEnabled={turnNotificationsEnabled}
            onTurnNotificationsChange={chooseTurnNotifications}
            videoLayout={videoLayout}
            onVideoLayoutChange={chooseVideoLayout}
            videoFit={videoFit}
            onVideoFitChange={chooseVideoFit}
            outgoingVideoQuality={outgoingVideoQuality}
            onOutgoingVideoQualityChange={chooseOutgoingVideoQuality}
            counterPlayers={counterPreviewPlayers}
            onChangePoison={changePoison}
            onChangeCommanderDamage={changeCommanderDamage}
            onToggleCam={toggleCam}
            onToggleMic={toggleMic}
            onChooseCamera={chooseCamera}
            onChooseMic={chooseMic}
            onChooseColor={chooseColor}
            linkCopied={linkCopied}
            visitorLinkCopied={visitorLinkCopied}
            gameCodeCopied={gameCodeCopied}
            gameCode={session.code}
            playerLink={makeJoinLink(false)}
            visitorLink={makeJoinLink(true)}
            onCopyPlayerLink={() => copyJoinLink(false)}
            onCopyVisitorLink={() => copyJoinLink(true)}
            onCopyGameCode={copyGameCode}
            lobbyName={lobbyName || "Untitled game"}
            onRenameLobby={chooseLobbyName}
            onLeave={leaveExplicitly}
            isCreator={!!session.creator}
            managementParticipants={managementParticipants}
          />
        <div className="video-panel">
          {isGameOwner && activeOwnerToken && (
            <button
              className="game-management-trigger"
              type="button"
              onClick={() => setGameManagementOpen(true)}
            >
              <Crown size={16} />
              Manage game
              <span className={`game-status-badge ${gameStatus}`}>{gameStatus === "live" ? "Live" : gameStatus === "lobby" ? "Lobby" : "Finished"}</span>
            </button>
          )}
          {!isVisitor && myId && gameStatus === "live" && (
            <button
              className={`game-out-trigger${eliminations[myId] ? " active" : ""}`}
              type="button"
              onClick={() => {
                if (eliminations[myId]) {
                  if (!window.confirm("Return yourself to the active game?")) return;
                  const next = { ...eliminationsRef.current };
                  delete next[myId];
                  eliminationsRef.current = next;
                  setEliminations(next);
                  connRef.current?.setElimination("");
                  persistMyElimination(null);
                  setChatMessages((messages) => [...messages.slice(-99), {
                    id: `elimination-${myId}-${Date.now()}-${++chatIdRef.current}`,
                    kind: "elimination",
                    system: true,
                    text: `${session.name} returned to the game.`,
                    at: Date.now(),
                  }]);
                  return;
                }
                const reason = window.prompt("How were you eliminated? life, commander damage, poison, concede, or other");
                const normalized = String(reason || "").trim().toLowerCase().replace(/\s+/g, "_");
                const safeReason = {
                  life: "life",
                  commander_damage: "commander_damage",
                  poison: "poison",
                  concede: "concede",
                  other: "other",
                }[normalized];
                if (!safeReason || !window.confirm(`Mark yourself out by ${safeReason.replace("_", " ")}?`)) return;
                const next = { ...eliminationsRef.current, [myId]: safeReason };
                eliminationsRef.current = next;
                setEliminations(next);
                connRef.current?.setElimination(safeReason);
                persistMyElimination(safeReason);
                setChatMessages((messages) => [...messages.slice(-99), {
                  id: `elimination-${myId}-${Date.now()}-${++chatIdRef.current}`,
                  kind: "elimination",
                  system: true,
                  text: `${session.name} is out (${safeReason.replace("_", " ")}).`,
                  at: Date.now(),
                }]);
              }}
            >
              <X size={16} />
              {eliminations[myId] ? "Out · Undo" : "I’m out"}
            </button>
          )}
          {!sidebarOpen && !sidebarCollapsed && (
            <div
              className="sidebar-edge-zone"
              onPointerMove={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setEdgeTabY(Math.max(34, Math.min(rect.height - 34, event.clientY - rect.top)));
              }}
            >
              <button
                className="sidebar-edge-tab"
                style={{ top: edgeTabY == null ? "50%" : `${edgeTabY}px` }}
                onClick={() => {
                  setSidebarView("lookup");
                  setSidebarOpen(true);
                }}
                aria-label="Open card panel"
                data-tooltip="Open card panel"
                data-tooltip-pos="right"
              >
                <PanelLeft size={18} />
              </button>
            </div>
          )}
          {diceOverlay && (
            <div className="dice-result-overlay" key={diceOverlay.id} aria-live="polite">
              <div className="dice-result-card">
                <Dices size={28} />
                <strong>{formatDiceResult(diceOverlay.value, diceOverlay.sides)}</strong>
                <span>{formatDiceSides(diceOverlay.sides)} · {diceOverlay.name}</span>
              </div>
            </div>
          )}
          <div className={`${videoLayout === "follow" ? "grid follow-active" : videoLayout === "hero" ? "grid hero-view" : `grid${tiles.length > 4 ? " grid-six" : ""}`}${videoFit === "16:9" ? " grid-fit-16-9" : ""}`}>
            {visibleTiles.map((t, i) => (
              <VideoTile
                key={t.id}
                tile={t}
                color={t.color || TILE_COLORS[i % TILE_COLORS.length]}
                seatIndex={i}
                seatCount={tiles.length}
                innerSide={videoLayout === "follow" || i % 2 === 0 ? "right" : "left"}
                flash={flash?.tileId === t.id ? flash : null}
                scanNotice={t.isMe ? scanNotice : null}
                onIdentify={identify}
                onChooseCommander={chooseCommander}
                onChooseCommanderPartner={chooseCommanderPartner}
                savedCommanderDecks={session.savedCommanderDecks || []}
                onLookupCommander={lookupCommanderName}
                onChangeLife={changeLife}
                onOpenCounters={openCounters}
                onPassTurn={passTurn}
                camOn={t.isMe ? camOn : cameraEnabledByPlayer[t.id] !== false}
                micOn={t.isMe ? micOn : !mutedPlayers[t.id]}
                onToggleCam={toggleCam}
                onToggleMic={toggleMic}
                videoQuality={t.isMe ? "auto" : (videoQualityByPlayer[t.id] || "auto")}
                onVideoQualityChange={t.isMe ? undefined : (quality) => chooseVideoQuality(t.id, quality)}
                canRandomizeGrid={isGameOwner && t.isMe}
                onRandomizeGrid={randomizeGrid}
                onStartReadyCheck={startReadyCheck}
                isReadyCheckActive={!!readyCheck}
                readyStatus={readyCheck?.responses?.[t.id]}
                onReady={t.isMe ? () => respondReady(true) : undefined}
                onNotReady={t.isMe ? () => respondReady(false) : undefined}
                heroRole={videoLayout === "hero" ? (i === 0 ? "main" : "thumbnail") : ""}
                onSelectHero={() => {
                  if (!t.empty) setHeroPlayerId(t.id);
                }}
                videoCounters={videoCounters[t.id] || []}
                counterDragPreview={t.isMe ? videoCounterDragPreview : null}
                onStartVideoCounterDrag={t.isMe ? setCounterPointerDrag : undefined}
                onChangeVideoCounter={t.isMe ? changeOwnVideoCounter : undefined}
                onRemoveVideoCounter={t.isMe ? removeOwnVideoCounter : undefined}
                flipped={!!flippedVideos[t.id]}
                onToggleFlip={() => setFlippedVideos((values) => ({ ...values, [t.id]: !values[t.id] }))}
              />
            ))}
          </div>
        </div>
      </div>
      {gameManagementOpen && isGameOwner && (
        <GameManagement
          status={gameStatus}
          players={players.map((player) => ({
            ...player,
            isMe: player.id === myId,
            commander: commanders[player.id] || "",
            eliminated: Boolean(eliminations[player.id]),
            lossReason: eliminations[player.id] || "",
          }))}
          visitors={visitors}
          onClose={() => setGameManagementOpen(false)}
          onStart={startManagedGame}
          onManageMember={manageMember}
          onEnd={endManagedGame}
          onRestart={restartManagedGame}
          friends={gameFriends}
          onInviteFriend={(profileId) => inviteFriendToGame({
            gameId: session.gameId,
            ownerToken: activeOwnerToken,
            profileId,
          })}
          onCancelInvitation={(invitationId) => cancelGameInvitation({
            invitationId,
            ownerToken: activeOwnerToken,
          })}
        />
      )}
      {reviewSessionId && account && (
        <ReviewPrompt
          sessionId={reviewSessionId}
          onClose={() => {
            setReviewSessionId("");
            if (leaveAfterReview) onLeave();
          }}
        />
      )}
    </div>
  );
}

function RemoteAudio({ stream, muted = false }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream;
      ref.current.muted = muted;
      ref.current.play().catch(() => {
        // Browsers normally allow this after the explicit Join click. If one
        // blocks autoplay, the element will retry when the stream updates.
      });
    }
  }, [stream, muted]);
  return <audio ref={ref} autoPlay playsInline />;
}

let speakerAudioContext = null;

function getSpeakerAudioContext() {
  if (speakerAudioContext) return speakerAudioContext;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  speakerAudioContext = new AudioContext();

  // Safari and Chromium can suspend Web Audio when the game finishes joining
  // after the original button click. Resume on the next interaction as well as
  // immediately, so level detection never stays silently paused.
  const resume = () => {
    if (speakerAudioContext?.state === "suspended") speakerAudioContext.resume().catch(() => {});
  };
  window.addEventListener("pointerdown", resume, { capture: true });
  window.addEventListener("keydown", resume, { capture: true });
  document.addEventListener("visibilitychange", resume);
  resume();
  return speakerAudioContext;
}

// Watch a stream's microphone level without routing any extra audio. A short
// release delay keeps the indicator steady across natural gaps between words.
function useSpeaking(stream, disabled = false) {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    const audioTrack = stream?.getAudioTracks?.()[0];
    if (!stream || !audioTrack || disabled) {
      setSpeaking(false);
      return undefined;
    }

    const context = getSpeakerAudioContext();
    if (!context) return undefined;
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.35;
    source.connect(analyser);

    const samples = new Float32Array(analyser.fftSize);
    let lastVoiceAt = 0;
    let active = false;
    let noiseFloor = 0.004;
    const update = () => {
      analyser.getFloatTimeDomainData(samples);
      let energy = 0;
      for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i];
      const rms = Math.sqrt(energy / samples.length);
      const now = performance.now();
      // Learn the room's quiet level, but only while the signal is near it so
      // normal speech does not teach the threshold to ignore the speaker.
      if (rms < Math.max(0.012, noiseFloor * 2.2)) {
        noiseFloor = noiseFloor * 0.96 + rms * 0.04;
      }
      const voiceThreshold = Math.max(0.007, noiseFloor * 2.6);
      if (audioTrack.enabled && audioTrack.readyState === "live" && rms > voiceThreshold) {
        lastVoiceAt = now;
      }
      const next = now - lastVoiceAt < 360;
      if (next !== active) {
        active = next;
        setSpeaking(next);
      }
    };
    if (context.state === "suspended") context.resume().catch(() => {});
    update();
    const timer = setInterval(update, 66);

    return () => {
      clearInterval(timer);
      source.disconnect();
      analyser.disconnect();
    };
  }, [stream, disabled]);

  return speaking;
}

// Seat accent palette: yellow, blue, green, red.
const TILE_COLORS = [
  "#d7ac3f", "#e67e3c", "#d95757", "#d45b9b", "#a66bdd", "#626bc9",
  "#3f8fd2", "#38b8cf", "#31957e", "#58a75c", "#a6b94a", "#7c8796",
];

function formatVideoResolution(resolution) {
  const height = Number(resolution?.height) || 0;
  if (!height) return "";
  if (height >= 2160) return "4K";
  if (height >= 1440) return "1440p";
  if (height >= 1080) return "1080p";
  if (height >= 720) return "720p";
  return `${height}p`;
}

const VideoTile = React.memo(function VideoTile({ tile, color, seatIndex, seatCount, innerSide, onIdentify, onChooseCommander, onChooseCommanderPartner, savedCommanderDecks, onLookupCommander, onChangeLife, onOpenCounters, onPassTurn, canRandomizeGrid, onRandomizeGrid, onStartReadyCheck, isReadyCheckActive, readyStatus, onReady, onNotReady, heroRole, onSelectHero, flash, scanNotice, camOn, micOn, onToggleCam, onToggleMic, videoQuality, onVideoQualityChange, videoCounters, counterDragPreview, onStartVideoCounterDrag, onChangeVideoCounter, onRemoveVideoCounter, flipped, onToggleFlip }) {
  // Seats 3 and 4 (the bottom row of a 4-player grid) mirror their banner to
  // the bottom edge and their life badge to the top corner, since those
  // tiles sit upside-down relative to the viewer's side of the table.
  const isSeat3 = seatIndex === 2;
  const isSeat4 = seatIndex === 3;
  // The life badge's own tooltips must point away from whichever screen
  // edge the badge is flush against, or they'd render off-screen.
  const lifeBadgeAlign = isSeat3 ? "right" : isSeat4 ? "left" : innerSide;
  const bannerAtBottom = seatCount > 4 ? seatIndex >= 3 : isSeat3 || isSeat4;
  const lifeTooltipPosition = bannerAtBottom
    ? lifeBadgeAlign === "left" ? "left-bottom" : "right-bottom"
    : lifeBadgeAlign === "left" ? "left-top" : "right-top";
  const videoRef = useRef(null);
  const lifeHoldTimerRef = useRef(null);
  const lifeHoldIntervalRef = useRef(null);
  const lifeHoldTriggeredRef = useRef(false);
  const [videoResolution, setVideoResolution] = useState(null);
  const speaking = useSpeaking(tile.stream, tile.muted);
  const stopLifeHold = () => {
    clearTimeout(lifeHoldTimerRef.current);
    clearInterval(lifeHoldIntervalRef.current);
    lifeHoldTimerRef.current = null;
    lifeHoldIntervalRef.current = null;
  };
  const startLifeHold = (delta) => {
    stopLifeHold();
    lifeHoldTriggeredRef.current = false;
    lifeHoldTimerRef.current = setTimeout(() => {
      lifeHoldTriggeredRef.current = true;
      onChangeLife(delta * 5);
      lifeHoldIntervalRef.current = setInterval(() => onChangeLife(delta * 5), 180);
    }, 350);
  };
  const changeLifeFromButton = (delta) => {
    if (lifeHoldTriggeredRef.current) {
      lifeHoldTriggeredRef.current = false;
      return;
    }
    onChangeLife(delta);
  };
  useEffect(() => stopLifeHold, []);
  useEffect(() => {
    if (videoRef.current && tile.stream) videoRef.current.srcObject = tile.stream;
  }, [tile.stream]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !tile.stream) {
      setVideoResolution(null);
      return undefined;
    }
    const update = () => {
      const settings = tile.isMe ? tile.stream.getVideoTracks?.()[0]?.getSettings?.() : null;
      // A local track exposes the camera's negotiated capture dimensions even
      // before the preview has emitted loadedmetadata. Remote tiles continue
      // to report the dimensions actually decoded by this browser.
      const width = video.videoWidth || Number(settings?.width) || 0;
      const height = video.videoHeight || Number(settings?.height) || 0;
      setVideoResolution((current) => {
        if (!width || !height) return current == null ? current : null;
        if (current?.width === width && current?.height === height) return current;
        return { width, height };
      });
    };
    video.addEventListener("loadedmetadata", update);
    video.addEventListener("resize", update);
    const timer = setInterval(update, 5000);
    update();
    return () => {
      video.removeEventListener("loadedmetadata", update);
      video.removeEventListener("resize", update);
      clearInterval(timer);
    };
  }, [tile.stream, tile.isMe]);

  if (tile.empty) {
    return (
      <div className={`tile empty${heroRole === "thumbnail" ? " hero-thumbnail" : heroRole === "main" ? " hero-main" : ""}`} style={{ borderColor: color }}>
        <span>Waiting for player…</span>
      </div>
    );
  }

  return (
    <div
      className={`tile${tile.activeTurn ? " active-turn" : ""}${heroRole === "thumbnail" ? " hero-thumbnail" : heroRole === "main" ? " hero-main" : ""}`}
      style={tile.activeTurn ? { "--speaker-color": color } : { borderColor: color, "--speaker-color": color }}
    >
      {heroRole === "thumbnail" && (
        <button
          type="button"
          className="hero-thumbnail-hit"
          onClick={onSelectHero}
          aria-label={`Make ${tile.name} the hero view`}
        />
      )}
      <CommanderBanner
        tile={tile}
        onChoose={onChooseCommander}
        onChoosePartner={onChooseCommanderPartner}
        savedCommanderDecks={savedCommanderDecks}
        onLookupCommander={onLookupCommander}
        speaking={speaking}
        onPassTurn={onPassTurn}
        canRandomizeGrid={canRandomizeGrid}
        onRandomizeGrid={onRandomizeGrid}
        onStartReadyCheck={onStartReadyCheck}
        flipped={flipped}
        onToggleFlip={onToggleFlip}
        camOn={camOn}
        micOn={micOn}
        onToggleCam={onToggleCam}
        onToggleMic={onToggleMic}
        videoQuality={videoQuality}
        videoResolution={videoResolution}
        onVideoQualityChange={onVideoQualityChange}
        atBottom={bannerAtBottom}
      />
      <div
        className="video-wrap"
        data-counter-drop-target={tile.isMe ? "true" : undefined}
        onClick={(e) => {
          if (!videoRef.current) return;
          onIdentify(tile.id, videoRef.current, e.clientX, e.clientY, flipped);
        }}
      >
        <div className="video-fit-box">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={tile.isMe}
            style={flipped ? { transform: "rotate(180deg)" } : undefined}
          />
        </div>
        {flash && <div className="click-flash" style={{ left: flash.x, top: flash.y }} />}
        {(videoCounters || []).map((counter) => (
          <VideoCounterSticker
            key={counter.id}
            counter={counter}
            color={color}
            editable={tile.isMe}
            onStartDrag={onStartVideoCounterDrag}
            onChange={onChangeVideoCounter}
            onRemove={onRemoveVideoCounter}
          />
        ))}
        {counterDragPreview && (
          <VideoCounterSticker
            counter={{
              id: "drag-preview",
              type: counterDragPreview.type,
              x: counterDragPreview.x,
              y: counterDragPreview.y,
              value: getVideoCounterType(counterDragPreview.type)?.adjustable ? 1 : 0,
            }}
            color={color}
            preview
          />
        )}
        {tile.reconnecting && (
          <div className="reconnecting-overlay" role="status">
            Reconnecting…
          </div>
        )}
        {isReadyCheckActive && (
          <div className="ready-check-overlay" role="status">
            <strong>{readyStatus === true ? "Ready" : readyStatus === false ? "Not ready" : tile.isMe ? "Are you ready?" : "Waiting…"}</strong>
            {tile.isMe && readyStatus === undefined && (
              <span className="ready-check-actions">
                <button type="button" className="ready-btn" onClick={(event) => { event.stopPropagation(); onReady?.(); }}><Check size={15} /> Ready</button>
                <button type="button" className="not-ready-btn" onClick={(event) => { event.stopPropagation(); onNotReady?.(); }}><X size={15} /> Not ready</button>
              </span>
            )}
          </div>
        )}
        {tile.isMe && scanNotice && (
          <div className="scan-notice" role="status">
            📷 {scanNotice.by} scanned your board
          </div>
        )}
        <div
          className={tile.isMe ? "life-badge mine" : "life-badge"}
          style={
            isSeat3
              ? { background: color, top: 0, bottom: "auto", right: 0, borderRadius: "0 0 0 10px" }
              : isSeat4
              ? { background: color, top: 0, bottom: "auto", left: 0, borderRadius: "0 0 10px 0" }
              : {
                  background: color,
                  [innerSide]: 0,
                  // Flush against the corner: only round the corner facing the video.
                  borderRadius: innerSide === "right" ? "10px 0 0 0" : "0 10px 0 0",
                }
          }
          onClick={(e) => e.stopPropagation()}
        >
          {tile.isMe && (
            <>
              <button className="life-btn life-sword-btn" onClick={() => onOpenCounters?.()} aria-label="Add commander damage" data-tooltip="Add commander damage" data-tooltip-pos={lifeTooltipPosition}>
                <Swords size={20} fill="currentColor" />
              </button>
              <span className="life-divider" aria-hidden="true" />
            </>
          )}
          {tile.isMe && (
            <button
              type="button"
              className="life-btn"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture?.(event.pointerId);
                startLifeHold(-1);
              }}
              onPointerUp={(event) => {
                event.currentTarget.releasePointerCapture?.(event.pointerId);
                stopLifeHold();
              }}
              onPointerCancel={stopLifeHold}
              onClick={() => changeLifeFromButton(-1)}
              aria-label="Lose 1 life; hold to lose life in increments of 5"
              data-tooltip="Lose 1 life · hold for 5"
              data-tooltip-pos={lifeTooltipPosition}
            >
              <Minus size={20} />
            </button>
          )}
          <span className="life-value">{tile.life}</span>
          {tile.isMe && (
            <button
              type="button"
              className="life-btn"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture?.(event.pointerId);
                startLifeHold(1);
              }}
              onPointerUp={(event) => {
                event.currentTarget.releasePointerCapture?.(event.pointerId);
                stopLifeHold();
              }}
              onPointerCancel={stopLifeHold}
              onClick={() => changeLifeFromButton(1)}
              aria-label="Gain 1 life; hold to gain life in increments of 5"
              data-tooltip="Gain 1 life · hold for 5"
              data-tooltip-pos={lifeTooltipPosition}
            >
              <Plus size={20} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}, (previous, next) => {
  const { tile: previousTile, ...previousProps } = previous;
  const { tile: nextTile, ...nextProps } = next;
  return shallowNonFunctionPropsEqual(previousProps, nextProps)
    && shallowNonFunctionPropsEqual(previousTile || {}, nextTile || {});
});

function VideoCounterSticker({ counter, color, editable, preview, onStartDrag, onChange, onRemove }) {
  const type = getVideoCounterType(counter.type);
  if (!type) return null;
  const label = type.id === "plus-one"
    ? `+${counter.value}/+${counter.value}`
    : type.id === "minus-one"
      ? `−${counter.value}/−${counter.value}`
      : type.label;
  const hasLongSingleWord = !label.includes(" ") && label.length > 8;
  return (
    <div
      className={`video-counter-sticker${editable ? " editable" : ""}${preview ? " drag-preview" : ""}${hasLongSingleWord ? " long-single-word" : ""}`}
      style={{
        left: `${counter.x * 100}%`,
        top: `${counter.y * 100}%`,
        background: color,
        color: getCounterTextColor(color),
      }}
      onPointerDown={(event) => {
        if (!editable) return;
        if (event.target.closest("button")) return;
        event.preventDefault();
        event.stopPropagation();
        onStartDrag?.({
          id: counter.id,
          type: counter.type,
          source: "video",
        });
      }}
      onClick={(event) => event.stopPropagation()}
      aria-label={`${label} counter`}
    >
      <span>{label}</span>
      {editable && (
        <div className="video-counter-actions">
          {type.adjustable && (
            <>
              <button type="button" onClick={(event) => { event.stopPropagation(); onChange?.(counter.id, -1); }} aria-label={`Decrease ${type.label}`}><Minus size={14} /></button>
              <button type="button" onClick={(event) => { event.stopPropagation(); onChange?.(counter.id, 1); }} aria-label={`Increase ${type.label}`}><Plus size={14} /></button>
            </>
          )}
          <button type="button" className="video-counter-remove" onClick={(event) => { event.stopPropagation(); onRemove?.(counter.id); }} aria-label={`Remove ${type.label}`}><X size={14} /></button>
        </div>
      )}
    </div>
  );
}

// Small, mana-inspired pips keep the commander's color identity visible
// without competing with the name in the compact video overlay.
const MANA_BG = {
  W: "#c9c2aa", U: "#4f88b8", B: "#3d3a38", R: "#b5463e", G: "#4a7853", C: "#77736e",
};

function CommanderColorPips({ colors }) {
  if (!colors) return null;
  const coloredPips = colors.filter((color) => ["W", "U", "B", "R", "G"].includes(color));
  const symbols = coloredPips.length ? coloredPips : ["C"];
  return (
    <span className="mana-cost">
      {symbols.map((sym, i) => {
        return (
          <span
            key={`${sym}-${i}`}
            className="mana-symbol"
            style={{ background: MANA_BG[sym] || MANA_BG.C }}
            role="img"
            aria-label={`{${sym}}`}
          />
        );
      })}
    </span>
  );
}

// Three-dot player-options menu on the banner's first row. On your own tile
// it also carries quick mic/camera toggles right next to the menu button.
function TileMenu({ profileId, flipped, onToggleFlip, canPassTurn, onPassTurn, canRandomizeGrid, onRandomizeGrid, canStartReadyCheck, onStartReadyCheck, showMediaControls, camOn, micOn, onToggleCam, onToggleMic, videoQuality, videoResolution, onVideoQualityChange, menuUp = false }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="banner-menu" onClick={(e) => e.stopPropagation()}>
      <>
        {showMediaControls ? (
          <>
          <button
            className={camOn ? "menu-btn" : "menu-btn menu-btn-danger"}
            onClick={() => onToggleCam?.()}
            aria-label={camOn ? "Turn camera off" : "Turn camera on"}
            data-tooltip={camOn ? "Turn camera off" : "Turn camera on"}
            data-tooltip-pos={menuUp ? "right-top" : "right-bottom"}
          >
            {camOn ? <Video size={16} /> : <VideoOff size={16} />}
          </button>
          <button
            className={micOn ? "menu-btn" : "menu-btn menu-btn-danger"}
            onClick={() => onToggleMic?.()}
            aria-label={micOn ? "Mute" : "Unmute"}
            data-tooltip={micOn ? "Mute" : "Unmute"}
            data-tooltip-pos={menuUp ? "right-top" : "right-bottom"}
          >
            {micOn ? <Mic size={16} /> : <MicOff size={16} />}
          </button>
          </>
        ) : (
          <>
            <span
              className={camOn ? "menu-btn menu-status" : "menu-btn menu-status menu-btn-danger"}
              role="img"
              aria-label={camOn ? "Camera on" : "Camera off"}
              data-tooltip={camOn ? "Camera on" : "Camera off"}
              data-tooltip-pos={menuUp ? "right-top" : "right-bottom"}
            >
              {camOn ? <Video size={16} /> : <VideoOff size={16} />}
            </span>
            <span
              className={micOn ? "menu-btn menu-status" : "menu-btn menu-status menu-btn-danger"}
              role="img"
              aria-label={micOn ? "Microphone on" : "Microphone muted"}
              data-tooltip={micOn ? "Microphone on" : "Microphone muted"}
              data-tooltip-pos={menuUp ? "right-top" : "right-bottom"}
            >
              {micOn ? <Mic size={16} /> : <MicOff size={16} />}
            </span>
          </>
        )}
      </>
      <button
        className="menu-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label="Player options"
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className={menuUp ? "tile-menu menu-up" : "tile-menu"}>
          {profileId && (
            <a
              href={`/profile?id=${encodeURIComponent(profileId)}`}
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpen(false)}
            >
              <UserRound size={16} />
              <span>View profile</span>
            </a>
          )}
          {onVideoQualityChange && (
            <label className="tile-quality-control">
              <span>Video quality</span>
              <select value={videoQuality || "auto"} onChange={(event) => onVideoQualityChange(event.target.value)}>
                <option value="auto">Auto (recommended)</option>
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
              </select>
              <small>{videoResolution ? `Receiving ${formatVideoResolution(videoResolution)}` : "Waiting for video…"}</small>
            </label>
          )}
          <button
            type="button"
            onClick={() => {
              onToggleFlip();
              setOpen(false);
            }}
          >
            <FlipVertical2 size={16} />
            <span>{flipped ? "Unflip video" : "Flip video"}</span>
          </button>
          {canPassTurn && (
            <button
              type="button"
              onClick={() => {
                onPassTurn?.();
                setOpen(false);
              }}
            >
              <SkipForward size={16} />
              <span>Pass turn</span>
            </button>
          )}
          {canRandomizeGrid && (
            <button type="button" onClick={() => { onRandomizeGrid?.(); setOpen(false); }}>
              <Shuffle size={16} />
              <span>Shuffle position</span>
            </button>
          )}
          {canStartReadyCheck && (
            <button type="button" onClick={() => { onStartReadyCheck?.(); setOpen(false); }}>
              <Check size={16} />
              <span>Check ready</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CommanderBanner({ tile, onChoose, onChoosePartner, savedCommanderDecks = [], onLookupCommander, speaking, onPassTurn, canRandomizeGrid, onRandomizeGrid, onStartReadyCheck, flipped, onToggleFlip, camOn, micOn, onToggleCam, onToggleMic, videoQuality, videoResolution, onVideoQualityChange, atBottom }) {
  const [draft, setDraft] = useState(tile.commander);
  const [suggestions, setSuggestions] = useState([]);
  const [highlight, setHighlight] = useState(-1);
  const [editing, setEditing] = useState(false);
  const [partnerDraft, setPartnerDraft] = useState(tile.commanderPartner);
  const [partnerSuggestions, setPartnerSuggestions] = useState([]);
  const [partnerHighlight, setPartnerHighlight] = useState(-1);
  const [editingPartner, setEditingPartner] = useState(false);
  const [commanderCard, setCommanderCard] = useState(null);
  const [commanderColors, setCommanderColors] = useState(null);

  useEffect(() => setDraft(tile.commander), [tile.commander]);
  useEffect(() => setPartnerDraft(tile.commanderPartner), [tile.commanderPartner]);

  // Look up the commander's color identity for the banner display. A paired
  // commander contributes its identity too; generic and colorless mana are
  // omitted unless the resulting identity has no colors at all.
  useEffect(() => {
    setCommanderColors(null);
    setCommanderCard(null);
    const name = tile.commander?.trim();
    if (!name) return undefined;
    const controller = new AbortController();
    (async () => {
      try {
        const card = await fetchCardByName(name, { exact: true, signal: controller.signal });
        if (!card) return;
        const partnerName = tile.commanderPartner?.trim();
        const partner = partnerName
          ? await fetchCardByName(partnerName, { exact: true, signal: controller.signal })
          : null;
        setCommanderCard(card);
        setCommanderColors([...new Set([
          ...(Array.isArray(card.color_identity) ? card.color_identity : []),
          ...(Array.isArray(partner?.color_identity) ? partner.color_identity : []),
        ])]);
      } catch {
        /* banner just shows the name without pips */
      }
    })();
    return () => controller.abort();
  }, [tile.commander, tile.commanderPartner]);

  const pairing = getCommanderPairing(commanderCard);

  useEffect(() => {
    const query = partnerDraft.trim();
    if (!pairing || query.length < 2 || query === tile.commanderPartner) {
      setPartnerSuggestions([]);
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setPartnerSuggestions(await suggestCommanderPartners(commanderCard, query, controller.signal));
        setPartnerHighlight(-1);
      } catch (error) {
        if (error.name !== "AbortError") setPartnerSuggestions([]);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [commanderCard, partnerDraft, tile.commanderPartner]);

  useEffect(() => {
    const query = draft.trim();
    if (query.length < 2 || query === tile.commander) {
      setSuggestions([]);
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setSuggestions(await suggestCardNames(query, controller.signal));
        setHighlight(-1);
      } catch (error) {
        if (error.name !== "AbortError") setSuggestions([]);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [draft, tile.commander]);

  const playerName = String(tile.name || "").trim() || (tile.isMe ? "You" : "Player");
  const playerLabel = `${playerName}${tile.isMe ? " (you)" : ""}`;
  const playerRow = (
    <span className="banner-player-row">
      {tile.muted && !tile.isMe && <MicOff size={18} className="banner-muted" aria-label="Muted" />}
      {tile.profileId ? (
        <a
          className="banner-player banner-player-link"
          href={`/profile?id=${encodeURIComponent(tile.profileId)}`}
          onClick={(event) => event.stopPropagation()}
        >
          {playerLabel}
        </a>
      ) : (
        <span className="banner-player">{playerLabel}</span>
      )}
      {speaking && (
        <span className="speaking-meter" role="img" aria-label="Speaking">
          <i /><i /><i /><i /><i />
        </span>
      )}
    </span>
  );

  const nameRow = (
    <div className="banner-row banner-name-row">
      {playerRow}
    </div>
  );

  if (!tile.isMe) {
    return (
      <div className={atBottom ? "commander-banner banner-at-bottom" : "commander-banner"}>
        <TileMenu profileId={tile.profileId} flipped={flipped} onToggleFlip={onToggleFlip} canRandomizeGrid={canRandomizeGrid} onRandomizeGrid={onRandomizeGrid} camOn={camOn} micOn={micOn} videoQuality={videoQuality} videoResolution={videoResolution} onVideoQualityChange={onVideoQualityChange} menuUp={atBottom} />
        {nameRow}
        <div className="banner-row commander-detail">
          {tile.commander ? (
            <span className="commander-pair">
              <button
                type="button"
                className="commander-name commander-name-link"
                onClick={(event) => { event.stopPropagation(); onLookupCommander?.(tile.commander); }}
                data-tooltip="Look up this commander"
                data-tooltip-pos={atBottom ? "left-top" : "left-bottom"}
              >
                {tile.commander}
              </button>
              {tile.commanderPartner && (
                <>
                  <span className="commander-pair-divider">/</span>
                  <button
                    type="button"
                    className="commander-name commander-name-link"
                    onClick={(event) => { event.stopPropagation(); onLookupCommander?.(tile.commanderPartner); }}
                    data-tooltip="Look up this partner commander"
                    data-tooltip-pos={atBottom ? "left-top" : "left-bottom"}
                  >
                    {tile.commanderPartner}
                  </button>
                </>
              )}
            </span>
          ) : (
            <span className="commander-name unset">Not selected</span>
          )}
          <CommanderColorPips colors={commanderColors} />
        </div>
      </div>
    );
  }

  // Overlay text state (click to add or change). The input only appears
  // while actively editing.
  if (editingPartner && tile.commander && pairing) {
    const choosePartner = (partner) => {
      setPartnerSuggestions([]);
      onChoosePartner(partner);
      setEditingPartner(false);
    };
    const submitPartner = (event) => {
      event.preventDefault();
      const partner = partnerSuggestions[partnerHighlight];
      if (partner) choosePartner(partner);
    };
    return (
      <form className={atBottom ? "commander-banner commander-picker commander-partner-picker banner-at-bottom" : "commander-banner commander-picker commander-partner-picker"} onSubmit={submitPartner}>
        <TileMenu profileId={tile.profileId} flipped={flipped} onToggleFlip={onToggleFlip} canPassTurn={tile.activeTurn} onPassTurn={onPassTurn} canRandomizeGrid={canRandomizeGrid} onRandomizeGrid={onRandomizeGrid} canStartReadyCheck={canRandomizeGrid} onStartReadyCheck={onStartReadyCheck} showMediaControls camOn={camOn} micOn={micOn} onToggleCam={onToggleCam} onToggleMic={onToggleMic} videoResolution={videoResolution} menuUp={atBottom} />
        {nameRow}
        <div className="commander-search commander-partner-search">
          <span className="commander-name">{tile.commander}</span>
          <span className="commander-pair-divider">/</span>
          <input
            id={`commander-partner-${tile.id}`}
            value={partnerDraft}
            onChange={(event) => setPartnerDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                if (partnerSuggestions.length) setPartnerSuggestions([]);
                else setEditingPartner(false);
                return;
              }
              if (!partnerSuggestions.length) return;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setPartnerHighlight((i) => (i + 1) % partnerSuggestions.length);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setPartnerHighlight((i) => (i <= 0 ? partnerSuggestions.length - 1 : i - 1));
              }
            }}
            onBlur={() => setEditingPartner(false)}
            placeholder="Add partner"
            aria-label="Add partner commander"
            autoComplete="off"
            autoFocus
          />
          {partnerSuggestions.length > 0 && (
            <ul className={atBottom ? "commander-suggest menu-up" : "commander-suggest"}>
              {partnerSuggestions.map((name, i) => (
                <li
                  key={name}
                  className={i === partnerHighlight ? "active" : ""}
                  onMouseEnter={() => setPartnerHighlight(i)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choosePartner(name);
                  }}
                >
                  {name}
                </li>
              ))}
            </ul>
          )}
        </div>
      </form>
    );
  }

  if (!editing) {
    return (
      <div
        className={atBottom ? "commander-banner commander-set banner-at-bottom" : "commander-banner commander-set"}
        onClick={() => setEditing(true)}
      >
        <TileMenu profileId={tile.profileId} flipped={flipped} onToggleFlip={onToggleFlip} canPassTurn={tile.activeTurn} onPassTurn={onPassTurn} canRandomizeGrid={canRandomizeGrid} onRandomizeGrid={onRandomizeGrid} canStartReadyCheck={canRandomizeGrid} onStartReadyCheck={onStartReadyCheck} showMediaControls camOn={camOn} micOn={micOn} onToggleCam={onToggleCam} onToggleMic={onToggleMic} videoResolution={videoResolution} menuUp={atBottom} />
        {nameRow}
        <div className="banner-row commander-detail">
          <span className={tile.commander ? "commander-pair" : "commander-name unset"}>
            {tile.commander || "Add commander"}
            {tile.commanderPartner && (
              <>
                <span className="commander-pair-divider">/</span>
                <span className="commander-name">{tile.commanderPartner}</span>
              </>
            )}
            {tile.commander && pairing && !tile.commanderPartner && (
              <button
                type="button"
                className="commander-partner-placeholder"
                onClick={(event) => {
                  event.stopPropagation();
                  setEditingPartner(true);
                }}
              >
                <span className="commander-pair-divider">/</span>
                <span>Add partner</span>
              </button>
            )}
          </span>
          <CommanderColorPips colors={commanderColors} />
        </div>
      </div>
    );
  }

  const choose = (commander) => {
    setSuggestions([]);
    setPartnerDraft("");
    setEditingPartner(false);
    onChoose(commander);
    setEditing(false);
  };
  const chooseSavedDeck = (deck) => {
    setSuggestions([]);
    setPartnerDraft("");
    setEditingPartner(false);
    onChoose(deck.commander_name, deck.partner_name || "");
    setEditing(false);
  };
  const submit = (event) => {
    event.preventDefault();
    const commander = (highlight >= 0 ? suggestions[highlight] : draft).trim();
    if (commander) choose(commander);
  };
  return (
    <form className={atBottom ? "commander-banner commander-picker banner-at-bottom" : "commander-banner commander-picker"} onSubmit={submit}>
      <TileMenu profileId={tile.profileId} flipped={flipped} onToggleFlip={onToggleFlip} canPassTurn={tile.activeTurn} onPassTurn={onPassTurn} canRandomizeGrid={canRandomizeGrid} onRandomizeGrid={onRandomizeGrid} canStartReadyCheck={canRandomizeGrid} onStartReadyCheck={onStartReadyCheck} showMediaControls camOn={camOn} micOn={micOn} onToggleCam={onToggleCam} onToggleMic={onToggleMic} videoResolution={videoResolution} menuUp={atBottom} />
      {nameRow}
      <div className="commander-search">
        <input
          id={`commander-${tile.id}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              if (suggestions.length) setSuggestions([]);
              else setEditing(false);
              return;
            }
            if (!suggestions.length) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setHighlight((i) => (i + 1) % suggestions.length);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setHighlight((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
            }
          }}
          onBlur={() => setEditing(false)}
          placeholder="Add commander"
          aria-label="Add commander"
          autoComplete="off"
          autoFocus
        />
        {!draft.trim() && savedCommanderDecks.length > 0 && (
          <ul className="commander-suggest saved-commander-suggest">
            {savedCommanderDecks.map((deck) => (
              <li
                key={deck.id}
                onMouseDown={(event) => {
                  event.preventDefault();
                  chooseSavedDeck(deck);
                }}
              >
                <strong>{deck.label}</strong>
                <span>{deck.commander_name}{deck.partner_name ? ` + ${deck.partner_name}` : ""}</span>
              </li>
            ))}
          </ul>
        )}
        {suggestions.length > 0 && (
          <ul className={atBottom ? "commander-suggest menu-up" : "commander-suggest"}>
            {suggestions.map((name, i) => (
              <li
                key={name}
                className={i === highlight ? "active" : ""}
                onMouseEnter={() => setHighlight(i)}
                // mousedown so the pick lands before the input loses focus
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(name);
                }}
              >
                {name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </form>
  );
}
