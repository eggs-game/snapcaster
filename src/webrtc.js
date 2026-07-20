// WebRTC 4-player mesh over Supabase signaling.
// Data channels carry high-res capture requests/responses (chunked JSON).
import { joinRoom } from "./signaling.js";

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
if (import.meta.env.VITE_TURN_URL) {
  ICE_SERVERS.push({
    urls: import.meta.env.VITE_TURN_URL,
    username: import.meta.env.VITE_TURN_USER,
    credential: import.meta.env.VITE_TURN_PASS,
  });
}

const CHUNK = 12000; // chars per data-channel chunk
const MAX_VISITORS = 8; // peer-to-peer video fan-out is not an unlimited broadcast service

export class GameConnection {
  constructor(handlers) {
    // handlers: onRoster, onRemoteStream, onPeerLeft, onLife,
    // onCommander, onColor, onCardIdentified, onChat, onActivePlayer, onError
    this.h = handlers;
    this.peers = new Map();     // peerId -> {pc, dc, chunks: Map}
    this.pending = new Map();   // requestId -> {resolve, reject, timer}
    this.localStream = null;
    this.room = null;
    this.myId = null;
    this.knownIds = new Set();
    this.commander = "";
    this.color = "";
    this.muted = false;
    this.life = 40;
    this.lobbyName = "";
    this.activePlayerId = "";
    this.role = "player";
    this.roster = [];
    this.videoDeviceId = "";
    this.audioDeviceId = "";
  }

  async initMedia({ audioOnly = false, videoDeviceId = "", audioDeviceId = "" } = {}) {
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

    // Push the new track to peers before tearing down the old one.
    for (const { pc } of this.peers.values()) {
      const sender = pc.getSenders().find((s) => s.track?.kind === kind);
      if (sender) await sender.replaceTrack(newTrack);
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

  async join(code, name, role = "player") {
    this.role = role === "visitor" ? "visitor" : "player";
    this.room = await joinRoom(code, name, this.role, {
      onRoster: (roster) => {
        // Presence can sync before joinRoom has returned our ID.
        if (!this.myId) this.roster = roster;
        else this._onRoster(roster);
      },
      onMessage: (msg) => this._onSignal(msg),
    });
    this.myId = this.room.myId;
    this._onRoster(this.roster);
    return this.myId;
  }

  _onRoster(roster) {
    this.roster = roster;
    // Presence can sync before our own track has propagated, giving a roster
    // that lists existing members but not us. Deciding offers from such a
    // snapshot marks every existing peer as "known" without ever offering to
    // them — they would never get our connection (visitors saw no video at
    // all). Render the roster, but defer connection decisions until a sync
    // that includes us arrives.
    if (this.myId && !roster.some((r) => r.id === this.myId)) {
      this.h.onRoster?.(roster);
      return;
    }
    const players = roster.filter((r) => r.role !== "visitor");
    const visitors = roster.filter((r) => r.role === "visitor");
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
    const ids = new Set(roster.map((r) => r.id));
    // peers that left
    for (const id of [...this.peers.keys()]) {
      if (!ids.has(id)) {
        this.peers.get(id).pc.close();
        this.peers.delete(id);
        this.h.onPeerLeft?.(id);
      }
    }
    // I initiate offers to everyone who joined BEFORE me (newcomer initiates)
    const me = roster.find((r) => r.id === this.myId);
    for (const r of roster) {
      if (r.id === this.myId || this.knownIds.has(r.id)) continue;
      this.knownIds.add(r.id);
      if (me && r.joinedAt < me.joinedAt) this._makeOffer(r.id);
    }
    this.h.onRoster?.(roster);
    if (this.role === "player") {
      this.room?.send({ type: "life", life: this.life });
      if (this.lobbyName) this.room?.send({ type: "lobby-name", lobbyName: this.lobbyName });
      if (this.commander) this.room?.send({ type: "commander", commander: this.commander });
      if (this.color) this.room?.send({ type: "color", color: this.color });
      if (this.activePlayerId) this.room?.send({ type: "active-player", playerId: this.activePlayerId });
    }
    if (this.muted) this.room?.send({ type: "muted", muted: true });
  }

  async _onSignal(msg) {
    const senderRole = this.roster.find((r) => r.id === msg.from)?.role || "player";
    switch (msg.type) {
      case "offer": {
        const p = this._getPeer(msg.from);
        await p.pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
        const answer = await p.pc.createAnswer();
        await p.pc.setLocalDescription(answer);
        this.room.send({ type: "answer", sdp: answer.sdp }, msg.from);
        break;
      }
      case "answer":
        await this.peers.get(msg.from)?.pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
        break;
      case "ice":
        try { await this.peers.get(msg.from)?.pc.addIceCandidate(msg.candidate); } catch { /* ignore */ }
        break;
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
      case "color":
        if (senderRole !== "visitor") this.h.onColor?.(msg.from, String(msg.color || "").slice(0, 20));
        break;
      case "muted": this.h.onMuted?.(msg.from, !!msg.muted); break;
      case "card-identified":
        if (senderRole !== "visitor") this.h.onCardIdentified?.(msg);
        break;
      case "chat": {
        const text = String(msg.text || "").trim().slice(0, 500);
        if (!text) break;
        const sender = this.roster.find((member) => member.id === msg.from);
        this.h.onChat?.({
          from: msg.from,
          name: sender?.name || (senderRole === "visitor" ? "Visitor" : "Player"),
          text,
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
    }
  }

  _getPeer(peerId) {
    if (this.peers.has(peerId)) return this.peers.get(peerId);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const entry = { pc, dc: null, chunks: new Map() };
    this.peers.set(peerId, entry);
    for (const t of this.localStream?.getTracks() || []) pc.addTrack(t, this.localStream);
    // An audio-only visitor still needs a video m-line in offers so players
    // can send their camera feed back to the visitor.
    if (this.role === "visitor") pc.addTransceiver("video", { direction: "recvonly" });
    pc.onicecandidate = (e) => e.candidate && this.room.send({ type: "ice", candidate: e.candidate }, peerId);
    pc.ontrack = (e) => this.h.onRemoteStream?.(peerId, e.streams[0]);
    pc.ondatachannel = (e) => this._setupDC(peerId, e.channel);
    return entry;
  }

  async _makeOffer(peerId) {
    const p = this._getPeer(peerId);
    this._setupDC(peerId, p.pc.createDataChannel("ctrl"));
    const offer = await p.pc.createOffer();
    await p.pc.setLocalDescription(offer);
    this.room.send({ type: "offer", sdp: offer.sdp }, peerId);
  }

  _setupDC(peerId, dc) {
    const entry = this.peers.get(peerId);
    entry.dc = dc;
    dc.onmessage = async (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === "cap-req") {
        try {
          const image = await captureLocalFrame(this.localStream, m.nx, m.ny);
          this._sendChunked(peerId, { t: "cap-res", id: m.id }, image);
        } catch (err) {
          this._dcSend(peerId, { t: "cap-res", id: m.id, error: String(err) });
        }
      } else if (m.t === "cap-res") {
        if (m.error) this._resolveCapture(m.id, null, m.error);
        else if (m.n === undefined) this._resolveCapture(m.id, m.data);
      } else if (m.t === "chunk") {
        const key = m.id;
        if (!entry.chunks.has(key)) entry.chunks.set(key, { parts: new Array(m.n), got: 0 });
        const buf = entry.chunks.get(key);
        if (buf.parts[m.i] === undefined) { buf.parts[m.i] = m.part; buf.got++; }
        if (buf.got === m.n) {
          entry.chunks.delete(key);
          this._resolveCapture(key, buf.parts.join(""));
        }
      }
    };
  }

  _dcSend(peerId, obj) {
    const dc = this.peers.get(peerId)?.dc;
    if (dc?.readyState === "open") dc.send(JSON.stringify(obj));
  }

  _sendChunked(peerId, header, data) {
    const n = Math.ceil(data.length / CHUNK);
    for (let i = 0; i < n; i++) {
      this._dcSend(peerId, { t: "chunk", id: header.id, i, n, part: data.slice(i * CHUNK, (i + 1) * CHUNK) });
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
    this.life = Number(life);
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
    this.room?.send({ type: "commander", commander: this.commander });
  }
  setColor(color) {
    if (this.role === "visitor") return;
    this.color = String(color || "").trim().slice(0, 20);
    this.room?.send({ type: "color", color: this.color });
  }
  setMuted(muted) {
    this.muted = !!muted;
    this.room?.send({ type: "muted", muted: this.muted });
  }
  announceCard(card, byName) {
    if (this.role === "visitor") return;
    this.room?.send({ type: "card-identified", card, byName });
  }
  sendChat(text, at = Date.now()) {
    const message = String(text || "").trim().slice(0, 500);
    if (!message) return;
    this.room?.send({ type: "chat", text: message, at });
  }
  setActivePlayer(playerId) {
    if (this.role === "visitor") return;
    this.activePlayerId = String(playerId || "").slice(0, 40);
    if (this.activePlayerId) {
      this.room?.send({ type: "active-player", playerId: this.activePlayerId });
    }
  }

  toggleTrack(kind, enabled) {
    if (this.role === "visitor" && kind === "video") return;
    for (const t of this.localStream?.getTracks() || []) if (t.kind === kind) t.enabled = enabled;
  }

  close() {
    for (const p of this.peers.values()) p.pc.close();
    this.peers.clear();
    this.room?.leave();
    for (const t of this.localStream?.getTracks() || []) t.stop();
  }
}

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
  const side = Math.round(Math.min(w, h) * 0.55);
  const cx = Math.max(0, Math.min(1, nx)) * w;
  const cy = Math.max(0, Math.min(1, ny)) * h;

  const grab = () => {
    const canvas = document.createElement("canvas");
    canvas.width = side; canvas.height = side;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, side, side);
    ctx.drawImage(video, cx - side / 2, cy - side / 2, side, side, 0, 0, side, side);
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
  return best.toDataURL("image/jpeg", 0.9);
}

// Map click on an object-fit:cover video to normalized source coords.
export function clickToNormalized(videoEl, clientX, clientY) {
  const rect = videoEl.getBoundingClientRect();
  const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
  if (!vw || !vh) return null;
  const scale = Math.max(rect.width / vw, rect.height / vh);
  const offX = (vw * scale - rect.width) / 2, offY = (vh * scale - rect.height) / 2;
  const sx = (clientX - rect.left + offX) / scale;
  const sy = (clientY - rect.top + offY) / scale;
  return { nx: Math.max(0, Math.min(1, sx / vw)), ny: Math.max(0, Math.min(1, sy / vh)) };
}
