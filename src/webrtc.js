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

export class GameConnection {
  constructor(handlers) {
    // handlers: onRoster, onRemoteStream, onPeerLeft, onLife,
    // onCommander, onCardIdentified, onError
    this.h = handlers;
    this.peers = new Map();     // peerId -> {pc, dc, chunks: Map}
    this.pending = new Map();   // requestId -> {resolve, reject, timer}
    this.localStream = null;
    this.room = null;
    this.myId = null;
    this.knownIds = new Set();
    this.commander = "";
  }

  async initMedia() {
    this.localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    return this.localStream;
  }

  async join(code, name) {
    this.room = await joinRoom(code, name, {
      onRoster: (roster) => this._onRoster(roster),
      onMessage: (msg) => this._onSignal(msg),
    });
    this.myId = this.room.myId;
    return this.myId;
  }

  _onRoster(roster) {
    if (roster.length > 4) {
      const me = roster.find((r) => r.id === this.myId);
      const myRank = roster.indexOf(me);
      if (myRank >= 4) {
        this.h.onError?.("Game is full (4 players max)");
        this.close();
        return;
      }
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
    this.h.onRoster?.(roster.slice(0, 4));
    if (this.commander) this.room?.send({ type: "commander", commander: this.commander });
  }

  async _onSignal(msg) {
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
      case "life": this.h.onLife?.(msg.from, msg.life); break;
      case "commander": this.h.onCommander?.(msg.from, String(msg.commander || "").slice(0, 120)); break;
      case "card-identified": this.h.onCardIdentified?.(msg); break;
    }
  }

  _getPeer(peerId) {
    if (this.peers.has(peerId)) return this.peers.get(peerId);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const entry = { pc, dc: null, chunks: new Map() };
    this.peers.set(peerId, entry);
    for (const t of this.localStream?.getTracks() || []) pc.addTrack(t, this.localStream);
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
          const image = await captureLocalFrame(this.localStream);
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

  setLife(life) { this.room?.send({ type: "life", life }); }
  setCommander(commander) {
    this.commander = String(commander || "").trim().slice(0, 120);
    this.room?.send({ type: "commander", commander: this.commander });
  }
  announceCard(card, byName) { this.room?.send({ type: "card-identified", card, byName }); }

  toggleTrack(kind, enabled) {
    for (const t of this.localStream?.getTracks() || []) if (t.kind === kind) t.enabled = enabled;
  }

  close() {
    for (const p of this.peers.values()) p.pc.close();
    this.peers.clear();
    this.room?.leave();
    for (const t of this.localStream?.getTracks() || []) t.stop();
  }
}

// Stable camera frame used for recognition. The click point is sent separately
// so clicking different parts of one card never changes the source image.
export async function captureLocalFrame(stream) {
  const track = stream?.getVideoTracks()[0];
  if (!track) throw new Error("no local video");
  const video = document.createElement("video");
  video.srcObject = new MediaStream([track]);
  video.muted = true;
  await video.play();
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) throw new Error("camera frame is not ready");
  // 1280px retains enough card detail while keeping remote data-channel
  // transfers and OpenCV contour detection fast.
  const scale = Math.min(1, 1280 / w);
  const outW = Math.round(w * scale), outH = Math.round(h * scale);
  const canvas = document.createElement("canvas");
  canvas.width = outW; canvas.height = outH;
  canvas.getContext("2d").drawImage(video, 0, 0, w, h, 0, 0, outW, outH);
  video.pause(); video.srcObject = null;
  return canvas.toDataURL("image/jpeg", 0.86);
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
