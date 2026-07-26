// WebRTC 4-player mesh over Supabase signaling.
// Data channels carry high-res capture requests/responses (chunked JSON) and
// recipient-only chat whispers that must never enter the room broadcast.
import { joinRoom, saveConnectionEvent } from "./signaling.js";
import { cropGeometry } from "./captureGeometry.js";
import { getSoundEffect } from "./soundEffects.js";
import { normalizeVideoCounter } from "./videoCounters.js";

const FALLBACK_ICE_SERVERS = [
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: "stun:stun.l.google.com:19302" },
];

// Without an explicit target, WebRTC's default video bitrate cap sits well
// below what 1080p needs to look sharp, and the encoder's default
// degradation preference favors smooth motion over resolution — the wrong
// tradeoff for a mostly-static shot of a card table. 5 Mbps gives 1080p
// headroom for a clean 1080p30 feed when the link can sustain it; WebRTC's
// own congestion control still scales down automatically on a bad link.
const VIDEO_MAX_BITRATE = 5_000_000;
const VIDEO_QUALITY_VALUES = ["auto", "720p", "1080p"];

function normalizeVideoQuality(value) {
  return VIDEO_QUALITY_VALUES.includes(value) ? value : "auto";
}

// Tell the encoder this is a detail-heavy, mostly-static feed (a card table,
// not a talking head) so it prioritizes keeping resolution/sharpness over
// frame-rate smoothness when it has to trade one for the other.
function tuneVideoTrack(track) {
  if (!track || track.kind !== "video") return;
  try { track.contentHint = "detail"; } catch { /* not supported in this browser */ }
}

async function tuneVideoSender(sender, quality = "auto") {
  if (!sender || sender.track?.kind !== "video") return;
  try {
    const params = sender.getParameters();
    params.encodings = params.encodings?.length ? params.encodings : [{}];
    const encoding = params.encodings[0];
    const safeQuality = normalizeVideoQuality(quality);
    const targetWidth = safeQuality === "720p" ? 1280 : safeQuality === "1080p" ? 1920 : 0;
    const sourceWidth = Number(sender.track.getSettings?.().width) || 1920;
    if (targetWidth && sourceWidth > targetWidth) {
      // scaleResolutionDownBy cannot upscale a 720p source into 1080p. When
      // the camera is higher resolution, use the smallest scale that reaches
      // the requested target while preserving WebRTC's aspect-ratio handling.
      encoding.scaleResolutionDownBy = Math.max(1, Math.min(4, sourceWidth / targetWidth));
    } else {
      delete encoding.scaleResolutionDownBy;
    }
    encoding.maxBitrate = safeQuality === "720p" ? 1_800_000 : VIDEO_MAX_BITRATE;
    params.degradationPreference = "maintain-resolution";
    await sender.setParameters(params);
  } catch { /* setParameters can reject before the first negotiation completes */ }
}

function safeIceServers(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 4).flatMap((server) => {
    const urls = (Array.isArray(server?.urls) ? server.urls : [server?.urls])
      .filter((url) => typeof url === "string")
      .filter((url) => /^(stun|turn|turns):(stun|turn)\.cloudflare\.com:/i.test(url))
      // Cloudflare documents port 53 as blocked by major browsers. Keeping it
      // makes VPN/firewall fallback slower without adding browser coverage.
      .filter((url) => !/\.cloudflare\.com:53(?:\?|$)/i.test(url));
    if (!urls.length) return [];
    const next = { urls };
    if (server.username && server.credential) {
      next.username = String(server.username).slice(0, 512);
      next.credential = String(server.credential).slice(0, 512);
    }
    return [next];
  });
}

const CHUNK = 12000; // chars per data-channel chunk

// Hard limits on anything a PEER can influence. The data channel carries JSON
// straight from another browser, so every field below is attacker-controlled.
const MAX_CAPTURE_CHARS = 8 * 1024 * 1024;              // ~8MB assembled data URL
const MAX_CHUNKS = Math.ceil(MAX_CAPTURE_CHARS / CHUNK);
const CHUNK_TTL_MS = 30000;        // drop transfers that never complete
const CAPTURE_MIN_INTERVAL_MS = 1200; // per-peer floor between capture requests
const CAPTURE_BURST = 4;              // allowance for a quick flurry of clicks
const MAX_VISITORS = 8; // peer-to-peer video fan-out is not an unlimited broadcast service
const CONNECTION_DIAGNOSTIC_KEY = "snapcast-connection-diagnostics";
const CONNECTION_DIAGNOSTIC_LIMIT = 80;
const PEER_DISCONNECT_GRACE_MS = 15000;
const PLAYER_STATE_KEY_PREFIX = "snapcast-room-player-state:";
const LIFECYCLE_KEY_PREFIX = "snapcast-room-lifecycle:";
const LIFECYCLE_HEARTBEAT_MS = 5000;

export class GameConnection {
  constructor(handlers) {
    // handlers: onRoster, onRemoteStream, onPeerLeft, onLife,
    // onCommander, onCommanderPartner, onColor, onCardIdentified, onChat (public or whisper), onActivePlayer,
    // onGridOrder, onReadyCheckStart, onReadyCheckResponse, onReadyCheckEnd,
    // onVideoCounter, onVideoCounterRemove,
    // onError
    this.h = handlers;
    this.peers = new Map();     // peerId -> {pc, dc, chunks: Map}
    this.pending = new Map();   // requestId -> {resolve, reject, timer}
    this.localStream = null;
    this.room = null;
    this.myId = null;
    this.knownIds = new Set();
    this.commander = "";
    this.commanderPartner = "";
    this.commanderPartnerType = "";
    this.color = "";
    this.muted = false;
    this.cameraEnabled = true;
    this.life = 40;
    this.lobbyName = "";
    this.activePlayerId = "";
    this.poison = 0;
    this.commanderDamage = {};
    this.gridOrder = [];
    this.videoCounters = [];
    this.videoQuality = new Map(); // peerId -> receiver's requested quality
    this.role = "player";
    this.roster = [];
    this.videoDeviceId = "";
    this.audioDeviceId = "";
    this.iceServers = FALLBACK_ICE_SERVERS;
    this.turnStatus = "fallback";
    this.roomCode = "";
    this.connectionSessionId = crypto.randomUUID?.() || Math.random().toString(36).slice(2);
    this.closed = false;
    this.lastRealtimeProblemAt = 0;
    this.selfPresenceMissingAt = 0;
    this.connectionDiagnosticPersistenceUnavailable = false;
    this.networkListeners = null;
    this.intentionalLeaves = new Map();
    this.presenceRoster = [];
    this.departureTimers = new Map();
    this.participantId = "";
    this.joinedAt = 0;
    this.reconnectReason = "new-session";
    this.lifecycleTimer = null;
  }

  _playerStateKey() {
    return `${PLAYER_STATE_KEY_PREFIX}${this.roomCode}:${this.participantId || this.myId || ""}`;
  }

  _lifecycleKey() {
    return `${LIFECYCLE_KEY_PREFIX}${this.roomCode}:${this.participantId || this.myId || ""}`;
  }

  _readSessionValue(key) {
    try { return JSON.parse(sessionStorage.getItem(key) || "null"); } catch { return null; }
  }

  _writeSessionValue(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* recovery remains best effort */ }
  }

  _removeSessionValue(key) {
    try { sessionStorage.removeItem(key); } catch { /* recovery remains best effort */ }
  }

  _restorePlayerState() {
    const saved = this._readSessionValue(this._playerStateKey());
    if (!saved || typeof saved !== "object") return null;
    this.muted = !!saved.muted;
    this.cameraEnabled = saved.cameraEnabled !== false;
    if (this.role === "visitor") {
      for (const track of this.localStream?.getAudioTracks() || []) track.enabled = !this.muted;
      return {
        muted: this.muted,
        cameraEnabled: false,
      };
    }
    this.life = Math.max(0, Math.min(999, Number(saved.life) || 0));
    this.commander = String(saved.commander || "").slice(0, 120);
    this.commanderPartner = String(saved.commanderPartner || "").slice(0, 120);
    this.commanderPartnerType = String(saved.commanderPartnerType || "").slice(0, 240);
    this.color = String(saved.color || "").slice(0, 20);
    this.poison = Math.max(0, Math.min(99, Number(saved.poison) || 0));
    this.commanderDamage = saved.commanderDamage && typeof saved.commanderDamage === "object"
      ? Object.fromEntries(Object.entries(saved.commanderDamage).slice(0, 16).map(([id, value]) => (
        [String(id).slice(0, 40), Math.max(0, Math.min(99, Number(value) || 0))]
      )))
      : {};
    this.videoCounters = Array.isArray(saved.videoCounters)
      ? saved.videoCounters.map(normalizeVideoCounter).filter(Boolean).slice(-24)
      : [];
    for (const track of this.localStream?.getAudioTracks() || []) track.enabled = !this.muted;
    for (const track of this.localStream?.getVideoTracks() || []) track.enabled = this.cameraEnabled;
    return {
      life: this.life,
      commander: this.commander,
      commanderPartner: this.commanderPartner,
      commanderPartnerType: this.commanderPartnerType,
      color: this.color,
      muted: this.muted,
      cameraEnabled: this.cameraEnabled,
      poison: this.poison,
      commanderDamage: this.commanderDamage,
      videoCounters: this.videoCounters,
    };
  }

  _persistPlayerState() {
    if (!this.roomCode || !this.participantId) return;
    const state = {
      muted: this.muted,
      cameraEnabled: this.cameraEnabled,
      savedAt: Date.now(),
    };
    if (this.role !== "visitor") Object.assign(state, {
      life: this.life,
      commander: this.commander,
      commanderPartner: this.commanderPartner,
      commanderPartnerType: this.commanderPartnerType,
      color: this.color,
      poison: this.poison,
      commanderDamage: this.commanderDamage,
      videoCounters: this.videoCounters,
    });
    this._writeSessionValue(this._playerStateKey(), state);
  }

  _markLifecycle(exitHint) {
    if (!this.roomCode || !this.participantId) return;
    const previous = this._readSessionValue(this._lifecycleKey());
    this._writeSessionValue(this._lifecycleKey(), {
      participantId: this.participantId,
      lastHeartbeat: Date.now(),
      exitHint: exitHint === undefined ? String(previous?.exitHint || "") : exitHint,
    });
  }

  _classifyReconnect(previousLifecycle) {
    if (!previousLifecycle) return "new-session";
    const navigationType = globalThis.performance?.getEntriesByType?.("navigation")?.[0]?.type || "";
    if (navigationType === "reload") return "refresh";
    if (previousLifecycle.exitHint === "connection-loss") return "connection-loss";
    if (!previousLifecycle.exitHint && Date.now() - Number(previousLifecycle.lastHeartbeat || 0) < 30000) {
      return "likely-crash";
    }
    return "session-resume";
  }

  _startLifecycleHeartbeat() {
    if (this.lifecycleTimer) clearInterval(this.lifecycleTimer);
    this._markLifecycle("");
    this.lifecycleTimer = setInterval(() => this._markLifecycle(), LIFECYCLE_HEARTBEAT_MS);
  }

  _stopLifecycleHeartbeat() {
    if (this.lifecycleTimer) clearInterval(this.lifecycleTimer);
    this.lifecycleTimer = null;
  }

  _diagnostic(type, {
    subjectId = "",
    details = {},
    persist = false,
  } = {}) {
    const entry = {
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type,
      at: Date.now(),
      observerId: this.myId || "",
      observerSessionId: this.connectionSessionId,
      subjectId: String(subjectId || "").slice(0, 40),
      role: this.role,
      visibilityState: typeof document === "undefined" ? "" : document.visibilityState,
      browserOnline: typeof navigator === "undefined" ? true : navigator.onLine !== false,
      details,
    };
    try {
      const previous = JSON.parse(localStorage.getItem(CONNECTION_DIAGNOSTIC_KEY) || "[]");
      const next = [...(Array.isArray(previous) ? previous : []), entry].slice(-CONNECTION_DIAGNOSTIC_LIMIT);
      localStorage.setItem(CONNECTION_DIAGNOSTIC_KEY, JSON.stringify(next));
      globalThis.__SNAP_CONNECTION_DIAGNOSTICS = next;
    } catch {
      const previous = Array.isArray(globalThis.__SNAP_CONNECTION_DIAGNOSTICS)
        ? globalThis.__SNAP_CONNECTION_DIAGNOSTICS
        : [];
      globalThis.__SNAP_CONNECTION_DIAGNOSTICS = [...previous, entry].slice(-CONNECTION_DIAGNOSTIC_LIMIT);
    }
    if (persist && this.roomCode && !this.connectionDiagnosticPersistenceUnavailable) {
      void saveConnectionEvent({ ...entry, roomCode: this.roomCode }).catch((error) => {
        this.connectionDiagnosticPersistenceUnavailable = true;
        console.warn("[snapcast] Connection diagnostics could not be submitted", error);
      });
    }
    if (persist) console.warn(`[snapcast] connection event: ${type}`, entry);
    return entry;
  }

  _onRealtimeStatus(status, error) {
    if (this.closed) return;
    const detail = error ? String(error?.message || error).slice(0, 500) : "";
    if (status === "CHANNEL_ERROR") {
      this.lastRealtimeProblemAt = Date.now();
      this._diagnostic("realtime-channel-error", { details: { error: detail }, persist: true });
    } else if (status === "TIMED_OUT") {
      this.lastRealtimeProblemAt = Date.now();
      this._diagnostic("realtime-timed-out", { details: { error: detail }, persist: true });
    } else if (status === "CLOSED") {
      this.lastRealtimeProblemAt = Date.now();
      this._diagnostic("realtime-closed", { details: { error: detail }, persist: true });
    } else if (status === "SUBSCRIBED" && this.lastRealtimeProblemAt) {
      const outageMs = Date.now() - this.lastRealtimeProblemAt;
      this.lastRealtimeProblemAt = 0;
      this._diagnostic("realtime-recovered", { details: { outageMs }, persist: true });
    }
  }

  _startNetworkMonitoring() {
    if (this.networkListeners || typeof window === "undefined") return;
    const offline = () => {
      this._markLifecycle("connection-loss");
      this._diagnostic("browser-offline", { persist: true });
    };
    const online = () => {
      this._markLifecycle("");
      this._diagnostic("browser-online", { persist: true });
    };
    const pagehide = (event) => {
      this._markLifecycle(event.persisted ? "page-cache" : "navigation");
      this._diagnostic("page-hidden", {
        details: { persisted: !!event.persisted },
        persist: false,
      });
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    window.addEventListener("pagehide", pagehide);
    this.networkListeners = { offline, online, pagehide };
  }

  _stopNetworkMonitoring() {
    if (!this.networkListeners || typeof window === "undefined") return;
    window.removeEventListener("offline", this.networkListeners.offline);
    window.removeEventListener("online", this.networkListeners.online);
    window.removeEventListener("pagehide", this.networkListeners.pagehide);
    this.networkListeners = null;
  }

  async _configureIceServers(code) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch("/api/turn-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomCode: code }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`TURN credentials unavailable (${response.status})`);
      const payload = await response.json();
      const iceServers = safeIceServers(payload?.iceServers);
      if (!iceServers.some((server) => server.username && server.credential)) {
        throw new Error("TURN response did not contain relay credentials");
      }
      this.iceServers = iceServers;
      this.turnStatus = "ready";
      globalThis.__SNAP_TURN_STATUS = {
        status: "ready",
        expiresAt: payload.expiresAt || null,
        urls: iceServers.flatMap((server) => server.urls),
      };
    } catch (error) {
      this.iceServers = FALLBACK_ICE_SERVERS;
      this.turnStatus = "fallback";
      globalThis.__SNAP_TURN_STATUS = {
        status: "fallback",
        reason: error?.name === "AbortError" ? "credential request timed out" : String(error?.message || error),
      };
      // TURN is a fallback, not a prerequisite. Direct connections should
      // still work when the broker or Cloudflare is temporarily unavailable.
      console.warn("[snapcast] TURN fallback unavailable; trying direct WebRTC", error);
    } finally {
      clearTimeout(timer);
    }
  }

  async initMedia({
    audioOnly = false,
    videoDeviceId = "",
    audioDeviceId = "",
    startMuted = false,
  } = {}) {
    // Ask for the camera's maximum resolution — recognition crops are taken
    // from the raw local track, so every native pixel directly improves card
    // identification (WebRTC scales the *sent* video down on its own).
    this.localStream = await navigator.mediaDevices.getUserMedia({
      video: audioOnly
        ? false
        : {
          ...(videoDeviceId ? { deviceId: { exact: videoDeviceId } } : {}),
          width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 24 },
        },
      audio: {
        ...(audioDeviceId ? { deviceId: { exact: audioDeviceId } } : {}),
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    this.videoDeviceId = this.localStream.getVideoTracks()[0]?.getSettings?.().deviceId || "";
    this.audioDeviceId = this.localStream.getAudioTracks()[0]?.getSettings?.().deviceId || "";
    this.muted = !!startMuted;
    for (const track of this.localStream.getAudioTracks()) track.enabled = !this.muted;
    for (const track of this.localStream.getVideoTracks()) tuneVideoTrack(track);
    return this.localStream;
  }

  // After permission, labels are populated — call again on devicechange.
  async listDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      cameras: devices.filter((d) => d.kind === "videoinput"),
      mics: devices.filter((d) => d.kind === "audioinput"),
    };
  }

  // Swap the local camera or mic (Zoom-style) and push the new track to every peer.
  async switchDevice(kind, deviceId) {
    if (!this.localStream || !deviceId) return this.localStream;
    if (this.role === "visitor" && kind === "video") return this.localStream;
    const constraints = kind === "video"
      ? {
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: 3840 },
          height: { ideal: 2160 },
          frameRate: { ideal: 24 },
        },
        audio: false,
      }
      : {
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      };
    const fresh = await navigator.mediaDevices.getUserMedia(constraints);
    const newTrack = kind === "video" ? fresh.getVideoTracks()[0] : fresh.getAudioTracks()[0];
    // Drop unused tracks from the temporary stream so nothing is left open.
    for (const t of fresh.getTracks()) if (t !== newTrack) t.stop();

    const oldTrack = this.localStream.getTracks().find((t) => t.kind === kind);
    newTrack.enabled = oldTrack ? oldTrack.enabled : true;
    if (kind === "video") tuneVideoTrack(newTrack);

    // Push the new track to peers before tearing down the old one.
    for (const [peerId, { pc }] of this.peers) {
      const sender = pc.getSenders().find((s) => s.track?.kind === kind);
      if (sender) {
        await sender.replaceTrack(newTrack);
        if (kind === "video") await tuneVideoSender(sender, this.videoQuality.get(peerId) || "auto");
      }
    }

    if (oldTrack) {
      this.localStream.removeTrack(oldTrack);
      oldTrack.stop();
    }
    this.localStream.addTrack(newTrack);

    if (kind === "video") this.videoDeviceId = deviceId;
    else this.audioDeviceId = deviceId;
    return this.localStream;
  }

  async join(code, name, role = "player", {
    participantId = "",
    joinedAt = 0,
  } = {}) {
    this.role = role === "visitor" ? "visitor" : "player";
    this.roomCode = String(code || "").toUpperCase();
    this.participantId = String(participantId || "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40)
      || crypto.randomUUID().slice(0, 40);
    this.joinedAt = Number(joinedAt) || Date.now();
    const previousLifecycle = this._readSessionValue(this._lifecycleKey());
    this.reconnectReason = this._classifyReconnect(previousLifecycle);
    const restoredState = this._restorePlayerState();
    this._persistPlayerState();
    this.closed = false;
    this._startNetworkMonitoring();
    this._startLifecycleHeartbeat();
    await this._configureIceServers(code);
    this.room = await joinRoom(code, name, this.role, {
      onRoster: (roster) => {
        // Presence can sync before joinRoom has returned our ID.
        if (!this.myId) this.roster = roster;
        else this._onRoster(roster);
      },
      onMessage: (msg) => this._onSignal(msg),
      onStatus: (status, error) => this._onRealtimeStatus(status, error),
      participantId: this.participantId,
      joinedAt: this.joinedAt,
    });
    this.myId = this.room.myId;
    this._diagnostic("room-joined", {
      details: { turnStatus: this.turnStatus, reconnectReason: this.reconnectReason },
      persist: true,
    });
    if (this.reconnectReason !== "new-session") {
      this._diagnostic("client-rejoined", {
        details: { reason: this.reconnectReason },
        persist: true,
      });
    }
    this.h.onRestoredState?.({ id: this.myId, ...(restoredState || {}) });
    this._onRoster(this.roster);
    this.room?.send({ type: "reconnect-context", reason: this.reconnectReason });
    return this.myId;
  }

  _finalizeDeparture(departed, intentional = false) {
    const id = departed.id;
    const entry = this.peers.get(id);
    const timer = this.departureTimers.get(id);
    if (timer) clearTimeout(timer);
    this.departureTimers.delete(id);
    this.intentionalLeaves.delete(id);
    this._diagnostic(intentional ? "intentional-leave" : "unexpected-peer-drop", {
      subjectId: id,
      details: {
        subjectRole: departed.role || "player",
        peerConnectionState: entry?.pc.connectionState || "not-created",
        iceConnectionState: entry?.pc.iceConnectionState || "not-created",
        graceMs: intentional ? 0 : PEER_DISCONNECT_GRACE_MS,
        rosterSizeAfter: this.presenceRoster.length,
      },
      persist: true,
    });
    if (entry?.disconnectTimer) clearTimeout(entry.disconnectTimer);
    entry?.pc.close();
    if (entry) this.peers.delete(id);
    this.knownIds.delete(id);
    this.roster = this.roster.filter((member) => member.id !== id);
    this.h.onPeerReconnecting?.(id, false);
    this.h.onPeerLeft?.(id, { unexpected: !intentional });
    this.h.onRoster?.(this.roster);
  }

  _onRoster(presenceRoster) {
    const previousRoster = this.roster;
    this.presenceRoster = presenceRoster;
    // Presence can sync before our own track has propagated, giving a roster
    // that lists existing members but not us. Deciding offers from such a
    // snapshot marks every existing peer as "known" without ever offering to
    // them — they would never get our connection (visitors saw no video at
    // all). Render the roster, but defer connection decisions until a sync
    // that includes us arrives.
    if (this.myId && !presenceRoster.some((r) => r.id === this.myId)) {
      const now = Date.now();
      if (!this.selfPresenceMissingAt || now - this.selfPresenceMissingAt > 15000) {
        this.selfPresenceMissingAt = now;
        this._diagnostic("self-presence-missing", {
          details: { rosterSize: presenceRoster.length },
          persist: true,
        });
      }
      // Keep the last complete roster visible while our own presence is
      // recovering; an empty intermediate sync should not dismantle the room.
      this.h.onRoster?.(previousRoster);
      return;
    }
    this.selfPresenceMissingAt = 0;
    const players = presenceRoster.filter((r) => r.role !== "visitor");
    const visitors = presenceRoster.filter((r) => r.role === "visitor");
    if (this.role === "player" && players.length > 4) {
      const myRank = players.findIndex((r) => r.id === this.myId);
      if (myRank >= 4) {
        this.h.onError?.("Game is full (4 players max)");
        this.close();
        return;
      }
    }
    if (this.role === "visitor" && visitors.findIndex((r) => r.id === this.myId) >= MAX_VISITORS) {
      this.h.onError?.(`Visitor room is full (${MAX_VISITORS} visitors max)`);
      this.close();
      return;
    }
    const ids = new Set(presenceRoster.map((r) => r.id));

    // A participant who returns during the grace period keeps the same roster
    // identity and seat. If their old peer connection did not survive, allow
    // the normal deterministic offer rule below to build a fresh one.
    for (const member of presenceRoster) {
      const departureTimer = this.departureTimers.get(member.id);
      if (!departureTimer) continue;
      clearTimeout(departureTimer);
      this.departureTimers.delete(member.id);
      this.h.onPeerReconnecting?.(member.id, false);
      const entry = this.peers.get(member.id);
      if (entry) {
        if (entry.disconnectTimer) clearTimeout(entry.disconnectTimer);
        entry.pc.close();
        this.peers.delete(member.id);
        this.knownIds.delete(member.id);
      }
      this._diagnostic("peer-presence-restored", {
        subjectId: member.id,
        details: { withinGraceMs: PEER_DISCONNECT_GRACE_MS },
        persist: false,
      });
    }

    // Missing participants retain their tile and seat during the grace period.
    // A deliberate departure skips the delay; an unannounced disappearance is
    // only classified as a drop if it does not recover before the timer ends.
    const departedMembers = previousRoster.filter((member) => (
      member.id !== this.myId && !ids.has(member.id)
    ));
    for (const departed of departedMembers) {
      const intentionalAt = this.intentionalLeaves.get(departed.id) || 0;
      const intentional = Date.now() - intentionalAt < 5000;
      if (intentional) {
        this._finalizeDeparture(departed, true);
        continue;
      }
      if (this.departureTimers.has(departed.id)) continue;
      this.h.onPeerReconnecting?.(departed.id, true);
      const timer = setTimeout(() => {
        if (this.presenceRoster.some((member) => member.id === departed.id)) return;
        this._finalizeDeparture(departed, false);
      }, PEER_DISCONNECT_GRACE_MS);
      this.departureTimers.set(departed.id, timer);
    }
    const intentionalCutoff = Date.now() - 5000;
    for (const [id, at] of this.intentionalLeaves) {
      if (at < intentionalCutoff) this.intentionalLeaves.delete(id);
    }
    // I initiate offers to everyone who joined BEFORE me (newcomer initiates)
    const retained = previousRoster.filter((member) => (
      !ids.has(member.id) && this.departureTimers.has(member.id)
    ));
    this.roster = [...presenceRoster, ...retained]
      .filter((member, index, all) => all.findIndex((candidate) => candidate.id === member.id) === index)
      .sort((a, b) => a.joinedAt - b.joinedAt);

    const me = presenceRoster.find((r) => r.id === this.myId);
    for (const r of presenceRoster) {
      if (r.id === this.myId || this.knownIds.has(r.id)) continue;
      this.knownIds.add(r.id);
      if (me && r.joinedAt < me.joinedAt) this._makeOffer(r.id);
    }
    this.h.onRoster?.(this.roster);
    if (this.role === "player") {
      this.room?.send({ type: "life", life: this.life });
      if (this.lobbyName) this.room?.send({ type: "lobby-name", lobbyName: this.lobbyName });
      this.room?.send({ type: "commander", commander: this.commander });
      this.room?.send({
        type: "commander-partner",
        partner: this.commanderPartner,
        typeLine: this.commanderPartnerType,
      });
      this.room?.send({ type: "color", color: this.color });
      if (this.activePlayerId) this.room?.send({ type: "active-player", playerId: this.activePlayerId });
      if (this.gridOrder.length) this.room?.send({ type: "grid-order", order: this.gridOrder });
      this.room?.send({ type: "poison", value: this.poison });
      for (const [attackerId, value] of Object.entries(this.commanderDamage)) {
        this.room?.send({ type: "commander-damage", attackerId, value });
      }
      for (const counter of this.videoCounters) {
        this.room?.send({ type: "video-counter", counter });
      }
    }
    this.room?.send({ type: "muted", muted: this.muted });
    this.room?.send({ type: "camera-enabled", enabled: this.cameraEnabled });
  }

  async _onSignal(msg) {
    if (msg.type === "participant-leaving") {
      this.intentionalLeaves.set(String(msg.from || "").slice(0, 40), Date.now());
      return;
    }
    if (msg.type === "reconnect-context") {
      const reason = ["refresh", "connection-loss", "likely-crash", "session-resume"].includes(msg.reason)
        ? msg.reason
        : "";
      if (reason) {
        this._diagnostic("peer-reconnected", {
          subjectId: String(msg.from || "").slice(0, 40),
          details: { reason },
          persist: true,
        });
      }
      return;
    }
    const senderRole = this.roster.find((r) => r.id === msg.from)?.role || "player";
    switch (msg.type) {
      case "offer": {
        const p = this._getPeer(msg.from);
        await p.pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
        const answer = await p.pc.createAnswer();
        await p.pc.setLocalDescription(answer);
        await this._tunePeerVideo(msg.from);
        this.room.send({ type: "answer", sdp: answer.sdp }, msg.from);
        break;
      }
      case "answer":
        await this.peers.get(msg.from)?.pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
        break;
      case "ice":
        try { await this.peers.get(msg.from)?.pc.addIceCandidate(msg.candidate); } catch { /* ignore */ }
        break;
      case "video-quality": {
        if (!this.roster.some((member) => member.id === msg.from)) break;
        const quality = normalizeVideoQuality(msg.quality);
        this.videoQuality.set(msg.from, quality);
        const entry = this.peers.get(msg.from);
        if (entry) {
          await Promise.all(entry.pc.getSenders().map((sender) => tuneVideoSender(sender, quality)));
        }
        break;
      }
      case "life":
        if (senderRole !== "visitor") this.h.onLife?.(msg.from, msg.life);
        break;
      case "lobby-name":
        if (senderRole !== "visitor") {
          this.h.onLobbyName?.(String(msg.lobbyName || "").trim().slice(0, 48));
        }
        break;
      case "commander":
        if (senderRole !== "visitor") {
          this.h.onCommander?.(msg.from, String(msg.commander || "").slice(0, 120));
        }
        break;
      case "commander-partner":
        if (senderRole !== "visitor") this.h.onCommanderPartner?.(
          msg.from,
          String(msg.partner || "").slice(0, 120),
          String(msg.typeLine || "").slice(0, 240),
        );
        break;
      case "color":
        if (senderRole !== "visitor") this.h.onColor?.(msg.from, String(msg.color || "").slice(0, 20));
        break;
      case "muted": this.h.onMuted?.(msg.from, !!msg.muted); break;
      case "camera-enabled": this.h.onCameraEnabled?.(msg.from, !!msg.enabled); break;
      case "card-identified":
        if (senderRole !== "visitor") this.h.onCardIdentified?.(msg);
        break;
      case "chat": {
        const text = String(msg.text || "").trim().slice(0, 500);
        // A chat packet can name only one bundled, allow-listed sound. Never
        // accept a peer-provided media URL here.
        const soundId = getSoundEffect(msg.soundId)?.id || "";
        if (!text && !soundId) break;
        const sender = this.roster.find((member) => member.id === msg.from);
        this.h.onChat?.({
          from: msg.from,
          name: sender?.name || (senderRole === "visitor" ? "Visitor" : "Player"),
          text,
          soundId,
          at: Number(msg.at) || Date.now(),
        });
        break;
      }
      case "active-player":
        if (senderRole !== "visitor") {
          this.activePlayerId = String(msg.playerId || "").slice(0, 40);
          this.h.onActivePlayer?.(this.activePlayerId);
        }
        break;
      case "grid-order":
        if (senderRole !== "visitor") {
          const order = this._safeGridOrder(msg.order);
          if (order.length) {
            this.gridOrder = order;
            this.h.onGridOrder?.(order);
          }
        }
        break;
      case "ready-check-start":
        if (senderRole !== "visitor") {
          const checkId = String(msg.checkId || "").slice(0, 64);
          const expiresAt = Number(msg.expiresAt);
          if (checkId && Number.isFinite(expiresAt)) this.h.onReadyCheckStart?.({ checkId, expiresAt });
        }
        break;
      case "ready-check-response":
        if (senderRole !== "visitor") {
          const checkId = String(msg.checkId || "").slice(0, 64);
          if (checkId) this.h.onReadyCheckResponse?.({ checkId, playerId: msg.from, ready: !!msg.ready });
        }
        break;
      case "ready-check-end":
        if (senderRole !== "visitor") {
          const checkId = String(msg.checkId || "").slice(0, 64);
          const outcome = ["ready", "not-ready"].includes(msg.outcome) ? msg.outcome : "timeout";
          if (checkId) this.h.onReadyCheckEnd?.({ checkId, outcome, by: msg.from });
        }
        break;
      case "poison":
        if (senderRole !== "visitor") {
          this.h.onPoison?.(msg.from, Math.max(0, Math.min(99, Number(msg.value) || 0)));
        }
        break;
      case "commander-damage":
        if (senderRole !== "visitor") {
          const attackerId = String(msg.attackerId || "").slice(0, 40);
          if (attackerId) {
            this.h.onCommanderDamage?.(
              msg.from,
              attackerId,
              Math.max(0, Math.min(99, Number(msg.value) || 0)),
              String(msg.commanderName || "").slice(0, 120),
            );
          }
        }
        break;
      case "dice-roll": {
        const sides = Math.max(2, Math.min(20, Number(msg.sides) || 20));
        const value = Math.max(1, Math.min(sides, Number(msg.value) || 1));
        const sender = this.roster.find((member) => member.id === msg.from);
        this.h.onDiceRoll?.({
          from: msg.from,
          name: sender?.name || (senderRole === "visitor" ? "Visitor" : "Player"),
          value,
          sides,
          at: Number(msg.at) || Date.now(),
        });
        break;
      }
      case "video-counter": {
        if (senderRole === "visitor") break;
        const counter = normalizeVideoCounter(msg.counter);
        if (counter) this.h.onVideoCounter?.(msg.from, counter);
        break;
      }
      case "video-counter-remove": {
        if (senderRole === "visitor") break;
        const counterId = String(msg.counterId || "").slice(0, 64);
        if (counterId) this.h.onVideoCounterRemove?.(msg.from, counterId);
        break;
      }
    }
  }

  _getPeer(peerId) {
    if (this.peers.has(peerId)) return this.peers.get(peerId);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const entry = {
      pc,
      dc: null,
      chunks: new Map(),
      disconnectTimer: null,
      connectionWasInterrupted: false,
      failureReported: false,
    };
    this.peers.set(peerId, entry);
    for (const t of this.localStream?.getTracks() || []) {
      const sender = pc.addTrack(t, this.localStream);
      if (t.kind === "video") void tuneVideoSender(sender, this.videoQuality.get(peerId) || "auto");
    }
    // An audio-only visitor still needs a video m-line in offers so players
    // can send their camera feed back to the visitor.
    if (this.role === "visitor") pc.addTransceiver("video", { direction: "recvonly" });
    pc.onicecandidate = (e) => e.candidate && this.room.send({ type: "ice", candidate: e.candidate }, peerId);
    pc.ontrack = (e) => this.h.onRemoteStream?.(peerId, e.streams[0]);
    pc.ondatachannel = (e) => this._setupDC(peerId, e.channel);
    pc.onconnectionstatechange = () => {
      if (this.closed || !this.peers.has(peerId)) return;
      const state = pc.connectionState;
      if (state === "connected") {
        if (entry.disconnectTimer) clearTimeout(entry.disconnectTimer);
        entry.disconnectTimer = null;
        if (entry.connectionWasInterrupted) {
          entry.connectionWasInterrupted = false;
          entry.failureReported = false;
          this._diagnostic("peer-connection-recovered", {
            subjectId: peerId,
            details: { iceConnectionState: pc.iceConnectionState },
            persist: true,
          });
        }
        return;
      }
      if (state === "failed") {
        if (entry.disconnectTimer) clearTimeout(entry.disconnectTimer);
        entry.disconnectTimer = null;
        entry.connectionWasInterrupted = true;
        if (entry.failureReported) return;
        entry.failureReported = true;
        this._diagnostic("peer-connection-failed", {
          subjectId: peerId,
          details: { iceConnectionState: pc.iceConnectionState },
          persist: true,
        });
        return;
      }
      if (state === "disconnected" && !entry.disconnectTimer) {
        entry.connectionWasInterrupted = true;
        entry.disconnectTimer = setTimeout(() => {
          entry.disconnectTimer = null;
          if (pc.connectionState !== "disconnected" || this.closed) return;
          if (entry.failureReported) return;
          entry.failureReported = true;
          this._diagnostic("peer-connection-failed", {
            subjectId: peerId,
            details: {
              connectionState: "disconnected",
              iceConnectionState: pc.iceConnectionState,
              graceMs: PEER_DISCONNECT_GRACE_MS,
            },
            persist: true,
          });
        }, PEER_DISCONNECT_GRACE_MS);
      }
    };
    return entry;
  }

  async _tunePeerVideo(peerId) {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    await Promise.all(entry.pc.getSenders().map((sender) => tuneVideoSender(sender, this.videoQuality.get(peerId) || "auto")));
  }

  async _makeOffer(peerId) {
    const p = this._getPeer(peerId);
    this._setupDC(peerId, p.pc.createDataChannel("ctrl"));
    const offer = await p.pc.createOffer();
    await p.pc.setLocalDescription(offer);
    await this._tunePeerVideo(peerId);
    this.room.send({ type: "offer", sdp: offer.sdp }, peerId);
  }

  _setupDC(peerId, dc) {
    const entry = this.peers.get(peerId);
    entry.dc = dc;
    dc.onmessage = async (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (typeof m?.t !== "string" || typeof m.id !== "string" || m.id.length > 64) return;
      if (m.t === "cap-req") {
        // A capture request hands a peer a native-resolution still of this
        // player's camera. The Supabase broadcast path already gates every
        // privileged message on sender role; this transport did not, so a
        // visitor — who has no camera of their own — could pull frames from
        // everyone, unthrottled and with nothing shown on this screen.
        if (!this._mayCapture(peerId)) return;
        try {
          const cap = await captureLocalFrame(this.localStream, m.nx, m.ny);
          this._sendChunked(peerId, { t: "cap-res", id: m.id, px: cap.px, py: cap.py }, cap.url);
          // Tell this player their board was just scanned, and by whom.
          const by = this.roster.find((r) => r.id === peerId)?.name || "Someone";
          this.h.onCaptured?.(peerId, by);
        } catch {
          // Deliberately opaque: the requester does not need our local error
          // text, which can name devices or expose browser internals.
          this._dcSend(peerId, { t: "cap-res", id: m.id, error: "capture failed" });
        }
      } else if (m.t === "cap-res") {
        if (m.error) this._resolveCapture(m.id, null, "capture failed");
        else if (m.n === undefined) {
          if (typeof m.data !== "string" || m.data.length > MAX_CAPTURE_CHARS) return;
          this._resolveCapture(m.id, { url: m.data, px: m.px, py: m.py });
        }
      } else if (m.t === "chunk") {
        // Every field here is peer-controlled. Unvalidated, `new Array(m.n)`
        // and an unbounded `parts` accumulator let a peer exhaust this tab.
        if (!Number.isInteger(m.n) || m.n < 1 || m.n > MAX_CHUNKS) return;
        if (!Number.isInteger(m.i) || m.i < 0 || m.i >= m.n) return;
        if (typeof m.part !== "string" || m.part.length > CHUNK) return;
        // Only accept chunks for a capture WE asked for, so a peer cannot open
        // transfers at will.
        if (!this.pending.has(m.id)) return;
        const key = m.id;
        this._sweepChunks(entry);
        if (!entry.chunks.has(key)) {
          entry.chunks.set(key, { parts: new Array(m.n), got: 0, bytes: 0, at: Date.now() });
        }
        const buf = entry.chunks.get(key);
        if (m.px !== undefined) { buf.px = m.px; buf.py = m.py; }
        if (buf.parts[m.i] === undefined) {
          buf.bytes += m.part.length;
          if (buf.bytes > MAX_CAPTURE_CHARS) { entry.chunks.delete(key); return; }
          buf.parts[m.i] = m.part;
          buf.got++;
        }
        if (buf.got === m.n) {
          entry.chunks.delete(key);
          this._resolveCapture(key, { url: buf.parts.join(""), px: buf.px, py: buf.py });
        }
      } else if (m.t === "whisper") {
        const text = String(m.text || "").trim().slice(0, 500);
        if (!text) return;
        const sender = this.roster.find((member) => member.id === peerId);
        if (!sender) return;
        this.h.onChat?.({
          from: peerId,
          name: sender.name || (sender.role === "visitor" ? "Visitor" : "Player"),
          text,
          at: Number(m.at) || Date.now(),
          whisper: true,
          to: this.myId,
          toName: this.roster.find((member) => member.id === this.myId)?.name || "You",
        });
      }
    };
  }

  // Capture authorisation: players only, and no faster than a human clicking.
  // Without this a peer can poll cap-req in a loop and reconstruct a video
  // feed of this player at full camera resolution.
  _mayCapture(peerId) {
    if (!this.localStream) return false;
    const role = this.roster.find((r) => r.id === peerId)?.role;
    if (role === "visitor") return false;
    const entry = this.peers.get(peerId);
    if (!entry) return false;
    const now = Date.now();
    // Token bucket: refills at one per CAPTURE_MIN_INTERVAL_MS, capped at
    // CAPTURE_BURST so ordinary rapid clicking is unaffected.
    const last = entry.capTokensAt || 0;
    const tokens = Math.min(
      CAPTURE_BURST,
      (entry.capTokens ?? CAPTURE_BURST) + (now - last) / CAPTURE_MIN_INTERVAL_MS,
    );
    if (tokens < 1) { entry.capTokens = tokens; entry.capTokensAt = now; return false; }
    entry.capTokens = tokens - 1;
    entry.capTokensAt = now;
    return true;
  }

  // Incomplete transfers were never evicted, so a peer could accumulate them
  // indefinitely by starting captures it never finished sending.
  _sweepChunks(entry) {
    const cutoff = Date.now() - CHUNK_TTL_MS;
    for (const [k, buf] of entry.chunks) {
      if (buf.at < cutoff) entry.chunks.delete(k);
    }
  }

  _dcSend(peerId, obj) {
    const dc = this.peers.get(peerId)?.dc;
    if (dc?.readyState !== "open") return false;
    dc.send(JSON.stringify(obj));
    return true;
  }

  _sendChunked(peerId, header, data) {
    const n = Math.ceil(data.length / CHUNK);
    for (let i = 0; i < n; i++) {
      const msg = { t: "chunk", id: header.id, i, n, part: data.slice(i * CHUNK, (i + 1) * CHUNK) };
      // Ride the crop's click position along on the first chunk.
      if (i === 0 && header.px !== undefined) { msg.px = header.px; msg.py = header.py; }
      this._dcSend(peerId, msg);
    }
  }

  _resolveCapture(id, data, error) {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
    error ? p.reject(new Error(error)) : p.resolve(data);
  }

  requestRemoteCapture(peerId, nx, ny, timeoutMs = 10000) {
    const id = Math.random().toString(36).slice(2);
    return new Promise((resolve, reject) => {
      const dc = this.peers.get(peerId)?.dc;
      if (!dc || dc.readyState !== "open") return reject(new Error("Not connected to that player yet"));
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("Capture timed out")); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this._dcSend(peerId, { t: "cap-req", id, nx, ny });
    });
  }

  setLife(life) {
    if (this.role === "visitor") return;
    this.life = Math.max(0, Number(life) || 0);
    this._persistPlayerState();
    this.room?.send({ type: "life", life: this.life });
  }
  setLobbyName(lobbyName) {
    if (this.role === "visitor") return;
    this.lobbyName = String(lobbyName || "").trim().slice(0, 48);
    this.room?.send({ type: "lobby-name", lobbyName: this.lobbyName });
  }
  setCommander(commander) {
    if (this.role === "visitor") return;
    this.commander = String(commander || "").trim().slice(0, 120);
    this._persistPlayerState();
    this.room?.send({ type: "commander", commander: this.commander });
  }
  setCommanderPartner(partner, typeLine = "") {
    if (this.role === "visitor") return;
    this.commanderPartner = String(partner || "").trim().slice(0, 120);
    this.commanderPartnerType = String(typeLine || "").trim().slice(0, 240);
    this._persistPlayerState();
    this.room?.send({ type: "commander-partner", partner: this.commanderPartner, typeLine: this.commanderPartnerType });
  }
  setColor(color) {
    if (this.role === "visitor") return;
    this.color = String(color || "").trim().slice(0, 20);
    this._persistPlayerState();
    this.room?.send({ type: "color", color: this.color });
  }
  setMuted(muted) {
    this.muted = !!muted;
    this._persistPlayerState();
    this.room?.send({ type: "muted", muted: this.muted });
  }
  setCameraEnabled(enabled) {
    this.cameraEnabled = !!enabled;
    this._persistPlayerState();
    this.room?.send({ type: "camera-enabled", enabled: this.cameraEnabled });
  }
  announceCard(card, byName, at = Date.now()) {
    if (this.role === "visitor") return;
    this.room?.send({ type: "card-identified", card, byName, at });
  }
  sendChat(text, at = Date.now(), soundId = "") {
    const message = String(text || "").trim().slice(0, 500);
    const safeSoundId = getSoundEffect(soundId)?.id || "";
    if (!message && !safeSoundId) return;
    this.room?.send({ type: "chat", text: message, soundId: safeSoundId || undefined, at });
  }
  sendWhisper(peerId, text, at = Date.now()) {
    const targetId = String(peerId || "").slice(0, 40);
    const message = String(text || "").trim().slice(0, 500);
    if (!targetId || targetId === this.myId || !message) return false;
    if (!this.roster.some((member) => member.id === targetId)) return false;
    return this._dcSend(targetId, {
      t: "whisper",
      id: crypto.randomUUID?.() || Math.random().toString(36).slice(2),
      text: message,
      at,
    });
  }
  setActivePlayer(playerId) {
    if (this.role === "visitor") return;
    this.activePlayerId = String(playerId || "").slice(0, 40);
    if (this.activePlayerId) {
      this.room?.send({ type: "active-player", playerId: this.activePlayerId });
    }
  }
  _safeGridOrder(order) {
    if (!Array.isArray(order)) return [];
    return [...new Set(order.map((id) => String(id || "").slice(0, 40)).filter(Boolean))].slice(0, 8);
  }
  setGridOrder(order) {
    if (this.role === "visitor") return;
    const safeOrder = this._safeGridOrder(order);
    if (!safeOrder.length) return;
    this.gridOrder = safeOrder;
    this.room?.send({ type: "grid-order", order: safeOrder });
  }
  startReadyCheck(checkId, expiresAt) {
    if (this.role === "visitor") return;
    const safeId = String(checkId || "").slice(0, 64);
    const safeExpiry = Number(expiresAt);
    if (!safeId || !Number.isFinite(safeExpiry)) return;
    this.room?.send({ type: "ready-check-start", checkId: safeId, expiresAt: safeExpiry });
  }
  respondReady(checkId, ready) {
    if (this.role === "visitor") return;
    const safeId = String(checkId || "").slice(0, 64);
    if (!safeId) return;
    this.room?.send({ type: "ready-check-response", checkId: safeId, ready: !!ready });
  }
  endReadyCheck(checkId, outcome) {
    if (this.role === "visitor") return;
    const safeId = String(checkId || "").slice(0, 64);
    const safeOutcome = ["ready", "not-ready", "timeout"].includes(outcome) ? outcome : "timeout";
    if (!safeId) return;
    this.room?.send({ type: "ready-check-end", checkId: safeId, outcome: safeOutcome });
  }
  setPoison(value) {
    if (this.role === "visitor") return;
    this.poison = Math.max(0, Math.min(99, Number(value) || 0));
    this._persistPlayerState();
    this.room?.send({ type: "poison", value: this.poison });
  }
  setCommanderDamage(attackerId, value, commanderName = "") {
    if (this.role === "visitor") return;
    const safeAttackerId = String(attackerId || "").slice(0, 40);
    if (!safeAttackerId) return;
    const safeValue = Math.max(0, Math.min(99, Number(value) || 0));
    this.commanderDamage = { ...this.commanderDamage, [safeAttackerId]: safeValue };
    this._persistPlayerState();
    this.room?.send({
      type: "commander-damage",
      attackerId: safeAttackerId,
      value: safeValue,
      commanderName: String(commanderName || "").slice(0, 120),
    });
  }
  sendDiceRoll(value, sides = 20, at = Date.now()) {
    if (this.role === "visitor") return;
    const safeSides = Math.max(2, Math.min(20, Number(sides) || 20));
    const roll = Math.max(1, Math.min(safeSides, Number(value) || 1));
    this.room?.send({ type: "dice-roll", value: roll, sides: safeSides, at });
  }
  setVideoCounter(counter) {
    if (this.role === "visitor") return;
    const safeCounter = normalizeVideoCounter(counter);
    if (!safeCounter) return;
    const exists = this.videoCounters.some((item) => item.id === safeCounter.id);
    this.videoCounters = (exists
      ? this.videoCounters.map((item) => item.id === safeCounter.id ? safeCounter : item)
      : [...this.videoCounters, safeCounter]).slice(-24);
    this._persistPlayerState();
    this.room?.send({ type: "video-counter", counter: safeCounter });
  }
  removeVideoCounter(counterId) {
    if (this.role === "visitor") return;
    const safeId = String(counterId || "").slice(0, 64);
    if (!safeId) return;
    this.videoCounters = this.videoCounters.filter((counter) => counter.id !== safeId);
    this._persistPlayerState();
    this.room?.send({ type: "video-counter-remove", counterId: safeId });
  }

  requestVideoQuality(peerId, quality) {
    const targetId = String(peerId || "").slice(0, 40);
    const safeQuality = normalizeVideoQuality(quality);
    if (!targetId || targetId === this.myId || !this.roster.some((member) => member.id === targetId)) return false;
    this.room?.send({ type: "video-quality", quality: safeQuality }, targetId);
    return true;
  }

  toggleTrack(kind, enabled) {
    if (this.role === "visitor" && kind === "video") return;
    for (const t of this.localStream?.getTracks() || []) if (t.kind === kind) t.enabled = enabled;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this._stopNetworkMonitoring();
    this._stopLifecycleHeartbeat();
    for (const timer of this.departureTimers.values()) clearTimeout(timer);
    this.departureTimers.clear();
    for (const p of this.peers.values()) {
      if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
      p.pc.close();
    }
    this.peers.clear();
    this.room?.leave();
    for (const t of this.localStream?.getTracks() || []) t.stop();
  }

  async leaveIntentionally() {
    this._markLifecycle("intentional-leave");
    this._diagnostic("intentional-leave", {
      subjectId: this.myId || this.participantId,
      details: { local: true },
      persist: true,
    });
    try {
      await Promise.race([
        this.room?.announceLeave?.(),
        new Promise((resolve) => setTimeout(resolve, 300)),
      ]);
    } catch { /* presence removal still completes below */ }
    this.close();
    this._removeSessionValue(this._playerStateKey());
    this._removeSessionValue(this._lifecycleKey());
  }
}

// Production connectivity diagnostic. It gathers relay-only ICE candidates
// without opening a camera/microphone or connecting to another player. The
// result deliberately excludes the short-lived username and credential.
export async function testTurnConnectivity(roomCode = "ABC234") {
  const connection = new GameConnection({});
  await connection._configureIceServers(String(roomCode).toUpperCase());
  if (connection.turnStatus !== "ready") {
    return { status: "unavailable", relayCandidates: 0 };
  }

  const pc = new RTCPeerConnection({
    iceServers: connection.iceServers,
    iceTransportPolicy: "relay",
  });
  const candidates = [];
  try {
    const gathering = new Promise((resolve) => {
      const timeout = setTimeout(resolve, 10000);
      pc.onicecandidate = (event) => {
        if (!event.candidate) {
          clearTimeout(timeout);
          resolve();
          return;
        }
        const candidate = event.candidate;
        const relay = candidate.type === "relay" || /\styp relay\s/i.test(candidate.candidate);
        if (relay) {
          candidates.push({
            protocol: candidate.protocol || (/\sudp\s/i.test(candidate.candidate) ? "udp" : "tcp"),
            relayProtocol: candidate.relayProtocol || null,
          });
        }
      };
    });
    pc.createDataChannel("turn-diagnostic");
    await pc.setLocalDescription(await pc.createOffer());
    await gathering;
    return {
      status: candidates.length ? "ready" : "no-relay-candidate",
      relayCandidates: candidates.length,
      protocols: [...new Set(candidates.flatMap((candidate) => [candidate.protocol, candidate.relayProtocol]).filter(Boolean))],
    };
  } catch (error) {
    return { status: "error", relayCandidates: 0, reason: String(error?.message || error) };
  } finally {
    pc.close();
  }
}

if (typeof window !== "undefined") window.__scTestTurn = testTurnConnectivity;

// Recognition capture: a native-resolution crop centered on the clicked point.
// Never downscales — a card that fills 1/10th of a playmat frame keeps every
// pixel the sensor recorded, which is what makes small-card OCR and hashing
// possible. The clicked point always maps to the crop center (out-of-frame
// areas pad with black), so downstream code can assume {nx:0.5, ny:0.5}.
// Takes the sharpest of three frames to dodge motion blur and autofocus hunts.
export async function captureLocalFrame(stream, nx = 0.5, ny = 0.5) {
  const track = stream?.getVideoTracks()[0];
  if (!track) throw new Error("no local video");
  const video = document.createElement("video");
  video.srcObject = new MediaStream([track]);
  video.muted = true;
  await video.play();
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) throw new Error("camera frame is not ready");
  // The crop is clamped inside the frame (see cropGeometry): a card held beside
  // the head puts the click near a frame border, and an unclamped crop filled
  // 30%+ of the capture with black — throwing away real pixels and skewing the
  // color signature, gradient score and hash toward a featureless region.
  const geom = cropGeometry(w, h, nx, ny);
  const { side } = geom;

  const grab = () => {
    const canvas = document.createElement("canvas");
    canvas.width = side; canvas.height = side;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, side, side);
    ctx.drawImage(video, geom.sx, geom.sy, side, side, 0, 0, side, side);
    return canvas;
  };
  const sharpness = (canvas) => {
    // Variance of a simple gradient on a small gray thumbnail — enough to
    // rank motion blur without noticeable cost.
    const t = document.createElement("canvas");
    t.width = 160; t.height = 160;
    t.getContext("2d").drawImage(canvas, 0, 0, 160, 160);
    const d = t.getContext("2d").getImageData(0, 0, 160, 160).data;
    let sum = 0, sumSq = 0, count = 0;
    for (let y = 1; y < 159; y++) {
      for (let x = 1; x < 159; x++) {
        const i = (y * 160 + x) * 4;
        const g = (d[i] + d[i + 1] + d[i + 2]) / 3;
        const gx = (d[i + 4] + d[i + 5] + d[i + 6]) / 3 - g;
        const gy = (d[i + 640] + d[i + 641] + d[i + 642]) / 3 - g;
        const e = gx * gx + gy * gy;
        sum += e; sumSq += e * e; count++;
      }
    }
    const mean = sum / count;
    return sumSq / count - mean * mean;
  };

  let best = grab(), bestScore = sharpness(best);
  for (let i = 0; i < 2; i++) {
    await new Promise((r) => setTimeout(r, 120));
    const next = grab();
    const score = sharpness(next);
    if (score > bestScore) { best = next; bestScore = score; }
  }
  video.pause(); video.srcObject = null;
  // px/py is where the click landed *inside* the crop. It is 0.5,0.5 unless the
  // crop was clamped away from a frame edge, in which case the caller needs the
  // real position so downstream crops still center on the card.
  return { url: best.toDataURL("image/jpeg", 0.9), px: geom.px, py: geom.py };
}

// Map a click on a fitted video to normalized source coordinates. A local 180°
// display flip changes only where the image is painted, so reflect both axes
// before translating the visible point back into the unmodified stream.
export function clickToNormalized(videoEl, clientX, clientY, flipped = false) {
  const rect = videoEl.getBoundingClientRect();
  const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
  if (!vw || !vh) return null;
  const fit = getComputedStyle(videoEl).objectFit;
  const scale = fit === "contain"
    ? Math.min(rect.width / vw, rect.height / vh)
    : Math.max(rect.width / vw, rect.height / vh);
  const renderedWidth = vw * scale;
  const renderedHeight = vh * scale;
  const offX = (rect.width - renderedWidth) / 2;
  const offY = (rect.height - renderedHeight) / 2;
  let x = clientX - rect.left;
  let y = clientY - rect.top;
  if (flipped) {
    x = rect.width - x;
    y = rect.height - y;
  }
  // A letterbox/pillarbox click is not a card click.
  if (fit === "contain" && (x < offX || x > offX + renderedWidth || y < offY || y > offY + renderedHeight)) return null;
  const sx = (x - offX) / scale;
  const sy = (y - offY) / scale;
  return { nx: Math.max(0, Math.min(1, sx / vw)), ny: Math.max(0, Math.min(1, sy / vh)) };
}
