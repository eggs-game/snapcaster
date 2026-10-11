import { cropGeometry } from "./captureGeometry.js";
import { isLoopbackHost } from "./localMock.js";
import { normalizeVideoCounter } from "./videoCounters.js";

// This transport never opens a signaling room or asks for real media devices.
// Canvas streams exercise the production video elements and card capture UI.
export default class LocalMockGameConnection {
  constructor(handlers, mockGame) {
    if (!isLoopbackHost()) throw new Error("Local game simulation is available only on loopback hosts.");
    this.h = handlers;
    this.mockGame = mockGame;
    this.myId = mockGame.localId;
    this.roster = structuredClone(mockGame.roster || []);
    this.state = structuredClone(mockGame);
    for (const key of ["lives", "poison", "commanderDamage", "eliminations", "videoCounters", "commanders", "commanderPartners", "commanderPartnerTypes", "colors"]) this.state[key] ||= {};
    this.localStream = typeof MediaStream === "function" ? new MediaStream() : null;
    this.videoDeviceId = "";
    this.audioDeviceId = "";
    this.muted = false;
    this.closed = false;
    this.boards = new Map();
    this.timers = new Set();
    this.events = [];
    this.readyCheckId = "";
    this.options = mockGame.simulation;
  }

  _record(type, details = {}) {
    this.events.push({ type, ...details, at: Date.now() });
    this.events = this.events.slice(-200);
  }

  _later(action, delay = 250) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.closed) action();
    }, delay);
    this.timers.add(timer);
  }

  async initMedia({ audioOnly = false, startMuted = false } = {}) {
    if (this.closed) throw new Error("Local game simulation has closed.");
    this.muted = !!startMuted;
    if (!this.options) return this.localStream;
    for (const member of this.roster.filter((player) => player.role !== "visitor" && (!audioOnly || player.id !== this.myId))) {
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      const board = { canvas, cards: [], stream: null };
      const cards = this.options.boards?.[member.id] || this.options.cards || [];
      for (const card of cards.slice(0, 6)) {
        // Only existing local fixtures may become a capture; never fetch a peer URL.
        if (!/^\/snaptest\/arcane\/(light|medium|heavy)\/[a-z0-9_-]+\.jpg$/i.test(card.url || "")) continue;
        const image = new Image();
        await new Promise((resolve) => { image.onload = resolve; image.onerror = resolve; image.src = card.url; });
        if (this.closed) throw new Error("Local game simulation has closed.");
        if (image.naturalWidth) board.cards.push({ ...card, image });
      }
      this._drawBoard(member, board);
      if (typeof canvas.captureStream === "function") board.stream = canvas.captureStream(8);
      this.boards.set(member.id, board);
      if (member.id === this.myId && board.stream) {
        this.localStream = board.stream;
        this.videoDeviceId = "local-simulated-camera";
      }
    }
    // Canvas capture tracks need refreshed frames in browsers without requestFrame.
    this.repaintTimer = setInterval(() => {
      for (const member of this.roster) {
        const board = this.boards.get(member.id);
        if (board) this._drawBoard(member, board);
      }
    }, 500);
    return this.localStream;
  }

  _drawBoard(member, board) {
    const ctx = board.canvas.getContext("2d");
    ctx.fillStyle = this.state.colors?.[member.id] || "#354237";
    ctx.fillRect(0, 0, 1280, 720);
    ctx.fillStyle = "rgba(0,0,0,.24)";
    ctx.fillRect(0, 0, 1280, 720);
    ctx.fillStyle = "#fff";
    ctx.font = "24px system-ui";
    ctx.fillText(`${member.name} · simulated table`, 28, 42);
    board.cards.forEach((card, index) => {
      const x = Number(card.x) || 250 + index * 340;
      const y = Number(card.y) || 380;
      const height = Number(card.height) || 430;
      const width = height * card.image.naturalWidth / card.image.naturalHeight;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((Number(card.rotation) || 0) * Math.PI / 180);
      ctx.drawImage(card.image, -width / 2, -height / 2, width, height);
      ctx.restore();
    });
    board.stream?.getVideoTracks()[0]?.requestFrame?.();
  }

  async listDevices() {
    return { cameras: this.options ? [{ deviceId: "local-simulated-camera", label: "Simulated table camera", kind: "videoinput" }] : [], mics: [] };
  }

  async join(code, name, role = "player") {
    if (this.closed) throw new Error("Local game simulation has closed.");
    this.role = role;
    const me = this.roster.find((member) => member.id === this.myId);
    if (me) me.name = name || me.name;
    this.h.onRoster?.(this.roster);
    for (const member of this.roster.filter((player) => player.id !== this.myId && player.role !== "visitor")) {
      const board = this.boards.get(member.id);
      if (board?.stream) this.h.onRemoteStream?.(member.id, board.stream);
      for (const counter of this.state.videoCounters?.[member.id] || []) this.h.onVideoCounter?.(member.id, counter);
    }
    if (this.options) {
      this.control = Object.freeze({
        snapshot: () => structuredClone({ ...this.state, roster: this.roster, events: this.events }),
        receive: (peerId, type, payload = {}) => this.receive(peerId, type, payload),
        disconnect: (peerId) => this.disconnect(peerId),
        reconnect: (peerId) => this.reconnect(peerId),
        capture: (peerId, nx = .5, ny = .5) => this.requestRemoteCapture(peerId, nx, ny),
      });
      window.__scLocalGame = this.control;
      this._record("joined", { code });
    }
    return this.myId;
  }

  receive(peerId, type, payload = {}) {
    if (this.closed || !this.roster.some((member) => member.id === peerId && member.id !== this.myId)) return false;
    const value = Math.max(0, Math.min(99, Number(payload.value) || 0));
    const text = String(payload.text || "").trim().slice(0, 500);
    const member = this.roster.find((player) => player.id === peerId);
    if (member.role === "visitor" && !["chat", "whisper", "muted", "camera-enabled"].includes(type)) return false;
    switch (type) {
      case "life": {
        const life = Math.max(0, Number(payload.value) || 0);
        this.state.lives[peerId] = life; this.h.onLife?.(peerId, life); break;
      }
      case "poison": this.state.poison[peerId] = value; this.h.onPoison?.(peerId, value); break;
      case "commander-damage": {
        const attackerId = String(payload.attackerId || "");
        const ownerId = attackerId.startsWith("p:") ? attackerId.slice(2) : attackerId;
        if (!this.roster.some((player) => player.id === ownerId && player.role !== "visitor")) return false;
        this.state.commanderDamage[peerId] = { ...this.state.commanderDamage[peerId], [attackerId]: value };
        this.h.onCommanderDamage?.(peerId, attackerId, value, String(payload.commanderName || ""));
        break;
      }
      case "chat": case "whisper":
        if (!text && !payload.soundId) return false;
        {
          const message = { from: peerId, name: member.name, text, at: Date.now(), soundId: payload.soundId || "", ...(type === "whisper" ? { whisper: true, to: this.myId, toName: this.roster.find((player) => player.id === this.myId)?.name || "You" } : {}) };
          this.state.chat = [...(this.state.chat || []), message].slice(-100);
          this.h.onChat?.(message);
        }
        break;
      case "dice-roll": this.h.onDiceRoll?.({ from: peerId, name: member.name, sides: 20, value: Math.max(1, Math.min(20, value)), at: Date.now() }); break;
      case "active-player": this.state.activePlayerId = peerId; this.h.onActivePlayer?.(peerId); break;
      case "muted":
        this.state.mutedPlayers = { ...this.state.mutedPlayers, [peerId]: !!payload.muted };
        this.h.onMuted?.(peerId, !!payload.muted); break;
      case "camera-enabled":
        this.state.cameraEnabledByPlayer = { ...this.state.cameraEnabledByPlayer, [peerId]: !!payload.enabled };
        for (const track of this.boards.get(peerId)?.stream?.getVideoTracks() || []) track.enabled = !!payload.enabled;
        this.h.onCameraEnabled?.(peerId, !!payload.enabled); break;
      case "ready": this.h.onReadyCheckResponse?.({ checkId: this.readyCheckId, playerId: peerId, ready: payload.ready !== false }); break;
      case "video-counter": {
        const counter = normalizeVideoCounter(payload.counter);
        if (!counter) return false;
        const current = this.state.videoCounters[peerId] || [];
        this.state.videoCounters[peerId] = [...current.filter((item) => item.id !== counter.id), counter].slice(-24);
        this.h.onVideoCounter?.(peerId, counter); break;
      }
      case "video-counter-remove":
        this.state.videoCounters[peerId] = (this.state.videoCounters[peerId] || []).filter((counter) => counter.id !== String(payload.id || ""));
        this.h.onVideoCounterRemove?.(peerId, String(payload.id || "")); break;
      case "elimination": {
        const reason = ["life", "poison", "commander_damage", "concede", "other", "unknown", ""].includes(payload.reason) ? payload.reason : "unknown";
        if (reason) this.state.eliminations[peerId] = reason;
        else delete this.state.eliminations[peerId];
        this.h.onElimination?.(peerId, reason); break;
      }
      case "card-identified": this.h.onCardIdentified?.({ from: peerId, byName: member.name, card: payload.card, at: Date.now() }); break;
      default: return false;
    }
    this._record(type, { from: peerId });
    return true;
  }

  disconnect(peerId) {
    if (!this.roster.some((member) => member.id === peerId && peerId !== this.myId)) return false;
    this.h.onPeerReconnecting?.(peerId, true);
    this._record("disconnected", { from: peerId });
    return true;
  }

  reconnect(peerId) {
    const member = this.roster.find((player) => player.id === peerId && peerId !== this.myId);
    if (!member) return false;
    this.h.onPeerReconnecting?.(peerId, false);
    if (this.boards.get(peerId)?.stream) this.h.onRemoteStream?.(peerId, this.boards.get(peerId).stream);
    this._record("reconnected", { from: peerId });
    return true;
  }

  removePeer(peerId) {
    if (peerId === this.myId || !this.roster.some((member) => member.id === peerId)) return false;
    for (const track of this.boards.get(peerId)?.stream?.getTracks() || []) track.stop();
    this.boards.delete(peerId);
    this.roster = this.roster.filter((member) => member.id !== peerId);
    this.h.onPeerLeft?.(peerId);
    this.h.onRoster?.(this.roster);
    this._record("removed", { from: peerId });
    return true;
  }

  async requestRemoteCapture(peerId, nx = .5, ny = .5) {
    const member = this.roster.find((player) => player.id === peerId && player.role !== "visitor");
    const board = member && this.boards.get(peerId);
    if (this.closed || !board || !Number.isFinite(nx) || !Number.isFinite(ny)) throw new Error("Simulated camera frame is unavailable.");
    const geometry = cropGeometry(board.canvas.width, board.canvas.height, nx, ny);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = geometry.side;
    canvas.getContext("2d").drawImage(board.canvas, geometry.sx, geometry.sy, geometry.side, geometry.side, 0, 0, geometry.side, geometry.side);
    const blob = await new Promise((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Could not encode simulated capture.")), "image/jpeg", .9));
    this._record("capture", { from: peerId, nx, ny });
    return { blob, url: URL.createObjectURL(blob), bytes: blob.size, px: geometry.px, py: geometry.py };
  }

  _own(key, value) { if (this.role !== "visitor") { this.state[key] ||= {}; this.state[key][this.myId] = value; } }
  setLife(value) { this._own("lives", Math.max(0, Number(value) || 0)); }
  setLobbyName(name) { this.state.lobbyName = String(name || "").slice(0, 48); }
  setCommander(value) { this._own("commanders", value); }
  setCommanderPartner(value, typeLine = "") { this._own("commanderPartners", value); this._own("commanderPartnerTypes", typeLine); }
  setColor(value) { this._own("colors", value); }
  setMuted(muted) { this.muted = !!muted; this.state.muted = this.muted; }
  setCameraEnabled(enabled) { this.cameraEnabled = !!enabled; this.state.cameraEnabled = this.cameraEnabled; }
  setActivePlayer(id) { this.state.activePlayerId = id; }
  setGridOrder(order) { this.state.gridOrder = [...order]; }
  setPoison(value) { this._own("poison", value); }
  setCommanderDamage(id, value) { this._own("commanderDamage", { ...this.state.commanderDamage[this.myId], [id]: value }); }
  setElimination(reason) { this._own("eliminations", reason); }
  announceCard(card, byName, at) { this._record("outgoing-card", { card, byName, at }); }
  announceRecognitionHint(hint) { this._record("outgoing-recognition-hint", { hint }); }
  sendChat(text, at, soundId) { this._record("outgoing-chat", { text, at, soundId }); }
  sendWhisper(peerId, text) {
    if (this.closed || !text?.trim() || !this.roster.some((member) => member.id === peerId && peerId !== this.myId)) return false;
    this._record("outgoing-whisper", { to: peerId, text });
    if (this.options?.autoWhisper !== false) this._later(() => this.receive(peerId, "whisper", { text: "Got your whisper. No responses from me." }));
    return true;
  }
  sendDiceRoll(value, sides) { this._record("outgoing-dice", { value, sides }); }
  startReadyCheck(checkId, expiresAt) {
    this.readyCheckId = checkId;
    this._record("ready-check", { checkId, expiresAt });
    if (this.options?.autoReady !== false) this.roster.filter((member) => member.role !== "visitor" && member.id !== this.myId).forEach((member, index) => this._later(() => {
      if (this.readyCheckId === checkId && Date.now() < expiresAt) this.receive(member.id, "ready");
    }, 350 + index * 250));
  }
  respondReady() {}
  endReadyCheck(checkId) { if (this.readyCheckId === checkId) this.readyCheckId = ""; }
  setVideoCounter(counter) {
    const safe = normalizeVideoCounter(counter);
    if (!safe) return;
    const mine = this.state.videoCounters?.[this.myId] || [];
    this._own("videoCounters", [...mine.filter((item) => item.id !== safe.id), safe].slice(-24));
  }
  removeVideoCounter(id) { this._own("videoCounters", (this.state.videoCounters?.[this.myId] || []).filter((counter) => counter.id !== id)); }
  toggleTrack(kind, enabled) { for (const track of this.localStream?.getTracks() || []) if (track.kind === kind) track.enabled = enabled; }
  switchDevice() { return Promise.resolve(); }
  requestVideoQuality(peerId, quality) { this._record("video-quality", { peerId, quality }); return !this.closed && this.boards.has(peerId); }
  setOutgoingVideoQuality(quality) { this.state.outgoingVideoQuality = quality; return Promise.resolve(quality); }
  setMembershipStates() {}
  setAllowedMemberships() {}
  rotateRealtimeEpoch() { return Promise.resolve(); }
  requestMembershipRefresh() {}
  resetTableState() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const [ownerId, counters] of Object.entries(this.state.videoCounters || {})) {
      for (const counter of counters) this.h.onVideoCounterRemove?.(ownerId, counter.id);
    }
    this.readyCheckId = "";
    this.state.lives = Object.fromEntries(this.roster.filter((member) => member.role !== "visitor").map((member) => [member.id, 40]));
    for (const key of ["poison", "commanderDamage", "eliminations", "videoCounters", "commanders", "commanderPartners", "commanderPartnerTypes"]) this.state[key] = {};
    this.state.activePlayerId = this.roster.find((member) => member.role !== "visitor")?.id || "";
    this.state.status = "lobby";
    this.state.startedAt = "";
    this._record("table-reset");
  }
  leaveIntentionally() { this.close(); return Promise.resolve(); }
  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.repaintTimer);
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const board of this.boards.values()) for (const track of board.stream?.getTracks() || []) track.stop();
    for (const track of this.localStream?.getTracks() || []) track.stop();
    this.boards.clear();
    if (typeof window !== "undefined" && window.__scLocalGame === this.control) delete window.__scLocalGame;
  }
}
